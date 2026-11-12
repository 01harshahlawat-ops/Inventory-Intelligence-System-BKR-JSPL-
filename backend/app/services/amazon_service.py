import logging
import json
import time
import re
from datetime import datetime, timedelta
from typing import Tuple, Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.services.amazon_client import get_amazon_client
from app.models.schema import (
    Product, Warehouse, WarehouseType, WarehouseExternalMapping, AmazonSyncLog,
    AmazonLiveAllocation, AmazonOrderEventLog, AmazonDLQ, AmazonNetworkType, AllocationStatus, DLQType
)

logger = logging.getLogger(__name__)

class AmazonService:
    @staticmethod
    def normalize_amazon_sku(raw_sku: str, known_skus: dict, name_to_sku: dict = None, title: str = "") -> Optional[str]:
        """
        Normalizes Amazon SKUs strictly preserving variant suffixes per catalog rules:
        - Pattern: 2 alphabetic letters followed by 4+ digits and optional hyphen/space variant suffix.
        - Never strips variant suffixes (e.g. -1, -P, -S) to merge into a base SKU.
        """
        if not raw_sku:
            return None
        clean = " ".join(str(raw_sku).strip().upper().split())

        # 1. Exact match in known catalog
        if clean in known_skus:
            return known_skus[clean]

        # 2. Extract full SKU variant pattern (preserving hyphenated suffixes)
        variant_match = re.search(r'\b([A-Z]{2}\d{4}(?:-[A-Z0-9]+)+)\b', clean)
        if variant_match:
            token = variant_match.group(1)
            if token in known_skus:
                return known_skus[token]
            # Strict variant isolation: never downgrade a variant SKU to its base SKU
            return None

        # Check space-separated numeric variant like 'LG0726 1'
        space_variant = re.search(r'\b([A-Z]{2}\d{4}\s+[A-Z0-9]{1,3})\b', clean)
        if space_variant:
            token = space_variant.group(1)
            if token in known_skus:
                return known_skus[token]
            return None

        # 3. Standalone 6+ digit base SKU (only when no variant suffix is attached)
        base_match = re.search(r'\b([A-Z]{2}\d{4,})\b', clean)
        if base_match and base_match.group(1) in known_skus:
            return known_skus[base_match.group(1)]

        # 4. Check in item title if present (preserving any variant suffix)
        if title:
            title_upper = title.upper()
            m_title_var = re.search(r'\b([A-Z]{2}\d{4}(?:-[A-Z0-9]+)+)\b', title_upper)
            if m_title_var:
                return known_skus.get(m_title_var.group(1))
            m_title = re.search(r'\b([A-Z]{2}\d{4,})\b', title_upper)
            if m_title and m_title.group(1) in known_skus:
                return known_skus[m_title.group(1)]

        # 5. Check if raw_sku is a model number in product names (e.g., 18980-28 -> LG0995)
        if name_to_sku:
            for p_name, p_sku in name_to_sku.items():
                if clean in p_name:
                    return p_sku

        return None

    @staticmethod
    def sync_orders(
        db: Session, 
        company_id: int, 
        since: datetime = None, 
        force_backfill: bool = False,
        max_pages: int = None
    ) -> Dict[str, Any]:
        """
        Enterprise Amazon Order Synchronizer:
        - Auto-watermarks based on last successful sync or initial backfill date.
        - Streams pages with NextToken pagination.
        - Incremental page-level commits so data is never lost.
        - Skips expensive line item lookups for already-synced orders.
        - Records status in AmazonSyncLog.
        """
        start_time = datetime.utcnow()
        client = get_amazon_client()

        # 1. Determine sync start date
        if since is None:
            if force_backfill:
                since = datetime(2026, 8, 1)
            else:
                last_log = db.query(AmazonSyncLog).filter(
                    AmazonSyncLog.company_id == company_id,
                    AmazonSyncLog.status == "SUCCESS"
                ).order_by(AmazonSyncLog.id.desc()).first()

                watermark = None
                if last_log and last_log.api_response_status and last_log.api_response_status.startswith("watermark:"):
                    try:
                        watermark = datetime.fromisoformat(last_log.api_response_status.split("watermark:")[1])
                    except Exception:
                        pass

                if watermark:
                    since = watermark - timedelta(hours=2)
                else:
                    latest_alloc = db.query(func.max(AmazonLiveAllocation.updated_at)).filter(
                        AmazonLiveAllocation.company_id == company_id
                    ).scalar()
                    if latest_alloc:
                        since = latest_alloc - timedelta(hours=2)
                    else:
                        since = datetime(2026, 8, 1)

        sync_log = AmazonSyncLog(
            company_id=company_id,
            order_id=f"SYNC-{int(time.time())}",
            sync_start_time=start_time,
            status="IN_PROGRESS",
            orders_processed=0,
            skipped_duplicates=0,
            failed_items=0,
            unknown_skus="[]"
        )
        db.add(sync_log)
        db.commit()
        db.refresh(sync_log)

        # 2. Pre-fetch existing order IDs to optimize line item fetches
        existing_order_tuples = db.query(AmazonLiveAllocation.order_id).filter(
            AmazonLiveAllocation.company_id == company_id
        ).distinct().all()
        existing_ids = {r[0] for r in existing_order_tuples if r[0]}

        # 3. Resolve warehouse mappings
        # For JSPL (company_id=3), MFN orders map to JSPL IN warehouse (code 'IN')
        # For BKR (company_id=2), MFN orders map to BKR_CENTRAL
        mfn_wh = db.query(Warehouse).join(
            WarehouseExternalMapping, Warehouse.id == WarehouseExternalMapping.warehouse_id
        ).filter(
            Warehouse.company_id == company_id,
            WarehouseExternalMapping.amazon_network == AmazonNetworkType.MFN,
            Warehouse.status == "ACTIVE"
        ).first()

        if not mfn_wh:
            mfn_wh = db.query(Warehouse).filter(
                Warehouse.company_id == company_id,
                Warehouse.code.in_(("IN", "BKR_CENTRAL", "VSHB")),
                Warehouse.status == "ACTIVE"
            ).first()

        if not mfn_wh:
            mfn_wh = db.query(Warehouse).filter(
                Warehouse.company_id == company_id,
                Warehouse.warehouse_type == WarehouseType.CENTRAL,
                Warehouse.status == "ACTIVE"
            ).first()

        mfn_warehouse_id = mfn_wh.id if mfn_wh else None

        # AFN Warehouse: default AFN mapping or fallback
        afn_wh = db.query(Warehouse).join(
            WarehouseExternalMapping, Warehouse.id == WarehouseExternalMapping.warehouse_id
        ).filter(
            Warehouse.company_id == company_id,
            WarehouseExternalMapping.amazon_network == AmazonNetworkType.AFN,
            Warehouse.status == "ACTIVE"
        ).first()

        afn_warehouse_id = afn_wh.id if afn_wh else mfn_warehouse_id

        # Cache products for fast in-memory lookup
        products = db.query(Product.sku, Product.name).filter(Product.company_id == company_id).all()
        known_skus = {p.sku.strip().upper(): p.sku for p in products if p.sku}
        name_to_sku = {p.name.strip().upper(): p.sku for p in products if p.name and p.sku}

        # Status Map
        status_map = {
            "Pending": AllocationStatus.PENDING,
            "Unshipped": AllocationStatus.UNSHIPPED,
            "PartiallyShipped": AllocationStatus.UNSHIPPED,
            "Shipped": AllocationStatus.SHIPPED,
            "Canceled": AllocationStatus.CANCELLED,
            "InvoiceUnconfirmed": AllocationStatus.UNSHIPPED
        }

        counters = {
            "processed": 0,
            "skipped": 0,
            "failed": 0,
            "unknown_skus": set()
        }

        def process_page(orders_page: List[Dict[str, Any]]):
            for order in orders_page:
                order_id = order.get("order_id")
                amazon_status = order.get("status")
                channel = order.get("fulfillment_channel", "MFN")
                last_update_str = order.get("last_update_date")
                purchase_date_str = order.get("purchase_date")
                
                try:
                    last_update = datetime.fromisoformat(last_update_str.replace("Z", "+00:00")).replace(tzinfo=None) if last_update_str else datetime.utcnow()
                except Exception:
                    last_update = datetime.utcnow()

                try:
                    purchase_date = datetime.fromisoformat(purchase_date_str.replace("Z", "+00:00")).replace(tzinfo=None) if purchase_date_str else last_update
                except Exception:
                    purchase_date = last_update

                if "max_order_date" not in counters or (last_update and last_update > counters["max_order_date"]):
                    counters["max_order_date"] = last_update

                # Extract actual invoice number & date if present in amazon order payload
                raw_inv_no = order.get("invoice_number") or order.get("InvoiceNumber") or order.get("invoice_id")
                raw_inv_date = order.get("invoice_date") or order.get("InvoiceDate")
                inv_date = None
                if raw_inv_date:
                    try:
                        inv_date = datetime.fromisoformat(str(raw_inv_date).replace("Z", "+00:00")).replace(tzinfo=None)
                    except Exception:
                        inv_date = None
                if not inv_date:
                    inv_date = purchase_date  # Use order/purchase date, NOT sync timestamp!

                mapped_status = status_map.get(amazon_status, AllocationStatus.PENDING)
                network = AmazonNetworkType.MFN if channel == "MFN" else AmazonNetworkType.AFN
                target_warehouse_id = mfn_warehouse_id if network == AmazonNetworkType.MFN else afn_warehouse_id

                wh_code = "IN" if network == AmazonNetworkType.MFN else "AMZ"
                if target_warehouse_id:
                    wh_obj = db.query(Warehouse.code).filter(Warehouse.id == target_warehouse_id).first()
                    if wh_obj and wh_obj[0]:
                        wh_code = wh_obj[0].upper()
                # Resolve authoritative Amazon invoice number if provided; never synthesize fake sequential IN-xxx numbers
                existing_inv = db.query(AmazonLiveAllocation.invoice_number).filter(
                    AmazonLiveAllocation.order_id == order_id,
                    AmazonLiveAllocation.invoice_number.isnot(None),
                    AmazonLiveAllocation.invoice_number != ""
                ).first()

                if existing_inv and existing_inv[0]:
                    invoice_number = existing_inv[0]
                elif raw_inv_no:
                    invoice_number = str(raw_inv_no).strip()
                else:
                    invoice_number = None

                # If this order was already known and had no items fetched
                if order.get("is_known_order") and not order.get("items"):
                    existing_allocations = db.query(AmazonLiveAllocation).filter(
                        AmazonLiveAllocation.order_id == order_id,
                        AmazonLiveAllocation.company_id == company_id
                    ).all()

                    status_changed = False
                    for alloc in existing_allocations:
                        if alloc.status != mapped_status:
                            prev_status = alloc.status
                            alloc.status = mapped_status
                            alloc.updated_at = last_update
                            if mapped_status == AllocationStatus.CANCELLED:
                                alloc.closed = True
                                alloc.allocated_qty = alloc.reconciled_qty
                            
                            event = AmazonOrderEventLog(
                                allocation_id=alloc.id,
                                previous_status=prev_status.value,
                                new_status=mapped_status.value,
                                timestamp=datetime.utcnow()
                            )
                            db.add(event)
                            status_changed = True
                    
                    if status_changed:
                        counters["processed"] += 1
                    else:
                        counters["skipped"] += 1
                    continue

                # Process order items for new or itemized orders
                for item in order.get("items", []):
                    raw_sku = str(item.get("sku", "")).strip().upper()
                    line_item_id = str(item.get("amazon_line_item_id", "default"))
                    qty = int(item.get("quantity") or 0)
                    title = str(item.get("title", "")).strip()

                    if not raw_sku:
                        continue

                    normalized_sku = AmazonService.normalize_amazon_sku(
                        raw_sku, known_skus, name_to_sku=name_to_sku, title=title
                    )

                    if not normalized_sku:
                        # Quarantine in DLQ
                        dlq = AmazonDLQ(
                            company_id=company_id,
                            dlq_type=DLQType.DATA_MISMATCH,
                            reference_id=order_id,
                            error_message=f"Unknown SKU: {raw_sku}",
                            payload={"item": item, "order_id": order_id, "channel": channel}
                        )
                        db.add(dlq)
                        counters["failed"] += 1
                        counters["unknown_skus"].add(raw_sku)
                        continue

                    sku = normalized_sku

                    try:
                        with db.begin_nested():
                            existing = db.query(AmazonLiveAllocation).filter(
                                AmazonLiveAllocation.order_id == order_id,
                                AmazonLiveAllocation.sku == sku,
                                AmazonLiveAllocation.amazon_line_item_id == line_item_id
                            ).with_for_update().first()

                            if existing:
                                if existing.updated_at and existing.updated_at >= last_update:
                                    counters["skipped"] += 1
                                    continue

                                if existing.status in [AllocationStatus.CANCELLED, AllocationStatus.RETURNED, AllocationStatus.REFUNDED]:
                                    counters["skipped"] += 1
                                    continue

                                prev_status = existing.status
                                existing.status = mapped_status
                                existing.allocated_qty = qty
                                existing.updated_at = last_update
                                if not existing.order_date:
                                    existing.order_date = purchase_date
                                if not existing.invoice_date or existing.invoice_date == existing.updated_at:
                                    existing.invoice_date = inv_date
                                if not existing.invoice_number or (raw_inv_no and existing.invoice_number != str(raw_inv_no).strip()):
                                    existing.invoice_number = invoice_number

                                if mapped_status in [AllocationStatus.CANCELLED, AllocationStatus.RETURNED, AllocationStatus.REFUNDED]:
                                    existing.closed = True
                                    existing.allocated_qty = existing.reconciled_qty

                                if prev_status != mapped_status:
                                    event = AmazonOrderEventLog(
                                        allocation_id=existing.id,
                                        previous_status=prev_status.value,
                                        new_status=mapped_status.value,
                                        timestamp=datetime.utcnow()
                                    )
                                    db.add(event)
                                counters["processed"] += 1
                            else:
                                closed = mapped_status in [AllocationStatus.CANCELLED, AllocationStatus.RETURNED, AllocationStatus.REFUNDED]
                                final_qty = 0 if closed else qty

                                allocation = AmazonLiveAllocation(
                                    company_id=company_id,
                                    order_id=order_id,
                                    sku=sku,
                                    amazon_line_item_id=line_item_id,
                                    warehouse_id=target_warehouse_id,
                                    amazon_network_at_allocation=network,
                                    allocated_qty=final_qty,
                                    status=mapped_status,
                                    closed=closed,
                                    order_date=purchase_date,
                                    invoice_date=inv_date,
                                    invoice_number=invoice_number,
                                    created_at=purchase_date,
                                    updated_at=last_update
                                )
                                db.add(allocation)
                                db.flush()

                                event = AmazonOrderEventLog(
                                    allocation_id=allocation.id,
                                    previous_status=None,
                                    new_status=mapped_status.value,
                                    timestamp=datetime.utcnow()
                                )
                                db.add(event)
                                counters["processed"] += 1
                                existing_ids.add(order_id)
                    except Exception as item_err:
                        logger.error(f"Failed processing item {sku} on order {order_id}: {item_err}")
                        counters["failed"] += 1

            # Commit after each page with live telemetry
            sync_log.orders_processed = counters["processed"]
            sync_log.skipped_duplicates = counters["skipped"]
            sync_log.failed_items = counters["failed"]
            sync_log.unknown_skus = json.dumps(list(counters["unknown_skus"]))
            db.commit()

        try:
            client.fetch_orders(
                since=since,
                existing_order_ids=existing_ids,
                on_page_callback=process_page,
                max_pages=max_pages
            )

            end_time = datetime.utcnow()
            duration = (end_time - start_time).total_seconds()

            sync_log.status = "SUCCESS"
            sync_log.sync_end_time = end_time
            sync_log.orders_processed = counters["processed"]
            sync_log.skipped_duplicates = counters["skipped"]
            sync_log.failed_items = counters["failed"]
            watermark_ts = end_time if not max_pages else counters.get("max_order_date", end_time)
            sync_log.api_response_status = f"watermark:{watermark_ts.isoformat()}"
            db.commit()

            return {
                "status": "SUCCESS",
                "since": since.isoformat(),
                "orders_processed": counters["processed"],
                "skipped_duplicates": counters["skipped"],
                "failed_items": counters["failed"],
                "unknown_skus": list(counters["unknown_skus"]),
                "duration_seconds": round(duration, 2)
            }
        except Exception as sync_err:
            logger.error(f"Amazon sync failed: {sync_err}", exc_info=True)
            sync_log.status = "FAILED"
            sync_log.sync_end_time = datetime.utcnow()
            sync_log.errors = str(sync_err)
            db.commit()
            raise sync_err

    @staticmethod
    def poll_orders(db: Session, company_id: int, since=None) -> Tuple[int, int]:
        """
        Backwards-compatible polling entry point for scheduler and CLI.
        """
        res = AmazonService.sync_orders(db, company_id=company_id, since=since)
        return res.get("orders_processed", 0), res.get("skipped_duplicates", 0)

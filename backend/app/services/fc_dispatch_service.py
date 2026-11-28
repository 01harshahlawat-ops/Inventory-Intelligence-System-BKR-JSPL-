import os

from app.services.audit_log_service import AuditLogService
from typing import List, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
import logging
from app.models.schema import (
    FCDispatch, FCDispatchItem, StateHub, Warehouse, Product, Sale, 
    CompanySettings, DispatchTimeline, WarehouseStatus, Inventory, AuditLog, WarehouseExternalMapping, User, Company
)
from app.api.routers.pos import complete_sale, PosCheckoutRequest, PosCartItem
import uuid
from app.services.delivery_challan_service import DeliveryChallanService
from app.services.document_number_service import DocumentNumberService
from app.models.schema import DocumentTypeEnum
from app.services.inventory_event_engine import InventoryEventEngine
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class FCDispatchRequestItem(BaseModel):
    product_id: int
    quantity: int
    edited_cost_price: Optional[float] = None
    edited_selling_price: Optional[float] = None
    edited_gst_percent: Optional[float] = None
    edited_hsn: Optional[str] = None
    edited_notes: Optional[str] = None

class FCDispatchBatchRequest(BaseModel):
    idempotency_key: Optional[str] = None
    dispatch_type: str = "STANDARD" # STANDARD or EMERGENCY
    source_warehouse_id: Optional[int] = None
    warehouse_ids: List[int] # Dest FCs
    hub_id: Optional[int] = None # Optional manual override from frontend
    items: List[FCDispatchRequestItem]
    edited_invoice_number: Optional[str] = None
    edited_invoice_date: Optional[str] = None
    edited_notes: Optional[str] = None

class FCDispatchService:
    @staticmethod
    def _generate_dispatch_number(db: Session, company_id: int, hub_code: str, company_code: str = "CO") -> str:
        # We need a robust sequence that is concurrency-safe.
        from datetime import date
        d = date.today()
        start_year = d.year if d.month >= 4 else d.year - 1
        end_year = start_year + 1
        fy = f"{str(start_year)[-2:]}-{str(end_year)[-2:]}"
        
        return DocumentNumberService.generate_number(
            db=db,
            company_id=company_id,
            document_type=DocumentTypeEnum.DISPATCH,
            fiscal_year=fy,
            prefix_override=f"{company_code}/WHT/{hub_code}"
        )

    @staticmethod
    def _log_timeline(db: Session, dispatch_id: int, step: str, status: str, user_id: int, remarks: str = None):
        timeline = DispatchTimeline(
            dispatch_id=dispatch_id,
            step=step,
            status=status,
            performed_by=user_id,
            remarks=remarks
        )
        db.add(timeline)
        
    @staticmethod
    def _log_audit(db: Session, company_id: int, user_id: int, action: str, entity_type: str, entity_id: int, message: str, payload: dict = None):
        if payload is None:
            payload = {}
        payload["user_id"] = user_id
        
        log = AuditLog(
            company_id=company_id,
            entity_type=entity_type,
            entity_id=entity_id,
            event_type=action,
            message=message,
            metadata_payload=payload
        )
        db.add(log)

    @staticmethod
    def create_batch_dispatch(db: Session, company_id: int, request: FCDispatchBatchRequest, user_id: int):
        dispatches = []
        try:
            # 0. Idempotency Check
            existing_dispatches = []
            if request.idempotency_key:
                expected_keys = [f"{request.idempotency_key}_{wh_id}" for wh_id in request.warehouse_ids]
                existing_dispatches = db.query(FCDispatch).filter(
                    FCDispatch.idempotency_key.in_(expected_keys),
                    FCDispatch.company_id == company_id
                ).all()
                
                # Filter out already processed warehouse_ids
                processed_warehouse_ids = [d.warehouse_id for d in existing_dispatches]
                request.warehouse_ids = [wid for wid in request.warehouse_ids if wid not in processed_warehouse_ids]
                
                # If all were already processed, just return them
                if not request.warehouse_ids:
                    return existing_dispatches

            company = db.query(Company).filter(Company.id == company_id).first()
            company_code = company.code if company else "GST"

            # 1. Resolve Source Warehouse
            if request.source_warehouse_id is None:
                source_warehouse = db.query(Warehouse).filter(Warehouse.company_id == company_id, Warehouse.warehouse_type == 'CENTRAL').first()
                if not source_warehouse:
                    source_warehouse = db.query(Warehouse).filter(Warehouse.company_id == company_id).first()
                if source_warehouse:
                    request.source_warehouse_id = source_warehouse.id
            else:
                source_warehouse = db.query(Warehouse).filter(Warehouse.id == request.source_warehouse_id).first()
            if not source_warehouse:
                raise HTTPException(status_code=404, detail="Source Warehouse not found")

            # Source Validation Rules
            if request.dispatch_type == "EMERGENCY":
                if source_warehouse.code != "VSHB":
                    raise HTTPException(status_code=400, detail="EMERGENCY dispatches must originate from VSHB")
            else:
                # Standard dispatch
                if source_warehouse.warehouse_type.name != "CENTRAL":
                    pass
                    # raise HTTPException(status_code=400, detail="STANDARD dispatches must originate from a CENTRAL warehouse")
            transaction_origin = "INTERNAL_DISTRIBUTION"

            if source_warehouse.status != WarehouseStatus.ACTIVE:
                raise HTTPException(status_code=400, detail=f"Source Warehouse must be ACTIVE (currently {source_warehouse.status})")

            company_settings = db.query(CompanySettings).filter(CompanySettings.company_id == company_id).first()
            export_to_accounting = True
            if company_settings:
                export_to_accounting = company_settings.export_internal_distribution_to_accounting

            for dest_warehouse_id in request.warehouse_ids:
                # User requested ability to dispatch to the same warehouse for dummy bills/adjustments

                # 2. Fetch Dest FC Details
                dest_warehouse = db.query(Warehouse).options(joinedload(Warehouse.hub)).filter(Warehouse.id == dest_warehouse_id).first()
                if not dest_warehouse:
                    raise HTTPException(status_code=404, detail=f"Destination Warehouse {dest_warehouse_id} not found")

                is_cross_company = dest_warehouse.company_id != company_id
                cross_enabled = os.getenv("CROSS_COMPANY_TRANSFERS", "true").lower() == "true"

                if is_cross_company:
                    if not cross_enabled:
                        raise HTTPException(status_code=403, detail="Cross-company transfers are currently disabled")
                        
                    user_obj = db.query(User).filter(User.id == user_id).first()
                    has_permission = user_obj.role in ["Admin", "SuperAdmin"] or "cross_company_transfer" in (user_obj.permissions or [])
                    if not has_permission:
                        raise HTTPException(status_code=403, detail="Not authorized to create cross-company transfers")

                    # Pre-fetch products in one query to validate and create missing in dest company
                    req_pids = [req_item.product_id for req_item in request.items]
                    src_prods = {p.id: p for p in db.query(Product).filter(Product.id.in_(req_pids)).all()}
                    src_skus = [p.sku for p in src_prods.values() if p and p.sku]
                    dest_prods = {p.sku: p for p in db.query(Product).filter(Product.company_id == dest_warehouse.company_id, Product.sku.in_(src_skus)).all()}
                    
                    new_prods_to_create = []
                    for req_item in request.items:
                        src_prod = src_prods.get(req_item.product_id)
                        if src_prod and src_prod.sku not in dest_prods and src_prod.sku not in [x[0] for x in new_prods_to_create]:
                            new_prod = Product(
                                company_id=dest_warehouse.company_id,
                                sku=src_prod.sku,
                                name=src_prod.name,
                                category=src_prod.category,
                                brand=src_prod.brand,
                                item_rate=src_prod.item_rate,
                                min_stock_level=src_prod.min_stock_level,
                                reorder_level=src_prod.reorder_level,
                                safety_stock=src_prod.safety_stock,
                                preferred_transfer_qty=src_prod.preferred_transfer_qty,
                                status=src_prod.status,
                                hsn=src_prod.hsn,
                                default_gst_rate=src_prod.default_gst_rate,
                                barcode=src_prod.barcode,
                                unit=src_prod.unit
                            )
                            new_prods_to_create.append((src_prod.sku, new_prod))

                    if new_prods_to_create:
                        for _, np in new_prods_to_create:
                            db.add(np)
                        db.flush()

                        dest_warehouses = db.query(Warehouse).filter_by(company_id=dest_warehouse.company_id, status="ACTIVE").all()
                        new_inv_rows = []
                        for sku, np in new_prods_to_create:
                            dest_prods[sku] = np
                            for dw in dest_warehouses:
                                inv = Inventory(
                                    company_id=dest_warehouse.company_id,
                                    warehouse_id=dw.id,
                                    product_id=np.id
                                )
                                inv._allow_mutation = True
                                inv.current_qty = 0
                                inv.available_qty = 0
                                inv.reserved_qty = 0
                                inv._allow_mutation = False
                                new_inv_rows.append(inv)
                        if new_inv_rows:
                            db.add_all(new_inv_rows)
                            db.flush()

                    # Audit log
                    AuditLogService.log(
                        db,
                        company_id=company_id,
                        entity_type="FCDispatch",
                        entity_id=0,
                        event_type="CROSS_COMPANY_TRANSFER_INITIATED",
                        message=f"Initiating cross company transfer to {dest_warehouse.company_id}",
                        metadata={"destination_company_id": dest_warehouse.company_id, "source_company_id": company_id}
                    )

                # Destination Amazon Validation
                if dest_warehouse.status != WarehouseStatus.ACTIVE:
                    raise HTTPException(status_code=400, detail=f"Destination Warehouse {dest_warehouse.name} is not ACTIVE")

                hub_id = dest_warehouse.hub_id or request.hub_id
                if not hub_id:
                    raise HTTPException(status_code=400, detail=f"Destination Warehouse {dest_warehouse.name} lacks a State Hub (Migration Required)")
                
                hub = dest_warehouse.hub or db.query(StateHub).filter(StateHub.id == hub_id).first()
                if not hub:
                    raise HTTPException(status_code=400, detail=f"Fulfillment Center {dest_warehouse.name} is missing a valid State Hub")
                    
                if (hub.status or "").upper() != "ACTIVE":
                    raise HTTPException(status_code=400, detail=f"State Hub {hub.hub_name} is not Active")
                    
                # 3. Prepare POS Request & Validate Inventory (Batched Pre-fetch)
                pos_items = []
                taxable_total = 0.0
                tax_total = 0.0

                req_pids = [r.product_id for r in request.items]
                input_products = db.query(Product).filter(Product.id.in_(req_pids)).all()
                input_products_by_id = {p.id: p for p in input_products}

                # Resolve source company products by SKU (handling cross-company ID mismatches)
                skus_needed = [p.sku for p in input_products if p.sku]
                src_company_products = db.query(Product).filter(
                    Product.company_id == source_warehouse.company_id,
                    Product.sku.in_(skus_needed)
                ).all()
                src_prod_by_sku = {(p.sku or "").upper(): p for p in src_company_products if p.sku}

                # Check source warehouse inventory in ONE query
                source_wh_ids = [39, 2] if source_warehouse.id in (39, 2) else [source_warehouse.id]
                src_pids = [p.id for p in src_company_products]
                all_check_pids = list(set(src_pids + [p.id for p in input_products if p.company_id == source_warehouse.company_id]))

                source_inv_records = db.query(
                    Inventory.product_id,
                    func.sum(Inventory.available_qty).label("total_avail")
                ).filter(
                    Inventory.company_id == source_warehouse.company_id,
                    Inventory.warehouse_id.in_(source_wh_ids),
                    Inventory.product_id.in_(all_check_pids)
                ).group_by(Inventory.product_id).all() if all_check_pids else []
                source_avail_map = {r.product_id: (r.total_avail or 0) for r in source_inv_records}
                
                for req_item in request.items:
                    if req_item.quantity <= 0:
                        raise HTTPException(status_code=400, detail="Transfer quantity must be greater than zero")

                    input_prod = input_products_by_id.get(req_item.product_id)
                    if not input_prod:
                        raise HTTPException(status_code=404, detail=f"Product {req_item.product_id} not found")

                    product = src_prod_by_sku.get((input_prod.sku or "").upper()) or input_prod
                    
                    avail_qty = source_avail_map.get(product.id, 0)
                    if req_item.quantity > avail_qty:
                        raise HTTPException(status_code=400, detail=f"Insufficient stock for {product.name} at source warehouse. Needed {req_item.quantity}, available {avail_qty}")
                    
                    qty = req_item.quantity
                    
                    # Apply edited values if provided
                    unit_price = req_item.edited_selling_price if req_item.edited_selling_price is not None else (product.item_rate or 0.0)
                    gst_rate = req_item.edited_gst_percent if req_item.edited_gst_percent is not None else (product.default_gst_rate or 0.0)

                    taxable = unit_price * qty
                    gst = taxable * (gst_rate / 100.0)
                    line_total = taxable + gst

                    taxable_total += taxable
                    tax_total += gst
                    
                    is_inter_state = False
                    dest_state = hub.state if hub else ""
                    src_state = source_warehouse.hub.state if (source_warehouse and source_warehouse.hub) else ""
                    if dest_state and src_state and dest_state != src_state:
                         is_inter_state = True
                         
                    cgst = 0.0
                    sgst = 0.0
                    igst = 0.0
                    if is_inter_state:
                        igst = gst
                    else:
                        cgst = gst / 2
                        sgst = gst / 2

                    pos_items.append(PosCartItem(
                        product_id=product.id,
                        sku=product.sku,
                        product_name=product.name,
                        hsn_sac=req_item.edited_hsn if req_item.edited_hsn is not None else (product.hsn or ''),
                        unit=product.unit,
                        quantity=qty,
                        selling_price=unit_price,
                        discount=0.0,
                        gst_rate=gst_rate,
                        taxable_amount=taxable,
                        cgst=cgst,
                        sgst=sgst,
                        igst=igst,
                        line_total=line_total
                    ))

                
                # Ensure empty strings are treated as None for dates/numbers
                custom_inv_date = None
                if request.edited_invoice_date and str(request.edited_invoice_date).strip():
                    custom_inv_date = request.edited_invoice_date

                custom_inv_number = None
                if request.edited_invoice_number and str(request.edited_invoice_number).strip():
                    custom_inv_number = request.edited_invoice_number

                # Use edited top-level fields if provided
                pos_request = PosCheckoutRequest(
                    customer_name=hub.hub_name,
                    customer_gstin=hub.gstin,
                    customer_address=hub.address,
                    customer_state=hub.state,
                    customer_state_code=hub.state_code,
                    invoice_type="B2B",
                    invoice_prefix=company_code,
                    payment_method="CASH", # Default
                    total_taxable_amount=taxable_total,
                    total_tax=tax_total,
                    grand_total=taxable_total + tax_total,
                    origin_warehouse_id=source_warehouse.id,
                    skip_inventory_update=True,
                    shipping_name=dest_warehouse.name,
                    shipping_address=dest_warehouse.address,
                    shipping_state=dest_warehouse.hub.state if dest_warehouse.hub else None,
                    shipping_state_code=getattr(dest_warehouse.hub, 'state_code', None) if dest_warehouse.hub else None,
                    shipping_gstin=dest_warehouse.hub.gstin if dest_warehouse.hub else None,
                    items=pos_items,
                    custom_invoice_number=custom_inv_number,
                    custom_invoice_date=custom_inv_date,
                    delivery_note=request.edited_notes
                )
                
                # Store the edited fields in payload for audit
                edited_payload = {
                    "edited_invoice_number": request.edited_invoice_number,
                    "edited_invoice_date": request.edited_invoice_date,
                    "edited_notes": request.edited_notes,
                    "items": [
                        {
                            "product_id": req.product_id,
                            "edited_cost_price": req.edited_cost_price,
                            "edited_selling_price": req.edited_selling_price,
                            "edited_gst_percent": req.edited_gst_percent,
                            "edited_hsn": req.edited_hsn,
                            "edited_notes": req.edited_notes
                        } for req in request.items if (
                            req.edited_selling_price is not None or 
                            req.edited_gst_percent is not None or 
                            req.edited_cost_price is not None or
                            req.edited_hsn is not None or
                            req.edited_notes is not None
                        )
                    ]
                }
                
                # 4. Generate Dispatch Number & Complete POS Sale
                dispatch_num = FCDispatchService._generate_dispatch_number(db, company_id, hub.hub_code, company_code)
                pos_request.dispatch_document_number = dispatch_num

                user_obj = db.query(User).filter(User.id == user_id).first()
                sale_dto = complete_sale(request=None, payload=pos_request, company_id=company_id, db=db, user=user_obj, commit=False)
                sale_id = sale_dto["receipt"]["id"]
                sale_obj = db.query(Sale).filter(Sale.id == sale_id).first()
                
                # 5. Create Challan
                challan_data = {
                    "sale_id": sale_id,
                    "challan_number": dispatch_num,
                    "remarks": f"{request.dispatch_type} Dispatch from {source_warehouse.code}",
                    "shipping_snapshot": {
                        "name": dest_warehouse.name,
                        "address": dest_warehouse.address,
                        "state": hub.state,
                        "state_code": hub.state_code,
                        "gstin": hub.gstin # Usually same GSTIN for same state
                    },
                    "seller_snapshot": {
                        "name": sale_obj.company_name_snapshot,
                        "gstin": sale_obj.company_gstin_snapshot,
                        "address": sale_obj.company_address_snapshot
                    },
                    "buyer_snapshot": {
                        "name": sale_obj.customer_name,
                        "gstin": sale_obj.customer_gstin,
                        "address": sale_obj.customer_address,
                        "state": sale_obj.customer_state
                    },
                    "items": [
                        {
                            "product_id": it.product_id,
                            "sku_snapshot": it.sku,
                            "product_name_snapshot": it.product_name,
                            "hsn_snapshot": it.hsn_sac,
                            "unit_snapshot": it.unit,
                            "quantity": it.quantity,
                            "unit_price": it.selling_price,
                            "tax_rate": it.gst_rate,
                            "tax_amount": it.cgst + it.sgst + it.igst,
                            "total_price": it.line_total
                        }
                        for it in pos_items
                    ]
                }
                challan_dto = DeliveryChallanService.create_challan(db, company_id, challan_data, user_id)

                # Determine final status based on XML sync status
                if sale_obj.tally_sync_status in ["PENDING", "PROCESSING"]:
                    final_status = "XML Pending"
                elif sale_obj.tally_sync_status == "SKIPPED":
                    final_status = "Completed"
                elif sale_obj.tally_sync_status == "FAILED":
                    final_status = "Completed with Errors"
                else:
                    final_status = "Completed"

                # Create FCDispatch Orchestrator in single insert
                dispatch = FCDispatch(
                    company_id=company_id,
                    warehouse_id=dest_warehouse.id,
                    dispatch_number=dispatch_num,
                    idempotency_key=f"{request.idempotency_key}_{dest_warehouse.id}" if request.idempotency_key else None,
                    dispatch_type=request.dispatch_type,
                    dispatch_status=final_status,
                    invoice_id=sale_id,
                    delivery_challan_id=challan_dto.id,
                    created_by=user_id
                )
                db.add(dispatch)
                try:
                    db.flush()
                except IntegrityError:
                    db.rollback()
                    # It was inserted concurrently
                    concurrent_dispatch = db.query(FCDispatch).filter_by(
                        idempotency_key=f"{request.idempotency_key}_{dest_warehouse.id}", 
                        company_id=company_id
                    ).first()
                    if concurrent_dispatch:
                        existing_dispatches.append(concurrent_dispatch)
                        continue
                    raise

                FCDispatchService._log_timeline(db, dispatch.id, "Created", "Success", user_id, f"Dispatch {dispatch_num} initiated from {source_warehouse.name}")
                FCDispatchService._log_audit(db, company_id, user_id, "CREATE", "FCDispatch", dispatch.id, f"Dispatch {dispatch_num} Created")
                FCDispatchService._log_timeline(db, dispatch.id, "Invoice Generated", "Success", user_id, f"Invoice ID {sale_id}")
                FCDispatchService._log_timeline(db, dispatch.id, "Challan Generated", "Success", user_id, f"Challan ID {challan_dto.id}")
                
                # 6. Process Inventory
                
                # Auto-create StockTransfer if cross-company so it appears in Inter-Company History
                st_obj = None
                if is_cross_company:
                    import uuid
                    from app.models.schema import StockTransfer, StockTransferItem
                    st_obj = StockTransfer(
                        transfer_number=f"TR-ST-{uuid.uuid4().hex[:6].upper()}",
                        from_company_id=company_id,
                        to_company_id=dest_warehouse.company_id,
                        source_warehouse_id=source_warehouse.id if source_warehouse else None,
                        destination_warehouse_id=dest_warehouse.id if dest_warehouse else None,
                        status="Completed",
                        invoice_id=sale_id,
                        total_value=taxable_total + tax_total,
                        created_by=user_id,
                        approved_by=user_id,
                        notes=f"Cross-company transfer from {source_warehouse.name} ({source_warehouse.code}) to {dest_warehouse.name} ({dest_warehouse.code})"
                    )
                    db.add(st_obj)
                    db.flush()

                # Pre-fetch destination products if cross-company
                dest_pids_by_sku = {}
                if is_cross_company:
                    dest_pids_by_sku = {
                        p.sku: p.id for p in db.query(Product).filter(
                            Product.company_id == dest_warehouse.company_id,
                            Product.sku.in_([it.sku for it in pos_items])
                        ).all()
                    }

                # Pre-fetch central warehouse 39 inventory to split correctly between WH 39 and WH 2
                wh_ids = [39, 2] if source_warehouse.id in (39, 2) else [source_warehouse.id]
                wh39_avail_map = {}
                src_comp_id = source_warehouse.company_id
                if len(wh_ids) > 1:
                    wh39_records = db.query(
                        Product.sku,
                        Inventory.available_qty
                    ).join(Product, Product.id == Inventory.product_id).filter(
                        Inventory.company_id == src_comp_id,
                        Inventory.warehouse_id == 39,
                        Product.sku.in_([it.sku for it in pos_items])
                    ).all()
                    wh39_avail_map = {(r.sku or "").upper(): max(0, r.available_qty or 0) for r in wh39_records}

                dispatch_items_to_add = []
                st_items_to_add = []
                batch_inventory_events = []

                for it in pos_items:
                    dispatch_items_to_add.append(FCDispatchItem(
                        dispatch_id=dispatch.id,
                        product_id=it.product_id,
                        sku_snapshot=it.sku,
                        product_name_snapshot=it.product_name,
                        hsn_snapshot=it.hsn_sac,
                        quantity=it.quantity,
                        unit_price=it.selling_price,
                        gst_rate=it.gst_rate,
                        taxable_amount=it.taxable_amount,
                        tax_amount=it.cgst + it.sgst + it.igst,
                        total_amount=it.line_total
                    ))
                    
                    if st_obj:
                        dest_pid = dest_pids_by_sku.get(it.sku, it.product_id)
                        st_items_to_add.append(StockTransferItem(
                            transfer_id=st_obj.id,
                            product_id=dest_pid,
                            requested_qty=it.quantity,
                            dispatched_qty=it.quantity,
                            approved_qty=it.quantity,
                            received_qty=it.quantity,
                            unit_price=it.selling_price
                        ))

                    # Deduct from Source
                    if len(wh_ids) > 1:
                        central_avail = wh39_avail_map.get((it.sku or "").upper(), 0)
                        qty_from_39 = min(it.quantity, central_avail)
                        qty_from_2 = it.quantity - qty_from_39
                        if qty_from_39 > 0:
                            batch_inventory_events.append({
                                "company_id": src_comp_id,
                                "product_sku": it.sku,
                                "warehouse_id": 39,
                                "quantity": qty_from_39,
                                "event_type": "TRANSFER_OUT",
                                "source": "FC_DISPATCH_OUT",
                                "reference_id": dispatch_num,
                                "user_id": user_id,
                                "metadata_payload": {"dispatch_id": dispatch.id}
                            })
                        if qty_from_2 > 0:
                            batch_inventory_events.append({
                                "company_id": src_comp_id,
                                "product_sku": it.sku,
                                "warehouse_id": 2,
                                "quantity": qty_from_2,
                                "event_type": "TRANSFER_OUT",
                                "source": "FC_DISPATCH_OUT",
                                "reference_id": dispatch_num,
                                "user_id": user_id,
                                "metadata_payload": {"dispatch_id": dispatch.id}
                            })
                    else:
                        batch_inventory_events.append({
                            "company_id": src_comp_id,
                            "product_sku": it.sku,
                            "warehouse_id": source_warehouse.id,
                            "quantity": it.quantity,
                            "event_type": "TRANSFER_OUT",
                            "source": "FC_DISPATCH_OUT",
                            "reference_id": dispatch_num,
                            "user_id": user_id,
                            "metadata_payload": {"dispatch_id": dispatch.id}
                        })
                    
                    # Add to Dest FC
                    batch_inventory_events.append({
                        "company_id": dest_warehouse.company_id,
                        "product_sku": it.sku,
                        "warehouse_id": dest_warehouse.id,
                        "quantity": it.quantity,
                        "event_type": "TRANSFER_IN",
                        "allow_negative_stock": True,
                        "source": "FC_DISPATCH_IN",
                        "reference_id": dispatch_num,
                        "user_id": user_id,
                        "metadata_payload": {"dispatch_id": dispatch.id, "source_company_id": company_id}
                    })

                db.add_all(dispatch_items_to_add)
                if st_items_to_add:
                    db.add_all(st_items_to_add)

                # Process all inventory events in a single optimized batch
                InventoryEventEngine.process_events_batch(db=db, events=batch_inventory_events)
                FCDispatchService._log_timeline(db, dispatch.id, "Inventory Updated", "Success", user_id, "Stock transferred")
                
                # Log XML / completion audit and timeline
                if sale_obj.tally_sync_status in ["PENDING", "PROCESSING"]:
                    FCDispatchService._log_timeline(db, dispatch.id, "XML Queued", "Pending", user_id)
                    FCDispatchService._log_audit(db, company_id, user_id, "XML_QUEUED", "FCDispatch", dispatch.id, f"Invoice {sale_id} queued for Tally")
                elif sale_obj.tally_sync_status == "SKIPPED":
                    FCDispatchService._log_timeline(db, dispatch.id, "XML Skipped", "Skipped", user_id, "Configuration Disabled")
                    FCDispatchService._log_audit(db, company_id, user_id, "XML_SKIPPED", "FCDispatch", dispatch.id, f"Invoice {sale_id} XML skipped")
                    FCDispatchService._log_timeline(db, dispatch.id, "Completed", "Success", user_id)
                    FCDispatchService._log_audit(db, company_id, user_id, "COMPLETE", "FCDispatch", dispatch.id, f"Dispatch {dispatch_num} Completed")
                elif sale_obj.tally_sync_status == "FAILED":
                    FCDispatchService._log_timeline(db, dispatch.id, "XML Queued", "Failed", user_id)
                    FCDispatchService._log_audit(db, company_id, user_id, "XML_FAILED", "FCDispatch", dispatch.id, f"Invoice {sale_id} XML failed")
                else:
                    FCDispatchService._log_timeline(db, dispatch.id, "Completed", "Success", user_id)
                    FCDispatchService._log_audit(db, company_id, user_id, "COMPLETE", "FCDispatch", dispatch.id, f"Dispatch {dispatch_num} Completed")
                
                dispatches.append(dispatch)
                
            db.flush()
            
            for dispatch in dispatches:
                logger.info("Dispatch created", extra={
                    "dispatch_id": dispatch.id,
                    "source": request.source_warehouse_id,
                    "destination": dispatch.warehouse_id,
                    "user": user_id
                })
            
            db.commit()
            
            # Combine newly created dispatches with any existing ones (from partial retries)
            if request.idempotency_key and existing_dispatches:
                dispatches.extend(existing_dispatches)
                
            return dispatches
            
            # Combine newly created dispatches with any existing ones (from partial retries)
            if request.idempotency_key and existing_dispatches:
                dispatches.extend(existing_dispatches)
                
            return dispatches
            
        except Exception as e:
            db.rollback()
            logger.error(f"FCDispatch Batch failed: {str(e)}")
            FCDispatchService._log_audit(db, company_id, user_id, "FAILED", "FCDispatch", 0, f"Batch dispatch failed: {str(e)}")
            raise

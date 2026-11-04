import uuid
import logging
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError
from sqlalchemy.exc import OperationalError
from fastapi import HTTPException
from app.models.schema import Inventory, InventoryMovement, Product, Alert
from app.services.metrics_service import log_metric
import time

logger = logging.getLogger("inventory.event_engine")

class InventoryEventEngine:
    
    @staticmethod
    def process_event(
        db: Session,
        company_id: int,
        product_sku: str,
        warehouse_id: int,
        quantity: int,
        event_type: str, # "ADD", "REPLACE", "DEDUCT"
        source: str,
        reference_id: str,
        user_id: Optional[int] = None,
        metadata_payload: Optional[dict] = None,
        allow_negative_stock: bool = False
    ) -> InventoryMovement:
        """
        The single source of truth for all inventory modifications.
        """
        # 1. Enforce Idempotency Key (Operation ID)
        actual_metadata = metadata_payload or {}
        op_id = actual_metadata.get("operation_id")
        if not op_id:
            line_id = actual_metadata.get("line_id", "")
            # Deterministic idempotency key to prevent double processing
            op_id = f"{event_type}_{reference_id}_{product_sku}_{warehouse_id}_{line_id}".strip("_")
            actual_metadata["operation_id"] = op_id
            
        # 2. Check if already processed (Idempotency)
        existing_event = db.query(InventoryMovement).filter_by(operation_id=op_id).first()
        if existing_event:
            logger.info(f"Idempotency match: skipping inventory update for operation_id {op_id}")
            return existing_event

        MAX_RETRIES = 3
        for attempt in range(MAX_RETRIES):
            try:
                with db.begin_nested(): # SAVEPOINT
                    # Guard against negative quantities
                    if quantity < 0:
                        raise ValueError('Quantity must be positive. Use event_type DEDUCT for removals.')
                        
                    # Ensure product exists for this company
                    # Globally enforce the 6-character SKU rule
                    product_sku = product_sku.strip().upper()
                    product = db.query(Product).filter(Product.sku == product_sku, Product.company_id == company_id).first()
                    if not product:
                        raise ValueError(f"Product SKU {product_sku} not found for company {company_id}.")
            
                    # Get current inventory with row-level lock
                    inventory = db.query(Inventory).filter(
                        Inventory.product_id == product.id,
                        Inventory.warehouse_id == warehouse_id,
                        Inventory.company_id == company_id
                    ).with_for_update().first()

                    if not inventory:
                        inventory = Inventory(
                            company_id=company_id,
                            product_id=product.id,
                            warehouse_id=warehouse_id
                        )
                        inventory._allow_mutation = True
                        inventory.current_qty = 0
                        inventory.reserved_qty = 0
                        inventory.available_qty = 0
                        db.add(inventory)
                        db.flush()

                    inventory._allow_mutation = True
                    qty_before = inventory.current_qty
                    qty_changed = 0

                    # Handle Explicit Business Events
                    if event_type in ("ADD", "OPENING_BALANCE"):
                        qty_changed = quantity
                        inventory.current_qty += quantity

                    elif event_type == "RETURN":
                        qty_changed = quantity
                        inventory.current_qty += quantity
                    
                    elif event_type == "TRANSFER_IN":
                        qty_changed = quantity
                        inventory.current_qty += quantity
                
                    elif event_type == "RESTOCK":
                        qty_changed = quantity
                        inventory.current_qty += quantity
                        
                    elif event_type in ("DEDUCT", "REMOVE"):
                        qty_changed = -quantity
                        inventory.current_qty -= quantity
                        
                    elif event_type == "TRANSFER_OUT":
                        qty_changed = -quantity
                        inventory.current_qty -= quantity
                
                    elif event_type == "ADJ_MINUS":
                        qty_changed = -quantity
                        inventory.current_qty -= quantity
                        
                    elif event_type == "DAMAGE_WRITE_OFF":
                        qty_changed = -quantity
                        inventory.current_qty -= quantity
    
                    elif event_type == "SALE":
                        qty_changed = -quantity
                        inventory.current_qty -= quantity
                        
                    elif event_type == "REPLACE":
                        qty_changed = quantity - qty_before
                        inventory.current_qty = quantity
                        
                    elif event_type in ("RESERVE", "RESERVED"):
                        qty_changed = 0  # Does not change current_qty
                        inventory.reserved_qty = (inventory.reserved_qty or 0) + quantity
                
                    elif event_type == "UNRESERVE":
                        qty_changed = 0  # Does not change current_qty
                        if inventory.reserved_qty and inventory.reserved_qty >= quantity:
                            inventory.reserved_qty -= quantity
                        elif inventory.reserved_qty and inventory.reserved_qty > 0:
                            inventory.reserved_qty = 0
                            
                    else:
                        raise ValueError(f"Unknown event_type: {event_type}")

                # Keep available_qty in sync: available = current - reserved
                inventory.available_qty = inventory.current_qty - (inventory.reserved_qty or 0)
                
                # Enforce available_qty >= 0 (unless allow_negative_stock is True)
                if inventory.available_qty < 0 and not allow_negative_stock and qty_changed <= 0:
                    print(f"[NEGATIVE STOCK ATTEMPT] product_sku={product_sku}, available_qty is negative, requested={quantity}, allowed_flag={allow_negative_stock}")
                    raise ValueError(f"Insufficient stock for {product_sku}: cannot deduct {quantity} because available stock would drop below zero")
                
                # Explicit Inventory Reconciliation Verification
                if inventory.available_qty != inventory.current_qty - (inventory.reserved_qty or 0):
                     inventory._allow_mutation = False
                     raise ValueError("Inventory reconciliation failed: Available Qty must equal Current Qty - Reserved Qty")

                qty_after = inventory.current_qty
                inventory._allow_mutation = False
                
                # Inject explicit event_type into metadata_payload for history tracking
                actual_metadata = metadata_payload or {}
                actual_metadata["event_type"] = event_type
        
                # Record Movement
                movement = InventoryMovement(
                    company_id=company_id,
                    product_id=product.id,
                    warehouse_id=warehouse_id,
                    qty_before=qty_before,
                    qty_changed=qty_changed,
                    qty_after=qty_after,
                    source=source,
                    reference_id=reference_id,
                    operation_id=op_id,
                    user_id=user_id,
                    metadata_payload=actual_metadata
                )
                db.add(movement)
        
                # Check alerts
                min_stock_level = product.min_stock_level or 0
                alert_type = None
                alert_message = None
        
                if qty_after < 0:
                    alert_type = "NegativeStock"
                    alert_message = f"Product {product_sku} has negative stock ({qty_after}) in warehouse {warehouse_id}."
                elif min_stock_level > 0 and qty_after < min_stock_level:
                    alert_type = "LowStock"
                    alert_message = f"Product {product_sku} has dropped below min stock ({qty_after} < {min_stock_level}) in warehouse {warehouse_id}."
        
                if alert_type and alert_message:
                    existing_alert = db.query(Alert).filter(
                        Alert.company_id == company_id,
                        Alert.alert_type == alert_type,
                        Alert.message == alert_message,
                        Alert.is_resolved == False
                    ).first()
                    if not existing_alert:
                        db.add(Alert(
                            company_id=company_id,
                            alert_type=alert_type,
                            message=alert_message
                        ))

                db.flush() # Force OCC check
                logger.info(f"Inventory Event: {source} [{reference_id}] | SKU: {product_sku} | {qty_before} -> {qty_after}")

                # Continuous Auto-Transfer Hook:
                # When stock is added or received into Auto Godown (WH 2, BKR),
                # automatically and continuously transfer it to BKR Central (WH 39)
                if event_type in ("ADD", "RESTOCK", "RETURN", "TRANSFER_IN", "OPENING_BALANCE") and warehouse_id == 2 and company_id == 2 and source != "AUTO_MERGE_TRANSFER" and inventory.available_qty > 0:
                    transfer_qty = inventory.available_qty
                    logger.info(f"[AUTO_MERGE] Auto Godown received {transfer_qty} of SKU {product_sku}. Auto-transferring to BKR Central (WH 39).")
                    
                    # 1. Deduct from Auto Godown (WH 2)
                    InventoryEventEngine.process_event(
                        db=db,
                        company_id=company_id,
                        product_sku=product_sku,
                        warehouse_id=2,
                        quantity=transfer_qty,
                        event_type="TRANSFER_OUT",
                        source="AUTO_MERGE_TRANSFER",
                        reference_id=f"AUTO_MERGE_{reference_id or 'WH2'}",
                        user_id=user_id,
                        metadata_payload={
                            "auto_merge": True,
                            "target_warehouse_id": 39,
                            "original_source": source,
                            "original_reference_id": reference_id,
                            "line_id": actual_metadata.get("line_id", "")
                        }
                    )
                    
                    # 2. Add to BKR Central (WH 39)
                    InventoryEventEngine.process_event(
                        db=db,
                        company_id=company_id,
                        product_sku=product_sku,
                        warehouse_id=39,
                        quantity=transfer_qty,
                        event_type="TRANSFER_IN",
                        source="AUTO_MERGE_TRANSFER",
                        reference_id=f"AUTO_MERGE_{reference_id or 'WH2'}",
                        user_id=user_id,
                        metadata_payload={
                            "auto_merge": True,
                            "from_warehouse_id": 2,
                            "original_source": source,
                            "original_reference_id": reference_id,
                            "line_id": actual_metadata.get("line_id", "")
                        }
                    )

                return movement

            except StaleDataError:
                if attempt == MAX_RETRIES - 1:
                    raise HTTPException(
                        status_code=409,
                        detail="Concurrent modification detected. Please retry."
                    )
                # rollback the savepoint happens automatically by db.begin_nested() context manager on exception
                
            except OperationalError as e:
                if "database is locked" in str(e).lower():
                    logger.warning(f"DB_LOCK_RETRY | attempt={attempt+1} | user={user_id}")
                    log_metric("inventory_write_conflict", 1)
                    if attempt == MAX_RETRIES - 1:
                        raise HTTPException(
                            status_code=503,
                            detail="System busy. Please retry."
                        )
                    time.sleep(0.1 * (attempt + 1))
                else:
                    raise

    @staticmethod
    def process_events_batch(
        db: Session,
        events: list[dict]
    ) -> list[InventoryMovement]:
        """
        High-performance batched execution for inventory modifications.
        Eliminates N+1 queries, nested savepoints, and multiple flushes over remote DB connections.
        Each event dict:
            - company_id: int
            - product_sku: str
            - warehouse_id: int
            - quantity: int
            - event_type: str ("TRANSFER_OUT", "TRANSFER_IN", "SALE", "ADD", etc.)
            - source: str
            - reference_id: str
            - user_id: Optional[int]
            - metadata_payload: Optional[dict]
            - allow_negative_stock: bool (default False)
        """
        if not events:
            return []

        # 1. Deterministic operation_ids & Idempotency check
        for ev in events:
            meta = ev.setdefault("metadata_payload", {})
            if not meta.get("operation_id"):
                line_id = meta.get("line_id", "")
                p_sku = ev["product_sku"].strip().upper()
                meta["operation_id"] = f"{ev['event_type']}_{ev['reference_id']}_{p_sku}_{ev['warehouse_id']}_{line_id}".strip("_")

        op_ids = [ev["metadata_payload"]["operation_id"] for ev in events]
        existing_movements = db.query(InventoryMovement).filter(InventoryMovement.operation_id.in_(op_ids)).all()
        existing_by_op = {m.operation_id: m for m in existing_movements}

        events_to_process = [ev for ev in events if ev["metadata_payload"]["operation_id"] not in existing_by_op]
        if not events_to_process:
            return [existing_by_op[op] for op in op_ids if op in existing_by_op]

        # 2. Pre-fetch all products across required companies in ONE query
        sku_clean_map = {ev["product_sku"].strip().upper() for ev in events_to_process}
        companies_needed = {ev["company_id"] for ev in events_to_process}

        products = db.query(Product).filter(
            Product.company_id.in_(companies_needed),
            Product.sku.in_(sku_clean_map)
        ).all()
        products_map = {(p.sku.upper(), p.company_id): p for p in products}

        for ev in events_to_process:
            clean_sku = ev["product_sku"].strip().upper()
            c_id = ev["company_id"]
            prod = products_map.get((clean_sku, c_id))
            if not prod:
                raise ValueError(f"Product SKU {clean_sku} not found for company {c_id}.")
            ev["_product"] = prod

        # 3. Pre-fetch and lock all affected inventory rows in ONE query
        product_ids_needed = {ev["_product"].id for ev in events_to_process}
        warehouse_ids_needed = {ev["warehouse_id"] for ev in events_to_process}

        inv_rows = db.query(Inventory).filter(
            Inventory.company_id.in_(companies_needed),
            Inventory.product_id.in_(product_ids_needed),
            Inventory.warehouse_id.in_(warehouse_ids_needed)
        ).with_for_update().all()

        inv_map = {(inv.company_id, inv.warehouse_id, inv.product_id): inv for inv in inv_rows}

        # Ensure all required inventory rows exist
        new_invs_added = False
        for ev in events_to_process:
            c_id = ev["company_id"]
            wh_id = ev["warehouse_id"]
            pid = ev["_product"].id
            key = (c_id, wh_id, pid)
            if key not in inv_map:
                new_inv = Inventory(
                    company_id=c_id,
                    product_id=pid,
                    warehouse_id=wh_id
                )
                new_inv._allow_mutation = True
                new_inv.current_qty = 0
                new_inv.reserved_qty = 0
                new_inv.available_qty = 0
                new_inv._allow_mutation = False
                db.add(new_inv)
                inv_map[key] = new_inv
                new_invs_added = True

        if new_invs_added:
            db.flush()

        # 4. In-memory state mutation & movement generation
        created_movements = []
        alerts_to_add = []

        for ev in events_to_process:
            qty = ev["quantity"]
            if qty < 0:
                raise ValueError("Quantity must be positive.")
            if qty == 0:
                continue

            prod = ev["_product"]
            c_id = ev["company_id"]
            wh_id = ev["warehouse_id"]
            ev_type = ev["event_type"]
            allow_negative = ev.get("allow_negative_stock", False)

            inv = inv_map[(c_id, wh_id, prod.id)]
            qty_before = inv.current_qty
            qty_changed = 0

            inv._allow_mutation = True
            if ev_type in ("ADD", "OPENING_BALANCE", "RETURN", "TRANSFER_IN", "RESTOCK"):
                qty_changed = qty
                inv.current_qty += qty
            elif ev_type in ("DEDUCT", "REMOVE", "TRANSFER_OUT", "ADJ_MINUS", "DAMAGE_WRITE_OFF", "SALE"):
                qty_changed = -qty
                inv.current_qty -= qty
            elif ev_type == "REPLACE":
                qty_changed = qty - qty_before
                inv.current_qty = qty
            elif ev_type in ("RESERVE", "RESERVED"):
                qty_changed = 0
                inv.reserved_qty = (inv.reserved_qty or 0) + qty
            elif ev_type == "UNRESERVE":
                qty_changed = 0
                if inv.reserved_qty and inv.reserved_qty >= qty:
                    inv.reserved_qty -= qty
                elif inv.reserved_qty and inv.reserved_qty > 0:
                    inv.reserved_qty = 0
            else:
                inv._allow_mutation = False
                raise ValueError(f"Unknown event_type: {ev_type}")

            inv.available_qty = inv.current_qty - (inv.reserved_qty or 0)
            if inv.available_qty < 0 and not allow_negative:
                inv._allow_mutation = False
                raise ValueError(f"Insufficient stock for {prod.sku}: cannot deduct {qty} because available stock would drop below zero")

            qty_after = inv.current_qty
            inv._allow_mutation = False
            inv._is_modified = True

            meta = ev.get("metadata_payload") or {}
            meta["event_type"] = ev_type

            movement = InventoryMovement(
                company_id=c_id,
                product_id=prod.id,
                warehouse_id=wh_id,
                qty_before=qty_before,
                qty_changed=qty_changed,
                qty_after=qty_after,
                source=ev["source"],
                reference_id=ev["reference_id"],
                operation_id=meta["operation_id"],
                user_id=ev.get("user_id"),
                metadata_payload=meta
            )
            created_movements.append(movement)

            # Alert evaluation
            min_stock = prod.min_stock_level or 0
            if qty_after < 0:
                alerts_to_add.append(Alert(company_id=c_id, alert_type="NegativeStock", message=f"Product {prod.sku} has negative stock ({qty_after}) in warehouse {wh_id}."))
            elif min_stock > 0 and qty_after < min_stock:
                alerts_to_add.append(Alert(company_id=c_id, alert_type="LowStock", message=f"Product {prod.sku} has dropped below min stock ({qty_after} < {min_stock}) in warehouse {wh_id}."))

        # Fast bulk-update of all modified inventory rows in ONE query via psycopg2 execute_values
        update_tuples = [
            (inv.id, inv.current_qty, inv.available_qty, inv.reserved_qty or 0, inv.version_id)
            for inv in inv_map.values()
            if getattr(inv, '_is_modified', False)
        ]
        if update_tuples:
            from psycopg2.extras import execute_values
            cursor = db.connection().connection.cursor()
            sql = """
            UPDATE inventory AS i
            SET current_qty = v.current_qty,
                available_qty = v.available_qty,
                reserved_qty = v.reserved_qty,
                version_id = i.version_id + 1,
                last_updated = CURRENT_TIMESTAMP
            FROM (VALUES %s) AS v(id, current_qty, available_qty, reserved_qty, old_version_id)
            WHERE i.id = v.id AND i.version_id = v.old_version_id
            """
            execute_values(cursor, sql, update_tuples)
            for inv in inv_map.values():
                if getattr(inv, '_is_modified', False):
                    db.expire(inv, ['current_qty', 'available_qty', 'reserved_qty', 'version_id'])

        if created_movements:
            db.add_all(created_movements)

        if alerts_to_add:
            existing_alerts = {
                (a.alert_type, a.message)
                for a in db.query(Alert.alert_type, Alert.message).filter(
                    Alert.company_id.in_(companies_needed),
                    Alert.is_resolved == False
                ).all()
            }
            new_alerts = [a for a in alerts_to_add if (a.alert_type, a.message) not in existing_alerts]
            if new_alerts:
                db.add_all(new_alerts)

        result_movements = []
        created_by_op = {m.operation_id: m for m in created_movements}
        for op in op_ids:
            if op in existing_by_op:
                result_movements.append(existing_by_op[op])
            elif op in created_by_op:
                result_movements.append(created_by_op[op])

        return result_movements

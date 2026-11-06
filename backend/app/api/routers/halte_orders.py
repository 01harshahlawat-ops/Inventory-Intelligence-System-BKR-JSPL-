import os
import logging
import requests
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, or_

from app.models.db import get_db
from app.models.schema import HalteWebsiteOrder, Inventory, InventoryMovement, Product, Company, Warehouse
from app.services.inventory_event_engine import InventoryEventEngine
from app.api.dependencies import get_current_user

logger = logging.getLogger("halte_orders")

router = APIRouter(prefix="/halte-orders", tags=["Halte Website Orders"])

HALTE_API_URL = os.getenv("HALTE_API_URL", "https://halte.in")
HALTE_API_KEY = os.getenv("HALTE_API_KEY", "sdbl573th5ige8ityi65iubtlnrshvopbw3jv")
JSPL_COMPANY_ID = 3
JSPL_VSHB_WAREHOUSE_ID = 14


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class SyncRequest(BaseModel):
    lookback_days: int = 30
    auto_deduct_paid: bool = False

class OrderItemSchema(BaseModel):
    sku: str
    quantity: int
    price_at_purchase: float
    product_title: Optional[str] = None

class DeductResponse(BaseModel):
    success: bool
    order_id: int
    inventory_status: str
    message: str
    movements: List[Dict[str, Any]] = []

class BatchDeductRequest(BaseModel):
    order_ids: Optional[List[int]] = None  # None means all pending paid orders


# ---------------------------------------------------------------------------
# Helper: Deduct order items from JSPL VSHB
# ---------------------------------------------------------------------------
def execute_order_deduction(db: Session, order: HalteWebsiteOrder, user_id: Optional[int] = None) -> List[Dict[str, Any]]:
    if order.inventory_status == "DEDUCTED":
        logger.info(f"Order {order.order_id} is already deducted. Skipping.")
        return []

    items = order.items or []
    if not items:
        raise HTTPException(
            status_code=400, 
            detail=f"Order {order.order_id} has no line items to deduct."
        )

    movements_created = []
    
    for idx, itm in enumerate(items):
        sku = str(itm.get("sku", "")).strip().upper()
        qty = int(itm.get("quantity", 1))
        if not sku or qty <= 0:
            continue

        op_id = f"DEDUCT_HALTE_{order.order_id}_{sku}_{idx}"

        movement = InventoryEventEngine.process_event(
            db=db,
            company_id=JSPL_COMPANY_ID,
            product_sku=sku,
            warehouse_id=JSPL_VSHB_WAREHOUSE_ID,
            quantity=qty,
            event_type="DEDUCT",
            source="WEBSITE_HALTE",
            reference_id=f"HALTE-ORD-{order.order_id}",
            user_id=user_id,
            metadata_payload={
                "operation_id": op_id,
                "order_id": order.order_id,
                "customer_name": order.customer_name,
                "channel": "halte.in",
                "notes": f"Auto-deducted from Halte.in web order #{order.order_id}"
            },
            allow_negative_stock=True
        )

        movements_created.append({
            "movement_id": movement.id,
            "sku": sku,
            "quantity": qty,
            "balance_after": movement.balance_after
        })

    order.inventory_status = "DEDUCTED"
    order.deducted_at = datetime.utcnow()
    order.deducted_movement_ids = [m["movement_id"] for m in movements_created]
    order.error_message = None
    db.commit()

    return movements_created


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/stats")
def get_halte_order_stats(db: Session = Depends(get_db)):
    """Summary metrics of Halte.in website orders."""
    total_orders = db.query(func.count(HalteWebsiteOrder.order_id)).scalar() or 0
    total_revenue = db.query(func.sum(HalteWebsiteOrder.total_amount)).scalar() or 0.0
    
    pending_deduction = db.query(func.count(HalteWebsiteOrder.order_id)).filter(
        HalteWebsiteOrder.inventory_status == "PENDING",
        func.lower(HalteWebsiteOrder.order_state).in_(["paid", "shipped", "delivered", "processing"])
    ).scalar() or 0

    deducted_count = db.query(func.count(HalteWebsiteOrder.order_id)).filter(
        HalteWebsiteOrder.inventory_status == "DEDUCTED"
    ).scalar() or 0

    unpaid_count = db.query(func.count(HalteWebsiteOrder.order_id)).filter(
        func.lower(HalteWebsiteOrder.order_state) == "unpaid"
    ).scalar() or 0

    return {
        "total_orders": total_orders,
        "total_revenue": round(float(total_revenue), 2),
        "pending_deduction": pending_deduction,
        "deducted_count": deducted_count,
        "unpaid_count": unpaid_count,
        "warehouse_code": "VSHB",
        "company_name": "JSPL"
    }


@router.get("")
def list_halte_orders(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    inventory_status: Optional[str] = Query(None),
    order_state: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """List website orders fetched from Halte.in."""
    query = db.query(HalteWebsiteOrder)

    if inventory_status and isinstance(inventory_status, str):
        query = query.filter(HalteWebsiteOrder.inventory_status == inventory_status.upper())
    
    if order_state and isinstance(order_state, str):
        query = query.filter(func.lower(HalteWebsiteOrder.order_state) == order_state.lower())

    if search and isinstance(search, str):
        search_pattern = f"%{search.strip()}%"
        # Support search by order ID, customer name, phone, city, state
        if search.strip().isdigit():
            query = query.filter(
                or_(
                    HalteWebsiteOrder.order_id == int(search.strip()),
                    HalteWebsiteOrder.customer_phone.ilike(search_pattern)
                )
            )
        else:
            query = query.filter(
                or_(
                    HalteWebsiteOrder.customer_name.ilike(search_pattern),
                    HalteWebsiteOrder.customer_phone.ilike(search_pattern),
                    HalteWebsiteOrder.ship_city.ilike(search_pattern),
                    HalteWebsiteOrder.ship_state.ilike(search_pattern)
                )
            )

    total = query.count()
    offset = (page - 1) * limit
    orders = query.order_by(desc(HalteWebsiteOrder.order_time), desc(HalteWebsiteOrder.order_id)).offset(offset).limit(limit).all()

    return {
        "success": True,
        "total": total,
        "page": page,
        "limit": limit,
        "orders": [
            {
                "order_id": o.order_id,
                "order_time": o.order_time.isoformat() if o.order_time else None,
                "order_state": o.order_state,
                "total_amount": float(o.total_amount or 0),
                "customer_name": o.customer_name,
                "customer_phone": o.customer_phone,
                "customer_email": o.customer_email,
                "ship_city": o.ship_city,
                "ship_state": o.ship_state,
                "ship_postal_code": o.ship_postal_code,
                "shipping_address": o.shipping_address,
                "billing_address": o.billing_address,
                "items": o.items or [],
                "item_count": sum(int(it.get("quantity", 1)) for it in (o.items or [])),
                "inventory_status": o.inventory_status,
                "deducted_at": o.deducted_at.isoformat() if o.deducted_at else None,
                "error_message": o.error_message
            }
            for o in orders
        ]
    }


@router.post("/sync")
def sync_orders_from_halte(
    req: SyncRequest = SyncRequest(),
    db: Session = Depends(get_db),
    current_user: Optional[Any] = Depends(get_current_user)
):
    """Fetch latest website orders from Halte.in and optionally auto-deduct paid ones from JSPL."""
    url = f"{HALTE_API_URL}/api/haltedb/orders"
    headers = {"x-api-key": HALTE_API_KEY}
    params = {
        "format": "grouped",
        "lookback_days": req.lookback_days
    }

    try:
        res = requests.get(url, headers=headers, params=params, timeout=25)
        res.raise_for_status()
        data = res.json()
    except Exception as e:
        logger.error(f"Failed to fetch orders from Halte.in: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to connect to Halte.in API ({str(e)})"
        )

    # Handle both wrapped {orders: [...]} and raw array response
    raw_orders = data.get("orders", data) if isinstance(data, dict) else data
    if not isinstance(raw_orders, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unexpected response format from Halte.in API"
        )

    inserted_count = 0
    updated_count = 0
    auto_deducted_count = 0

    for ord_data in raw_orders:
        order_id = ord_data.get("order_id")
        if not order_id:
            continue

        existing = db.query(HalteWebsiteOrder).filter(HalteWebsiteOrder.order_id == order_id).first()

        order_time_raw = ord_data.get("order_time")
        parsed_order_time = None
        if order_time_raw:
            try:
                parsed_order_time = datetime.fromisoformat(order_time_raw.replace("Z", "+00:00"))
            except Exception:
                pass

        if not existing:
            # Create new order record
            new_order = HalteWebsiteOrder(
                order_id=order_id,
                order_time=parsed_order_time,
                order_state=ord_data.get("order_state", "UNPAID"),
                total_amount=float(ord_data.get("total_amount") or 0.0),
                customer_name=ord_data.get("customer_name"),
                customer_phone=ord_data.get("customer_phone"),
                customer_email=ord_data.get("customer_email"),
                ship_city=ord_data.get("ship_city"),
                ship_state=ord_data.get("ship_state"),
                ship_postal_code=ord_data.get("ship_postal_code"),
                shipping_address=ord_data.get("shipping_address"),
                billing_address=ord_data.get("billing_address"),
                items=ord_data.get("items", []),
                inventory_status="PENDING"
            )
            db.add(new_order)
            db.flush()
            inserted_count += 1
            current_target = new_order
        else:
            # Update state and details if changed
            existing.order_state = ord_data.get("order_state", existing.order_state)
            existing.total_amount = float(ord_data.get("total_amount") or existing.total_amount)
            if ord_data.get("customer_name"):
                existing.customer_name = ord_data.get("customer_name")
            if ord_data.get("customer_phone"):
                existing.customer_phone = ord_data.get("customer_phone")
            if ord_data.get("ship_city"):
                existing.ship_city = ord_data.get("ship_city")
            if ord_data.get("ship_state"):
                existing.ship_state = ord_data.get("ship_state")
            if ord_data.get("items"):
                existing.items = ord_data.get("items")
            updated_count += 1
            current_target = existing

        # Check for auto-deduction
        state_lower = (current_target.order_state or "").lower()
        if req.auto_deduct_paid and state_lower in ["paid", "shipped", "delivered"] and current_target.inventory_status == "PENDING":
            try:
                execute_order_deduction(db, current_target, user_id=getattr(current_user, "id", None))
                auto_deducted_count += 1
            except Exception as deduct_err:
                logger.error(f"Failed auto-deducting order {order_id}: {deduct_err}")
                current_target.error_message = str(deduct_err)

    db.commit()

    return {
        "success": True,
        "message": f"Halte orders sync completed. Synced {len(raw_orders)} orders ({inserted_count} new, {updated_count} updated, {auto_deducted_count} auto-deducted).",
        "total_fetched": len(raw_orders),
        "inserted": inserted_count,
        "updated": updated_count,
        "auto_deducted": auto_deducted_count
    }


@router.post("/{order_id}/deduct", response_model=DeductResponse)
def deduct_order_inventory(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[Any] = Depends(get_current_user)
):
    """Manually deduct an order's items from JSPL VSHB warehouse."""
    order = db.query(HalteWebsiteOrder).filter(HalteWebsiteOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail=f"Halte website order #{order_id} not found in system.")

    if order.inventory_status == "DEDUCTED":
        return DeductResponse(
            success=True,
            order_id=order_id,
            inventory_status="DEDUCTED",
            message=f"Order #{order_id} was already deducted from JSPL inventory."
        )

    try:
        user_id = getattr(current_user, "id", None)
        movements = execute_order_deduction(db, order, user_id=user_id)
        return DeductResponse(
            success=True,
            order_id=order_id,
            inventory_status="DEDUCTED",
            message=f"Order #{order_id} successfully deducted from JSPL VSHB warehouse.",
            movements=movements
        )
    except Exception as e:
        order.error_message = str(e)
        db.commit()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to deduct order #{order_id}: {str(e)}"
        )


@router.post("/batch-deduct")
def batch_deduct_orders(
    req: BatchDeductRequest,
    db: Session = Depends(get_db),
    current_user: Optional[Any] = Depends(get_current_user)
):
    """Deduct multiple pending orders from JSPL VSHB inventory."""
    query = db.query(HalteWebsiteOrder).filter(HalteWebsiteOrder.inventory_status == "PENDING")

    if req.order_ids:
        query = query.filter(HalteWebsiteOrder.order_id.in_(req.order_ids))
    else:
        # Default: all pending PAID or Shipped orders
        query = query.filter(func.lower(HalteWebsiteOrder.order_state).in_(["paid", "shipped", "delivered"]))

    orders_to_process = query.all()
    successful = []
    failed = []

    user_id = getattr(current_user, "id", None)

    for order in orders_to_process:
        try:
            execute_order_deduction(db, order, user_id=user_id)
            successful.append(order.order_id)
        except Exception as e:
            order.error_message = str(e)
            failed.append({"order_id": order.order_id, "error": str(e)})

    db.commit()

    return {
        "success": True,
        "processed_count": len(orders_to_process),
        "successful_ids": successful,
        "failed": failed
    }


@router.post("/{order_id}/skip")
def skip_order_deduction(
    order_id: int,
    db: Session = Depends(get_db)
):
    """Mark an order as SKIPPED so it does not deduct inventory (e.g. cancelled/unpaid/manual)."""
    order = db.query(HalteWebsiteOrder).filter(HalteWebsiteOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail=f"Halte website order #{order_id} not found.")

    order.inventory_status = "SKIPPED"
    order.error_message = "Skipped by user"
    db.commit()

    return {
        "success": True,
        "order_id": order_id,
        "inventory_status": "SKIPPED",
        "message": f"Order #{order_id} marked as SKIPPED."
    }

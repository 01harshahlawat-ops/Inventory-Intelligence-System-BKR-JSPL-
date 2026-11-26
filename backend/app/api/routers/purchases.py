from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import exc
from typing import List, Dict, Any, Optional

from app.models.db import get_db
from app.models.schema import User, Purchase, OfflinePurchase, Vendor, CompanyUser
from app.api.routers.auth import get_current_user
from app.api.dependencies import get_current_company_id
from app.services.purchase_service import PurchaseService, PurchaseDraftRequest, PurchaseReceiveRequest, PurchasePaymentRequest
import json
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/purchases", tags=["Purchases"])

def require_admin_or_manager(user: User = Depends(get_current_user)):
    if not user.role or user.role.upper() not in ["ADMIN", "MANAGER"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Requires ADMIN or MANAGER role to execute Stock In / Receive"
        )
    return user

@router.put("/{purchase_id}")
def update_purchase(
    purchase_id: int, 
    request: PurchaseDraftRequest, 
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    try:
        operator_id = user.id if user else 1
        res = PurchaseService.update_purchase(db, purchase_id, request, operator_id)
        db.commit()
        return res
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except exc.IntegrityError as e:
        db.rollback()
        if "uix_company_invoice_number" in str(e):
            raise HTTPException(status_code=400, detail="This Invoice Number has already been saved. Please check your purchase history or enter a different invoice number.")
        raise HTTPException(status_code=400, detail="Database integrity error: " + str(e.orig))
    except Exception as e:
        db.rollback()
        logger.exception("Error updating purchase: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", summary="Create Purchase Draft")
def create_purchase_draft(
    request: PurchaseDraftRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    try:
        res = PurchaseService.create_draft(db, request, user.id)
        db.commit()
        return res
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except exc.IntegrityError as e:
        db.rollback()
        if "uix_company_invoice_number" in str(e):
            raise HTTPException(status_code=400, detail="This Invoice Number has already been saved. Please check your purchase history or enter a different invoice number.")
        raise HTTPException(status_code=400, detail="Database integrity error: " + str(e.orig))
    except Exception as e:
        db.rollback()
        logger.exception("Error creating purchase draft")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.post("/{purchase_id}/receive", summary="Receive Purchase Stock")
def receive_purchase(
    purchase_id: int,
    request: PurchaseReceiveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin_or_manager) # ENFORCED
):
    try:
        res = PurchaseService.receive_purchase(db, purchase_id, request, user.id)
        db.commit()
        return res
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        logger.exception("Error receiving purchase")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

class OfflinePurchaseRequest(PurchaseDraftRequest):
    pass # Inherits structure

@router.post("/offline/submit", summary="Queue Offline Purchase")
def submit_offline_purchase(
    request: OfflinePurchaseRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    try:
        existing = db.query(OfflinePurchase).filter_by(company_id=request.company_id, idempotency_key=request.idempotency_key).first()
        if existing:
            return {"status": "PENDING", "message": "Already queued"}

        offline_rec = OfflinePurchase(
            company_id=request.company_id,
            operator_id=user.id,
            payload=request.model_dump(),
            idempotency_key=request.idempotency_key
        )
        db.add(offline_rec)
        db.commit()
        return {"status": "PENDING", "id": offline_rec.id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Error queueing offline purchase")

@router.post("/offline/sync", summary="Sync Offline Purchases")
def sync_offline_purchases(
    company_id: int,
    db: Session = Depends(get_db)
):
    pendings = db.query(OfflinePurchase).filter_by(company_id=company_id, status="PENDING").all()
    results = []
    
    for op in pendings:
        try:
            req_data = PurchaseDraftRequest(**op.payload)
            # Find the user manually since this is a server sync loop
            # the operator_id is inside the OfflinePurchase row
            res = PurchaseService.create_draft(db, req_data, op.operator_id)
            
            op.status = "SYNCED"
            op.purchase_id = res['id']
            results.append({"idempotency_key": op.idempotency_key, "synced": True, "purchase_id": op.purchase_id})
        except Exception as e:
            op.status = "FAILED"
            op.error_message = str(e)
            results.append({"idempotency_key": op.idempotency_key, "synced": False, "error": str(e)})
            
    db.commit()
    return {"synced": len(results), "details": results}

@router.get("/vendors/payables", summary="Get Vendor Payables")
def get_vendor_payables(company_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    vendors = db.query(Vendor).filter_by(company_id=company_id).all()
    return [{"id": v.id, "name": v.name, "payable_balance": v.payable_balance} for v in vendors]

@router.get("/", summary="List Purchases")
def list_purchases(
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    purchases = db.query(Purchase).options(
        joinedload(Purchase.vendor),
        joinedload(Purchase.warehouse)
    ).filter_by(company_id=company_id).order_by(Purchase.id.desc()).all()
    res = []
    for p in purchases:
        res.append({
            "id": p.id,
            "vendor_name": p.vendor.name if p.vendor else None,
            "invoice_number": p.invoice_number,
            "warehouse_id": p.warehouse_id,
            "warehouse_name": p.warehouse.name if p.warehouse else None,
            "status": p.status,
            "total_amount": p.total_amount,
            "amount_paid": p.amount_paid,
            "payment_status": p.payment_status,
            "payment_method": p.payment_method,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "date": (p.date or p.created_at).isoformat() if (p.date or p.created_at) else None
        })
    return res

@router.get("/{purchase_id}", summary="Get Purchase Details")
def get_purchase(
    purchase_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    p = db.query(Purchase).options(
        joinedload(Purchase.vendor),
        joinedload(Purchase.warehouse),
        selectinload(Purchase.items)
    ).filter_by(id=purchase_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")
        
    if user.role and user.role.upper() not in ["ADMIN", "SUPER_ADMIN", "MANAGER"]:
        access = db.query(CompanyUser).filter(
            CompanyUser.user_id == user.id,
            CompanyUser.company_id == p.company_id
        ).first()
        if not access:
            raise HTTPException(status_code=403, detail="You do not have permission to access this company's purchases")
        
    items = []
    for item in p.items:
        items.append({
            "id": item.id,
            "product_id": item.product_id,
            "product_sku": item.product_sku,
            "description": item.description,
            "qty": item.qty,
            "unit_cost": item.unit_cost,
            "gst_pct": item.gst_pct,
            "hsn": item.hsn,
            "line_total": item.line_total
        })
        
    return {
        "id": p.id,
        "company_id": p.company_id,
        "vendor_id": p.vendor_id,
        "vendor_name": p.vendor.name if p.vendor else p.vendor_name,
        "invoice_number": p.invoice_number,
        "warehouse_id": p.warehouse_id,
        "warehouse_name": p.warehouse.name if p.warehouse else None,
        "date": (p.date or p.created_at).isoformat() if (p.date or p.created_at) else None,
        "payment_terms": p.payment_terms,
        "eway_bill": p.eway_bill,
        "vehicle_number": p.vehicle_number,
        "status": p.status,
        "total_amount": p.total_amount,
        "amount_paid": float(p.amount_paid or 0.0),
        "payment_status": p.payment_status,
        "payment_method": p.payment_method,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "notes": p.notes,
        "items": items
    }

@router.post("/{purchase_id}/pay", summary="Record Payment")
def record_payment(
    purchase_id: int,
    request: PurchasePaymentRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin_or_manager)
):
    try:
        res = PurchaseService.record_payment(db, purchase_id, request, user.id)
        db.commit()
        return res
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        logger.exception("Error recording payment")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

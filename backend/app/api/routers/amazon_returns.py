from fastapi import APIRouter, Depends, HTTPException
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, ConfigDict
from datetime import datetime

from app.models.db import get_db
from app.models.schema import AmazonReturn, AmazonReturnSyncLog, DefectiveInventory, AuditLog, Product, Warehouse
from app.api.dependencies import get_current_company_id, get_current_user
from app.services.amazon_returns_scheduler import run_amazon_returns_sync_job
from app.services.inventory_event_engine import InventoryEventEngine
from app.core.limiter import limiter

router = APIRouter(prefix="/amazon-returns", tags=["Amazon Returns"])

class AmazonReturnBase(BaseModel):
    amazon_return_id: str
    amazon_order_id: str
    order_item_id: str
    sku: str
    asin: Optional[str] = None
    product_name: Optional[str] = None
    quantity: int
    return_reason: Optional[str] = None
    return_status: str
    requested_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    last_synced_at: Optional[datetime] = None
    
    # Inspection fields
    inspection_status: Optional[str] = None
    inspection_notes: Optional[str] = None
    inspection_images: Optional[list] = None
    inspected_by: Optional[int] = None
    inspected_at: Optional[datetime] = None

class InspectRequest(BaseModel):
    decision: str  # RESTOCK, DEFECTIVE, REJECTED
    warehouse_id: Optional[int] = None
    notes: Optional[str] = None
    images: Optional[list] = []

class InspectResponse(BaseModel):
    updated_return: AmazonReturnResponse
    inventory_event_id: Optional[int] = None
    inspection_status: str
    inventory_quantity: Optional[int] = None
    audit_id: int

class AmazonReturnResponse(AmazonReturnBase):
    id: int
    company_id: int
    model_config = ConfigDict(from_attributes=True)

class SyncStatusResponse(BaseModel):
    last_run: Optional[datetime] = None
    next_run: Optional[datetime] = None
    records_created_last_run: int = 0
    records_updated_last_run: int = 0
    status: str = "Unknown"

@router.get("/", response_model=List[AmazonReturnResponse])
def get_returns(
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db),
    status: Optional[str] = None,
    inspection_status: Optional[str] = None,
    sku: Optional[str] = None,
    search: Optional[str] = None
):
    query = db.query(AmazonReturn)
    if company_id:
        has_returns = db.query(AmazonReturn.id).filter(AmazonReturn.company_id == company_id).first()
        if has_returns:
            query = query.filter(AmazonReturn.company_id == company_id)
    
    if status:
        query = query.filter(AmazonReturn.return_status == status)
    if inspection_status:
        if inspection_status.upper() in ["PENDING", "UNVERIFIED"]:
            query = query.filter(
                (AmazonReturn.inspection_status.is_(None)) | 
                (AmazonReturn.inspection_status == "") | 
                (AmazonReturn.inspection_status == "PENDING")
            )
        else:
            query = query.filter(AmazonReturn.inspection_status == inspection_status.upper())
    if sku:
        query = query.filter(AmazonReturn.sku.ilike(f"%{sku}%"))
    if search:
        query = query.filter(
            (AmazonReturn.amazon_return_id.ilike(f"%{search}%")) |
            (AmazonReturn.amazon_order_id.ilike(f"%{search}%")) |
            (AmazonReturn.product_name.ilike(f"%{search}%"))
        )
        
    return query.order_by(AmazonReturn.requested_at.desc().nulls_last()).all()

@router.get("/status", response_model=SyncStatusResponse)
def get_sync_status(
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    last_log_query = db.query(AmazonReturnSyncLog)
    if company_id:
        has_log = db.query(AmazonReturnSyncLog.id).filter(AmazonReturnSyncLog.company_id == company_id).first()
        if has_log:
            last_log_query = last_log_query.filter(AmazonReturnSyncLog.company_id == company_id)
    last_log = last_log_query.order_by(AmazonReturnSyncLog.started_at.desc()).first()
    
    if not last_log:
        return SyncStatusResponse(status="Never Run")
        
    return SyncStatusResponse(
        last_run=last_log.started_at,
        records_created_last_run=last_log.records_created or 0,
        records_updated_last_run=last_log.records_updated or 0,
        status=last_log.status
    )

@router.post("/sync")
@limiter.limit("5/minute")
def trigger_manual_sync(
    request: Request,
    company_id: int = Depends(get_current_company_id)
):
    try:
        run_amazon_returns_sync_job(company_id=company_id)
        return {"status": "Success", "message": "Manual sync completed."}
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{return_id}/inspect", response_model=InspectResponse)
def inspect_return(
    return_id: int,
    request: InspectRequest,
    company_id: int = Depends(get_current_company_id),
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    amazon_return = db.query(AmazonReturn).filter(AmazonReturn.id == return_id).first()
    
    if not amazon_return:
        raise HTTPException(status_code=404, detail="Return not found")
        
    if amazon_return.inspection_status in ["RESTOCKED", "DEFECTIVE", "REJECTED"]:
        raise HTTPException(status_code=400, detail="Return has already been verified and inspected")
        
    valid_decisions = ["RESTOCK", "DEFECTIVE", "REJECTED"]
    if request.decision.upper() not in valid_decisions:
        raise HTTPException(status_code=400, detail=f"Invalid decision. Must be one of: {valid_decisions}")

    dec = request.decision.upper()
    try:
        amazon_return.inspection_status = "RESTOCKED" if dec == "RESTOCK" else dec
        amazon_return.inspection_notes = request.notes
        amazon_return.inspection_images = request.images or []
        amazon_return.inspected_by = current_user.id
        amazon_return.inspected_at = datetime.utcnow()
        
        # Mark as received once inspected
        if amazon_return.return_status != "Received":
            amazon_return.return_status = "Received"
            if not amazon_return.received_at:
                amazon_return.received_at = datetime.utcnow()

        product = db.query(Product).filter(
            Product.sku == amazon_return.sku,
            Product.company_id == company_id
        ).first()
        
        if not product:
            product = Product(sku=amazon_return.sku, name=amazon_return.product_name or f"Unknown ({amazon_return.sku})", company_id=company_id)
            db.add(product)
            db.flush()
            
        inventory_event_id = None
        inventory_quantity = None
        
        audit_log = None
        if dec == "RESTOCK":
            target_wh_id = request.warehouse_id
            if target_wh_id:
                wh = db.query(Warehouse).filter(
                    Warehouse.id == target_wh_id,
                    Warehouse.company_id == company_id,
                    Warehouse.status == "ACTIVE"
                ).first()
                if not wh:
                    raise HTTPException(status_code=400, detail="Selected warehouse is not valid or active for this company")
                warehouse_id = wh.id
                wh_name = wh.name
            else:
                warehouses = db.query(Warehouse).filter(
                    Warehouse.company_id == company_id,
                    Warehouse.status == "ACTIVE"
                ).order_by(Warehouse.id.asc()).all()
                if not warehouses:
                    raise HTTPException(status_code=400, detail="No active warehouse configured for company")
                    
                warehouse_id = warehouses[0].id
                wh_name = warehouses[0].name
                for w in warehouses:
                    code = (w.code or "").strip().upper()
                    name = (w.name or "").strip().lower()
                    if code in ["DEFAULT", "MAIN", "POS"] or "default" in name or "main" in name:
                        warehouse_id = w.id
                        wh_name = w.name
                        break
                    
            # Process RESTOCK via InventoryEventEngine
            movement = InventoryEventEngine.process_event(
                db=db,
                company_id=company_id,
                product_sku=amazon_return.sku,
                warehouse_id=warehouse_id,
                quantity=amazon_return.quantity,
                event_type="ADD",
                source="Amazon Return",
                reference_id=amazon_return.amazon_return_id,
                user_id=current_user.id,
                metadata_payload={"notes": request.notes, "warehouse_name": wh_name},
                allow_negative_stock=True
            )
            inventory_event_id = movement.id
            inventory_quantity = movement.qty_after
            
            # Create Audit Log for restock
            audit_log = AuditLog(
                company_id=company_id,
                entity_type="AmazonReturn",
                entity_id=amazon_return.id,
                event_type="INSPECTION_RESTOCKED",
                message=f"Return {amazon_return.amazon_return_id} inspected & verified by {current_user.username}: Restocked {amazon_return.quantity} to {wh_name}",
                metadata_payload={"movement_id": movement.id, "warehouse_id": warehouse_id}
            )
            db.add(audit_log)
            
        elif dec == "DEFECTIVE":
            # Add to DefectiveInventory
            defective = DefectiveInventory(
                company_id=company_id,
                amazon_return_id=amazon_return.id,
                product_id=product.id,
                sku_snapshot=product.sku,
                product_name_snapshot=product.name,
                quantity=amazon_return.quantity,
                return_reason=amazon_return.return_reason,
                inspection_notes=request.notes,
                inspection_images=request.images or [],
                inspector_id=current_user.id,
                inspection_date=datetime.utcnow(),
                status="NEW"
            )
            db.add(defective)
            
            # Create Audit Log for defective
            audit_log = AuditLog(
                company_id=company_id,
                entity_type="AmazonReturn",
                entity_id=amazon_return.id,
                event_type="INSPECTION_DEFECTIVE",
                message=f"Return {amazon_return.amazon_return_id} marked defective by {current_user.username}",
                metadata_payload={"notes": request.notes}
            )
            db.add(audit_log)

        elif dec == "REJECTED":
            # Create Audit Log for rejected return (no inventory movement)
            audit_log = AuditLog(
                company_id=company_id,
                entity_type="AmazonReturn",
                entity_id=amazon_return.id,
                event_type="INSPECTION_REJECTED",
                message=f"Return {amazon_return.amazon_return_id} rejected by {current_user.username}: No inventory reverted",
                metadata_payload={"notes": request.notes}
            )
            db.add(audit_log)
            
        db.commit()
        db.refresh(amazon_return)
        audit_id = 0
        if audit_log:
            db.refresh(audit_log)
            audit_id = audit_log.id

        return InspectResponse(
            updated_return=amazon_return,
            inventory_event_id=inventory_event_id,
            inspection_status=amazon_return.inspection_status,
            inventory_quantity=inventory_quantity,
            audit_id=audit_id
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

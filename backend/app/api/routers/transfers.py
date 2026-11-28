from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api.dependencies import get_current_user, get_db, get_current_company_id
from app.models.schema import (
    User, StockTransfer, StockTransferItem, Product, Sale, SaleItem, 
    DocumentTypeEnum, CompanySettings, Company
)
from app.services.stock_transfer_service import StockTransferService
from app.services.transfer_number_service import TransferNumberService
from app.services.document_number_service import DocumentNumberService
from app.services.invoice_number_service import _get_fiscal_year_string
from app.services.metrics_service import log_metric
from datetime import datetime
import logging
from sqlalchemy import func

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transfers", tags=["Stock Transfers"])

from pydantic import BaseModel
from typing import List, Optional

class TransferItemRequest(BaseModel):
    product_id: int
    requested_qty: int
    unit_price: Optional[float] = 0.0
    product_sku: Optional[str] = None

class CreateTransferRequest(BaseModel):
    source_company_id: Optional[int] = None
    destination_company_id: Optional[int] = None
    from_company_id: Optional[int] = None  # Backward compatibility
    to_company_id: Optional[int] = None    # Backward compatibility
    source_warehouse_id: Optional[int] = None
    destination_warehouse_id: Optional[int] = None
    idempotency_key: Optional[str] = None
    auto_generate_bill: Optional[bool] = False
    invoice_prefix: Optional[str] = "GST"
    items: List[TransferItemRequest]

import os
from app.services.audit_log_service import AuditLogService

@router.post("/create")
def create_transfer(req: CreateTransferRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user), company_id: int = Depends(get_current_company_id)):
    src_comp = req.source_company_id or req.from_company_id
    dest_comp = req.destination_company_id or req.to_company_id
    
    if src_comp != company_id and dest_comp != company_id:
        raise HTTPException(status_code=403, detail="Cannot create transfer for unrelated companies")
        
    is_cross_company = src_comp != dest_comp
    if is_cross_company:
        cross_enabled = os.getenv("CROSS_COMPANY_TRANSFERS", "true").lower() == "true"
        if not cross_enabled:
            raise HTTPException(status_code=403, detail="Cross company transfers are currently disabled")
            
        has_permission = current_user.role in ["Admin", "SuperAdmin"] or "create_transfer" in (current_user.permissions or []) or "cross_company_transfer" in (current_user.permissions or [])
        if not has_permission:
            raise HTTPException(status_code=403, detail="Not authorized to create cross-company transfers")
        
    if req.idempotency_key:
        existing = db.query(StockTransfer).filter(
            StockTransfer.from_company_id == src_comp,
            StockTransfer.idempotency_key == req.idempotency_key
        ).first()
        if existing:
            return {"status": "success", "transfer_id": existing.id, "message": "Idempotent response"}

    transfer_num = TransferNumberService.generate_next(db, company_id=src_comp)
    transfer = StockTransfer(
        transfer_number=transfer_num,
        from_company_id=src_comp,
        to_company_id=dest_comp,
        source_warehouse_id=req.source_warehouse_id,
        destination_warehouse_id=req.destination_warehouse_id,
        idempotency_key=req.idempotency_key,
        status="Pending",
        created_by=current_user.id
    )
    db.add(transfer)
    db.flush()
    
    if is_cross_company:
        AuditLogService.log(
            db, 
            company_id=company_id, 
            entity_type="StockTransfer", 
            entity_id=transfer.id, 
            event_type="cross_company_transfer.create", 
            message="Created cross company transfer", 
            metadata={"source_company_id": src_comp, "destination_company_id": dest_comp},
            
        )

    for it in req.items:
        # Cross-company SKU resolution: Ensure product belongs to src_comp
        source_prod = None
        if it.product_id:
            p = db.query(Product).filter(Product.id == it.product_id).first()
            if p:
                if p.company_id == src_comp:
                    source_prod = p
                else:
                    source_prod = db.query(Product).filter(Product.sku == p.sku, Product.company_id == src_comp).first()
        if not source_prod and it.product_sku:
            source_prod = db.query(Product).filter(Product.sku == it.product_sku, Product.company_id == src_comp).first()

        prod_id = source_prod.id if source_prod else it.product_id
        rate = it.unit_price or (source_prod.item_rate if source_prod else 0.0) or 0.0

        ti = StockTransferItem(
            transfer_id=transfer.id,
            product_id=prod_id,
            requested_qty=it.requested_qty,
            unit_price=rate
        )
        db.add(ti)
    db.flush()

    # Automatically generate B2B Inter-Company Bill if requested (e.g. urgent replenishment)
    if req.auto_generate_bill and is_cross_company:
        src_settings = db.query(CompanySettings).filter(CompanySettings.company_id == src_comp).first()
        dest_settings = db.query(CompanySettings).filter(CompanySettings.company_id == dest_comp).first()
        src_company = db.query(Company).filter(Company.id == src_comp).first()
        dest_company = db.query(Company).filter(Company.id == dest_comp).first()

        seller_name = src_settings.legal_name if src_settings and src_settings.legal_name else (src_company.name if src_company else "B K RAMAN AND CO")
        seller_gstin = src_settings.gstin if src_settings else "04AEFPS6301F1ZU"
        seller_address = src_settings.address if src_settings else "Chandigarh"
        seller_state = src_settings.state if src_settings else "Chandigarh"
        seller_state_code = src_settings.state_code if src_settings else "04"

        buyer_name = dest_settings.legal_name if dest_settings and dest_settings.legal_name else (dest_company.name if dest_company else "Jagan Shopsmart Private Limited")
        buyer_gstin = dest_settings.gstin if dest_settings else "04AAFCJ8215N1ZC"
        buyer_address = dest_settings.address if dest_settings else "Plot no: 150, Industrial & Business Park-2, Chandigarh"
        buyer_state = dest_settings.state if dest_settings else "Chandigarh"
        buyer_state_code = dest_settings.state_code if dest_settings else "04"
        buyer_phone = dest_settings.phone if dest_settings else None

        fy = _get_fiscal_year_string(datetime.today().date())
        invoice_pref = (req.invoice_prefix or "GST").strip().upper()
        invoice_number = DocumentNumberService.generate_number(
            db=db,
            company_id=src_comp,
            document_type=DocumentTypeEnum.SALE,
            fiscal_year=fy,
            prefix_override=invoice_pref
        )

        is_intra_state = (seller_state_code == buyer_state_code)
        subtotal = 0.0
        total_cgst = 0.0
        total_sgst = 0.0
        total_igst = 0.0
        sale_items_data = []

        for ti in transfer.items:
            prod = db.query(Product).filter(Product.id == ti.product_id).first()
            rate = float(ti.unit_price or (prod.item_rate if prod else 0) or 100.0)
            qty = int(ti.requested_qty)
            line_taxable = round(rate * qty, 2)
            gst_rate = float(prod.default_gst_rate if prod and prod.default_gst_rate else 18.0)

            subtotal += line_taxable
            if is_intra_state:
                half_tax = round(line_taxable * (gst_rate / 200.0), 2)
                cgst = half_tax
                sgst = half_tax
                igst = 0.0
                total_cgst += cgst
                total_sgst += sgst
            else:
                cgst = 0.0
                sgst = 0.0
                igst = round(line_taxable * (gst_rate / 100.0), 2)
                total_igst += igst

            line_total = round(line_taxable + cgst + sgst + igst, 2)
            sale_items_data.append({
                "product_id": ti.product_id,
                "sku": prod.sku if prod else "",
                "product_name": prod.name if prod else "",
                "quantity": qty,
                "selling_price": rate,
                "gst_rate": gst_rate,
                "taxable_amount": line_taxable,
                "cgst": cgst,
                "sgst": sgst,
                "igst": igst,
                "line_total": line_total,
                "hsn_sac": prod.hsn if prod else None,
                "unit": prod.unit if prod else "PCS"
            })

        total_tax = round(total_cgst + total_sgst + total_igst, 2)
        grand_total = round(subtotal + total_tax, 2)

        sale = Sale(
            bill_number=invoice_number,
            company_id=src_comp,
            customer_name=buyer_name,
            customer_gstin=buyer_gstin,
            customer_address=buyer_address,
            customer_state=buyer_state,
            customer_state_code=buyer_state_code,
            customer_phone=buyer_phone,
            created_at=datetime.utcnow(),
            sale_date=datetime.utcnow(),
            invoice_number=invoice_number,
            invoice_type="B2B",
            transaction_origin="INTER_COMPANY_TRANSFER",
            total_taxable_amount=subtotal,
            total_tax=total_tax,
            grand_total=grand_total,
            payment_method="TRANSFER",
            payment_terms="Immediate Inter-Company",
            status="Completed",
            company_name_snapshot=seller_name,
            company_gstin_snapshot=seller_gstin,
            company_address_snapshot=seller_address,
            company_state_snapshot=seller_state,
            company_state_code_snapshot=seller_state_code,
            company_email_snapshot=(src_settings.email if src_settings else None),
            company_phone_snapshot=(src_settings.phone if src_settings else None),
            company_logo_url_snapshot=(src_settings.logo_url if src_settings else None),
            company_bank_details_snapshot=(src_settings.bank_details if src_settings else None)
        )
        db.add(sale)
        db.flush()

        for sid in sale_items_data:
            s_item = SaleItem(
                sale_id=sale.id,
                product_id=sid["product_id"],
                sku=sid["sku"],
                product_name=sid["product_name"],
                quantity=sid["quantity"],
                selling_price=sid["selling_price"],
                gst_rate=sid["gst_rate"],
                taxable_amount=sid["taxable_amount"],
                cgst=sid["cgst"],
                sgst=sid["sgst"],
                igst=sid["igst"],
                line_total=sid["line_total"],
                hsn_sac=sid["hsn_sac"],
                unit=sid["unit"]
            )
            db.add(s_item)
        db.flush()

        # Complete the transfer with the generated sale
        StockTransferService.complete_transfer_locked(
            db=db,
            transfer=transfer,
            invoice_id=sale.id,
            user_id=current_user.id,
            allow_negative_stock=True
        )
        db.commit()

        return {
            "status": "success",
            "transfer_id": transfer.id,
            "transfer_number": transfer.transfer_number,
            "invoice_id": sale.id,
            "invoice_number": sale.invoice_number,
            "grand_total": sale.grand_total,
            "message": f"Replenishment transfer created and B2B Bill {sale.invoice_number} generated successfully!"
        }

    db.commit()
    return {"status": "success", "transfer_id": transfer.id}

@router.post("/{transfer_id}/approve")
def approve_transfer(transfer_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user), company_id: int = Depends(get_current_company_id)):
    try:
        transfer = db.query(StockTransfer).filter(StockTransfer.id == transfer_id).first()
        if not transfer or (transfer.from_company_id != company_id and transfer.to_company_id != company_id):
            raise HTTPException(status_code=403, detail="Not authorized to approve this transfer")
            
        transfer = StockTransferService.approve_transfer(db, transfer_id, current_user.id)
        db.commit()
        
        logger.info(f"Action: Transfer Approve | User: {current_user.id} | Company: {company_id} | Status: Success | TransferID: {transfer.id}")
        log_metric("transfer_approved", 1, {"company_id": company_id})
        
        return {"status": "success", "transfer_id": transfer.id}
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        import logging
        logging.getLogger(__name__).error(str(e), exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))

from pydantic import BaseModel
from app.models.schema import Inventory

class CompleteTransferRequest(BaseModel):
    invoice_id: int
    idempotency_key: Optional[str] = None

@router.put("/{transfer_id}/complete")
def complete_transfer(transfer_id: int, req: CompleteTransferRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user), company_id: int = Depends(get_current_company_id)):
    try:
        # Lock the row for concurrency
        transfer = db.query(StockTransfer).filter(StockTransfer.id == transfer_id).with_for_update().first()
        if not transfer or (transfer.from_company_id != company_id and transfer.to_company_id != company_id):
            raise HTTPException(status_code=403, detail="Not authorized to complete this transfer")
            
        if req.idempotency_key and transfer.idempotency_key != req.idempotency_key:
            raise HTTPException(status_code=400, detail="Idempotency key mismatch: Completion must use the same identity as creation.")
            
        if transfer.status == "Completed":
            return {"status": "success", "transfer_id": transfer.id, "message": "Already completed"}
            
        transfer = StockTransferService.complete_transfer_locked(db, transfer, req.invoice_id, current_user.id)
        db.commit()
        return {"status": "success", "transfer_id": transfer.id}
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        import logging
        logging.getLogger(__name__).error(str(e), exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{transfer_id}")
def get_transfer(transfer_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user), company_id: int = Depends(get_current_company_id)):
    transfer = db.query(StockTransfer).filter(StockTransfer.id == transfer_id).first()
    if not transfer or (transfer.from_company_id != company_id and transfer.to_company_id != company_id):
        raise HTTPException(status_code=404, detail="Transfer not found")
        
    items = []
    for item in transfer.items:
        # Cross-company SKU resolution: ensure available stock is checked for source company product
        src_product = None
        sku = item.product.sku if item.product else None
        if item.product and item.product.company_id == transfer.from_company_id:
            src_product = item.product
        elif sku:
            src_product = db.query(Product).filter(
                Product.sku == sku,
                Product.company_id == transfer.from_company_id
            ).first()

        src_prod_id = src_product.id if src_product else item.product_id

        # Aggregate available stock across ALL warehouses for the source company
        total_available = db.query(
            func.sum(Inventory.available_qty)
        ).filter(
            Inventory.company_id == transfer.from_company_id,
            Inventory.product_id == src_prod_id
        ).scalar() or 0
        
        display_prod = src_product or item.product
        items.append({
            "id": item.id,
            "product_id": src_prod_id,
            "destination_product_id": item.product_id if item.product_id != src_prod_id else None,
            "sku": display_prod.sku if display_prod else "",
            "product_sku": display_prod.sku if display_prod else "",
            "product_name": display_prod.name if display_prod else "",
            "product": display_prod.name if display_prod else "",
            "hsn_sac": display_prod.hsn if display_prod else "",
            "gst_rate": display_prod.default_gst_rate if display_prod and display_prod.default_gst_rate is not None else 18.0,
            "requested_qty": item.requested_qty,
            "unit_price": item.unit_price or (display_prod.item_rate if display_prod else 0),
            "available_qty": total_available
        })
        
    return {
        "id": transfer.id,
        "transfer_number": transfer.transfer_number,
        "status": transfer.status,
        "from_company_id": transfer.from_company_id,
        "to_company_id": transfer.to_company_id,
        "source_warehouse_id": transfer.source_warehouse_id,
        "destination_warehouse_id": transfer.destination_warehouse_id,
        "items": items
    }

from typing import Optional
from sqlalchemy.orm import selectinload
from app.models.schema import CompanySettings, Company
from app.models.schema import StockTransferItem

@router.get("")
@router.get("/")
def list_transfers(
    status: Optional[str] = None, 
    to_company_id: Optional[int] = None,
    history: Optional[bool] = False,
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(StockTransfer).filter(
        (StockTransfer.from_company_id == company_id) | 
        (StockTransfer.to_company_id == company_id)
    )
    
    if to_company_id:
        query = query.filter(StockTransfer.to_company_id == to_company_id)
        
    if history:
        query = query.filter(StockTransfer.status == "Completed")
    elif status == "active":
        query = query.filter(StockTransfer.status.in_(["Pending", "In Progress"]))
    elif status:
        query = query.filter(StockTransfer.status == status)
        
    query = query.options(
        selectinload(StockTransfer.items).selectinload(StockTransferItem.product)
    ).order_by(StockTransfer.created_at.desc())
    transfers = query.all()
    
    # Pre-fetch companies for fast mapping
    companies_settings = {c.company_id: c.legal_name for c in db.query(CompanySettings).all()}
    companies_names = {c.id: c.name for c in db.query(Company).all()}
    
    result = []
    for t in transfers:
        total_qty = sum(item.requested_qty for item in t.items)
        total_amount = sum(item.requested_qty * item.unit_price for item in t.items)
        
        from_name = companies_settings.get(t.from_company_id) or companies_names.get(t.from_company_id) or "Unknown"
        to_name = companies_settings.get(t.to_company_id) or companies_names.get(t.to_company_id) or "Unknown"
        
        result.append({
            "id": t.id,
            "transfer_number": t.transfer_number,
            "status": t.status,
            "from_company_id": t.from_company_id,
            "to_company_id": t.to_company_id,
            "from_company_name": from_name,
            "to_company_name": to_name,
            "created_at": t.created_at,
            "invoice_id": t.invoice_id,
            "total_qty": total_qty,
            "total_amount": total_amount,
            "items_count": len(t.items),
            "items": [{"product_id": i.product_id, "sku": i.product.sku if i.product else "", "product_sku": i.product.sku if i.product else "", "product_name": i.product.name if i.product else ""} for i in t.items]
        })
        
    return result

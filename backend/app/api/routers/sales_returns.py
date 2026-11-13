from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from pydantic import BaseModel, ConfigDict
from app.models.db import get_db
from app.api.dependencies import get_current_company_id, get_current_user
from app.services.sales_return_service import SalesReturnService
from app.services.metrics_service import log_metric
import logging
logger = logging.getLogger(__name__)
from app.models.schema import SalesReturn, User

router = APIRouter(prefix="/sales-returns", tags=["Sales Returns"])

class SalesReturnItemCreate(BaseModel):
    sale_item_id: Optional[int] = None
    product_id: Optional[int] = None
    sku_snapshot: Optional[str] = None
    product_name_snapshot: Optional[str] = None
    returned_quantity: int
    return_reason: Optional[str] = None
    unit_price: float = 0.0
    tax_rate: float = 0.0
    tax_amount: float = 0.0
    total_price: float = 0.0

class SalesReturnCreate(BaseModel):
    idempotency_key: Optional[str] = None
    sale_id: Optional[int] = None
    return_number: Optional[str] = None
    return_type: str = "OFFLINE"
    customer_name: Optional[str] = None
    total_taxable_amount: float = 0.0
    total_tax: float = 0.0
    grand_total: float = 0.0
    items: List[SalesReturnItemCreate]

class SalesReturnItemResponse(SalesReturnItemCreate):
    id: int
    return_id: int
    hsn_snapshot: Optional[str] = None
    unit_snapshot: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

from datetime import datetime

class SalesReturnResponse(SalesReturnCreate):
    id: int
    company_id: int
    status: str
    return_date: Optional[datetime] = None
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None
    items: List[SalesReturnItemResponse]
    model_config = ConfigDict(from_attributes=True)

class CompleteReturnRequest(BaseModel):
    warehouse_id: Optional[int] = None

@router.get("/next-number")
def get_next_return_number(
    return_type: str = "OFFLINE",
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    from app.services.document_number_service import DocumentNumberService
    from app.models.schema import DocumentTypeEnum
    from app.services.invoice_number_service import _get_fiscal_year_string
    from datetime import datetime as dt
    fy = _get_fiscal_year_string(dt.today().date())
    prefix = "GGSR" if ("AMAZON" in return_type.upper() or "GGSR" in return_type.upper()) else "SR"
    preview = DocumentNumberService.get_next_number_preview(
        db, company_id, DocumentTypeEnum.RETURN, fy, prefix_override=prefix
    )
    return preview

@router.post("/draft", response_model=SalesReturnResponse)
def create_draft_return(
    data: SalesReturnCreate,
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    try:
        if data.idempotency_key:
            existing = db.query(SalesReturn).filter(
                SalesReturn.company_id == company_id,
                SalesReturn.idempotency_key == data.idempotency_key
            ).first()
            if existing:
                return existing

        rtn = SalesReturnService.create_draft(db, company_id, data.model_dump(), user.id)
        db.commit()
        db.refresh(rtn)
        return rtn
    except IntegrityError as e:
        db.rollback()
        if data.idempotency_key:
            existing = db.query(SalesReturn).filter(
                SalesReturn.company_id == company_id,
                SalesReturn.idempotency_key == data.idempotency_key
            ).first()
            if existing:
                return existing
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(str(e), exc_info=True)
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{return_id}/complete", response_model=SalesReturnResponse)
def complete_return(
    return_id: int,
    payload: Optional[CompleteReturnRequest] = None,
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    try:
        wh_id = payload.warehouse_id if payload else None
        rtn = SalesReturnService.complete_return(db, company_id, return_id, user.id, warehouse_id=wh_id)
        db.commit()
        db.refresh(rtn)
        
        logger.info(f"Action: Sales Return Complete | User: {user.id} | Company: {company_id} | Status: Success | ReturnID: {rtn.id}")
        log_metric("sales_return_completed", 1, {"company_id": company_id})
        
        return rtn
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(str(e), exc_info=True)
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{return_id}/cancel", response_model=SalesReturnResponse)
def cancel_return(
    return_id: int,
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    try:
        rtn = SalesReturnService.cancel_return(db, company_id, return_id)
        db.commit()
        db.refresh(rtn)
        return rtn
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(str(e), exc_info=True)
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{return_id}")
def get_return_detail(
    return_id: int,
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    from app.models.schema import Company, CompanySettings, Sale
    ret = db.query(SalesReturn).filter(
        SalesReturn.id == return_id,
        SalesReturn.company_id == company_id
    ).first()
    if not ret:
        raise HTTPException(status_code=404, detail="Sales return not found")

    company = db.query(Company).filter(Company.id == company_id).first()
    company_settings = db.query(CompanySettings).filter(CompanySettings.company_id == company_id).first()
    sale = db.query(Sale).filter(Sale.id == ret.sale_id).first() if ret.sale_id else None

    seller = {
        "name": company_settings.legal_name if company_settings and company_settings.legal_name else (company.name if company else "Company"),
        "code": company.code if company else "",
        "gstin": company_settings.gstin if company_settings and company_settings.gstin else "",
        "address": company_settings.address if company_settings and company_settings.address else "",
        "state": company_settings.state if company_settings and company_settings.state else "",
        "state_code": company_settings.state_code if company_settings and company_settings.state_code else "",
        "phone": company_settings.phone if company_settings and company_settings.phone else "",
        "email": company_settings.email if company_settings and company_settings.email else "",
        "bank_details": company_settings.bank_details if company_settings else None,
        "declaration": company_settings.declaration if company_settings else None
    }

    buyer = {
        "name": ret.customer_name or (sale.customer_name if sale else "Walk-in Customer"),
        "mobile": sale.customer_mobile if sale else "",
        "phone": sale.customer_phone if sale else "",
        "gstin": sale.customer_gstin if sale else "",
        "address": sale.customer_address if sale else "",
        "state": sale.customer_state if sale else "",
        "state_code": sale.customer_state_code if sale else "",
        "place_of_supply": sale.place_of_supply if sale else ""
    }

    original_invoice = {
        "id": sale.id if sale else None,
        "bill_number": sale.bill_number if sale else None,
        "invoice_number": sale.invoice_number if sale else None,
        "invoice_type": sale.invoice_type if sale else "B2C",
        "sale_date": sale.sale_date.isoformat() if sale and sale.sale_date else None,
        "payment_method": sale.payment_method if sale else None
    }

    seller_state = (seller["state_code"] or (seller["gstin"][:2] if seller["gstin"] else "04")).strip()
    buyer_state = (buyer["state_code"] or (buyer["gstin"][:2] if buyer["gstin"] else "")).strip()
    is_interstate = bool(buyer_state and buyer_state != seller_state)

    items_data = []
    total_taxable = 0.0
    total_cgst = 0.0
    total_sgst = 0.0
    total_igst = 0.0
    tax_breakdown = {}

    for it in ret.items:
        qty = it.returned_quantity or 0
        rate = float(it.unit_price or 0.0)
        taxable = float(round(qty * rate))
        gst_pct = float(it.tax_rate or 0.0)
        tax_amt = float(round(taxable * (gst_pct / 100.0)))
        line_tot = float(round(taxable + tax_amt))

        if is_interstate:
            cgst = 0.0
            sgst = 0.0
            igst = tax_amt
        else:
            cgst = float(round(tax_amt / 2.0))
            sgst = float(round(tax_amt - cgst))
            igst = 0.0

        total_taxable += taxable
        total_cgst += cgst
        total_sgst += sgst
        total_igst += igst

        hsn_key = it.hsn_snapshot or "9503"
        if hsn_key not in tax_breakdown:
            tax_breakdown[hsn_key] = {
                "hsn": hsn_key,
                "taxable": 0.0,
                "gst_rate": gst_pct,
                "cgst": 0.0,
                "sgst": 0.0,
                "igst": 0.0,
                "total_tax": 0.0
            }
        tax_breakdown[hsn_key]["taxable"] += taxable
        tax_breakdown[hsn_key]["cgst"] += cgst
        tax_breakdown[hsn_key]["sgst"] += sgst
        tax_breakdown[hsn_key]["igst"] += igst
        tax_breakdown[hsn_key]["total_tax"] += tax_amt

        items_data.append({
            "id": it.id,
            "product_id": it.product_id,
            "sale_item_id": it.sale_item_id,
            "sku": it.sku_snapshot,
            "product_name": it.product_name_snapshot,
            "hsn": it.hsn_snapshot,
            "unit": it.unit_snapshot or "PCS",
            "quantity": qty,
            "return_reason": it.return_reason,
            "unit_price": int(round(rate)),
            "tax_rate": gst_pct,
            "taxable_amount": int(round(taxable)),
            "tax_amount": int(round(tax_amt)),
            "cgst": int(round(cgst)),
            "sgst": int(round(sgst)),
            "igst": int(round(igst)),
            "total_price": int(round(line_tot))
        })

    tot_tax = total_cgst + total_sgst + total_igst
    raw_grand = total_taxable + tot_tax
    rounded_grand = round(raw_grand)
    round_off = rounded_grand - raw_grand

    totals = {
        "total_taxable_amount": int(round(total_taxable)),
        "cgst_amount": int(round(total_cgst)),
        "sgst_amount": int(round(total_sgst)),
        "igst_amount": int(round(total_igst)),
        "total_tax": int(round(tot_tax)),
        "round_off": round(round_off, 2),
        "grand_total": int(rounded_grand),
        "tax_breakdown": list(tax_breakdown.values())
    }

    return {
        "id": ret.id,
        "company_id": ret.company_id,
        "return_number": ret.return_number,
        "return_type": ret.return_type,
        "return_date": ret.return_date.isoformat() if ret.return_date else (ret.created_at.isoformat() if ret.created_at else None),
        "status": ret.status,
        "created_at": ret.created_at.isoformat() if ret.created_at else None,
        "company": seller,
        "customer": buyer,
        "original_invoice": original_invoice,
        "is_interstate": is_interstate,
        "items": items_data,
        "totals": totals
    }

@router.get("/", response_model=List[SalesReturnResponse])
def list_returns(
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    return db.query(SalesReturn).filter(SalesReturn.company_id == company_id).order_by(SalesReturn.id.desc()).all()

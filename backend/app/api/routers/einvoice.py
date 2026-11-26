from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime
import json
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from app.models.db import get_db
from app.models.schema import Sale, CompanySettings, User
from app.api.dependencies import get_current_company_id, get_current_user
from app.services.einvoice.einvoice_service import EInvoiceService
from app.services.einvoice.payload_builder import build_einvoice_payload
from app.utils.date_utils import parse_date_param

router = APIRouter(prefix="/einvoice", tags=["E-Invoice"])

class CancelIRNRequest(BaseModel):
    cancel_reason: str = "1" # 1: Duplicate, 2: Data entry mistake, 3: Order cancelled, 4: Others
    remarks: str = "Cancelled by user"

class BulkExportRequest(BaseModel):
    sale_ids: Optional[List[int]] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    series: Optional[str] = None

class EInvoiceSettingsUpdate(BaseModel):
    einvoice_enabled: bool = False
    einvoice_provider: str = "CLEARTAX"
    auth_token: Optional[str] = None
    gstin: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    environment: str = "sandbox" # sandbox | production
    auto_generate_on_pos: bool = False

@router.get("/settings")
def get_einvoice_settings(
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    settings = db.query(CompanySettings).filter(CompanySettings.company_id == company_id).first()
    if not settings:
        return {
            "einvoice_enabled": False,
            "einvoice_provider": "CLEARTAX",
            "environment": "sandbox",
            "gstin": "",
            "auth_token": "",
            "auto_generate_on_pos": False
        }
    config = settings.einvoice_config or {}
    return {
        "einvoice_enabled": bool(settings.einvoice_enabled),
        "einvoice_provider": settings.einvoice_provider or "CLEARTAX",
        "environment": config.get("environment", "sandbox"),
        "gstin": config.get("gstin") or settings.gstin or "",
        "auth_token": config.get("auth_token", ""),
        "client_id": config.get("client_id", ""),
        "client_secret": config.get("client_secret", ""),
        "auto_generate_on_pos": config.get("auto_generate_on_pos", False)
    }

@router.put("/settings")
def update_einvoice_settings(
    payload: EInvoiceSettingsUpdate,
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    settings = db.query(CompanySettings).filter(CompanySettings.company_id == company_id).first()
    if not settings:
        settings = CompanySettings(company_id=company_id)
        db.add(settings)

    settings.einvoice_enabled = payload.einvoice_enabled
    settings.einvoice_provider = payload.einvoice_provider
    settings.einvoice_config = {
        "auth_token": payload.auth_token or "",
        "gstin": payload.gstin or settings.gstin or "",
        "client_id": payload.client_id or "",
        "client_secret": payload.client_secret or "",
        "environment": payload.environment or "sandbox",
        "auto_generate_on_pos": payload.auto_generate_on_pos
    }
    db.commit()
    db.refresh(settings)
    return {"message": "E-Invoice settings updated successfully"}

@router.post("/generate/{sale_id}")
def generate_irn(
    sale_id: int,
    force_retry: bool = Query(False),
    company_id: int = Depends(get_current_company_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    sale = db.query(Sale).filter(Sale.id == sale_id, Sale.company_id == company_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale invoice not found.")

    try:
        result = EInvoiceService.generate_irn_for_sale(sale_id=sale.id, db=db, force_retry=force_retry)
        
        # Auto-trigger Tally sync if enabled for this company
        from app.services.tally_integration_service import TallyIntegrationService
        if TallyIntegrationService.is_enabled_for_company(db, company_id):
            try:
                tally_res = TallyIntegrationService.sync_sale(db, sale_id=sale.id, mode="PROCESSING")
                result["tally_sync"] = {
                    "status": tally_res.status,
                    "reference": tally_res.reference,
                    "error_message": tally_res.error_message
                }
            except Exception as t_err:
                import logging
                logging.getLogger(__name__).warning(f"Tally sync after IRN gen failed for sale {sale.id}: {t_err}")
                result["tally_sync"] = {"status": "FAILED", "error_message": str(t_err)}

        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/cancel/{sale_id}")
def cancel_irn(
    sale_id: int,
    payload: CancelIRNRequest,
    company_id: int = Depends(get_current_company_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    sale = db.query(Sale).filter(Sale.id == sale_id, Sale.company_id == company_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale invoice not found.")

    try:
        result = EInvoiceService.cancel_irn_for_sale(
            sale_id=sale.id,
            cancel_reason=payload.cancel_reason,
            remarks=payload.remarks,
            db=db
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/status/{sale_id}")
def get_einvoice_status(
    sale_id: int,
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    sale = db.query(Sale).filter(Sale.id == sale_id, Sale.company_id == company_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale invoice not found.")

    return {
        "sale_id": sale.id,
        "invoice_number": sale.invoice_number or sale.bill_number,
        "einvoice_status": sale.einvoice_status or "NOT_GENERATED",
        "einvoice_irn": sale.einvoice_irn,
        "einvoice_ack_no": sale.einvoice_ack_no,
        "einvoice_ack_date": sale.einvoice_ack_date.isoformat() if sale.einvoice_ack_date else None,
        "einvoice_qr_code_data": sale.einvoice_qr_code_data,
        "einvoice_error_message": sale.einvoice_error_message,
        "einvoice_canceled_at": sale.einvoice_canceled_at.isoformat() if sale.einvoice_canceled_at else None,
        "is_b2b": bool(sale.customer_gstin and len(sale.customer_gstin.strip()) >= 15)
    }

@router.get("/export-json/{sale_id}")
def export_single_json(
    sale_id: int,
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    """
    Exports a single B2B invoice as an official Government INV-01 JSON file
    compatible with the einvoice1.gst.gov.in portal.
    """
    sale = db.query(Sale).filter(Sale.id == sale_id, Sale.company_id == company_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale invoice not found.")
    
    if not sale.customer_gstin or len(sale.customer_gstin.strip()) < 15:
        raise HTTPException(status_code=400, detail="E-Invoice is only applicable for B2B sales with a valid 15-character GSTIN.")

    payload = build_einvoice_payload(sale, db=db)
    # The Government NIC portal expects an array of invoices [ {...} ]
    json_data = json.dumps([payload], indent=2)
    doc_no = (sale.invoice_number or sale.bill_number or f"Sale_{sale.id}").replace("/", "_").replace("\\", "_")
    filename = f"EInvoice_{doc_no}.json"

    return Response(
        content=json_data,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )

@router.post("/export-bulk-json")
def export_bulk_json(
    payload: BulkExportRequest,
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    """
    Exports multiple B2B invoices as an official Government bulk JSON file
    compatible with the einvoice1.gst.gov.in bulk upload tool.
    """
    query = db.query(Sale).filter(
        Sale.company_id == company_id,
        Sale.customer_gstin != None,
        func.length(func.trim(Sale.customer_gstin)) >= 15,
        Sale.status != "Cancelled"
    )

    if payload.sale_ids:
        query = query.filter(Sale.id.in_(payload.sale_ids))
    else:
        if payload.date_from:
            d_from = parse_date_param(payload.date_from)
            if d_from:
                query = query.filter(Sale.sale_date >= datetime.combine(d_from, datetime.min.time()))
        if payload.date_to:
            d_to = parse_date_param(payload.date_to)
            if d_to:
                query = query.filter(Sale.sale_date <= datetime.combine(d_to, datetime.max.time()))
        if payload.series and payload.series.strip():
            ser = payload.series.strip().upper()
            query = query.filter(
                or_(
                    Sale.bill_number.ilike(f"{ser}%"),
                    Sale.invoice_number.ilike(f"{ser}%")
                )
            )

    sales = query.order_by(Sale.sale_date.asc(), Sale.id.asc()).all()
    if not sales:
        raise HTTPException(status_code=400, detail="No eligible B2B invoices found for the selected criteria.")

    payloads = [build_einvoice_payload(s, db=db) for s in sales]
    json_data = json.dumps(payloads, indent=2)
    timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"EInvoice_Bulk_{len(sales)}_Bills_{timestamp_str}.json"

    return Response(
        content=json_data,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )

@router.post("/import-response")
async def import_government_response(
    file: UploadFile = File(...),
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    """
    Imports the signed response JSON downloaded from einvoice1.gst.gov.in,
    extracting IRN, Ack No, Ack Date, Signed QR Code, and E-Way Bill Number.
    """
    content = await file.read()
    try:
        data = json.loads(content.decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON file format: {str(e)}")

    if isinstance(data, dict):
        records = [data]
    elif isinstance(data, list):
        records = data
    else:
        raise HTTPException(status_code=400, detail="Unexpected JSON structure. Expected a list of invoice responses or an invoice response object.")

    updated_count = 0
    errors = []

    for item in records:
        # Standard NIC response keys: Irn, AckNo, AckDt, SignedQRCode, DocDtls: {Typ, No, Dt}
        doc_no = None
        doc_dtls = item.get("DocDtls") or item.get("doc_dtls") or {}
        if isinstance(doc_dtls, dict):
            doc_no = doc_dtls.get("No") or doc_dtls.get("no")
        if not doc_no:
            doc_no = item.get("doc_no") or item.get("invoice_number") or item.get("bill_number") or item.get("DocNo")

        irn = item.get("Irn") or item.get("irn")
        ack_no = item.get("AckNo") or item.get("ack_no")
        ack_dt_str = item.get("AckDt") or item.get("ack_date") or item.get("AckDate")
        signed_qr = item.get("SignedQRCode") or item.get("qr_code_data") or item.get("SignedQrCode")
        ewb_no = item.get("EwbNo") or item.get("ewb_no") or item.get("EwayBillNo")

        if not doc_no and not irn:
            continue

        sale_query = db.query(Sale).filter(Sale.company_id == company_id)
        if doc_no:
            sale = sale_query.filter(or_(Sale.invoice_number == doc_no, Sale.bill_number == doc_no)).first()
        else:
            sale = sale_query.filter(Sale.einvoice_irn == irn).first()

        if not sale:
            errors.append(f"Invoice '{doc_no or irn}' not found in company records.")
            continue

        ack_date = datetime.utcnow()
        if ack_dt_str:
            try:
                ack_date = datetime.fromisoformat(str(ack_dt_str).replace(" ", "T"))
            except Exception:
                try:
                    ack_date = datetime.strptime(str(ack_dt_str), "%d/%m/%Y %H:%M:%S")
                except Exception:
                    pass

        if irn:
            sale.einvoice_irn = irn
            sale.einvoice_status = "GENERATED"
        if ack_no:
            sale.einvoice_ack_no = str(ack_no)
        if ack_dt_str:
            sale.einvoice_ack_date = ack_date
        if signed_qr:
            sale.einvoice_qr_code_data = signed_qr
        if ewb_no:
            sale.eway_bill_number = str(ewb_no)
            sale.eway_bill_date = ack_date

        sale.einvoice_error_message = None
        updated_count += 1

    db.commit()
    return {
        "success": True,
        "updated_count": updated_count,
        "message": f"Successfully updated {updated_count} invoice(s) with Government IRN & Signed QR data.",
        "errors": errors if errors else []
    }

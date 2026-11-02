from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from uuid import uuid4

from app.models.db import get_db
from app.models.schema import Company, Product, Warehouse, WarehouseType, Inventory, Sale, SaleItem, CompanySettings, SalesReturn, SalesReturnItem, User, InventoryMovement
from app.api.dependencies import get_current_company_id, get_current_user
from app.services.inventory_event_engine import InventoryEventEngine
from app.services.invoice_number_service import InvoiceNumberService
from app.services.tally_integration_service import TallyIntegrationService
from app.services.audit_log_service import AuditLogService
from app.services.metrics_service import log_metric
from app.core.limiter import limiter
from fastapi import Request
import logging

import os

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pos", tags=["POS"])

# --- Authorization Dependency ---
def get_pos_company_id(company_id: int = Depends(get_current_company_id), db: Session = Depends(get_db)) -> int:
    """Allow BKR always. Allow JSPL only when ENABLE_POS_JSPL=true. Reject others."""
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=403, detail="Company not found.")

    allowed_codes = {"BKR"}
    if os.environ.get("ENABLE_POS_JSPL", "true").lower() == "true":
        allowed_codes.add("JSPL")

    if company.code not in allowed_codes:
        raise HTTPException(status_code=403, detail=f"POS is not enabled for {company.code}.")
    return company_id

# Keep old name as alias so nothing breaks if imported elsewhere
get_bkr_company_id = get_pos_company_id


def _resolve_default_warehouse(db: Session, company_id: int) -> Warehouse:
    """Resolve the default POS warehouse for any company."""
    company = db.query(Company).filter(Company.id == company_id).first()
    company_code = company.code if company else "UNKNOWN"

    warehouses = db.query(Warehouse).filter(
        Warehouse.company_id == company_id,
        Warehouse.status == "ACTIVE"
    ).order_by(Warehouse.id.asc()).all()

    if not warehouses:
        raise HTTPException(status_code=400, detail=f"No active warehouse configured for {company_code}")

    if len(warehouses) == 1:
        return warehouses[0]

    # JSPL-specific override: strictly use VSHB (FC VSHB Chandigarh)
    if company_code == "JSPL":
        vshb = next((w for w in warehouses if (w.code or "").strip().upper() == "VSHB"), None)
        if vshb:
            return vshb
        raise HTTPException(status_code=400, detail="JSPL POS requires the 'VSHB' warehouse, but it was not found or is inactive.")

    preferred_codes = {
        "DEFAULT", f"{company_code}-DEFAULT", f"{company_code}_DEFAULT",
        "MAIN", "POS", "CENTRAL", f"{company_code}_CENTRAL", f"{company_code}-CENTRAL", "BKR_CENTRAL"
    }
    for warehouse in warehouses:
        code = (warehouse.code or "").strip().upper()
        name = (warehouse.name or "").strip().lower()
        if code in preferred_codes or "default" in name or "main" in name or "pos" in name or "central" in name or "central" in code.lower():
            return warehouse

    # If no preferred code matched, return the first active warehouse
    if warehouses:
        return warehouses[0]

    raise HTTPException(
        status_code=400,
        detail=f"Multiple active {company_code} warehouses found. Mark one clearly as the default warehouse before using POS."
    )

# Keep old name as alias
_resolve_default_bkr_warehouse = _resolve_default_warehouse


def _generate_bill_number(company_code: str = "BKR") -> str:
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S%f")
    suffix = uuid4().hex[:6].upper()
    return f"{company_code}-{timestamp}-{suffix}"

# --- Pydantic Models ---
from pydantic import BaseModel, Field
from app.models.schema import StockTransfer
from app.services.tally_payload_builder import TallyPayloadBuilder
class PosCartItem(BaseModel):
    product_id: int
    sku: str
    product_name: Optional[str] = None
    hsn_sac: Optional[str] = None
    unit: Optional[str] = None
    quantity: int = Field(..., gt=0)
    selling_price: float
    discount: float = 0.0
    gst_rate: float
    taxable_amount: float
    cgst: float
    sgst: float
    igst: float = 0.0
    line_total: float

class PosCheckoutRequest(BaseModel):
    idempotency_key: Optional[str] = None
    customer_name: Optional[str] = None
    customer_mobile: Optional[str] = None
    customer_gstin: Optional[str] = None
    customer_address: Optional[str] = None
    customer_state: Optional[str] = None
    customer_state_code: Optional[str] = None
    place_of_supply: Optional[str] = None
    customer_email: Optional[str] = None
    customer_phone: Optional[str] = None

    shipping_name: Optional[str] = None
    shipping_address: Optional[str] = None
    shipping_state: Optional[str] = None
    shipping_state_code: Optional[str] = None
    shipping_gstin: Optional[str] = None

    invoice_type: str = "B2C"
    invoice_prefix: Optional[str] = None  # B2C | B2B
    custom_invoice_number: Optional[str] = None
    custom_invoice_date: Optional[datetime] = None
    buyer_order_no: Optional[str] = None
    buyer_order_date: Optional[str] = None
    payment_terms: Optional[str] = None
    delivery_note: Optional[str] = None
    delivery_note_date: Optional[datetime] = None
    dispatch_document_number: Optional[str] = None
    dispatch_through: Optional[str] = None
    destination: Optional[str] = None
    vehicle_number: Optional[str] = None
    lr_rr_number: Optional[str] = None
    terms_of_delivery: Optional[str] = None

    # Internal routing overrides (for cross-module calls)
    origin_warehouse_id: Optional[int] = None
    skip_inventory_update: bool = False
    transaction_origin: Optional[str] = None
    tally_sync_status: Optional[str] = None

    payment_method: str
    payment_reference: Optional[str] = None
    payment_remarks: Optional[str] = None
    payment_date: Optional[datetime] = None
    total_taxable_amount: float
    total_tax: float
    grand_total: float
    items: List[PosCartItem]

# --- Endpoints ---

@router.get("/products/search")
def search_products(q: str = "", warehouse_id: Optional[int] = None, company_id: int = Depends(get_bkr_company_id), db: Session = Depends(get_db)):
    if not q or len(q) < 2:
        return []

    search_term = f"%{q}%"
    
    if warehouse_id:
        default_warehouse = db.query(Warehouse).filter(Warehouse.id == warehouse_id, Warehouse.company_id == company_id).first()
        if not default_warehouse:
            default_warehouse = _resolve_default_bkr_warehouse(db, company_id)
    else:
        default_warehouse = _resolve_default_bkr_warehouse(db, company_id)

    # If warehouse is BKR Central (39) or Auto Godown (2), combine their inventory for unified billing
    wh_ids = [39, 2] if default_warehouse.id in (39, 2) else [default_warehouse.id]

    inv_subquery = (
        db.query(
            Inventory.product_id,
            func.sum(func.coalesce(Inventory.available_qty, 0)).label("combined_available_stock")
        )
        .filter(Inventory.warehouse_id.in_(wh_ids), Inventory.company_id == company_id)
        .group_by(Inventory.product_id)
        .subquery()
    )

    results = db.query(
        Product.id,
        Product.sku,
        Product.name,
        Product.hsn,
        Product.unit,
        Product.brand,
        Product.category,
        Product.item_rate.label("default_price"),
        Product.default_gst_rate,
        func.coalesce(inv_subquery.c.combined_available_stock, 0).label("available_stock")
    ).outerjoin(
        inv_subquery, 
        Product.id == inv_subquery.c.product_id
    ).filter(
        Product.company_id == company_id,
        Product.status == "Active",
        (Product.sku.ilike(search_term)) | (Product.name.ilike(search_term))
    ).limit(20).all()

    # For any product missing HSN or default_price, fall back to master catalog SKU
    missing_skus = [r.sku for r in results if not r.hsn or not r.default_price]
    sku_fallback_map = {}
    if missing_skus:
        fallbacks = db.query(Product).filter(
            Product.sku.in_(missing_skus),
            Product.status == "Active",
            (Product.hsn != None) | (Product.item_rate > 0)
        ).all()
        for fb in fallbacks:
            if fb.sku not in sku_fallback_map or (fb.hsn and fb.item_rate and fb.item_rate > 0):
                sku_fallback_map[fb.sku] = fb

    response_items = []
    for r in results:
        fb = sku_fallback_map.get(r.sku)
        hsn_val = r.hsn or (fb.hsn if fb else None) or "84248200"
        price_val = r.default_price if (r.default_price and r.default_price > 0) else ((fb.item_rate if fb and fb.item_rate else 0.0) if fb else r.default_price)
        gst_val = r.default_gst_rate if r.default_gst_rate is not None else ((fb.default_gst_rate if fb else 18.0) if fb else r.default_gst_rate)

        response_items.append({
            "id": r.id,
            "sku": r.sku,
            "name": r.name,
            "hsn_sac": hsn_val,
            "unit": r.unit or ("SERV" if (r.category in ["SERV", "SERVICE"] or r.sku == "SERVICE CHARGE") else "PCS"),
            "brand": r.brand or (fb.brand if fb else None),
            "category": r.category or (fb.category if fb else None),
            "default_price": price_val,
            "default_gst_rate": gst_val,
            "available_stock": 999999 if (r.category in ["SERV", "SERVICE"] or r.sku == "SERVICE CHARGE") else r.available_stock
        })
    return response_items

@router.get("/service-charge-item")
def get_service_charge_item(company_id: int = Depends(get_bkr_company_id), db: Session = Depends(get_db)):
    """Retrieve or auto-create the SERVICE CHARGE item for the company."""
    product = db.query(Product).filter(
        Product.company_id == company_id,
        Product.sku == "SERVICE CHARGE"
    ).first()
    if not product:
        product = Product(
            company_id=company_id,
            sku="SERVICE CHARGE",
            name="SERVICE CHARGE",
            category="SERV",
            brand="SERVICE",
            hsn="9987",
            hsn_code="9987",
            default_gst_rate=18.0,
            unit="SERV",
            status="Active",
            item_rate=0.0
        )
        db.add(product)
        db.commit()
        db.refresh(product)
    
    return {
        "id": product.id,
        "sku": product.sku,
        "name": product.name,
        "product_name": product.name,
        "hsn_sac": product.hsn or "9987",
        "unit": product.unit or "SERV",
        "pack_grade": "SERV",
        "brand": product.brand or "SERVICE",
        "category": "SERV",
        "default_price": product.item_rate or 0.0,
        "default_gst_rate": 18.0,
        "available_stock": 999999
    }

@router.post("/sale")
def complete_sale(
    request: Request,
    payload: PosCheckoutRequest, 
    company_id: int = Depends(get_bkr_company_id), 
    db: Session = Depends(get_db), 
    user: User = Depends(get_current_user),
    commit: bool = True
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    invoice_pref = (payload.invoice_prefix or "").strip().upper()
    for it in payload.items:
        if it.sku == "SERVICE CHARGE" or it.hsn_sac == "9987":
            if invoice_pref not in ["SERVICE", "SERV"]:
                raise HTTPException(
                    status_code=400,
                    detail="Service Charge can only be charged for Service series bills (SERVICE- or SERV-)."
                )

    if payload.idempotency_key:
        existing_sale = db.query(Sale).filter(Sale.idempotency_key == payload.idempotency_key, Sale.company_id == company_id).first()
        if existing_sale:
            return {
                "message": "Sale processed successfully (Idempotent response)",
                "receipt": _build_invoice_dto(existing_sale, db)
            }

    if payload.origin_warehouse_id:
        default_warehouse = db.query(Warehouse).options(joinedload(Warehouse.hub)).filter(Warehouse.id == payload.origin_warehouse_id).first()
        if not default_warehouse:
            raise HTTPException(status_code=400, detail="Origin warehouse not found")
    else:
        default_warehouse = _resolve_default_warehouse(db, company_id)

    try:
        # 1. Validate Stock (Aggregated to prevent overselling on duplicate items)
        if not payload.skip_inventory_update:
            product_ids = [item.product_id for item in payload.items if item.product_id]
            products_by_id = {p.id: p for p in db.query(Product).filter(Product.id.in_(product_ids)).all()} if product_ids else {}

            required_quantities = {}
            for item in payload.items:
                product = products_by_id.get(item.product_id)
                it_sku = (item.sku or "").strip().upper()
                it_hsn = (item.hsn_sac or "").strip()
                is_service_item = (
                    (product and (
                        (product.category and product.category.strip().upper() in ['SERV', 'SERVICE'])
                        or (product.sku and product.sku.strip().upper() == 'SERVICE CHARGE')
                        or (product.hsn and product.hsn.strip() == '9987')
                    ))
                    or it_sku == 'SERVICE CHARGE'
                    or it_hsn == '9987'
                )
                if is_service_item:
                    continue
                required_quantities[item.product_id] = required_quantities.get(item.product_id, 0) + item.quantity

            wh_ids = [39, 2] if default_warehouse.id in (39, 2) else [default_warehouse.id]

            for product_id, total_qty in required_quantities.items():
                if len(wh_ids) > 1:
                    invs = db.query(Inventory).filter(
                        Inventory.product_id == product_id,
                        Inventory.warehouse_id.in_(wh_ids),
                        Inventory.company_id == company_id
                    ).with_for_update().all()
                    combined_available = sum(inv.available_qty or 0 for inv in invs)
                    if combined_available < total_qty:
                        product = products_by_id.get(product_id) or db.query(Product).filter(Product.id == product_id).first()
                        sku_name = product.sku if product else str(product_id)
                        raise HTTPException(status_code=400, detail=f"Insufficient Stock for SKU: {sku_name} (Requested: {total_qty}, Combined Available: {combined_available})")
                else:
                    inv = db.query(Inventory).filter(
                        Inventory.product_id == product_id,
                        Inventory.warehouse_id == default_warehouse.id,
                        Inventory.company_id == company_id
                    ).with_for_update().first() # Lock row

                    if not inv or inv.available_qty < total_qty:
                        product = products_by_id.get(product_id) or db.query(Product).filter(Product.id == product_id).first()
                        sku_name = product.sku if product else str(product_id)
                        raise HTTPException(status_code=400, detail=f"Insufficient Stock for SKU: {sku_name}")

        # 2. Generate Invoice Number (sequence-based or prefixed custom)
        from app.services.document_number_service import DocumentNumberService
        from app.models.schema import DocumentTypeEnum
        from app.services.invoice_number_service import _get_fiscal_year_string
        from datetime import datetime
        import re
        company = db.query(Company).filter(Company.id == company_id).first()
        company_code = company.code if company else "CO"
        prefix = (payload.invoice_prefix or company_code).strip().upper()
        
        if payload.custom_invoice_number and payload.custom_invoice_number.strip():
            raw_no = payload.custom_invoice_number.strip()
            if prefix and not raw_no.upper().startswith(f"{prefix}-") and not raw_no.upper().startswith(f"{prefix}/"):
                # Avoid double prefixing if raw_no already starts with a known prefix
                if '-' in raw_no and raw_no.split('-')[0].upper() in ['GST', 'JGST', 'SERVICE', 'SERV', 'BKR', 'JSPL']:
                    invoice_number = raw_no
                else:
                    invoice_number = f"{prefix}-{raw_no}"
            else:
                invoice_number = raw_no

            # Keep DocumentSequence in sync with manually entered numbers
            try:
                m = re.search(r'(\d+)$', invoice_number)
                if m:
                    num_used = int(m.group(1))
                    fy = _get_fiscal_year_string(datetime.today().date())
                    DocumentNumberService.sync_sequence_with_number(db, company_id, prefix, fy, num_used)
            except Exception as e:
                logger.warning(f"Could not sync sequence with manual invoice number {invoice_number}: {e}")
        else:
            fy = _get_fiscal_year_string(datetime.today().date())
            invoice_number = DocumentNumberService.generate_number(
                db=db,
                company_id=company_id,
                document_type=DocumentTypeEnum.SALE,
                fiscal_year=fy,
                prefix_override=prefix
            )

        # Ensure bill_number is consistent and matches invoice_number
        bill_number = invoice_number or _generate_bill_number(company_code)

        # Company snapshot source (settings + selected warehouse)
        settings = db.query(CompanySettings).filter(CompanySettings.company_id == company_id).first()
        wh = default_warehouse

        seller_name = (settings.legal_name if settings and settings.legal_name else (company.name if company else None))
        seller_gstin = (settings.gstin if settings else None)
        seller_address = (settings.address if settings else None)
        seller_state = (settings.state if settings else None)
        seller_state_code = (settings.state_code if settings else None)
        seller_email = (settings.email if settings else None)
        seller_phone = (settings.phone if settings else None)

        if wh and wh.warehouse_type != WarehouseType.CENTRAL:
            if wh.hub:
                if wh.hub.gstin:
                    seller_gstin = wh.hub.gstin
                if wh.hub.state:
                    seller_state = wh.hub.state
                if wh.hub.state_code:
                    seller_state_code = wh.hub.state_code
                if wh.hub.address:
                    seller_address = wh.hub.address
                if wh.hub.phone:
                    seller_phone = wh.hub.phone
                if wh.hub.email:
                    seller_email = wh.hub.email
            if wh.address and wh.address.strip():
                seller_address = wh.address.strip()
            if wh.phone_number:
                seller_phone = wh.phone_number
            if wh.email:
                seller_email = wh.email

        # 3. Create Sale
        sale = Sale(
            bill_number=bill_number,
            company_id=company_id,
            customer_name=payload.customer_name,
            customer_gstin=payload.customer_gstin,
            customer_address=payload.customer_address,
            customer_state=payload.customer_state,
            customer_state_code=payload.customer_state_code,
            customer_phone=payload.customer_phone,
            customer_mobile=payload.customer_mobile,
            created_at=payload.custom_invoice_date or datetime.utcnow(),
            sale_date=payload.custom_invoice_date or datetime.utcnow(),
            customer_email=payload.customer_email,
            place_of_supply=payload.place_of_supply,
            shipping_name=payload.shipping_name,
            shipping_address=payload.shipping_address,
            shipping_state=payload.shipping_state,
            shipping_state_code=payload.shipping_state_code,
            shipping_gstin=payload.shipping_gstin,
            idempotency_key=payload.idempotency_key,
            invoice_number=invoice_number,
            invoice_type=payload.invoice_type,
            buyer_order_no=payload.buyer_order_no,
            buyer_order_date=payload.buyer_order_date,
            destination=payload.destination,
            payment_terms=payload.payment_terms,
            vehicle_number=payload.vehicle_number,
            lr_rr_number=payload.lr_rr_number,
            terms_of_delivery=payload.terms_of_delivery,
            delivery_note=payload.delivery_note,
            delivery_note_date=payload.delivery_note_date,
            dispatch_document_number=payload.dispatch_document_number,
            dispatch_through=payload.dispatch_through,

            company_name_snapshot=seller_name,
            company_gstin_snapshot=seller_gstin,
            company_address_snapshot=seller_address,
            company_state_snapshot=seller_state,
            company_state_code_snapshot=seller_state_code,
            company_email_snapshot=seller_email,
            company_phone_snapshot=seller_phone,
            company_logo_url_snapshot=(settings.logo_url if settings else None),
            company_bank_details_snapshot=(settings.bank_details if settings else None),

            tally_sync_status=payload.tally_sync_status or "NOT_APPLICABLE",
            transaction_origin=payload.transaction_origin or "POS",
            total_taxable_amount=payload.total_taxable_amount,
            total_tax=payload.total_tax,
            grand_total=payload.grand_total,
            payment_method=payload.payment_method,
            payment_reference=payload.payment_reference,
            payment_remarks=payload.payment_remarks,
            payment_date=payload.payment_date,
            status="Completed"
        )
        db.add(sale)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            existing_sale = db.query(Sale).filter(Sale.idempotency_key == payload.idempotency_key, Sale.company_id == company_id).first()
            if existing_sale:
                return {
                    "message": "Sale processed successfully (Idempotent response)",
                    "receipt": _build_invoice_dto(existing_sale, db)
                }
            raise

        # 4. Create Sale Items and Deduct Inventory
        prod_ids = [item.product_id for item in payload.items if item.product_id]
        products_map = {p.id: p for p in db.query(Product).filter(Product.id.in_(prod_ids), Product.company_id == company_id).all()} if prod_ids else {}

        for item in payload.items:
            product = products_map.get(item.product_id)
            final_hsn = item.hsn_sac or (product.hsn if product else None)
            sale_item = SaleItem(
                sale_id=sale.id,
                product_id=item.product_id,
                sku=item.sku,
                quantity=item.quantity,
                selling_price=item.selling_price,
                gst_rate=item.gst_rate,
                taxable_amount=item.taxable_amount,
                cgst=item.cgst,
                sgst=item.sgst,
                igst=item.igst,
                line_total=item.line_total,
                discount=item.discount,
                product_name=item.product_name or (product.name if product else None),
                hsn_sac=final_hsn,
                unit=item.unit or (product.unit if product else None),
            )
            db.add(sale_item)

            # Auto-update product HSN if it was missing in DB and provided in POS
            if product and item.hsn_sac and (not product.hsn or product.hsn in ['0', 'N/A', '']):
                product.hsn = item.hsn_sac
            
            # 5. Inventory Deduction via Event Engine
            # Use the verified DB product SKU, not the client-supplied SKU
            # Deduct from Inventory using Event Engine (if not skipped and not a service item)
            is_service_item = (
                (product and (product.category in ['SERV', 'SERVICE'] or product.sku == 'SERVICE CHARGE' or product.hsn == '9987'))
                or item.sku == 'SERVICE CHARGE'
                or item.hsn_sac == '9987'
            )
            if not payload.skip_inventory_update and product and not is_service_item:
                wh_ids = [39, 2] if default_warehouse.id in (39, 2) else [default_warehouse.id]
                if len(wh_ids) > 1:
                    qty_needed = item.quantity
                    central_inv = db.query(Inventory).filter(
                        Inventory.product_id == product.id,
                        Inventory.warehouse_id == 39,
                        Inventory.company_id == company_id
                    ).first()
                    central_avail = max(0, central_inv.available_qty if central_inv else 0)
                    qty_from_39 = min(qty_needed, central_avail)
                    qty_from_2 = qty_needed - qty_from_39

                    if qty_from_39 > 0:
                        InventoryEventEngine.process_event(
                            db=db,
                            company_id=company_id,
                            product_sku=product.sku,
                            warehouse_id=39,
                            quantity=qty_from_39,
                            event_type="SALE",
                            source="OFFLINE_POS",
                            reference_id=bill_number,
                            metadata_payload={"sale_id": sale.id}
                        )
                    if qty_from_2 > 0:
                        InventoryEventEngine.process_event(
                            db=db,
                            company_id=company_id,
                            product_sku=product.sku,
                            warehouse_id=2,
                            quantity=qty_from_2,
                            event_type="SALE",
                            source="OFFLINE_POS",
                            reference_id=bill_number,
                            metadata_payload={"sale_id": sale.id}
                        )
                else:
                    InventoryEventEngine.process_event(
                        db=db,
                        company_id=company_id,
                        product_sku=product.sku,
                        warehouse_id=default_warehouse.id,
                        quantity=item.quantity,
                        event_type="SALE",
                        source="OFFLINE_POS",
                        reference_id=bill_number,
                        metadata_payload={"sale_id": sale.id}
                    )

        if commit:
            db.commit()
            db.refresh(sale)
        else:
            db.flush()

        # Audit: invoice created (we treat Sale as invoice carrier for now)
        AuditLogService.log(
            db,
            company_id=company_id,
            entity_type="Sale",
            entity_id=sale.id,
            event_type="INVOICE_CREATED",
            message="Invoice created from POS checkout",
            metadata={"invoice_number": sale.invoice_number, "invoice_type": sale.invoice_type},
        )
        if commit:
            db.commit()
        
        # Tally sync (B2B only, configurable) - runs AFTER sale is committed
        # Tally failures should NOT rollback the sale
        tally_result = {"status": sale.tally_sync_status}
        if sale.invoice_type == "B2B":
            try:
                import logging
                tally_logger = logging.getLogger("pos.tally")
                if TallyIntegrationService.is_enabled_for_company(db, company_id):
                    # Only attempt Tally Sync if we are actually committing
                    if commit:
                        res = TallyIntegrationService.sync_sale(db, sale_id=sale.id, mode="PROCESSING")
                        db.commit()
                        db.refresh(sale)
                        tally_result = {"status": res.status, "reference": res.reference, "error_message": res.error_message}
                    else:
                        sale.tally_sync_status = "PENDING"  # Will be synced later
                        db.flush()
                        tally_result = {"status": "PENDING"}
                else:
                    sale.tally_sync_status = "NOT_APPLICABLE"
                    if commit:
                        db.commit()
                        db.refresh(sale)
                    else:
                        db.flush()
            except Exception as tally_err:
                import logging
                logging.getLogger(__name__).error(str(tally_err), exc_info=True)
                tally_logger.error(f"Tally sync failed for sale {sale.id}: {tally_err}")
                sale.tally_sync_status = "FAILED"
                if commit:
                    db.commit()
                    db.refresh(sale)
                else:
                    db.flush()
                tally_result = {"status": "FAILED", "error_message": str(tally_err)}

        # E-Invoice Generation (B2B only, configurable) - runs AFTER sale is committed
        if commit and sale.customer_gstin and len(sale.customer_gstin.strip()) >= 15:
            try:
                settings = db.query(CompanySettings).filter(CompanySettings.company_id == company_id).first()
                if settings and settings.einvoice_enabled:
                    cfg = settings.einvoice_config or {}
                    if cfg.get("auto_generate_on_pos", False):
                        from app.services.einvoice.einvoice_service import EInvoiceService
                        EInvoiceService.generate_irn_for_sale(sale_id=sale.id, db=db)
            except Exception as e_err:
                logging.getLogger(__name__).warning(f"Auto E-Invoice failed for sale {sale.id}: {e_err}")

        # Add audit logs
        AuditLogService.log(
            db, 
            company_id=company_id,entity_type="POS Checkout", 
            entity_id=sale.id, 
            event_type="Sale",
            message=f"POS Checkout by User {user.id}",
            metadata={"total_amount": sale.grand_total, "invoice_number": sale.invoice_number}
        )

        logger.info(f"Action: Sale | User: {user.id} | Company: {company_id} | Status: Success | SaleID: {sale.id} | Value: {sale.grand_total}")
        log_metric("sale_completed", 1, {"company_id": company_id})

        receipt = _build_invoice_dto(sale, db, is_new=True)
        return {"message": "Sale completed successfully", "receipt": receipt, "tally_sync": tally_result}
        
    except HTTPException:
        if commit:
            db.rollback()
        raise
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(str(e), exc_info=True)
        if commit:
            db.rollback()
        raise HTTPException(status_code=500, detail="An internal error occurred while processing the sale.")

@router.get("/history")
def get_sales_history(
    skip: int = 0, 
    limit: int = 50,
    search: Optional[str] = None,
    status: Optional[str] = None,
    invoice_type: Optional[str] = None,
    tally_status: Optional[str] = None,
    invoice_number: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    return_status: Optional[str] = None, # None, "Partially Returned", "Fully Returned", "Active Sales"
    company_id: int = Depends(get_bkr_company_id), 
    db: Session = Depends(get_db)
):
    # Subqueries for sold and returned totals
    sold_subq = (
        db.query(
            SaleItem.sale_id,
            func.sum(SaleItem.quantity).label("total_sold")
        )
        .group_by(SaleItem.sale_id)
        .subquery()
    )

    returned_subq = (
        db.query(
            SalesReturn.sale_id,
            func.sum(SalesReturnItem.returned_quantity).label("total_returned")
        )
        .join(SalesReturnItem, SalesReturn.id == SalesReturnItem.return_id)
        .filter(SalesReturn.status == "Completed")
        .group_by(SalesReturn.sale_id)
        .subquery()
    )

    query = db.query(
        Sale,
        func.coalesce(sold_subq.c.total_sold, 0).label("total_sold"),
        func.coalesce(returned_subq.c.total_returned, 0).label("total_returned")
    ).options(joinedload(Sale.items)) \
     .outerjoin(sold_subq, Sale.id == sold_subq.c.sale_id) \
     .outerjoin(returned_subq, Sale.id == returned_subq.c.sale_id) \
     .filter(Sale.company_id == company_id)
    
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (Sale.bill_number.ilike(search_term)) |
            (Sale.customer_name.ilike(search_term)) |
            (Sale.customer_mobile.ilike(search_term)) |
            (Sale.invoice_number.ilike(search_term))
        )
        
    if status:
        query = query.filter(Sale.status == status)

    if invoice_type:
        query = query.filter(Sale.invoice_type == invoice_type.upper())

    if tally_status:
        query = query.filter(Sale.tally_sync_status == tally_status.upper())

    if invoice_number:
        query = query.filter(Sale.invoice_number.ilike(f"%{invoice_number}%"))

    if date_from:
        try:
            from datetime import datetime as dt
            query = query.filter(Sale.sale_date >= dt.fromisoformat(date_from))
        except ValueError:
            pass

    if date_to:
        try:
            from datetime import datetime as dt
            query = query.filter(Sale.sale_date <= dt.fromisoformat(date_to))
        except ValueError:
            pass
            
    if return_status:
        # Note: the label names from subqueries can be referenced directly using their column objects
        total_sold_col = func.coalesce(sold_subq.c.total_sold, 0)
        total_returned_col = func.coalesce(returned_subq.c.total_returned, 0)
        
        if return_status == "None":
            query = query.filter(total_returned_col == 0)
        elif return_status == "Partially Returned":
            query = query.filter((total_returned_col > 0) & (total_returned_col < total_sold_col))
        elif return_status == "Fully Returned":
            query = query.filter((total_returned_col > 0) & (total_returned_col >= total_sold_col))
        elif return_status == "Active Sales":
            query = query.filter(total_returned_col < total_sold_col)
        
    total = query.count()
    results = query.order_by(Sale.id.desc()).offset(skip).limit(limit).all()
    
    response_items = []
    for row in results:
        s = row.Sale
        t_sold = row.total_sold
        t_ret = row.total_returned
        net_qty = t_sold - t_ret
        
        computed_return_status = "None"
        if t_ret > 0:
            computed_return_status = "Fully Returned" if t_ret >= t_sold else "Partially Returned"
            
        # Get linked return ids efficiently without N+1 if needed, but since it's just a boolean/id list, 
        # we can lazily load or omit if not strictly required for the list view (or query separately)
        # We will query linked return ids for this page
        
        response_items.append({
            "id": s.id,
            "bill_number": s.bill_number,
            "invoice_number": s.invoice_number,
            "invoice_type": s.invoice_type,
            "tally_sync_status": s.tally_sync_status,
            "customer_name": s.customer_name,
            "customer_gstin": s.customer_gstin,
            "sale_date": s.sale_date,
            "grand_total": s.grand_total,
            "total_tax": s.total_tax,
            "payment_method": s.payment_method,
            "status": s.status,
            "items_count": len(s.items),
            "return_status": computed_return_status,
            "returned_quantity": t_ret,
            "total_sold": t_sold,
            "einvoice_status": s.einvoice_status or "NOT_GENERATED",
            "einvoice_irn": s.einvoice_irn,
            "einvoice_ack_no": s.einvoice_ack_no,
            "einvoice_ack_date": s.einvoice_ack_date,
            "einvoice_error_message": s.einvoice_error_message
        })
    
    # Enrich with linked return ids
    if response_items:
        sale_ids = [item["id"] for item in response_items]
        linked_returns = db.query(SalesReturn.id, SalesReturn.sale_id).filter(SalesReturn.sale_id.in_(sale_ids)).all()
        return_map = {}
        for ret_id, s_id in linked_returns:
            if s_id not in return_map:
                return_map[s_id] = []
            return_map[s_id].append(ret_id)
            
        for item in response_items:
            item["linked_sales_return_ids"] = return_map.get(item["id"], [])
    
    return {
        "total": total,
        "items": response_items
    }


def _build_invoice_dto(sale: Sale, db: Session = None, is_new: bool = False) -> dict:
    # Fetch returns data if db is provided
    returns_summary = []
    item_return_map = {}
    origin_wh_id = None
    
    if db and not is_new:
        returns = db.query(SalesReturn).filter(SalesReturn.sale_id == sale.id, SalesReturn.status != "Cancelled").all()
        for r in returns:
            # sum up returned items
            ret_qty = sum(ri.returned_quantity for ri in r.items)
            returns_summary.append({
                "id": r.id,
                "return_number": r.return_number,
                "date": r.return_date.isoformat() if r.return_date else None,
                "status": r.status,
                "returned_quantity": ret_qty
            })
            
            # Map item level returns for "Completed" returns
            if r.status == "Completed":
                for ri in r.items:
                    if ri.sale_item_id:
                        item_return_map[ri.sale_item_id] = item_return_map.get(ri.sale_item_id, 0) + ri.returned_quantity
                        
        sale_mov = db.query(InventoryMovement).filter(InventoryMovement.reference_id == sale.bill_number).first()
        origin_wh_id = sale_mov.warehouse_id if sale_mov else None

    dto_items = []
    for i in (sale.items or []):
        ret_qty = item_return_map.get(i.id, 0)
        net_qty = i.quantity - ret_qty
        
        item_status = "Sold"
        if ret_qty > 0:
            item_status = "Returned" if ret_qty >= i.quantity else "Partial"
            
        pack_grade = ""
        if i.product:
            pack_grade = i.product.category or i.product.brand or ""
        if i.sku == "SERVICE CHARGE" or i.hsn_sac == "9987" or (i.product and i.product.category in ["SERV", "SERVICE"]):
            pack_grade = "SERV"

        dto_items.append({
            "id": i.id,
            "product_id": i.product_id,
            "sku": i.sku,
            "product_name": i.product_name or (i.product.name if i.product else None),
            "pack_grade": pack_grade,
            "hsn_sac": i.hsn_sac,
            "gst_rate": i.gst_rate,
            "quantity": i.quantity, # original sold
            "returned_quantity": ret_qty,
            "remaining_quantity": net_qty,
            "item_status": item_status,
            "unit": i.unit,
            "rate": i.selling_price,
            "discount": i.discount,
            "taxable_value": i.taxable_amount,
            "cgst": i.cgst,
            "sgst": i.sgst,
            "igst": i.igst,
            "line_total": i.line_total,
        })

    seller_name = sale.company_name_snapshot
    seller_gstin = sale.company_gstin_snapshot
    seller_address = sale.company_address_snapshot
    seller_state = sale.company_state_snapshot
    seller_state_code = sale.company_state_code_snapshot
    seller_email = sale.company_email_snapshot
    seller_phone = sale.company_phone_snapshot

    if origin_wh_id:
        wh = db.query(Warehouse).options(joinedload(Warehouse.hub)).filter(Warehouse.id == origin_wh_id).first()
        if wh and wh.warehouse_type != WarehouseType.CENTRAL:
            if wh.hub:
                if wh.hub.gstin: seller_gstin = wh.hub.gstin
                if wh.hub.state: seller_state = wh.hub.state
                if wh.hub.state_code: seller_state_code = wh.hub.state_code
                if wh.hub.address: seller_address = wh.hub.address
                if wh.hub.phone: seller_phone = wh.hub.phone
                if wh.hub.email: seller_email = wh.hub.email
            if wh.address and wh.address.strip():
                seller_address = wh.address.strip()
            if wh.phone_number: seller_phone = wh.phone_number
            if wh.email: seller_email = wh.email

    company_code = "BKR" if sale.company_id == 2 else ("JSPL" if sale.company_id == 3 else None)
    if not company_code and sale.company:
        company_code = sale.company.code

    seller_bank_details = sale.company_bank_details_snapshot
    if not seller_bank_details:
        if company_code == "BKR" or sale.company_id == 2:
            seller_bank_details = {
                "account_name": "B.K. RAMAN & CO (CA)",
                "account_no": "41836801381",
                "ifsc": "SBIN0007501",
                "bank_name": "State Bank Of India",
                "branch": "Industrial Area, Phase-2",
                "city": "Chandigarh"
            }
        else:
            seller_bank_details = {
                "account_name": "JAGAN SHOPSMART PVT LTD",
                "account_no": "50200075992904",
                "ifsc": "HDFC0001417",
                "bank_name": "HDFC Bank Ltd",
                "branch": "CHD- INDUSTRIAL AREA PH-II",
                "city": "Chandigarh"
            }

    if not seller_email:
        seller_email = "bkramanco@gmail.com" if (company_code == "BKR" or sale.company_id == 2) else "halteindia@gmail.com"
    if not seller_phone:
        seller_phone = "9501200185, 9914130130" if (company_code == "BKR" or sale.company_id == 2) else "9914130130, 9216407929, 9872607929, 9501200185"

    company_dict = {
        "id": sale.company_id,
        "company_id": sale.company_id,
        "code": company_code,
        "name": seller_name,
        "gstin": seller_gstin,
        "address": seller_address,
        "state": seller_state,
        "state_code": seller_state_code,
        "email": seller_email,
        "phone": seller_phone,
        "logo_url": sale.company_logo_url_snapshot,
        "bank_details": seller_bank_details,
    }

    return {
        "id": sale.id,
        "company_id": sale.company_id,
        "origin_warehouse_id": origin_wh_id,
        "status": sale.status,
        "bill_number": sale.bill_number,
        "invoice_number": sale.invoice_number,
        "invoice_type": sale.invoice_type,
        "sale_date": sale.sale_date.isoformat() if sale.sale_date else None,
        "payment_method": sale.payment_method,
        "payment_reference": sale.payment_reference,
        "payment_remarks": sale.payment_remarks,
        "payment_date": sale.payment_date.isoformat() if sale.payment_date else None,
        "buyer_order_no": sale.buyer_order_no,
        "buyer_order_date": sale.buyer_order_date,
        "payment_terms": sale.payment_terms,
        "delivery_note": sale.delivery_note,
        "delivery_note_date": sale.delivery_note_date.isoformat() if sale.delivery_note_date else None,
        "dispatch_document_number": sale.dispatch_document_number,
        "dispatch_through": sale.dispatch_through,
        "destination": sale.destination,
        "vehicle_number": sale.vehicle_number,
        "lr_rr_number": sale.lr_rr_number,
        "terms_of_delivery": sale.terms_of_delivery,
        "company": company_dict,
        "customer": {
            "name": sale.customer_name,
            "gstin": sale.customer_gstin,
            "address": sale.customer_address,
            "state": sale.customer_state,
            "state_code": sale.customer_state_code,
            "place_of_supply": sale.place_of_supply,
            "email": sale.customer_email,
            "phone": sale.customer_phone,
            "mobile": sale.customer_mobile,
        },
        "shipping": {
            "name": sale.shipping_name,
            "gstin": sale.shipping_gstin,
            "address": sale.shipping_address,
            "state": sale.shipping_state,
            "state_code": sale.shipping_state_code,
        } if sale.shipping_name else None,
        "totals": {
            "taxable_amount": sale.total_taxable_amount,
            "total_tax": sale.total_tax,
            "grand_total": sale.grand_total,
        },
        "tally": {
            "status": sale.tally_sync_status,
            "synced_at": sale.tally_sync_at.isoformat() if sale.tally_sync_at else None,
            "reference": sale.tally_reference,
            "error_message": sale.tally_error_message,
        },
        "einvoice": {
            "status": sale.einvoice_status or ("GENERATED" if sale.einvoice_irn else "NOT_GENERATED"),
            "irn": sale.einvoice_irn,
            "ack_no": sale.einvoice_ack_no,
            "ack_date": sale.einvoice_ack_date.isoformat() if sale.einvoice_ack_date else None,
            "qr_code_data": sale.einvoice_qr_code_data,
            "error_message": sale.einvoice_error_message,
            "canceled_at": sale.einvoice_canceled_at.isoformat() if sale.einvoice_canceled_at else None,
            "cancel_reason": sale.einvoice_cancel_reason,
            "is_b2b": bool(sale.customer_gstin and len(sale.customer_gstin.strip()) >= 15),
        },
        "einvoice_irn": sale.einvoice_irn,
        "einvoice_ack_no": sale.einvoice_ack_no,
        "einvoice_ack_date": sale.einvoice_ack_date.isoformat() if sale.einvoice_ack_date else None,
        "einvoice_qr_code_data": sale.einvoice_qr_code_data,
        "einvoice_status": sale.einvoice_status or ("GENERATED" if sale.einvoice_irn else "NOT_GENERATED"),
        "items": dto_items,
        "related_returns": returns_summary
    }


@router.get("/sales/{sale_id}")
def get_sale_invoice(sale_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sale = db.query(Sale).filter(Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
        
    if current_user.role.upper() not in ["ADMIN", "SUPER_ADMIN"]:
        from app.models.schema import CompanyUser
        access = db.query(CompanyUser).filter(
            CompanyUser.user_id == current_user.id,
            CompanyUser.company_id == sale.company_id
        ).first()
        if not access:
            transfer = db.query(StockTransfer).filter(StockTransfer.invoice_id == sale_id).first()
            if not transfer or (transfer.from_company_id != current_user.company_id and transfer.to_company_id != current_user.company_id):
                raise HTTPException(status_code=403, detail="Not authorized to access this sale")
            
    return {"receipt": _build_invoice_dto(sale, db)}


@router.get("/invoice/{invoice_number}")
def get_invoice_by_number(invoice_number: str, company_id: int = Depends(get_current_company_id), db: Session = Depends(get_db)):
    sale = db.query(Sale).filter(
        Sale.invoice_number == invoice_number,
        Sale.company_id == company_id
    ).first()
    
    if not sale:
        raise HTTPException(status_code=404, detail="Invoice not found")
        
    return {"receipt": _build_invoice_dto(sale, db)}


@router.get("/next-invoice-number")
def get_next_invoice_number(
    prefix: str = "GST",
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    from app.services.document_number_service import DocumentNumberService
    from app.services.invoice_number_service import _get_fiscal_year_string
    from app.models.schema import DocumentTypeEnum
    from datetime import datetime

    fy = _get_fiscal_year_string(datetime.today().date())
    result = DocumentNumberService.get_next_number_preview(
        db=db,
        company_id=company_id,
        document_type=DocumentTypeEnum.SALE,
        fiscal_year=fy,
        prefix_override=prefix
    )
    return result


@router.post("/sales/{sale_id}/retry-tally")
def retry_tally_sync(sale_id: int, company_id: int = Depends(get_bkr_company_id), db: Session = Depends(get_db)):
    sale = db.query(Sale).filter(Sale.id == sale_id, Sale.company_id == company_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")

    if (sale.invoice_type or "B2C") != "B2B":
        raise HTTPException(status_code=400, detail="Tally sync is only applicable for B2B invoices")

    if not TallyIntegrationService.is_enabled_for_company(db, company_id):
        raise HTTPException(status_code=400, detail="Tally integration is disabled for this company")

    sale.tally_sync_status = "RETRYING"
    db.commit()

    res = TallyIntegrationService.sync_sale(db, sale_id=sale.id, mode="PROCESSING")
    db.commit()
    db.refresh(sale)
    return {"tally_sync": {"status": res.status, "reference": res.reference, "error_message": res.error_message}, "receipt": _build_invoice_dto(sale, db)}

@router.get("/sales/{sale_id}/tally-payload")
def get_tally_payload(sale_id: int, company_id: int = Depends(get_bkr_company_id), db: Session = Depends(get_db)):
    sale = db.query(Sale).filter(Sale.id == sale_id, Sale.company_id == company_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
        
    try:
        import json
        json_payload = TallyPayloadBuilder.build_json(sale)
        xml_payload = TallyPayloadBuilder.build_xml(sale)
        
        return {
            "json": json.dumps(json_payload, indent=2),
            "xml": xml_payload
        }
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(str(e), exc_info=True)
        raise HTTPException(status_code=500, detail="An internal error occurred while generating the export.")


# =============================================================================
# OFFLINE POS QUEUE ENDPOINTS
# =============================================================================

from app.models.schema import OfflineSale

class OfflineSaleSubmitRequest(BaseModel):
    idempotency_key: str
    payload: dict

@router.post("/offline/submit")
def submit_offline_sale(
    data: OfflineSaleSubmitRequest,
    company_id: int = Depends(get_pos_company_id),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Store a single offline sale in the queue for later sync."""
    # Idempotency check
    existing = db.query(OfflineSale).filter(OfflineSale.idempotency_key == data.idempotency_key).first()
    if existing:
        return {"message": "Already queued (idempotent)", "offline_sale_id": existing.id, "status": existing.status}

    offline = OfflineSale(
        company_id=company_id,
        operator_id=user.id,
        payload=data.payload,
        status="PENDING",
        idempotency_key=data.idempotency_key
    )
    db.add(offline)
    db.commit()
    db.refresh(offline)

    logger.info(f"Offline sale queued: id={offline.id} company={company_id} user={user.id}")
    return {"message": "Offline sale queued", "offline_sale_id": offline.id, "status": "PENDING"}


@router.get("/offline/pending")
def list_pending_offline_sales(
    company_id: int = Depends(get_pos_company_id),
    db: Session = Depends(get_db)
):
    """List all PENDING offline sales for the current company."""
    pending = db.query(OfflineSale).filter(
        OfflineSale.company_id == company_id,
        OfflineSale.status == "PENDING"
    ).order_by(OfflineSale.created_at.asc()).all()

    return [
        {
            "id": p.id,
            "idempotency_key": p.idempotency_key,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "status": p.status,
            "payload_summary": {
                "items_count": len(p.payload.get("items", [])) if isinstance(p.payload, dict) else 0,
                "grand_total": p.payload.get("grand_total") if isinstance(p.payload, dict) else None
            }
        }
        for p in pending
    ]


@router.post("/offline/sync")
def sync_offline_sales(
    request: Request,
    company_id: int = Depends(get_pos_company_id),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Process all PENDING offline sales for the current company. Uses existing sale logic with idempotency."""
    pending = db.query(OfflineSale).filter(
        OfflineSale.company_id == company_id,
        OfflineSale.status == "PENDING"
    ).order_by(OfflineSale.created_at.asc()).all()

    if not pending:
        return {"synced": 0, "failed": 0, "details": [], "message": "No pending offline sales"}

    synced = 0
    failed = 0
    details = []

    for item in pending:
        try:
            # Build PosCheckoutRequest from the stored payload
            checkout_payload = PosCheckoutRequest(**item.payload)
            # Use the offline sale's idempotency_key to prevent duplicates
            checkout_payload.idempotency_key = item.idempotency_key

            result = complete_sale(
                request=request,
                payload=checkout_payload,
                company_id=company_id,
                db=db,
                user=user,
                commit=False  # We commit once at the end
            )

            item.status = "SYNCED"
            item.synced_at = datetime.utcnow()
            if result and "receipt" in result:
                item.sale_id = result["receipt"].get("id")
            synced += 1
            details.append({"offline_id": item.id, "status": "SYNCED", "sale_id": item.sale_id})

        except Exception as e:
            item.status = "FAILED"
            item.error_message = str(e)[:500]
            failed += 1
            details.append({"offline_id": item.id, "status": "FAILED", "error": str(e)[:200]})
            logger.error(f"Offline sync failed for id={item.id}: {e}")

    db.commit()

    logger.info(f"Offline sync complete: company={company_id} synced={synced} failed={failed}")
    return {"synced": synced, "failed": failed, "details": details}

@router.post("/sales/{sale_id}/cancel")
def cancel_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    sale = db.query(Sale).filter(Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
        
    if current_user.role.upper() not in ["ADMIN", "SUPER_ADMIN"]:
        from app.models.schema import CompanyUser
        access = db.query(CompanyUser).filter(
            CompanyUser.user_id == current_user.id,
            CompanyUser.company_id == sale.company_id
        ).first()
        if not access:
            raise HTTPException(status_code=403, detail="Not authorized to cancel this sale")
        
    if sale.status == 'Cancelled':
        raise HTTPException(status_code=400, detail="Sale is already cancelled")
        
    # Check if sale has active returns
    active_returns = db.query(SalesReturn).filter(SalesReturn.sale_id == sale.id, SalesReturn.status != 'Cancelled').all()
    if active_returns:
        raise HTTPException(status_code=400, detail="Cannot cancel a sale that has active returns. Please cancel the returns first.")

    # Find associated inventory movements to revert stock
    movements = db.query(InventoryMovement).filter(
        InventoryMovement.reference_id.in_([sale.bill_number, sale.invoice_number]),
        InventoryMovement.source.in_(['OFFLINE_POS', 'INVOICE_EDIT'])
    ).all()
    
    # Calculate net quantity deducted per (product_id, warehouse_id)
    net_deductions = {}
    for mov in movements:
        key = (mov.product_id, mov.warehouse_id)
        net_deductions[key] = net_deductions.get(key, 0) + mov.qty_changed

    has_reverted = False
    for (prod_id, wh_id), total_delta in net_deductions.items():
        if total_delta < 0:
            qty_to_restore = abs(total_delta)
            prod = db.query(Product).filter(Product.id == prod_id).first()
            if prod:
                InventoryEventEngine.process_event(
                    db=db,
                    company_id=sale.company_id,
                    product_sku=prod.sku,
                    warehouse_id=wh_id,
                    quantity=qty_to_restore,
                    event_type="ADD",
                    source="SALE_CANCELLED",
                    reference_id=f"CANCEL_{sale.bill_number}",
                    user_id=current_user.id,
                    metadata_payload={"sale_id": sale.id, "prod_id": prod_id, "warehouse_id": wh_id, "line_id": f"{prod_id}_{wh_id}"}
                )
                has_reverted = True

    # Fallback to sale items if no movements were recorded
    if not has_reverted:
        default_wh = _resolve_default_warehouse(db, sale.company_id)
        for item in (sale.items or []):
            if item.quantity > 0:
                sku = item.sku or (item.product.sku if item.product else None)
                if sku:
                    InventoryEventEngine.process_event(
                        db=db,
                        company_id=sale.company_id,
                        product_sku=sku,
                        warehouse_id=default_wh.id,
                        quantity=item.quantity,
                        event_type="ADD",
                        source="SALE_CANCELLED",
                        reference_id=f"CANCEL_{sale.bill_number}",
                        user_id=current_user.id,
                        metadata_payload={"sale_id": sale.id, "item_id": item.id, "line_id": str(item.id)}
                    )
            
    sale.status = 'Cancelled'
    
    # Audit log
    AuditLogService.log(
        db,
        company_id=sale.company_id,
        entity_type="Sale",
        entity_id=sale.id,
        event_type="SALE_CANCELLED",
        message=f"Cancelled sale {sale.bill_number} and reverted inventory",
        metadata={"bill_number": sale.bill_number, "user_id": current_user.id}
    )
    
    db.commit()
    return {"message": "Sale cancelled successfully", "sale_id": sale.id, "status": "Cancelled"}

@router.put("/sales/{sale_id}")
def update_sale(
    sale_id: int,
    payload: PosCheckoutRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    from app.services.inventory_event_engine import InventoryEventEngine
    
    sale = db.query(Sale).filter(Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
        
    if user.role.upper() not in ["ADMIN", "SUPER_ADMIN"]:
        from app.models.schema import CompanyUser
        access = db.query(CompanyUser).filter(
            CompanyUser.user_id == user.id,
            CompanyUser.company_id == sale.company_id
        ).first()
        if not access:
            raise HTTPException(status_code=403, detail="Not authorized to edit this sale")
        
    if sale.status == 'Cancelled':
        raise HTTPException(status_code=400, detail="Cannot edit a cancelled sale")
        
    # Validation: Ensure no returns exist
    active_returns = db.query(SalesReturn).filter(SalesReturn.sale_id == sale.id, SalesReturn.status != 'Cancelled').all()
    if active_returns:
        raise HTTPException(status_code=400, detail="Cannot edit a sale that has active sales returns. Please cancel the returns first.")

    target_company_id = sale.company_id

    # 1. Header Updates
    if payload.custom_invoice_number and payload.custom_invoice_number.strip():
        raw_no = payload.custom_invoice_number.strip()
        prefix = (payload.invoice_prefix or "").strip().upper()
        if prefix and not raw_no.upper().startswith(f"{prefix}-") and not raw_no.upper().startswith(f"{prefix}/"):
            new_inv_no = f"{prefix}-{raw_no}"
        else:
            new_inv_no = raw_no

        if new_inv_no != sale.bill_number:
            # Check for uniqueness
            existing = db.query(Sale).filter(Sale.bill_number == new_inv_no, Sale.company_id == target_company_id).first()
            if existing and existing.id != sale.id:
                raise HTTPException(status_code=400, detail=f"Invoice number {new_inv_no} is already used.")
            sale.bill_number = new_inv_no
            sale.invoice_number = new_inv_no

    sale.customer_name = payload.customer_name
    sale.customer_gstin = payload.customer_gstin
    sale.customer_address = payload.customer_address
    sale.customer_state = payload.customer_state
    sale.customer_state_code = payload.customer_state_code
    sale.customer_phone = payload.customer_phone
    sale.customer_mobile = payload.customer_mobile
    sale.customer_email = payload.customer_email
    sale.place_of_supply = payload.place_of_supply
    sale.shipping_name = payload.shipping_name
    sale.shipping_address = payload.shipping_address
    sale.shipping_state = payload.shipping_state
    sale.shipping_state_code = payload.shipping_state_code
    sale.shipping_gstin = payload.shipping_gstin
    sale.invoice_type = payload.invoice_type
    
    if payload.custom_invoice_date:
        sale.created_at = payload.custom_invoice_date
        sale.sale_date = payload.custom_invoice_date
        
    sale.buyer_order_no = payload.buyer_order_no
    sale.buyer_order_date = payload.buyer_order_date
    sale.destination = payload.destination
    sale.payment_terms = payload.payment_terms
    sale.vehicle_number = payload.vehicle_number
    sale.lr_rr_number = payload.lr_rr_number
    sale.terms_of_delivery = payload.terms_of_delivery
    sale.delivery_note = payload.delivery_note
    sale.delivery_note_date = payload.delivery_note_date
    sale.dispatch_document_number = payload.dispatch_document_number
    sale.dispatch_through = payload.dispatch_through
    
    sale.total_taxable_amount = payload.total_taxable_amount
    sale.total_tax = payload.total_tax
    sale.grand_total = payload.grand_total

    sale.payment_method = payload.payment_method
    sale.payment_reference = payload.payment_reference
    sale.payment_remarks = payload.payment_remarks
    if payload.payment_date:
        sale.payment_date = payload.payment_date
    
    # Reset Tally sync
    if sale.tally_sync_status in ['COMPLETED', 'FAILED', 'PENDING']:
        sale.tally_sync_status = 'PENDING'
        
    # 2. Resolve default warehouse for delta tracking
    if payload.origin_warehouse_id:
        default_warehouse = db.query(Warehouse).filter(Warehouse.id == payload.origin_warehouse_id).first()
    else:
        sale_mov = db.query(InventoryMovement).filter(InventoryMovement.reference_id == sale.bill_number).first()
        if sale_mov:
            default_warehouse = db.query(Warehouse).filter(Warehouse.id == sale_mov.warehouse_id).first()
        else:
            default_warehouse = _resolve_default_warehouse(db, target_company_id)
        
    if not default_warehouse:
        default_warehouse = _resolve_default_warehouse(db, target_company_id)
    if not default_warehouse:
        raise HTTPException(status_code=400, detail="Warehouse not found for delta processing")

    # Update seller snapshot if warehouse is non-central
    if default_warehouse and default_warehouse.warehouse_type != WarehouseType.CENTRAL:
        wh = db.query(Warehouse).options(joinedload(Warehouse.hub)).filter(Warehouse.id == default_warehouse.id).first()
        if wh:
            if wh.hub:
                if wh.hub.gstin: sale.company_gstin_snapshot = wh.hub.gstin
                if wh.hub.state: sale.company_state_snapshot = wh.hub.state
                if wh.hub.state_code: sale.company_state_code_snapshot = wh.hub.state_code
                if wh.hub.address: sale.company_address_snapshot = wh.hub.address
                if wh.hub.phone: sale.company_phone_snapshot = wh.hub.phone
                if wh.hub.email: sale.company_email_snapshot = wh.hub.email
            if wh.address and wh.address.strip():
                sale.company_address_snapshot = wh.address.strip()
            if wh.phone_number:
                sale.company_phone_snapshot = wh.phone_number
            if wh.email:
                sale.company_email_snapshot = wh.email

    # 2.5 Resolve linked transfer (for inter-company edits)
    from app.models.schema import StockTransfer
    linked_transfer = db.query(StockTransfer).filter(StockTransfer.invoice_id == sale.id).first()
    dest_warehouse_id = None
    dest_company_id = None
    if linked_transfer:
        dest_company_id = linked_transfer.to_company_id
        if linked_transfer.destination_warehouse_id:
            dw = db.query(Warehouse).filter(Warehouse.id == linked_transfer.destination_warehouse_id).first()
        else:
            dw = _resolve_default_warehouse(db, linked_transfer.to_company_id)
        if dw:
            dest_warehouse_id = dw.id

    # 3. Item Delta Calculation
    invoice_pref = (payload.invoice_prefix or "").strip().upper()
    for it in (payload.items or []):
        if it.sku == "SERVICE CHARGE" or it.hsn_sac == "9987":
            if invoice_pref not in ["SERVICE", "SERV"]:
                raise HTTPException(
                    status_code=400,
                    detail="Service Charge can only be charged for Service series bills (SERVICE- or SERV-)."
                )

    old_items = {item.id: item for item in sale.items}
    new_items_payload = payload.items or []
    
    # Process updates and additions
    for req_item in new_items_payload:
        product = None
        if req_item.product_id:
            product = db.query(Product).filter(Product.id == req_item.product_id).first()
        if not product and req_item.sku:
            product = db.query(Product).filter(Product.sku == req_item.sku).first()
            
        if not product:
            continue
            
        existing_item = next((oi for oi in old_items.values() if oi.sku == (req_item.sku or product.sku)), None)
        
        delta_qty = req_item.quantity
        if existing_item:
            delta_qty = req_item.quantity - existing_item.quantity
            
            # Update existing row
            existing_item.product_id = product.id
            existing_item.quantity = req_item.quantity
            existing_item.selling_price = req_item.selling_price
            existing_item.gst_rate = req_item.gst_rate
            existing_item.taxable_amount = req_item.taxable_amount
            existing_item.cgst = req_item.cgst
            existing_item.sgst = req_item.sgst
            existing_item.igst = req_item.igst
            existing_item.line_total = req_item.line_total
            existing_item.product_name = req_item.product_name or product.name
            existing_item.hsn_sac = req_item.hsn_sac or product.hsn
            existing_item.unit = req_item.unit or product.unit
            existing_item.discount = req_item.discount or 0.0
            
            del old_items[existing_item.id] # mark as processed
        else:
            # Create new row
            new_sale_item = SaleItem(
                sale_id=sale.id,
                product_id=product.id,
                sku=product.sku,
                quantity=req_item.quantity,
                selling_price=req_item.selling_price,
                gst_rate=req_item.gst_rate,
                taxable_amount=req_item.taxable_amount,
                cgst=req_item.cgst,
                sgst=req_item.sgst,
                igst=req_item.igst,
                line_total=req_item.line_total,
                product_name=req_item.product_name or product.name,
                hsn_sac=req_item.hsn_sac or product.hsn,
                unit=req_item.unit or product.unit,
                discount=req_item.discount or 0.0
            )
            db.add(new_sale_item)
            
        # Apply Inventory Delta
        is_service_item = (
            (product and (product.category in ['SERV', 'SERVICE'] or product.sku == 'SERVICE CHARGE' or product.hsn == '9987'))
            or req_item.sku == 'SERVICE CHARGE'
            or req_item.hsn_sac == '9987'
        )
        if delta_qty != 0 and not payload.skip_inventory_update and not is_service_item:
            wh_ids = [39, 2] if default_warehouse.id in (39, 2) else [default_warehouse.id]
            if len(wh_ids) > 1 and delta_qty > 0:
                central_inv = db.query(Inventory).filter(
                    Inventory.product_id == product.id,
                    Inventory.warehouse_id == 39,
                    Inventory.company_id == target_company_id
                ).first()
                central_avail = max(0, central_inv.available_qty if central_inv else 0)
                qty_from_39 = min(delta_qty, central_avail)
                qty_from_2 = delta_qty - qty_from_39
                if qty_from_39 > 0:
                    InventoryEventEngine.process_event(
                        db=db,
                        company_id=target_company_id,
                        product_sku=product.sku,
                        warehouse_id=39,
                        quantity=qty_from_39,
                        event_type="SALE",
                        source="OFFLINE_POS",
                        reference_id=sale.bill_number,
                        metadata_payload={
                            "operation_id": f"EDIT_{sale.id}_{product.sku}_{uuid4().hex[:8]}",
                            "sale_id": sale.id, 
                            "edit_delta": qty_from_39
                        },
                    )
                if qty_from_2 > 0:
                    InventoryEventEngine.process_event(
                        db=db,
                        company_id=target_company_id,
                        product_sku=product.sku,
                        warehouse_id=2,
                        quantity=qty_from_2,
                        event_type="SALE",
                        source="OFFLINE_POS",
                        reference_id=sale.bill_number,
                        metadata_payload={
                            "operation_id": f"EDIT_WH2_{sale.id}_{product.sku}_{uuid4().hex[:8]}",
                            "sale_id": sale.id, 
                            "edit_delta": qty_from_2
                        },
                    )
            else:
                event_type = "SALE" if delta_qty > 0 else "ADD"
                source = "OFFLINE_POS" if delta_qty > 0 else "INVOICE_EDIT"
                wh_target = 39 if default_warehouse.id in (39, 2) else default_warehouse.id
                InventoryEventEngine.process_event(
                    db=db,
                    company_id=target_company_id,
                    product_sku=product.sku,
                    warehouse_id=wh_target,
                    quantity=abs(delta_qty),
                    event_type=event_type,
                    source=source,
                    reference_id=sale.bill_number,
                    metadata_payload={
                        "operation_id": f"EDIT_{sale.id}_{product.sku}_{uuid4().hex[:8]}",
                        "sale_id": sale.id, 
                        "edit_delta": delta_qty
                    },
                )
            
            if linked_transfer and dest_warehouse_id:
                dest_event_type = "TRANSFER_IN" if delta_qty > 0 else "TRANSFER_OUT"
                InventoryEventEngine.process_event(
                    db=db,
                    company_id=dest_company_id,
                    product_sku=product.sku,
                    warehouse_id=dest_warehouse_id,
                    quantity=abs(delta_qty),
                    event_type=dest_event_type,
                    source="INVOICE_EDIT",
                    reference_id=sale.bill_number,
                    metadata_payload={
                        "operation_id": f"EDIT_TRF_{sale.id}_{product.sku}_{uuid4().hex[:8]}",
                        "sale_id": sale.id, 
                        "edit_delta": delta_qty, 
                        "linked_transfer": linked_transfer.id
                    },
                )
            
    # Process removals (anything left in old_items was deleted from the UI)
    for oi in old_items.values():
        is_oi_service = (
            (oi.sku and oi.sku.strip().upper() == "SERVICE CHARGE")
            or (oi.hsn_sac and oi.hsn_sac.strip() == "9987")
        )
        if not payload.skip_inventory_update and not is_oi_service:
            wh_target = 39 if default_warehouse.id in (39, 2) else default_warehouse.id
            InventoryEventEngine.process_event(
                db=db,
                company_id=target_company_id,
                product_sku=oi.sku,
                warehouse_id=wh_target,
                quantity=oi.quantity,
                event_type="ADD",
                source="INVOICE_EDIT",
                reference_id=sale.bill_number,
                metadata_payload={
                    "operation_id": f"EDIT_DEL_{sale.id}_{oi.sku}_{uuid4().hex[:8]}",
                    "sale_id": sale.id, 
                    "edit_delta": -oi.quantity
                },
            )

            if linked_transfer and dest_warehouse_id:
                InventoryEventEngine.process_event(
                    db=db,
                    company_id=dest_company_id,
                    product_sku=oi.sku,
                    warehouse_id=dest_warehouse_id,
                    quantity=oi.quantity,
                    event_type="TRANSFER_OUT",
                    source="INVOICE_EDIT",
                    reference_id=sale.bill_number,
                    metadata_payload={
                        "operation_id": f"EDIT_TRF_DEL_{sale.id}_{oi.sku}_{uuid4().hex[:8]}",
                        "sale_id": sale.id, 
                        "edit_delta": -oi.quantity, 
                        "linked_transfer": linked_transfer.id
                    },
                )
        db.delete(oi)

    db.commit()
    return {"message": "Invoice updated successfully"}

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import func, or_, and_, case, distinct
from datetime import datetime, date
from typing import Optional

from app.models.db import get_db
from app.api.dependencies import get_current_user, get_current_company_id
from app.models.schema import (
    User, Sale, SaleItem, Inventory, Product, Warehouse,
    FCDispatch, FCReturn, DamageClaim, DefectiveInventory,
    StateHub, AmazonLiveAllocation, AmazonNetworkType, AllocationStatus, AmazonReturn,
    SalesReturn, SalesReturnItem
)
from app.utils.date_utils import parse_date_param
from app.services.series_report_service import get_allocation_date_expr

router = APIRouter(prefix="/business-reports", tags=["Business Reports"])


def _build_amazon_sales_agg_query(
    db: Session,
    company_id: Optional[int],
    s_clean: Optional[str],
    matched_wh: Optional[Warehouse],
    group_by: str,
    parsed_date_from: Optional[date],
    parsed_date_to: Optional[date],
    search: Optional[str],
):
    """Build aggregated period query for AmazonLiveAllocation orders shared by view and export endpoints."""
    is_sqlite = (db.bind.dialect.name == "sqlite") if db.bind else False
    is_in_series = (s_clean == "IN") or (bool(matched_wh) and (matched_wh.code or "").strip().upper() == "IN")
    alloc_date_col = get_allocation_date_expr(db, is_in_series)

    if is_sqlite:
        if group_by == "month":
            period_col = func.strftime("%Y-%m", alloc_date_col).label("period")
        elif group_by == "week":
            period_col = func.strftime("%Y-%W", alloc_date_col).label("period")
        else:
            period_col = func.date(alloc_date_col).label("period")
    else:
        if group_by == "month":
            period_col = func.to_char(alloc_date_col, "YYYY-MM").label("period")
        elif group_by == "week":
            period_col = func.to_char(alloc_date_col, "YYYY-WW").label("period")
        else:
            period_col = func.to_char(alloc_date_col, "YYYY-MM-DD").label("period")

    alloc_query = db.query(AmazonLiveAllocation).filter(
        or_(
            AmazonLiveAllocation.allocated_qty > 0,
            AmazonLiveAllocation.reconciled_qty > 0,
        ),
        AmazonLiveAllocation.status.notin_([AllocationStatus.CANCELLED]),
    )
    if company_id and not is_in_series:
        has_allocs = db.query(AmazonLiveAllocation.id).filter(AmazonLiveAllocation.company_id == company_id).first()
        if has_allocs:
            alloc_query = alloc_query.filter(AmazonLiveAllocation.company_id == company_id)

    if s_clean in ("AMAZON", "ALL"):
        pass
    elif s_clean == "AFN":
        alloc_query = alloc_query.filter(AmazonLiveAllocation.amazon_network_at_allocation == AmazonNetworkType.AFN)
    elif s_clean == "MFN":
        alloc_query = alloc_query.filter(AmazonLiveAllocation.amazon_network_at_allocation == AmazonNetworkType.MFN)
    elif is_in_series:
        alloc_query = alloc_query.filter(
            or_(
                AmazonLiveAllocation.warehouse_id == 38,
                AmazonLiveAllocation.invoice_number.ilike("IN-%"),
            )
        )
    elif matched_wh:
        is_central_bkr = (matched_wh.code.upper() == "BKR_CENTRAL") or (
            company_id == 2
            and matched_wh.warehouse_type
            and (
                str(matched_wh.warehouse_type).upper() == "CENTRAL"
                or getattr(matched_wh.warehouse_type, "value", "") == "CENTRAL"
            )
        )
        if is_central_bkr:
            alloc_query = alloc_query.filter(
                or_(
                    AmazonLiveAllocation.warehouse_id == matched_wh.id,
                    AmazonLiveAllocation.amazon_network_at_allocation == AmazonNetworkType.MFN,
                )
            )
        else:
            alloc_query = alloc_query.filter(AmazonLiveAllocation.warehouse_id == matched_wh.id)
    else:
        alloc_query = alloc_query.filter(
            or_(
                AmazonLiveAllocation.invoice_number.ilike(f"{s_clean}-%"),
                AmazonLiveAllocation.warehouse_id == -1,
            )
        )

    if parsed_date_from:
        alloc_query = alloc_query.filter(alloc_date_col >= datetime.combine(parsed_date_from, datetime.min.time()))
    if parsed_date_to:
        alloc_query = alloc_query.filter(alloc_date_col <= datetime.combine(parsed_date_to, datetime.max.time()))

    if search and isinstance(search, str) and search.strip():
        search_pattern = f"%{search.strip()}%"
        alloc_query = alloc_query.filter(
            or_(
                AmazonLiveAllocation.order_id.ilike(search_pattern),
                AmazonLiveAllocation.sku.ilike(search_pattern),
                AmazonLiveAllocation.invoice_number.ilike(search_pattern),
            )
        )

    fallback_unit_price = case(
        (Product.item_rate > 0, Product.item_rate * 1.35),
        else_=500.0,
    )
    tax_rate_expr = func.coalesce(Product.default_gst_rate, 18.0)
    revenue_expr = case(
        (AmazonLiveAllocation.net_amount.isnot(None), AmazonLiveAllocation.net_amount),
        else_=fallback_unit_price * AmazonLiveAllocation.allocated_qty,
    )
    gross_expr = case(
        (AmazonLiveAllocation.gross_amount.isnot(None), AmazonLiveAllocation.gross_amount),
        else_=(fallback_unit_price / (1.0 + tax_rate_expr / 100.0)) * AmazonLiveAllocation.allocated_qty,
    )
    tax_expr = case(
        (AmazonLiveAllocation.tax_amount.isnot(None), AmazonLiveAllocation.tax_amount),
        else_=revenue_expr - gross_expr,
    )

    return (
        alloc_query.outerjoin(
            Product,
            and_(
                Product.sku == AmazonLiveAllocation.sku,
                or_(
                    AmazonLiveAllocation.company_id == None,
                    Product.company_id == AmazonLiveAllocation.company_id,
                ),
            ),
        )
        .with_entities(
            period_col,
            func.count(distinct(AmazonLiveAllocation.order_id)).label("total_orders"),
            func.sum(AmazonLiveAllocation.allocated_qty).label("total_items_sold"),
            func.sum(gross_expr).label("total_taxable_amount"),
            func.sum(tax_expr).label("total_tax"),
            func.sum(revenue_expr).label("total_revenue"),
        )
        .group_by(period_col)
        .order_by(period_col.desc())
    )


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# 1. GET /sales - Paginated Sales Analytics grouped by Day / Week / Month
# ---------------------------------------------------------------------------
@router.get("/sales")
def get_sales_report(
    date_from: Optional[str] = Query(None, description="Start date filter (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="End date filter (YYYY-MM-DD)"),
    group_by: str = Query("day", pattern="^(day|week|month)$", description="Grouping dimension"),
    status: Optional[str] = Query(None, description="Sale status (e.g., Completed, Draft, Cancelled)"),
    search: Optional[str] = Query(None, description="Search by bill number, invoice number, customer name, SKU"),
    series: Optional[str] = Query(None, description="Series filter: GST, JGST, BKR, SERVICE, AFN, MFN, AMAZON, etc."),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    company_id: int = Depends(get_current_company_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns aggregated sales metrics grouped dynamically by day, week, or month.
    Seamlessly supports POS/Standard Sales and Amazon AFN/MFN Orders (from AmazonLiveAllocation).
    """
    s_clean = (series or "").strip().upper() if series else None
    parsed_date_from = parse_date_param(date_from)
    parsed_date_to = parse_date_param(date_to)

    is_sqlite = (db.bind.dialect.name == "sqlite") if db.bind else False

    # -----------------------------------------------------------------------
    # Branch A: Amazon AFN / MFN / AMAZON or Warehouse Series (e.g. VSHB, KWZ2, BLR4)
    # Amazon orders are stored in AmazonLiveAllocation (not Sale table).
    # -----------------------------------------------------------------------
    matched_wh = None
    if s_clean and s_clean not in ("GST", "JGST", "BKR", "SERVICE", "SERV", "ALL", "AFN", "MFN", "AMAZON"):
        wh_q = db.query(Warehouse).filter(func.upper(Warehouse.code) == s_clean, Warehouse.status == "ACTIVE")
        if company_id:
            wh_cand = wh_q.filter(Warehouse.company_id == company_id).first()
            matched_wh = wh_cand if wh_cand else wh_q.first()
        else:
            matched_wh = wh_q.first()

    if s_clean in ("AFN", "MFN", "AMAZON", "IN") or bool(matched_wh):
        agg_query = _build_amazon_sales_agg_query(
            db=db,
            company_id=company_id,
            s_clean=s_clean,
            matched_wh=matched_wh,
            group_by=group_by,
            parsed_date_from=parsed_date_from,
            parsed_date_to=parsed_date_to,
            search=search,
        )

        total_count = agg_query.count()
        skip = (page - 1) * limit
        results = agg_query.offset(skip).limit(limit).all()

        items = [
            {
                "period": str(row.period),
                "total_orders": int(row.total_orders or 0),
                "total_items_sold": int(row.total_items_sold or 0),
                "total_taxable_amount": round(float(row.total_taxable_amount or 0.0), 2),
                "total_tax": round(float(row.total_tax or 0.0), 2),
                "total_revenue": round(float(row.total_revenue or 0.0), 2),
            }
            for row in results
        ]

        return {
            "page": page,
            "limit": limit,
            "total": total_count,
            "total_records": total_count,
            "total_pages": (total_count + limit - 1) // limit if total_count > 0 else 0,
            "data": items,
            "items": items
        }

    # -----------------------------------------------------------------------
    # Branch B: Standard Sales (GST, JGST, BKR, SERVICE, ALL)
    # -----------------------------------------------------------------------
    if is_sqlite:
        if group_by == "month":
            period_col = func.strftime("%Y-%m", Sale.sale_date).label("period")
        elif group_by == "week":
            period_col = func.strftime("%Y-%W", Sale.sale_date).label("period")
        else:
            period_col = func.date(Sale.sale_date).label("period")
    else:
        if group_by == "month":
            period_col = func.to_char(Sale.sale_date, "YYYY-MM").label("period")
        elif group_by == "week":
            period_col = func.to_char(Sale.sale_date, "YYYY-WW").label("period")
        else:
            period_col = func.to_char(Sale.sale_date, "YYYY-MM-DD").label("period")

    # 1. Filter Sales First (No Joins)
    sale_base = db.query(
        Sale.id,
        period_col,
        Sale.total_taxable_amount,
        Sale.total_tax,
        Sale.grand_total
    ).filter(Sale.company_id == company_id)

    if parsed_date_from:
        sale_base = sale_base.filter(Sale.sale_date >= datetime.combine(parsed_date_from, datetime.min.time()))
    if parsed_date_to:
        sale_base = sale_base.filter(Sale.sale_date <= datetime.combine(parsed_date_to, datetime.max.time()))
    if status:
        sale_base = sale_base.filter(Sale.status == status)
    if search:
        s_val = search if isinstance(search, str) else ""
        if s_val.strip():
            search_pattern = f"%{s_val.strip()}%"
            sale_base = sale_base.filter(
                or_(
                    Sale.bill_number.ilike(search_pattern),
                    Sale.invoice_number.ilike(search_pattern),
                    Sale.customer_name.ilike(search_pattern)
                )
            )
    if s_clean:
        if s_clean == "GST":
            sale_base = sale_base.filter(
                and_(
                    or_(
                        Sale.bill_number.ilike("GST%"),
                        Sale.invoice_number.ilike("GST%"),
                        Sale.bill_number.ilike("BKR-GST%"),
                        Sale.invoice_number.ilike("BKR-GST%"),
                    ),
                    ~Sale.bill_number.ilike("JGST%"),
                    ~Sale.invoice_number.ilike("JGST%"),
                )
            )
        elif s_clean == "JGST":
            if company_id != 3:
                sale_base = sale_base.filter(Sale.id == -1)
            else:
                sale_base = sale_base.filter(
                    and_(
                        or_(
                            Sale.bill_number.ilike("JGST%"),
                            Sale.invoice_number.ilike("JGST%"),
                        ),
                        ~Sale.bill_number.ilike("GST%"),
                        ~Sale.invoice_number.ilike("GST%")
                    )
                )
        elif s_clean == "BKR":
            if company_id != 2:
                sale_base = sale_base.filter(Sale.id == -1)
            else:
                sale_base = sale_base.filter(
                    and_(
                        or_(Sale.bill_number.ilike("BKR%"), Sale.invoice_number.ilike("BKR%")),
                        ~Sale.bill_number.ilike("%GST%"),
                        ~Sale.invoice_number.ilike("%GST%")
                    )
                )
        elif s_clean in ("SERVICE", "SERV"):
            sale_base = sale_base.filter(
                or_(
                    Sale.bill_number.ilike("SERVICE%"),
                    Sale.invoice_number.ilike("SERVICE%"),
                    Sale.bill_number.ilike("SERV%"),
                    Sale.invoice_number.ilike("SERV%")
                )
            )
        elif s_clean == "ALL":
            # All Series Combined must strictly exclude Amazon orders and respect company exclusivity
            sale_base = sale_base.filter(
                and_(
                    or_(Sale.transaction_origin == None, Sale.transaction_origin != "AMAZON"),
                    ~Sale.bill_number.ilike("AMZ%"),
                    ~Sale.invoice_number.ilike("AMZ%"),
                    ~Sale.bill_number.ilike("%AMZN%"),
                    ~Sale.invoice_number.ilike("%AMZN%"),
                    ~Sale.bill_number.ilike("AFN%"),
                    ~Sale.invoice_number.ilike("AFN%"),
                    ~Sale.bill_number.ilike("MFN%"),
                    ~Sale.invoice_number.ilike("MFN%")
                )
            )
            if company_id == 3:
                # JSPL: strictly exclude BKR series
                sale_base = sale_base.filter(
                    and_(
                        ~Sale.bill_number.ilike("BKR%"),
                        ~Sale.invoice_number.ilike("BKR%")
                    )
                )
            elif company_id == 2:
                # BKR: strictly exclude JGST/JSPL series
                sale_base = sale_base.filter(
                    and_(
                        ~Sale.bill_number.ilike("JGST%"),
                        ~Sale.invoice_number.ilike("JGST%"),
                        ~Sale.bill_number.ilike("JSPL%"),
                        ~Sale.invoice_number.ilike("JSPL%")
                    )
                )
        else:
            pattern = f"{s_clean}%"
            sale_base = sale_base.filter(
                or_(
                    Sale.bill_number.ilike(pattern),
                    Sale.invoice_number.ilike(pattern)
                )
            )

    sale_sq = sale_base.subquery()

    # 2. Base query for item aggregation
    item_sq = db.query(
        SaleItem.sale_id,
        func.sum(SaleItem.quantity).label("qty")
    ).group_by(SaleItem.sale_id).subquery()

    # 3. Aggregate safely over the subquery
    query = db.query(
        sale_sq.c.period,
        func.count(sale_sq.c.id).label("total_orders"),
        func.sum(func.coalesce(item_sq.c.qty, 0)).label("total_items_sold"),
        func.sum(sale_sq.c.total_taxable_amount).label("total_taxable_amount"),
        func.sum(sale_sq.c.total_tax).label("total_tax"),
        func.sum(sale_sq.c.grand_total).label("total_revenue")
    ).outerjoin(item_sq, item_sq.c.sale_id == sale_sq.c.id)\
     .group_by(sale_sq.c.period).order_by(sale_sq.c.period.desc())

    # Count total aggregated groups for pagination
    total_count = query.count()

    # Apply pagination
    skip = (page - 1) * limit
    results = query.offset(skip).limit(limit).all()

    items = [
        {
            "period": str(row.period),
            "total_orders": int(row.total_orders or 0),
            "total_items_sold": int(row.total_items_sold or 0),
            "total_taxable_amount": round(float(row.total_taxable_amount or 0.0), 2),
            "total_tax": round(float(row.total_tax or 0.0), 2),
            "total_revenue": round(float(row.total_revenue or 0.0), 2),
        }
        for row in results
    ]

    return {
        "page": page,
        "limit": limit,
        "total": total_count,
        "total_records": total_count,
        "total_pages": (total_count + limit - 1) // limit if total_count > 0 else 0,
        "data": items,
        "items": items
    }


# ---------------------------------------------------------------------------
# 2. GET /inventory - Dynamically calculated Stock Levels (Current, Reserved, Available)
# ---------------------------------------------------------------------------
@router.get("/inventory")
def get_inventory_report(
    warehouse_id: Optional[int] = Query(None, description="Filter by Warehouse ID"),
    hub_id: Optional[int] = Query(None, description="Filter by Hub ID"),
    search: Optional[str] = Query(None, description="Search by SKU, Product Name, Category, Brand"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(50, ge=1, le=100, description="Items per page"),
    company_id: int = Depends(get_current_company_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns inventory stock levels joining Inventory, Product, and Warehouse tables.
    Dynamically verifies Available Stock = Current Stock - Reserved Stock.
    """
    query = db.query(
        Inventory.id.label("inventory_id"),
        Product.id.label("product_id"),
        Product.sku,
        Product.name.label("product_name"),
        Product.category,
        Product.brand,
        Warehouse.id.label("warehouse_id"),
        Warehouse.name.label("warehouse_name"),
        Warehouse.warehouse_type.label("warehouse_type"),
        StateHub.id.label("hub_id"),
        StateHub.hub_name.label("hub_name"),
        Inventory.current_qty,
        Inventory.reserved_qty,
        Inventory.available_qty,
        Inventory.last_updated
    ).join(Product, Product.id == Inventory.product_id)\
     .join(Warehouse, Warehouse.id == Inventory.warehouse_id)\
     .outerjoin(StateHub, StateHub.id == Warehouse.hub_id)\
     .filter(Inventory.company_id == company_id)

    if warehouse_id:
        query = query.filter(Inventory.warehouse_id == warehouse_id)
    if hub_id:
        query = query.filter(Warehouse.hub_id == hub_id)
    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            or_(
                Product.sku.ilike(search_pattern),
                Product.name.ilike(search_pattern),
                Product.category.ilike(search_pattern),
                Product.brand.ilike(search_pattern),
                Warehouse.name.ilike(search_pattern)
            )
        )

    total_records = query.count()
    skip = (page - 1) * limit
    results = query.order_by(Product.sku.asc()).offset(skip).limit(limit).all()

    items = [
        {
            "inventory_id": r.inventory_id,
            "product_id": r.product_id,
            "sku": r.sku,
            "product_name": r.product_name,
            "category": r.category,
            "brand": r.brand,
            "warehouse_id": r.warehouse_id,
            "warehouse_name": r.warehouse_name,
            "warehouse_type": r.warehouse_type.value if r.warehouse_type else None,
            "hub_id": r.hub_id,
            "hub_name": r.hub_name,
            "current_qty": r.current_qty,
            "reserved_qty": r.reserved_qty,
            "available_qty": r.current_qty - r.reserved_qty,  # Dynamic calculation
            "last_updated": r.last_updated.isoformat() if r.last_updated else None
        }
        for r in results
    ]

    return {
        "page": page,
        "limit": limit,
        "total_records": total_records,
        "total_pages": (total_records + limit - 1) // limit,
        "data": items
    }


# ---------------------------------------------------------------------------
# 3. GET /dispatches - Paginated FCDispatch Reports
# ---------------------------------------------------------------------------
@router.get("/dispatches")
def get_fc_dispatches_report(
    date_from: Optional[str] = Query(None, description="Start date filter"),
    date_to: Optional[str] = Query(None, description="End date filter"),
    warehouse_id: Optional[int] = Query(None, description="Filter by Warehouse ID"),
    status: Optional[str] = Query(None, description="Dispatch status filter"),
    search: Optional[str] = Query(None, description="Search by dispatch number"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    company_id: int = Depends(get_current_company_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns paginated FC Dispatch records with associated warehouse and document numbers.
    """
    parsed_date_from = parse_date_param(date_from)
    parsed_date_to = parse_date_param(date_to)

    query = db.query(FCDispatch).filter(FCDispatch.company_id == company_id)

    if warehouse_id:
        query = query.filter(FCDispatch.warehouse_id == warehouse_id)
    if status:
        query = query.filter(FCDispatch.dispatch_status == status)
    if parsed_date_from:
        query = query.filter(FCDispatch.created_at >= datetime.combine(parsed_date_from, datetime.min.time()))
    if parsed_date_to:
        query = query.filter(FCDispatch.created_at <= datetime.combine(parsed_date_to, datetime.max.time()))
    if search:
        query = query.filter(FCDispatch.dispatch_number.ilike(f"%{search.strip()}%"))

    total_records = query.count()
    skip = (page - 1) * limit
    dispatches = query.order_by(FCDispatch.created_at.desc()).offset(skip).limit(limit).all()

    data = []
    for d in dispatches:
        total_items = sum(item.quantity for item in d.items) if d.items else 0
        total_value = sum(item.total_amount for item in d.items) if d.items else 0.0

        data.append({
            "id": d.id,
            "dispatch_number": d.dispatch_number,
            "dispatch_status": d.dispatch_status,
            "warehouse_id": d.warehouse_id,
            "warehouse_name": d.warehouse.name if d.warehouse else None,
            "invoice_number": d.invoice.invoice_number if d.invoice else None,
            "challan_number": d.delivery_challan.challan_number if d.delivery_challan else None,
            "total_items": total_items,
            "total_value": round(total_value, 2),
            "created_at": d.created_at.isoformat() if d.created_at else None
        })

    return {
        "page": page,
        "limit": limit,
        "total": total_records,
        "total_records": total_records,
        "total_pages": (total_records + limit - 1) // limit if total_records > 0 else 0,
        "data": data,
        "items": data
    }


# ---------------------------------------------------------------------------
# 4. GET /returns - Paginated FCReturn / Amazon Returns Reports
# ---------------------------------------------------------------------------
@router.get("/returns")
def get_fc_returns_report(
    date_from: Optional[str] = Query(None, description="Start date filter"),
    date_to: Optional[str] = Query(None, description="End date filter"),
    warehouse_id: Optional[int] = Query(None, description="Filter by Warehouse ID"),
    status: Optional[str] = Query(None, description="Return status filter"),
    search: Optional[str] = Query(None, description="Search by return number or SKU"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    company_id: int = Depends(get_current_company_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns paginated Return records (Fulfillment Center and Amazon SP-API Returns).
    """
    parsed_date_from = parse_date_param(date_from)
    parsed_date_to = parse_date_param(date_to)

    query = db.query(FCReturn).filter(FCReturn.company_id == company_id)

    if warehouse_id:
        query = query.filter(FCReturn.warehouse_id == warehouse_id)
    if status:
        query = query.filter(FCReturn.status == status)
    if parsed_date_from:
        query = query.filter(FCReturn.created_at >= datetime.combine(parsed_date_from, datetime.min.time()))
    if parsed_date_to:
        query = query.filter(FCReturn.created_at <= datetime.combine(parsed_date_to, datetime.max.time()))
    if search:
        query = query.filter(FCReturn.return_number.ilike(f"%{search.strip()}%"))

    fc_count = query.count()

    # If FCReturn has records, use FCReturn. Otherwise fall back to AmazonReturn.
    if fc_count > 0:
        total_records = fc_count
        skip = (page - 1) * limit
        returns = query.order_by(FCReturn.created_at.desc()).offset(skip).limit(limit).all()

        data = []
        for r in returns:
            total_returned_qty = sum(item.quantity for item in r.items) if r.items else 0
            data.append({
                "id": r.id,
                "return_number": r.return_number,
                "status": r.status,
                "warehouse_id": r.warehouse_id,
                "warehouse_name": r.warehouse.name if r.warehouse else None,
                "dispatch_id": r.dispatch_id,
                "dispatch_number": r.dispatch.dispatch_number if r.dispatch else None,
                "total_returned_qty": total_returned_qty,
                "created_at": r.created_at.isoformat() if r.created_at else None
            })
    else:
        # Fall back to Amazon Returns
        amz_query = db.query(AmazonReturn)
        if company_id:
            has_ret = db.query(AmazonReturn.id).filter(AmazonReturn.company_id == company_id).first()
            if has_ret:
                amz_query = amz_query.filter(AmazonReturn.company_id == company_id)
        if status:
            amz_query = amz_query.filter(
                or_(
                    AmazonReturn.return_status == status,
                    AmazonReturn.inspection_status == status
                )
            )
        date_col = func.coalesce(AmazonReturn.received_at, AmazonReturn.requested_at, AmazonReturn.created_at)
        if parsed_date_from:
            amz_query = amz_query.filter(date_col >= datetime.combine(parsed_date_from, datetime.min.time()))
        if parsed_date_to:
            amz_query = amz_query.filter(date_col <= datetime.combine(parsed_date_to, datetime.max.time()))
        if search:
            s_pat = f"%{search.strip()}%"
            amz_query = amz_query.filter(
                or_(
                    AmazonReturn.amazon_return_id.ilike(s_pat),
                    AmazonReturn.amazon_order_id.ilike(s_pat),
                    AmazonReturn.sku.ilike(s_pat),
                    AmazonReturn.product_name.ilike(s_pat)
                )
            )
        total_records = amz_query.count()
        skip = (page - 1) * limit
        returns = amz_query.order_by(date_col.desc()).offset(skip).limit(limit).all()

        data = []
        for r in returns:
            ret_dt = r.received_at or r.requested_at or r.created_at
            data.append({
                "id": r.id,
                "return_number": r.amazon_return_id or r.amazon_order_id,
                "status": r.inspection_status or r.return_status or "Verified",
                "warehouse_id": None,
                "warehouse_name": "Amazon FBA",
                "dispatch_id": None,
                "dispatch_number": r.amazon_order_id,
                "total_returned_qty": r.quantity or 1,
                "sku": r.sku,
                "product_name": r.product_name,
                "created_at": ret_dt.isoformat() if ret_dt else None
            })

    return {
        "page": page,
        "limit": limit,
        "total": total_records,
        "total_records": total_records,
        "total_pages": (total_records + limit - 1) // limit if total_records > 0 else 0,
        "data": data,
        "items": data
    }


# ---------------------------------------------------------------------------
# 4b. GET /sales-returns - Paginated Sales Returns / Credit Notes Report
# ---------------------------------------------------------------------------
@router.get("/sales-returns")
def get_sales_returns_report(
    date_from: Optional[str] = Query(None, description="Start date filter (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="End date filter (YYYY-MM-DD)"),
    status: Optional[str] = Query(None, description="Return status filter (Draft, Completed, Cancelled)"),
    search: Optional[str] = Query(None, description="Search by return number, bill number, customer name, SKU"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    company_id: int = Depends(get_current_company_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns paginated Sales Returns (Credit Notes) for BKR and JSPL with summary metrics.
    """
    from sqlalchemy.orm import selectinload
    parsed_date_from = parse_date_param(date_from)
    parsed_date_to = parse_date_param(date_to)

    date_col = func.coalesce(SalesReturn.return_date, SalesReturn.created_at)
    query = db.query(SalesReturn).filter(SalesReturn.company_id == company_id)

    if status and status.upper() != "ALL":
        query = query.filter(func.lower(SalesReturn.status) == status.lower())
    if parsed_date_from:
        query = query.filter(date_col >= datetime.combine(parsed_date_from, datetime.min.time()))
    if parsed_date_to:
        query = query.filter(date_col <= datetime.combine(parsed_date_to, datetime.max.time()))

    if search and search.strip():
        s_pat = f"%{search.strip()}%"
        query = query.outerjoin(Sale, SalesReturn.sale_id == Sale.id).outerjoin(SalesReturnItem, SalesReturn.id == SalesReturnItem.return_id).filter(
            or_(
                SalesReturn.return_number.ilike(s_pat),
                SalesReturn.customer_name.ilike(s_pat),
                Sale.bill_number.ilike(s_pat),
                Sale.invoice_number.ilike(s_pat),
                SalesReturnItem.sku_snapshot.ilike(s_pat),
                SalesReturnItem.product_name_snapshot.ilike(s_pat)
            )
        ).distinct()

    total_records = query.count()

    # Aggregate summary metrics for filtered records
    summary_query = query.with_entities(
        func.count(distinct(SalesReturn.id)).label("total_returns"),
        func.sum(SalesReturn.total_taxable_amount).label("total_taxable"),
        func.sum(SalesReturn.total_tax).label("total_tax"),
        func.sum(SalesReturn.grand_total).label("grand_total")
    ).first()

    # Fetch total items returned
    ret_ids = [r[0] for r in query.with_entities(SalesReturn.id).all()]
    total_qty = 0
    if ret_ids:
        total_qty_res = db.query(func.sum(SalesReturnItem.returned_quantity)).filter(
            SalesReturnItem.return_id.in_(ret_ids)
        ).scalar()
        total_qty = int(total_qty_res or 0)

    skip = (page - 1) * limit
    returns = query.options(
        selectinload(SalesReturn.items),
        selectinload(SalesReturn.sale)
    ).order_by(date_col.desc(), SalesReturn.id.desc()).offset(skip).limit(limit).all()

    data = []
    for r in returns:
        r_dt = r.return_date or r.created_at
        items_list = []
        for it in (r.items or []):
            items_list.append({
                "id": it.id,
                "sku": it.sku_snapshot,
                "product_name": it.product_name_snapshot,
                "hsn": it.hsn_snapshot,
                "quantity": it.returned_quantity,
                "unit_price": float(it.unit_price or 0.0),
                "tax_rate": float(it.tax_rate or 0.0),
                "tax_amount": float(it.tax_amount or 0.0),
                "total_price": float(it.total_price or 0.0),
                "reason": it.return_reason
            })
        data.append({
            "id": r.id,
            "return_number": r.return_number,
            "return_date": r_dt.isoformat() if r_dt else None,
            "sale_id": r.sale_id,
            "bill_number": (r.sale.bill_number if r.sale else (r.sale.invoice_number if r.sale else None)),
            "customer_name": r.customer_name or (r.sale.customer_name if r.sale else "Retail Customer"),
            "total_taxable_amount": round(float(r.total_taxable_amount or 0.0), 2),
            "total_tax": round(float(r.total_tax or 0.0), 2),
            "grand_total": round(float(r.grand_total or 0.0), 2),
            "status": r.status or "Completed",
            "items_count": len(items_list),
            "total_qty": sum(it["quantity"] for it in items_list),
            "items": items_list,
            "created_at": r.created_at.isoformat() if r.created_at else None
        })

    return {
        "page": page,
        "limit": limit,
        "total": total_records,
        "total_records": total_records,
        "total_pages": (total_records + limit - 1) // limit if total_records > 0 else 0,
        "summary": {
            "total_returns": int(summary_query[0] or 0) if summary_query else 0,
            "total_qty": total_qty,
            "total_taxable": round(float(summary_query[1] or 0.0), 2) if summary_query and summary_query[1] else 0.0,
            "total_tax": round(float(summary_query[2] or 0.0), 2) if summary_query and summary_query[2] else 0.0,
            "grand_total": round(float(summary_query[3] or 0.0), 2) if summary_query and summary_query[3] else 0.0,
        },
        "data": data,
        "items": data
    }


# ---------------------------------------------------------------------------
# 5. GET /defective - Paginated Damage Claims & Defective Inventory Reports
# ---------------------------------------------------------------------------
@router.get("/defective")
def get_defective_reports(
    report_type: str = Query("claims", pattern="^(claims|inventory)$", description="claims or inventory"),
    date_from: Optional[str] = Query(None, description="Start date filter"),
    date_to: Optional[str] = Query(None, description="End date filter"),
    warehouse_id: Optional[int] = Query(None, description="Filter by Warehouse ID"),
    status: Optional[str] = Query(None, description="Status filter"),
    search: Optional[str] = Query(None, description="Search by SKU, claim number, or return ID"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    company_id: int = Depends(get_current_company_id),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns paginated Damage Claims and Defective Inventory records.
    """
    parsed_date_from = parse_date_param(date_from)
    parsed_date_to = parse_date_param(date_to)
    skip = (page - 1) * limit

    if report_type == "claims":
        query = db.query(DamageClaim).filter(DamageClaim.company_id == company_id)

        if warehouse_id:
            query = query.filter(DamageClaim.warehouse_id == warehouse_id)
        if status:
            query = query.filter(DamageClaim.claim_status == status)
        if parsed_date_from:
            query = query.filter(DamageClaim.created_at >= datetime.combine(parsed_date_from, datetime.min.time()))
        if parsed_date_to:
            query = query.filter(DamageClaim.created_at <= datetime.combine(parsed_date_to, datetime.max.time()))
        if search:
            search_pattern = f"%{search.strip()}%"
            query = query.join(Product, Product.id == DamageClaim.product_id)\
                         .filter(or_(DamageClaim.claim_number.ilike(search_pattern), Product.sku.ilike(search_pattern)))

        total_records = query.count()
        claims = query.order_by(DamageClaim.created_at.desc()).offset(skip).limit(limit).all()

        data = [
            {
                "id": c.id,
                "claim_number": c.claim_number,
                "warehouse_id": c.warehouse_id,
                "warehouse_name": c.warehouse.name if c.warehouse else None,
                "product_id": c.product_id,
                "sku": c.product.sku if c.product else None,
                "product_name": c.product.name if c.product else None,
                "quantity": c.quantity,
                "claim_status": c.claim_status,
                "video_reference": c.video_reference,
                "remarks": c.remarks,
                "created_at": c.created_at.isoformat() if c.created_at else None
            }
            for c in claims
        ]
    else:
        query = db.query(DefectiveInventory).filter(DefectiveInventory.company_id == company_id)

        if status:
            query = query.filter(DefectiveInventory.status == status)
        if parsed_date_from:
            query = query.filter(DefectiveInventory.created_at >= datetime.combine(parsed_date_from, datetime.min.time()))
        if parsed_date_to:
            query = query.filter(DefectiveInventory.created_at <= datetime.combine(parsed_date_to, datetime.max.time()))
        if search:
            search_pattern = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    DefectiveInventory.sku_snapshot.ilike(search_pattern),
                    DefectiveInventory.product_name_snapshot.ilike(search_pattern)
                )
            )

        total_records = query.count()
        items = query.order_by(DefectiveInventory.created_at.desc()).offset(skip).limit(limit).all()

        data = [
            {
                "id": i.id,
                "amazon_return_id": i.amazon_return_id,
                "product_id": i.product_id,
                "sku": i.sku_snapshot,
                "product_name": i.product_name_snapshot,
                "quantity": i.quantity,
                "return_reason": i.return_reason,
                "inspection_notes": i.inspection_notes,
                "status": i.status,
                "inspection_date": i.inspection_date.isoformat() if i.inspection_date else None,
                "created_at": i.created_at.isoformat() if i.created_at else None
            }
            for i in items
        ]

    return {
        "report_type": report_type,
        "page": page,
        "limit": limit,
        "total": total_records,
        "total_records": total_records,
        "total_pages": (total_records + limit - 1) // limit if total_records > 0 else 0,
        "data": data,
        "items": data
    }

import io
import csv
from fastapi.responses import Response

# ---------------------------------------------------------------------------
# EXPORT ENDPOINTS
# ---------------------------------------------------------------------------
@router.get("/sales/export")
def export_sales(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    group_by: str = Query("day", pattern="^(day|week|month)$"),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    series: Optional[str] = Query(None),
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    parsed_date_from = parse_date_param(date_from)
    parsed_date_to = parse_date_param(date_to)
    s_clean = (series or "").strip().upper() if series else None

    is_sqlite = (db.bind.dialect.name == "sqlite") if db.bind else False

    matched_wh = None
    if s_clean and s_clean not in ("GST", "JGST", "BKR", "SERVICE", "SERV", "ALL", "AFN", "MFN", "AMAZON"):
        wh_q = db.query(Warehouse).filter(func.upper(Warehouse.code) == s_clean, Warehouse.status == "ACTIVE")
        if company_id:
            wh_cand = wh_q.filter(Warehouse.company_id == company_id).first()
            matched_wh = wh_cand if wh_cand else wh_q.first()
        else:
            matched_wh = wh_q.first()

    if s_clean in ("AFN", "MFN", "AMAZON", "IN") or bool(matched_wh):
        results = _build_amazon_sales_agg_query(
            db=db,
            company_id=company_id,
            s_clean=s_clean,
            matched_wh=matched_wh,
            group_by=group_by,
            parsed_date_from=parsed_date_from,
            parsed_date_to=parsed_date_to,
            search=search,
        ).all()
    else:
        if is_sqlite:
            if group_by == "month":
                period_col = func.strftime("%Y-%m", Sale.sale_date).label("period")
            elif group_by == "week":
                period_col = func.strftime("%Y-%W", Sale.sale_date).label("period")
            else:
                period_col = func.date(Sale.sale_date).label("period")
        else:
            if group_by == "month":
                period_col = func.to_char(Sale.sale_date, "YYYY-MM").label("period")
            elif group_by == "week":
                period_col = func.to_char(Sale.sale_date, "YYYY-WW").label("period")
            else:
                period_col = func.to_char(Sale.sale_date, "YYYY-MM-DD").label("period")

        sale_base = db.query(
            Sale.id,
            period_col,
            Sale.total_taxable_amount,
            Sale.total_tax,
            Sale.grand_total
        ).filter(Sale.company_id == company_id)

        if parsed_date_from:
            sale_base = sale_base.filter(Sale.sale_date >= datetime.combine(parsed_date_from, datetime.min.time()))
        if parsed_date_to:
            sale_base = sale_base.filter(Sale.sale_date <= datetime.combine(parsed_date_to, datetime.max.time()))
        if status:
            sale_base = sale_base.filter(Sale.status == status)
        if search:
            search_pattern = f"%{search.strip()}%"
            sale_base = sale_base.filter(
                or_(Sale.bill_number.ilike(search_pattern), Sale.invoice_number.ilike(search_pattern), Sale.customer_name.ilike(search_pattern))
            )
        if s_clean:
            if s_clean == "GST":
                sale_base = sale_base.filter(
                    and_(
                        or_(
                            Sale.bill_number.ilike("GST%"),
                            Sale.invoice_number.ilike("GST%"),
                            Sale.bill_number.ilike("BKR-GST%"),
                            Sale.invoice_number.ilike("BKR-GST%"),
                        ),
                        ~Sale.bill_number.ilike("JGST%"),
                        ~Sale.invoice_number.ilike("JGST%"),
                    )
                )
            elif s_clean == "JGST":
                if company_id != 3:
                    sale_base = sale_base.filter(Sale.id == -1)
                else:
                    sale_base = sale_base.filter(
                        and_(
                            or_(
                                Sale.bill_number.ilike("JGST%"),
                                Sale.invoice_number.ilike("JGST%"),
                            ),
                            ~Sale.bill_number.ilike("GST%"),
                            ~Sale.invoice_number.ilike("GST%")
                        )
                    )
            elif s_clean == "BKR":
                if company_id != 2:
                    sale_base = sale_base.filter(Sale.id == -1)
                else:
                    sale_base = sale_base.filter(
                        and_(
                            or_(Sale.bill_number.ilike("BKR%"), Sale.invoice_number.ilike("BKR%")),
                            ~Sale.bill_number.ilike("%GST%"),
                            ~Sale.invoice_number.ilike("%GST%")
                        )
                    )
            elif s_clean in ("SERVICE", "SERV"):
                sale_base = sale_base.filter(
                    or_(
                        Sale.bill_number.ilike("SERVICE%"),
                        Sale.invoice_number.ilike("SERVICE%"),
                        Sale.bill_number.ilike("SERV%"),
                        Sale.invoice_number.ilike("SERV%")
                    )
                )
            elif s_clean == "ALL":
                sale_base = sale_base.filter(
                    and_(
                        or_(Sale.transaction_origin == None, Sale.transaction_origin != "AMAZON"),
                        ~Sale.bill_number.ilike("AMZ%"),
                        ~Sale.invoice_number.ilike("AMZ%"),
                        ~Sale.bill_number.ilike("%AMZN%"),
                        ~Sale.invoice_number.ilike("%AMZN%"),
                        ~Sale.bill_number.ilike("AFN%"),
                        ~Sale.invoice_number.ilike("AFN%"),
                        ~Sale.bill_number.ilike("MFN%"),
                        ~Sale.invoice_number.ilike("MFN%")
                    )
                )
                if company_id == 3:
                    sale_base = sale_base.filter(and_(~Sale.bill_number.ilike("BKR%"), ~Sale.invoice_number.ilike("BKR%")))
                elif company_id == 2:
                    sale_base = sale_base.filter(and_(~Sale.bill_number.ilike("JGST%"), ~Sale.invoice_number.ilike("JGST%"), ~Sale.bill_number.ilike("JSPL%"), ~Sale.invoice_number.ilike("JSPL%")))
            else:
                pattern = f"{s_clean}%"
                sale_base = sale_base.filter(or_(Sale.bill_number.ilike(pattern), Sale.invoice_number.ilike(pattern)))

        sale_sq = sale_base.subquery()

        item_sq = db.query(
            SaleItem.sale_id,
            func.sum(SaleItem.quantity).label("qty")
        ).group_by(SaleItem.sale_id).subquery()

        query = db.query(
            sale_sq.c.period,
            func.count(sale_sq.c.id).label("total_orders"),
            func.sum(func.coalesce(item_sq.c.qty, 0)).label("total_items_sold"),
            func.sum(sale_sq.c.total_taxable_amount).label("total_taxable_amount"),
            func.sum(sale_sq.c.total_tax).label("total_tax"),
            func.sum(sale_sq.c.grand_total).label("total_revenue")
        ).outerjoin(item_sq, item_sq.c.sale_id == sale_sq.c.id)

        query = query.group_by(sale_sq.c.period).order_by(sale_sq.c.period.desc())
        results = query.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Period", "Total Orders", "Total Items Sold", "Total Taxable Amount", "Total Tax", "Total Revenue"])
    for row in results:
        writer.writerow([
            row.period,
            row.total_orders,
            row.total_items_sold,
            round(float(row.total_taxable_amount or 0), 2),
            round(float(row.total_tax or 0), 2),
            round(float(row.total_revenue or 0), 2)
        ])
    
    filename = f"sales_report_{s_clean or 'all'}.csv"
    return Response(content=output.getvalue(), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={filename}"})

@router.get("/sales/detailed/export")
def export_detailed_sales(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    parsed_date_from = parse_date_param(date_from)
    parsed_date_to = parse_date_param(date_to)

    query = db.query(
        Sale.bill_number,
        Sale.customer_name,
        Sale.sale_date,
        SaleItem.sku,
        Product.name.label("product_name"),
        SaleItem.quantity,
        SaleItem.selling_price,
        SaleItem.line_total
    ).join(
        SaleItem, Sale.id == SaleItem.sale_id
    ).join(
        Product, SaleItem.product_id == Product.id
    ).filter(Sale.company_id == company_id)

    if parsed_date_from:
        query = query.filter(Sale.sale_date >= datetime.combine(parsed_date_from, datetime.min.time()))
    if parsed_date_to:
        query = query.filter(Sale.sale_date <= datetime.combine(parsed_date_to, datetime.max.time()))
    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Sale.bill_number.ilike(search_pattern),
                Sale.customer_name.ilike(search_pattern),
                SaleItem.sku.ilike(search_pattern),
                Product.name.ilike(search_pattern)
            )
        )

    query = query.order_by(Sale.sale_date.desc(), Sale.bill_number)
    results = query.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Bill Number", "Customer Name", "Sale Date", "SKU", "Product Name", "Quantity", "Unit Price", "Line Total"])
    for row in results:
        writer.writerow([
            row.bill_number,
            row.customer_name or "",
            row.sale_date.isoformat() if row.sale_date else "",
            row.sku,
            row.product_name,
            row.quantity,
            round(float(row.selling_price or 0), 2),
            round(float(row.line_total or 0), 2)
        ])
    
    return Response(content=output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=detailed_sales_report.csv"})

@router.get("/sales/series-export")
def export_series_sales(
    series: str = Query("GST"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    format: str = Query("csv", pattern="^(csv|excel)$"),
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    from app.services.series_report_service import SeriesReportService
    content, filename, media_type, row_count = SeriesReportService.generate_series_sales_report(
        db=db,
        company_id=company_id,
        series=series,
        date_from=date_from,
        date_to=date_to,
        file_format=format
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Row-Count": str(row_count)
        }
    )

@router.get("/inventory/export")
def export_inventory(
    search: Optional[str] = Query(None),
    format: str = Query("csv", pattern="^(excel|csv)$"),
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    from app.services.series_report_service import SeriesReportService
    content, filename, media_type, row_count = SeriesReportService.generate_inventory_register(
        db=db,
        company_id=company_id,
        search=search,
        file_format=format
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Row-Count": str(row_count)
        }
    )

@router.get("/dispatches/export")
def export_dispatches(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    parsed_date_from = parse_date_param(date_from)
    parsed_date_to = parse_date_param(date_to)

    query = db.query(FCDispatch).filter(FCDispatch.company_id == company_id)
    if status:
        query = query.filter(FCDispatch.dispatch_status == status)
    if parsed_date_from:
        query = query.filter(FCDispatch.created_at >= datetime.combine(parsed_date_from, datetime.min.time()))
    if parsed_date_to:
        query = query.filter(FCDispatch.created_at <= datetime.combine(parsed_date_to, datetime.max.time()))
    if search:
        query = query.filter(FCDispatch.dispatch_number.ilike(f"%{search.strip()}%"))
        
    results = query.options(
        joinedload(FCDispatch.warehouse),
        joinedload(FCDispatch.invoice),
        joinedload(FCDispatch.delivery_challan),
        selectinload(FCDispatch.items)
    ).order_by(FCDispatch.created_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Dispatch Number", "Status", "Warehouse", "Invoice Number", "Challan Number", "Total Items", "Total Value", "Date"])
    for d in results:
        total_items = sum(item.quantity for item in d.items) if d.items else 0
        total_value = sum(item.total_amount for item in d.items) if d.items else 0.0
        writer.writerow([
            d.dispatch_number,
            d.dispatch_status,
            d.warehouse.name if d.warehouse else "",
            d.invoice.invoice_number if d.invoice else "",
            d.delivery_challan.challan_number if d.delivery_challan else "",
            total_items,
            round(total_value, 2),
            d.created_at.strftime("%d/%m/%Y %H:%M") if d.created_at else ""
        ])
    
    return Response(content=output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=dispatch_report.csv"})

@router.get("/returns/export")
def export_returns(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    parsed_date_from = parse_date_param(date_from)
    parsed_date_to = parse_date_param(date_to)

    fc_query = db.query(FCReturn).filter(FCReturn.company_id == company_id)
    if status:
        fc_query = fc_query.filter(FCReturn.status == status)
    if parsed_date_from:
        fc_query = fc_query.filter(FCReturn.created_at >= datetime.combine(parsed_date_from, datetime.min.time()))
    if parsed_date_to:
        fc_query = fc_query.filter(FCReturn.created_at <= datetime.combine(parsed_date_to, datetime.max.time()))
    if search:
        fc_query = fc_query.filter(FCReturn.return_number.ilike(f"%{search.strip()}%"))
        
    fc_count = fc_query.count()

    output = io.StringIO()
    writer = csv.writer(output)

    if fc_count > 0:
        results = fc_query.options(
            joinedload(FCReturn.warehouse),
            joinedload(FCReturn.dispatch),
            selectinload(FCReturn.items)
        ).order_by(FCReturn.created_at.desc()).all()
        writer.writerow(["Return Number", "Status", "Warehouse", "Dispatch Number", "Total Returned Qty", "Date"])
        for r in results:
            total_returned_qty = sum(item.quantity for item in r.items) if r.items else 0
            writer.writerow([
                r.return_number,
                r.status,
                r.warehouse.name if r.warehouse else "",
                r.dispatch.dispatch_number if r.dispatch else "",
                total_returned_qty,
                r.created_at.strftime("%d/%m/%Y %H:%M") if r.created_at else ""
            ])
    else:
        # Fall back to Amazon Returns
        amz_query = db.query(AmazonReturn)
        if company_id:
            has_ret = db.query(AmazonReturn.id).filter(AmazonReturn.company_id == company_id).first()
            if has_ret:
                amz_query = amz_query.filter(AmazonReturn.company_id == company_id)
        if status:
            amz_query = amz_query.filter(
                or_(AmazonReturn.return_status == status, AmazonReturn.inspection_status == status)
            )
        date_col = func.coalesce(AmazonReturn.received_at, AmazonReturn.requested_at, AmazonReturn.created_at)
        if parsed_date_from:
            amz_query = amz_query.filter(date_col >= datetime.combine(parsed_date_from, datetime.min.time()))
        if parsed_date_to:
            amz_query = amz_query.filter(date_col <= datetime.combine(parsed_date_to, datetime.max.time()))
        if search:
            s_pat = f"%{search.strip()}%"
            amz_query = amz_query.filter(
                or_(
                    AmazonReturn.amazon_return_id.ilike(s_pat),
                    AmazonReturn.amazon_order_id.ilike(s_pat),
                    AmazonReturn.sku.ilike(s_pat),
                    AmazonReturn.product_name.ilike(s_pat)
                )
            )
        results = amz_query.order_by(date_col.desc()).all()
        writer.writerow(["Return Number", "Order ID", "SKU", "Product Name", "Quantity", "Status", "Date"])
        for r in results:
            ret_dt = r.received_at or r.requested_at or r.created_at
            writer.writerow([
                r.amazon_return_id,
                r.amazon_order_id,
                r.sku,
                r.product_name,
                r.quantity,
                r.inspection_status or r.return_status,
                ret_dt.isoformat() if ret_dt else ""
            ])
    
    return Response(content=output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=returns_report.csv"})

@router.get("/sales-returns/export")
def export_sales_returns(
    date_from: Optional[str] = Query(None, description="Start date filter"),
    date_to: Optional[str] = Query(None, description="End date filter"),
    format: str = Query("csv", pattern="^(csv|excel)$"),
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    from app.services.series_report_service import SeriesReportService
    content, filename, media_type, row_count = SeriesReportService.generate_sales_returns_report(
        db=db,
        company_id=company_id,
        date_from=date_from,
        date_to=date_to,
        file_format=format
    )
    if format.lower() == "excel":
        return Response(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "X-Row-Count": str(row_count)
            }
        )
    return Response(
        content=content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "X-Row-Count": str(row_count)
        }
    )

@router.get("/defective/export")
def export_defective(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    company_id: int = Depends(get_current_company_id),
    db: Session = Depends(get_db)
):
    parsed_date_from = parse_date_param(date_from)
    parsed_date_to = parse_date_param(date_to)

    query = db.query(DefectiveInventory).filter(DefectiveInventory.company_id == company_id)
    if status:
        query = query.filter(DefectiveInventory.status == status)
    if parsed_date_from:
        query = query.filter(DefectiveInventory.created_at >= datetime.combine(parsed_date_from, datetime.min.time()))
    if parsed_date_to:
        query = query.filter(DefectiveInventory.created_at <= datetime.combine(parsed_date_to, datetime.max.time()))
    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.filter(or_(DefectiveInventory.sku_snapshot.ilike(search_pattern), DefectiveInventory.product_name_snapshot.ilike(search_pattern)))
        
    results = query.order_by(DefectiveInventory.created_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["SKU", "Product Name", "Quantity", "Reason", "Status", "Inspection Date", "Created At"])
    for d in results:
        writer.writerow([
            d.sku_snapshot,
            d.product_name_snapshot,
            d.quantity,
            d.return_reason,
            d.status,
            d.inspection_date.isoformat() if d.inspection_date else "",
            d.created_at.isoformat() if d.created_at else ""
        ])
    
    return Response(content=output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=defective_report.csv"})

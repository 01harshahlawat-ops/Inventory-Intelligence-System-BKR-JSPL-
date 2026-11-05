import pytest
from datetime import datetime, date
from decimal import Decimal
import io
import openpyxl

from app.models.schema import (
    Company, Warehouse, Product, AmazonLiveAllocation, AllocationStatus,
    AmazonNetworkType
)
from app.services.series_report_service import SeriesReportService

def test_series_sales_report_excludes_returns_and_cancellations(db_session):
    company = Company(id=3, name="JSPL", code="JSPL", status="Active")
    warehouse = Warehouse(id=14, code="VSHB", name="Central", company_id=3, status="ACTIVE")
    prod1 = Product(id=101, sku="LG0637-1", name="Product 1", company_id=3, default_gst_rate=18.0)
    prod2 = Product(id=102, sku="LG0657", name="Product 2", company_id=3, default_gst_rate=18.0)
    db_session.add_all([company, warehouse, prod1, prod2])
    db_session.commit()

    # 1. Legitimate Shipped Sale
    alloc_shipped = AmazonLiveAllocation(
        company_id=3,
        warehouse_id=14,
        order_id="402-9796071-3566729",
        sku="LG0637-1",
        invoice_number="VSHB-1247",
        amazon_line_item_id="578089373547",
        allocated_qty=1,
        gross_amount=Decimal("4628.81"),
        tax_amount=Decimal("833.19"),
        net_amount=Decimal("5462.00"),
        status=AllocationStatus.SHIPPED,
        order_date=datetime(2026, 10, 5, 10, 0, 0),
        shipment_date=datetime(2026, 10, 5, 12, 0, 0),
        amazon_network_at_allocation=AmazonNetworkType.AFN
    )

    # 2. Return record for same order (should be excluded from Outward Sales Report)
    alloc_return = AmazonLiveAllocation(
        company_id=3,
        warehouse_id=14,
        order_id="402-9796071-3566729",
        sku="LG0637-1",
        invoice_number="VSHB-1247",
        amazon_line_item_id="578089373547_REF",
        allocated_qty=1,
        gross_amount=Decimal("-4628.81"),
        tax_amount=Decimal("-833.19"),
        net_amount=Decimal("-5462.00"),
        status=AllocationStatus.RETURNED,
        order_date=datetime(2026, 10, 5, 10, 0, 0),
        shipment_date=datetime(2026, 10, 15, 12, 0, 0),
        amazon_network_at_allocation=AmazonNetworkType.AFN
    )

    # 3. Cancelled record (should be excluded)
    alloc_cancelled = AmazonLiveAllocation(
        company_id=3,
        warehouse_id=14,
        order_id="406-4927273-1803521",
        sku="LG0657",
        invoice_number="VSHB-1373",
        amazon_line_item_id="579496019574_CANCEL",
        allocated_qty=0,
        gross_amount=Decimal("0.00"),
        tax_amount=Decimal("0.00"),
        net_amount=Decimal("0.00"),
        status=AllocationStatus.CANCELLED,
        order_date=datetime(2026, 10, 8, 10, 0, 0),
        shipment_date=datetime(2026, 10, 8, 12, 0, 0),
        amazon_network_at_allocation=AmazonNetworkType.AFN
    )

    db_session.add_all([alloc_shipped, alloc_return, alloc_cancelled])
    db_session.commit()

    content, filename, media_type, num_rows = SeriesReportService.generate_series_sales_report(
        db=db_session,
        company_id=3,
        series="VSHB",
        date_from=date(2026, 10, 1),
        date_to=date(2026, 10, 31),
        file_format="excel"
    )

    wb = openpyxl.load_workbook(io.BytesIO(content))
    ws = wb.active

    # Check rows
    orders = []
    bills = []
    for r in range(4, ws.max_row + 1):
        bill = ws.cell(r, 2).value
        order = ws.cell(r, 34).value
        net = ws.cell(r, 22).value
        if bill in ("BILL NO. WISE TOTALS", "GRAND TOTALS") or not bill:
            continue
        orders.append(order)
        bills.append(bill)
        assert isinstance(net, (int, float)) and net > 0, f"Expected positive net amount, got {net}"

    # Only 1 legitimate shipped order should be present
    assert len(orders) == 1
    assert orders[0] == "402-9796071-3566729"
    assert bills[0] == "VSHB-1247"
    assert "406-4927273-1803521" not in orders

def test_series_sales_report_preserves_multi_item_and_deduplicates(db_session):
    company = Company(id=3, name="JSPL", code="JSPL", status="Active")
    warehouse = Warehouse(id=14, code="VSHB", name="Central", company_id=3, status="ACTIVE")
    prod1 = Product(id=201, sku="HM0660", name="Item 1", company_id=3, default_gst_rate=18.0)
    prod2 = Product(id=202, sku="HM0726 1", name="Item 2", company_id=3, default_gst_rate=18.0)
    db_session.add_all([company, warehouse, prod1, prod2])
    db_session.commit()

    # Multi-sku order on same invoice VSHB-1475
    alloc_item1 = AmazonLiveAllocation(
        company_id=3,
        warehouse_id=14,
        order_id="408-8919251-3735523",
        sku="HM0660",
        invoice_number="VSHB-1475",
        amazon_line_item_id="580017205377",
        allocated_qty=1,
        gross_amount=Decimal("971.19"),
        tax_amount=Decimal("174.81"),
        net_amount=Decimal("1146.00"),
        status=AllocationStatus.SHIPPED,
        order_date=datetime(2026, 10, 20, 10, 0, 0),
        shipment_date=datetime(2026, 10, 20, 12, 0, 0),
        amazon_network_at_allocation=AmazonNetworkType.AFN
    )
    alloc_item2 = AmazonLiveAllocation(
        company_id=3,
        warehouse_id=14,
        order_id="408-8919251-3735523",
        sku="HM0726 1",
        invoice_number="VSHB-1475",
        amazon_line_item_id="580017205376",
        allocated_qty=1,
        gross_amount=Decimal("930.51"),
        tax_amount=Decimal("167.49"),
        net_amount=Decimal("1098.00"),
        status=AllocationStatus.SHIPPED,
        order_date=datetime(2026, 10, 20, 10, 0, 0),
        shipment_date=datetime(2026, 10, 20, 12, 0, 0),
        amazon_network_at_allocation=AmazonNetworkType.AFN
    )
    # Duplicate entry for item1 with same invoice and order
    alloc_item1_dup = AmazonLiveAllocation(
        company_id=3,
        warehouse_id=14,
        order_id="408-8919251-3735523",
        sku="HM0660",
        invoice_number="VSHB-1475",
        amazon_line_item_id="580017205377_DUP",
        allocated_qty=1,
        gross_amount=Decimal("971.19"),
        tax_amount=Decimal("174.81"),
        net_amount=Decimal("1146.00"),
        status=AllocationStatus.SHIPPED,
        order_date=datetime(2026, 10, 20, 10, 0, 0),
        shipment_date=datetime(2026, 10, 20, 12, 0, 0),
        amazon_network_at_allocation=AmazonNetworkType.AFN
    )
    db_session.add_all([alloc_item1, alloc_item2, alloc_item1_dup])
    db_session.commit()

    content, _, _, _ = SeriesReportService.generate_series_sales_report(
        db=db_session,
        company_id=3,
        series="VSHB",
        date_from=date(2026, 10, 1),
        date_to=date(2026, 10, 31),
        file_format="excel"
    )

    wb = openpyxl.load_workbook(io.BytesIO(content))
    ws = wb.active

    items = []
    subtotals = []
    for r in range(4, ws.max_row + 1):
        bill = ws.cell(r, 2).value
        sku = ws.cell(r, 4).value
        net = ws.cell(r, 22).value
        if bill == "BILL NO. WISE TOTALS":
            subtotals.append(net)
        elif bill == "GRAND TOTALS" or not bill:
            continue
        else:
            items.append((bill, sku, net))

    # Exactly 2 distinct items (HM0660 and HM0726 1) - duplicate HM0660 was safely deduplicated
    assert len(items) == 2
    skus = [it[1] for it in items]
    assert "HM0660" in skus
    assert "HM0726 1" in skus
    assert len(subtotals) == 1
    assert round(subtotals[0], 2) == round(1146.00 + 1098.00, 2)


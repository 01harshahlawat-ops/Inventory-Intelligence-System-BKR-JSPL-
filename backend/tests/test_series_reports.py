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


def test_in_series_cross_month_boundaries_taxfree_and_mtr_totals(db_session):
    from app.api.routers.business_reports import get_sales_report
    from app.services.amazon_service import AmazonService

    company = Company(id=3, name="JSPL", code="JSPL", status="Active")
    wh_in = Warehouse(id=38, code="IN", name="JSPL IN", company_id=3, status="ACTIVE")
    prod_base = Product(id=301, sku="LG1060", name="Telescopic Handle", hsn="84248200", company_id=3, default_gst_rate=5.0)
    prod_var_parent = Product(id=302, sku="LG1151", name="Brush Cutter Base", hsn="84335900", company_id=3, default_gst_rate=5.0, item_rate=4000.0)
    prod_var_stub = Product(id=303, sku="LG1151-1", name="LG1151-1", company_id=3, default_gst_rate=None, item_rate=0.0)
    db_session.add_all([company, wh_in, prod_base, prod_var_parent, prod_var_stub])
    db_session.commit()

    # Sept-billed, shipped Oct 1 -> must remain in September
    alloc_sep = AmazonLiveAllocation(
        company_id=3, warehouse_id=38, order_id="403-1009409-1902743", sku="LG0843-P",
        invoice_number="IN-525", amazon_line_item_id="578369057718", allocated_qty=1,
        gross_amount=Decimal("1094.29"), tax_amount=Decimal("54.71"), net_amount=Decimal("1149.00"),
        state_name="ANDHRA PRADESH", party_name="S L BATTERIES", customer_gstin="37ACXFS1297E1ZH",
        status=AllocationStatus.SHIPPED, order_date=datetime(2026, 9, 30, 11, 27),
        invoice_date=datetime(2026, 9, 30, 11, 31), shipment_date=datetime(2026, 10, 1, 14, 58),
        amazon_network_at_allocation=AmazonNetworkType.MFN,
    )
    # Sept-billed, delayed dispatch Oct 6 (>= 6 days) -> included in October
    alloc_oct_carry = AmazonLiveAllocation(
        company_id=3, warehouse_id=38, order_id="402-0852262-6053121", sku="LG1151-1",
        invoice_number="IN-522", amazon_line_item_id="578340233131", allocated_qty=1,
        gross_amount=Decimal("6856.19"), tax_amount=Decimal("342.81"), net_amount=Decimal("7199.00"),
        hsn_code="84335900", state_name="GUJARAT",
        status=AllocationStatus.SHIPPED, order_date=datetime(2026, 9, 28, 13, 41),
        invoice_date=datetime(2026, 9, 28, 14, 5), shipment_date=datetime(2026, 10, 6, 14, 33),
        amazon_network_at_allocation=AmazonNetworkType.MFN,
    )
    # Oct 31 billed, Nov 2 shipped (2 days lag), 0% GST override over product 5% default -> stays in October
    alloc_oct_zero_tax = AmazonLiveAllocation(
        company_id=3, warehouse_id=38, order_id="406-7068161-6923553", sku="LG1060",
        invoice_number="IN-596", amazon_line_item_id="580620001111", allocated_qty=1,
        gross_amount=Decimal("8133.00"), tax_amount=Decimal("0.00"), net_amount=Decimal("8133.00"),
        hsn_code="8201", state_name="MAHARASHTRA",
        status=AllocationStatus.SHIPPED, order_date=datetime(2026, 10, 31, 9, 23),
        invoice_date=datetime(2026, 10, 31, 9, 52), shipment_date=datetime(2026, 11, 2, 12, 50),
        amazon_network_at_allocation=AmazonNetworkType.MFN,
    )
    # Synthetic empty SP-API cancel & duplicate _CANCEL rows must not inflate MTR
    alloc_fake_cancel = AmazonLiveAllocation(
        company_id=3, warehouse_id=38, order_id="408-1015303-8454715", sku="LG0817",
        invoice_number="IN-624", amazon_line_item_id="65991579402362", allocated_qty=0,
        status=AllocationStatus.CANCELLED, invoice_date=datetime(2026, 10, 24, 11, 7),
        amazon_network_at_allocation=AmazonNetworkType.MFN,
    )
    alloc_real_cancel = AmazonLiveAllocation(
        company_id=3, warehouse_id=38, order_id="171-7222937-8755534", sku="LG1151-1",
        invoice_number="IN-591", amazon_line_item_id="580442925830", allocated_qty=1,
        gross_amount=Decimal("0.00"), tax_amount=Decimal("0.00"), net_amount=Decimal("0.00"),
        state_name="KARNATAKA", status=AllocationStatus.CANCELLED,
        invoice_date=datetime(2026, 10, 29, 13, 20),
        amazon_network_at_allocation=AmazonNetworkType.MFN,
    )
    alloc_dup_cancel = AmazonLiveAllocation(
        company_id=3, warehouse_id=38, order_id="171-7222937-8755534", sku="LG1151-1",
        invoice_number="IN-591", amazon_line_item_id="580442925830_CANCEL", allocated_qty=1,
        gross_amount=Decimal("0.00"), tax_amount=Decimal("0.00"), net_amount=Decimal("0.00"),
        state_name="KARNATAKA", status=AllocationStatus.CANCELLED,
        invoice_date=datetime(2026, 10, 29, 13, 20),
        amazon_network_at_allocation=AmazonNetworkType.MFN,
    )
    db_session.add_all([
        alloc_sep, alloc_oct_carry, alloc_oct_zero_tax,
        alloc_fake_cancel, alloc_real_cancel, alloc_dup_cancel,
    ])
    db_session.commit()

    # 1. Accountant Sales Report (October)
    acc_bytes, _, _, _ = SeriesReportService.generate_series_sales_report(
        db=db_session, company_id=3, series="IN",
        date_from=date(2026, 10, 1), date_to=date(2026, 10, 31), file_format="excel"
    )
    wb_acc = openpyxl.load_workbook(io.BytesIO(acc_bytes))
    ws_acc = wb_acc.active
    acc_rows = []
    for r in range(4, ws_acc.max_row + 1):
        bill = ws_acc.cell(r, 2).value
        if bill and bill not in ("BILL NO. WISE TOTALS", "GRAND TOTALS"):
            acc_rows.append({
                "bill": bill,
                "bill_date": ws_acc.cell(r, 3).value,
                "sku": ws_acc.cell(r, 4).value,
                "item_name": ws_acc.cell(r, 5).value,
                "group": ws_acc.cell(r, 7).value,
                "state": ws_acc.cell(r, 9).value,
                "party": ws_acc.cell(r, 10).value,
                "igst": ws_acc.cell(r, 17).value,
                "tax3": ws_acc.cell(r, 21).value,
                "net": ws_acc.cell(r, 22).value,
            })

    assert [r["bill"] for r in acc_rows] == ["IN-522", "IN-596"]
    assert acc_rows[0]["bill_date"] == "28/09/2026"
    assert acc_rows[0]["sku"] == "LG1151-1"
    assert acc_rows[0]["item_name"] == "Brush Cutter Base"
    assert acc_rows[0]["party"] == "AMAZON SELLER PORTAL CUSTOMER (GJ)"
    assert round(float(acc_rows[0]["igst"]), 2) == 342.81
    assert acc_rows[1]["group"] == "GST TAXFREE"
    assert acc_rows[1]["tax3"] == 0
    assert acc_rows[1]["party"] == "AMAZON SELLER PORTAL CUSTOMER (MH)"
    assert acc_rows[1]["igst"] in ("", None, 0, 0.0)

    # 2. Amazon MTR Report (October)
    mtr_bytes, _, _, _ = SeriesReportService.generate_amazon_mtr_report(
        db=db_session, company_id=3, warehouse_code="IN",
        date_from=date(2026, 10, 1), date_to=date(2026, 10, 31), file_format="excel"
    )
    wb_mtr = openpyxl.load_workbook(io.BytesIO(mtr_bytes))
    ws_mtr = wb_mtr.active
    mtr_rows = []
    for r in range(2, ws_mtr.max_row + 1):
        mtr_rows.append({
            "inv": ws_mtr.cell(r, 2).value,
            "tx": ws_mtr.cell(r, 4).value,
            "oid": ws_mtr.cell(r, 5).value,
            "hsn": ws_mtr.cell(r, 13).value,
            "inv_amt": ws_mtr.cell(r, 30).value,
            "gross": ws_mtr.cell(r, 31).value,
            "total_tax": ws_mtr.cell(r, 32).value,
            "igst_rate": ws_mtr.cell(r, 37).value,
            "igst_amt": ws_mtr.cell(r, 38).value,
        })

    # Fake IN-624 excluded, duplicate _CANCEL collapsed to 1 -> 2 Shipments + 1 Cancel
    assert len(mtr_rows) == 3
    ship_mtr = [m for m in mtr_rows if m["tx"] == "Shipment"]
    assert [m["inv"] for m in ship_mtr] == ["IN-522", "IN-596"]
    assert round(float(ship_mtr[0]["total_tax"]), 2) == 342.81
    assert round(float(ship_mtr[0]["igst_amt"]), 2) == 342.81
    assert str(ship_mtr[1]["hsn"]) == "8201"
    assert float(ship_mtr[1]["total_tax"]) == 0.0
    assert float(ship_mtr[1]["igst_rate"]) == 0.0

    # 3. Business Reports (/sales) IN Series
    br = get_sales_report(
        date_from="2026-10-01", date_to="2026-10-31", group_by="month",
        status=None, search=None, series="IN", page=1, limit=20,
        company_id=3, current_user=None, db=db_session,
    )
    assert len(br["items"]) == 1
    assert br["items"][0]["period"] == "2026-10"
    assert br["items"][0]["total_orders"] == 2
    assert br["items"][0]["total_items_sold"] == 2
    assert br["items"][0]["total_taxable_amount"] == round(6856.19 + 8133.00, 2)
    assert br["items"][0]["total_tax"] == 342.81
    assert br["items"][0]["total_revenue"] == round(7199.00 + 8133.00, 2)

    # 4. Strict SKU variant isolation (AGENTS.md)
    known = {"LG1151": "LG1151", "LG1151-1": "LG1151-1"}
    assert AmazonService.normalize_amazon_sku("LG1151-1", known) == "LG1151-1"
    assert AmazonService.normalize_amazon_sku("LG1151-P", known) is None
    assert AmazonService.normalize_amazon_sku("LG1151", known) == "LG1151"


def test_in_series_b2b_bill_vs_ship_state(db_session):
    company = Company(id=3, name="JSPL", code="JSPL", status="Active")
    wh_in = Warehouse(id=38, code="IN", name="JSPL IN", company_id=3, status="ACTIVE")
    prod = Product(id=305, sku="LG1151-1", name="Brush Cutter", hsn="84335900", company_id=3, default_gst_rate=5.0)
    db_session.add_all([company, wh_in, prod])
    db_session.commit()

    alloc = AmazonLiveAllocation(
        company_id=3, warehouse_id=38, order_id="403-9234527-9923500", sku="LG1151-1",
        invoice_number="IN-561", amazon_line_item_id="579643332074", allocated_qty=1,
        gross_amount=Decimal("6856.19"), tax_amount=Decimal("342.81"), net_amount=Decimal("7199.00"),
        hsn_code="84335900", state_name="KERALA",
        party_name="KRIPA ALUMINIUM GLASS CENTRE", customer_gstin="27AGIPV7060K1ZR",
        status=AllocationStatus.SHIPPED, order_date=datetime(2026, 10, 18, 18, 52),
        invoice_date=datetime(2026, 10, 18, 18, 54), shipment_date=datetime(2026, 10, 19, 11, 42),
        amazon_network_at_allocation=AmazonNetworkType.MFN,
    )
    db_session.add(alloc)
    db_session.commit()

    mtr_bytes, _, _, _ = SeriesReportService.generate_amazon_mtr_report(
        db=db_session, company_id=3, warehouse_code="IN",
        date_from=date(2026, 10, 1), date_to=date(2026, 10, 31), file_format="excel"
    )
    ws_mtr = openpyxl.load_workbook(io.BytesIO(mtr_bytes)).active
    assert ws_mtr.cell(2, 44).value == "Maharashtra"  # Customer Bill To State (GSTIN 27)
    assert ws_mtr.cell(2, 45).value == "Kerala"       # Customer Ship To State (delivery state)




import os
import io
import csv
import re
from datetime import datetime, date
from typing import Optional, List, Dict, Any, Tuple, Union
from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy import or_, and_, func, case

from app.models.schema import (
    Sale, SaleItem, Product, Warehouse, Company, Inventory,
    AmazonLiveAllocation, AmazonNetworkType, AllocationStatus, ReportHistory,
    Purchase, PurchaseItem, Vendor,
    SalesReturn, SalesReturnItem, AmazonReturn,
    FCReturn, FCReturnItem, InventoryMovement, StateHub
)
from app.utils.date_utils import parse_date_param

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUTPUT_DIR = os.path.join(BASE_DIR, "outputs")
REPORTS_DIR = os.path.join(OUTPUT_DIR, "reports")
os.makedirs(REPORTS_DIR, exist_ok=True)

REPORT_COLUMNS = [
    "SNO.",
    "BILL NO.",
    "BILL DATE",
    "ITEM CODE",
    "ITEM NAME",
    "hsn code",
    "GROUP11.GRP1",
    "GST NO.",
    "GST STATE NAME",
    "PARTY NAME",
    "PACK / SIZE",
    "SALE QUANTITY",
    "RATE/UNIT",
    "GROSS AMOUNT",
    "TOTAL SGST AMOUNT",
    "TOTAL CGST AMOUNT",
    "TOTAL IGST AMOUNT",
    "TD(%)",
    "CD(%)",
    "FREIGHT",
    "TAX-3(%)",
    "NET AMOUNT",
    "CD VALUE",
    "CASH",
    "TAX REGION",
    "SCHEME(RS.)",
    "REMARKS-3",
    "REMARKS-1",
    "REMARKS-2",
    "RCU MOBILE NO.",
    "RCU EMAIL ID",
    "ADJUST/UNIT",
    "RCU DISCOUNT CARD NO.",
    "ORDER NO.",
    "GODOWN NAME",
    "PUR RATE",
    "RATE-1",
    "LOT PURCHASE RATE",
    "TRANSPORT MODE",
    "CITY NAME",
    "ADDRESS-1",
    "ADDRESS-2",
    "ADDRESS-3",
    "HSN CODE",
    "HSN DESCRIPTION"
]

PURCHASE_REPORT_COLUMNS = [
    "SNO.",
    "BILL NO.",
    "BILL DATE",
    "PARTY NAME",
    "COMPANY NAME",
    "ITEM CODE",
    "ITEM NAME",
    "PACK / SIZE",
    "LOT NUMBER",
    "TOTAL QUANTITY",
    "GROSS AMOUNT",
    "NET AMOUNT",
    "TAX REGION",
    "TAX-1(%)",
    "HSN CODE",
    "HSN DESCRIPTION"
]

ACCOUNTANT_SALES_RETURN_COLUMNS = [
    "SNO.",
    "BILL NO.",
    "BILL DATE",
    "ITEM NAME",
    "ITEM CODE",
    "ADJUST/ITEM",
    "PARTY NAME",
    "GST NO.",
    "GST STATE NAME",
    "GST STATE CODE",
    "PACK / SIZE",
    "TAX (RS)",
    "LOT NUMBER",
    "TOTAL QUANTITY",
    "RATE/UNIT",
    "GROSS AMOUNT",
    "CD(%)",
    "FREIGHT",
    "ADJUSTMENT",
    "ADJUST/UNIT",
    "TAX (%)",
    "NET AMOUNT",
    "CD VALUE",
    "AMOUNT W/O TAX",
    "CREDIT",
    "CASH",
    "SCHEME(RS.)",
    "REMARKS-1",
    "RCU MOBILE NO.",
    "REMARKS-2",
    "RCU DISCOUNT CARD NO.",
    "RCU EMAIL ID",
    "ORDER NO.",
    "HSN CODE",
    "HSN DESCRIPTION"
]

INVENTORY_REGISTER_COLUMNS = [
    "SNO.",
    "COMPANY NAME",
    "ITEM CODE",
    "ITEM NAME",
    "PACK/SIZE",
    "CLOSING STOCK",
    "OPENING STOCK-1",
    "PURCHASE-1",
    "PUR FREE QTY",
    "PUR.RETURN-1",
    "RECEIPTS-1",
    "SALE-1",
    "SALE FREE QTY",
    "SALE RETURN-1",
    "SR FREE QTY",
    "NET SALE-1",
    "NET SALE VALUE-1",
    "ISSUES-1",
    "GROUP9",
    "GST TAX",
    "CLOSING VALUE(PUR RATE)"
]

STATE_CODE_MAP = {
    "01": "Jammu and Kashmir",
    "02": "Himachal Pradesh",
    "03": "Punjab",
    "04": "Chandigarh",
    "05": "Uttarakhand",
    "06": "Haryana",
    "07": "Delhi",
    "08": "Rajasthan",
    "09": "Uttar Pradesh",
    "10": "Bihar",
    "11": "Sikkim",
    "12": "Arunachal Pradesh",
    "13": "Nagaland",
    "14": "Manipur",
    "15": "Mizoram",
    "16": "Tripura",
    "17": "Meghalaya",
    "18": "Assam",
    "19": "West Bengal",
    "20": "Jharkhand",
    "21": "Odisha",
    "22": "Chhattisgarh",
    "23": "Madhya Pradesh",
    "24": "Gujarat",
    "26": "Dadra and Nagar Haveli and Daman and Diu",
    "27": "Maharashtra",
    "29": "Karnataka",
    "30": "Goa",
    "32": "Kerala",
    "33": "Tamil Nadu",
    "34": "Puducherry",
    "36": "Telangana",
    "37": "Andhra Pradesh",
    "38": "Ladakh"
}

def deduce_state_from_gstin(gstin: Optional[str], fallback: str = "Chandigarh") -> str:
    if gstin and len(gstin.strip()) >= 2:
        code = gstin.strip()[:2]
        if code in STATE_CODE_MAP:
            return STATE_CODE_MAP[code]
    return fallback

AMAZON_MTR_COLUMNS = [
    "Seller Gstin", "Invoice Number", "Invoice Date", "Transaction Type", "Order Id",
    "Shipment Id", "Shipment Date", "Order Date", "Shipment Item Id", "Quantity",
    "Item Description", "Asin", "Hsn/sac", "Sku", "Item Serial No.",
    "Product Tax Code", "Bill From City", "Bill From State", "Bill From Country", "Bill From Postal Code",
    "Ship From City", "Ship From State", "Ship From Country", "Ship From Postal Code",
    "Ship To City", "Ship To State", "Ship To Country", "Ship To Postal Code",
    "Invoice Amount", "Tax Exclusive Gross", "Total Tax Amount",
    "Cgst Rate", "Sgst Rate", "Utgst Rate", "Igst Rate", "Compensatory Cess Rate",
    "Principal Amount", "Principal Amount Basis",
    "Cgst Tax", "Sgst Tax", "Igst Tax", "Utgst Tax", "Compensatory Cess Tax",
    "Shipping Amount", "Shipping Amount Basis", "Shipping Cgst Tax", "Shipping Sgst Tax",
    "Shipping Utgst Tax", "Shipping Igst Tax", "Shipping Cess Tax Amount",
    "Gift Wrap Amount", "Gift Wrap Amount Basis", "Gift Wrap Cgst Tax", "Gift Wrap Sgst Tax",
    "Gift Wrap Utgst Tax", "Gift Wrap Igst Tax", "Gift Wrap Compensatory Cess Tax",
    "Item Promo Discount", "Item Promo Discount Basis", "Item Promo Discount Tax",
    "Shipping Promo Discount", "Shipping Promo Discount Basis", "Shipping Promo Discount Tax",
    "Gift Wrap Promo Discount", "Gift Wrap Promo Discount Basis", "Gift Wrap Promo Discount Tax",
    "Tcs Cgst Rate", "Tcs Cgst Amount", "Tcs Sgst Rate", "Tcs Sgst Amount",
    "Tcs Utgst Rate", "Tcs Utgst Amount", "Tcs Igst Rate", "Tcs Igst Amount",
    "Warehouse Id", "Fulfillment Channel", "Payment Method Code",
    "Credit Note No", "Credit Note Date", "Irn Number", "Irn Filing Status", "Irn Date", "Irn Error Code",
    "MEM SHIP", "TAX REGION", "ACCOUT CODE"
]

_ACCOUNT_CODE_CACHE: Optional[Dict[str, str]] = None

def get_account_code_map() -> Dict[str, str]:
    global _ACCOUNT_CODE_CACHE
    if _ACCOUNT_CODE_CACHE is not None:
        return _ACCOUNT_CODE_CACHE
    mapping: Dict[str, str] = {}
    lookup_file = os.path.join(BASE_DIR, "lookup_tables", "STATE CODE AND ACCOUNT CODE.xlsx")
    if os.path.exists(lookup_file):
        try:
            import openpyxl
            wb = openpyxl.load_workbook(lookup_file, read_only=True)
            ws = wb.active
            for row in ws.iter_rows(values_only=True):
                if not row or len(row) < 5:
                    continue
                acc_name = str(row[1] or "").strip().upper()
                if "AMAZON SELLER PORTAL CUSTOMER" in acc_name:
                    acc_code = str(row[2] or "").strip()
                    st_code = str(row[3] or "").strip().replace(".0", "")
                    st_name = str(row[4] or "").replace("\xa0", " ").strip().upper()
                    if st_code:
                        mapping[st_code] = acc_code
                        mapping[st_code.zfill(2)] = acc_code
                    if st_name:
                        mapping[st_name] = acc_code
                        clean_name = st_name.split("(")[0].strip()
                        mapping[clean_name] = acc_code
        except Exception:
            pass
    _ACCOUNT_CODE_CACHE = mapping
    return mapping

_CANONICAL_STATE_LEDGER: Dict[str, Tuple[str, str, str]] = {
    "01": ("Jammu and Kashmir", "01", "AMAZON SELLER PORTAL CUSTOMER (JK)"),
    "02": ("Himachal Pradesh", "02", "AMAZON SELLER PORTAL CUSTOMER (HP)"),
    "03": ("Punjab", "03", "AMAZON SELLER PORTAL CUSTOMER (PB)"),
    "04": ("Chandigarh", "04", "AMAZON SELLER PORTAL CUSTOMER (CHD)"),
    "05": ("Uttarakhand", "05", "AMAZON SELLER PORTAL CUSTOMER (UT)"),
    "06": ("Haryana", "06", "AMAZON SELLER PORTAL CUSTOMER (HRY)"),
    "07": ("Delhi", "07", "AMAZON SELLER PORTAL CUSTOMER (DL)"),
    "08": ("Rajasthan", "08", "AMAZON SELLER PORTAL CUSTOMER (RJ)"),
    "09": ("Uttar Pradesh", "09", "AMAZON SELLER PORTAL CUSTOMER (UP)"),
    "10": ("Bihar", "10", "AMAZON SELLER PORTAL CUSTOMER (BH)"),
    "11": ("Sikkim", "11", "AMAZON SELLER PORTAL CUSTOMER (SK)"),
    "12": ("Arunachal Pradesh", "12", "AMAZON SELLER PORTAL CUSTOMER (AR)"),
    "13": ("Nagaland", "13", "AMAZON SELLER PORTAL CUSTOMER (NL)"),
    "14": ("Manipur", "14", "AMAZON SELLER PORTAL CUSTOMER (MN)"),
    "15": ("Mizoram", "15", "AMAZON SELLER PORTAL CUSTOMER (MI)"),
    "16": ("Tripura", "16", "AMAZON SELLER PORTAL CUSTOMER (TR)"),
    "17": ("Meghalaya", "17", "AMAZON SELLER PORTAL CUSTOMER (ME)"),
    "18": ("Assam", "18", "AMAZON SELLER PORTAL CUSTOMER (AS)"),
    "19": ("West Bengal", "19", "AMAZON SELLER PORTAL CUSTOMER (WB)"),
    "20": ("Jharkhand", "20", "AMAZON SELLER PORTAL CUSTOMER (JH)"),
    "21": ("Odisha", "21", "AMAZON SELLER PORTAL CUSTOMER (OR)"),
    "22": ("Chhattisgarh", "22", "AMAZON SELLER PORTAL CUSTOMER (CG)"),
    "23": ("Madhya Pradesh", "23", "AMAZON SELLER PORTAL CUSTOMER (MP)"),
    "24": ("Gujarat", "24", "AMAZON SELLER PORTAL CUSTOMER (GJ)"),
    "25": ("Daman and Diu", "25", "AMAZON SELLER PORTAL CUSTOMER (DD)"),
    "26": ("Dadra and Nagar Haveli", "26", "AMAZON SELLER PORTAL CUSTOMER (DN)"),
    "27": ("Maharashtra", "27", "AMAZON SELLER PORTAL CUSTOMER (MH)"),
    "29": ("Karnataka", "29", "AMAZON SELLER PORTAL CUSTOMER (KA)"),
    "30": ("Goa", "30", "AMAZON SELLER PORTAL CUSTOMER (GA)"),
    "31": ("Lakshadweep", "31", "AMAZON SELLER PORTAL CUSTOMER (LD)"),
    "32": ("Kerala", "32", "AMAZON SELLER PORTAL CUSTOMER (KL)"),
    "33": ("Tamil Nadu", "33", "AMAZON SELLER PORTAL CUSTOMER (TN)"),
    "34": ("Puducherry", "34", "AMAZON SELLER PORTAL CUSTOMER (PY)"),
    "35": ("Andaman and Nicobar Islands", "35", "AMAZON SELLER PORTAL CUSTOMER (AN)"),
    "36": ("Telangana", "36", "AMAZON SELLER PORTAL CUSTOMER (TS)"),
    "37": ("Andhra Pradesh", "37", "AMAZON SELLER PORTAL CUSTOMER (AD)"),
    "38": ("Ladakh", "38", "AMAZON SELLER PORTAL CUSTOMER (LA)"),
}

_STATE_ALIAS_TO_CODE: Dict[str, str] = {
    "JK": "01", "JAMMU AND KASHMIR": "01", "JAMMU & KASHMIR": "01", "JAMMU KASHMIR": "01",
    "HP": "02", "HIMACHAL PRADESH": "02",
    "PB": "03", "PUNJAB": "03",
    "CH": "04", "CHD": "04", "CHANDIGARH": "04",
    "UT": "05", "UK": "05", "UTTARAKHAND": "05", "UTTARANCHAL": "05",
    "HR": "06", "HRY": "06", "HARYANA": "06",
    "DL": "07", "DELHI": "07", "NEW DELHI": "07", "NCT OF DELHI": "07",
    "RJ": "08", "RAJASTHAN": "08",
    "UP": "09", "UTTAR PRADESH": "09",
    "BR": "10", "BH": "10", "BIHAR": "10",
    "SK": "11", "SIKKIM": "11",
    "AR": "12", "ARUNACHAL PRADESH": "12",
    "NL": "13", "NAGALAND": "13",
    "MN": "14", "MANIPUR": "14",
    "MZ": "15", "MI": "15", "MIZORAM": "15",
    "TR": "16", "TRIPURA": "16",
    "ML": "17", "ME": "17", "MEGHALAYA": "17",
    "AS": "18", "ASSAM": "18",
    "WB": "19", "WEST BENGAL": "19", "WEST BENGAL ": "19",
    "JH": "20", "JHARKHAND": "20",
    "OR": "21", "OD": "21", "ODISHA": "21", "ORISSA": "21",
    "CG": "22", "CT": "22", "CHHATTISGARH": "22", "CHHATISGARH": "22",
    "MP": "23", "MADHYA PRADESH": "23",
    "GJ": "24", "GUJARAT": "24", "GUJARATH": "24",
    "DD": "25", "DAMAN AND DIU": "25", "DAMAN & DIU": "25",
    "DN": "26", "DADRA AND NAGAR HAVELI": "26", "DADRA & NAGAR HAVELI": "26",
    "DADRA AND NAGAR HAVELI AND DAMAN AND DIU": "26", "DNHDD": "26",
    "MH": "27", "MAHARASHTRA": "27", "MAHARASTRA": "27",
    "KA": "29", "KARNATAKA": "29",
    "GA": "30", "GOA": "30",
    "LD": "31", "LAKSHADWEEP": "31",
    "KL": "32", "KERALA": "32",
    "TN": "33", "TAMIL NADU": "33", "TAMILNADU": "33",
    "PY": "34", "PUDUCHERRY": "34", "PONDICHERRY": "34",
    "AN": "35", "ANDAMAN AND NICOBAR ISLANDS": "35", "ANDAMAN AND NICOBAR ISLAND": "35",
    "ANDAMAN & NICOBAR ISLANDS": "35", "ANDAMAN AND NICOBAR": "35",
    "TS": "36", "TG": "36", "TELANGANA": "36",
    "AD": "37", "AP": "37", "ANDHRA PRADESH": "37", "ANDHRA PRADESH (NEW)": "37",
    "LA": "38", "LADAKH": "38",
}


def resolve_state_info(
    raw_state: Optional[str],
    gstin: Optional[str] = None,
    fallback_state: str = "Chandigarh",
) -> Tuple[str, str, str]:
    """Return (official_state_name, gst_state_code, b2c_ledger_name) for any Indian state or GSTIN."""
    if gstin and len(gstin.strip()) >= 2:
        gst_code = gstin.strip()[:2]
        if gst_code in _CANONICAL_STATE_LEDGER:
            return _CANONICAL_STATE_LEDGER[gst_code]

    for candidate in (raw_state, fallback_state):
        if not candidate:
            continue
        norm = " ".join(str(candidate).replace("\xa0", " ").replace("&", " AND ").strip().upper().split())
        if norm in _CANONICAL_STATE_LEDGER:
            return _CANONICAL_STATE_LEDGER[norm]
        code = _STATE_ALIAS_TO_CODE.get(norm)
        if not code and "(" in norm:
            code = _STATE_ALIAS_TO_CODE.get(norm.split("(")[0].strip())
        if code and code in _CANONICAL_STATE_LEDGER:
            return _CANONICAL_STATE_LEDGER[code]

    fb_clean = (raw_state or fallback_state or "Chandigarh").strip().title()
    return fb_clean, "04", f"AMAZON SELLER PORTAL CUSTOMER ({fb_clean[:3].upper()})"


def resolve_product_and_base(
    alloc_sku: Optional[str],
    company_id: Optional[int],
    prod_map_by_company: Dict[Tuple[Optional[int], str], Any],
    prod_map_sku: Dict[str, Any],
) -> Tuple[Optional[Any], Optional[Any]]:
    """Resolve exact SKU product and optional base-SKU metadata without merging distinct variants."""
    norm_sku = (alloc_sku or "").strip().upper()
    if not norm_sku:
        return None, None
    exact_prod = prod_map_by_company.get((company_id, norm_sku)) or prod_map_sku.get(norm_sku)
    base_sku = re.split(r"[-\s]+", norm_sku)[0] if norm_sku else norm_sku
    base_prod = None
    if base_sku and base_sku != norm_sku:
        base_prod = prod_map_by_company.get((company_id, base_sku)) or prod_map_sku.get(base_sku)
    return exact_prod, base_prod


def derive_gst_rate(
    gross_amt: Optional[float],
    raw_tax: Optional[float],
    fallback_rate: float = 18.0,
) -> float:
    """Derive actual GST slab from transaction gross & tax amounts, preserving 0% tax-free items."""
    if raw_tax is not None:
        if abs(raw_tax) <= 0.005:
            return 0.0
        if gross_amt and abs(gross_amt) > 0:
            pct = (abs(raw_tax) / abs(gross_amt)) * 100.0
            for slab in (5.0, 12.0, 18.0, 28.0):
                if abs(pct - slab) <= 0.35:
                    return slab
            return round(pct, 2)
    return float(fallback_rate if fallback_rate is not None else 18.0)


def get_allocation_date_expr(db: Session, is_in_series: bool):
    """
    Return the effective date column expression for Amazon allocations.
    For IN series (MFN), orders follow invoice_date unless a cross-month dispatch was delayed >= 6 days
    into the following month (e.g., Sept invoice dispatched in Oct). Other warehouses keep shipment_date.
    """
    if not is_in_series:
        return func.coalesce(
            AmazonLiveAllocation.shipment_date,
            AmazonLiveAllocation.invoice_date,
            AmazonLiveAllocation.order_date,
        )

    is_sqlite = bool(db.bind and db.bind.dialect.name == "sqlite")
    if is_sqlite:
        diff_month = func.strftime("%Y-%m", AmazonLiveAllocation.shipment_date) != func.strftime("%Y-%m", AmazonLiveAllocation.invoice_date)
        lag_expr = func.julianday(AmazonLiveAllocation.shipment_date) - func.julianday(AmazonLiveAllocation.invoice_date)
    else:
        diff_month = func.to_char(AmazonLiveAllocation.shipment_date, "YYYY-MM") != func.to_char(AmazonLiveAllocation.invoice_date, "YYYY-MM")
        lag_expr = func.extract("epoch", AmazonLiveAllocation.shipment_date - AmazonLiveAllocation.invoice_date) / 86400.0

    delayed_cross_month = and_(
        AmazonLiveAllocation.invoice_date.isnot(None),
        AmazonLiveAllocation.shipment_date.isnot(None),
        diff_month,
        lag_expr >= 6.0,
    )
    return case(
        (delayed_cross_month, AmazonLiveAllocation.shipment_date),
        else_=func.coalesce(
            AmazonLiveAllocation.invoice_date,
            AmazonLiveAllocation.shipment_date,
            AmazonLiveAllocation.order_date,
        ),
    )

class SeriesReportService:
    @staticmethod
    def get_detected_series(db: Session, company_id: Optional[int] = None) -> List[Dict[str, str]]:
        """Returns detected series / prefixes from existing sales and Amazon orders."""
        company = db.query(Company).filter(Company.id == company_id).first() if company_id else None
        company_code = (company.code or "").strip().upper() if company else ""

        query = db.query(Sale.bill_number, Sale.invoice_number)
        if company_id:
            query = query.filter(Sale.company_id == company_id)
        
        sales = query.all()
        series_set = set()
        for b, inv in sales:
            ref = (inv or b or "").strip()
            if "-" in ref:
                prefix = ref.split("-")[0].strip().upper()
                if prefix:
                    series_set.add(prefix)
            elif ref and not ref.isdigit():
                series_set.add(ref[:3].upper())

        if company_code == "JSPL" or company_id == 3:
            # JSPL: GST, JGST, IN, SERVICE, ALL. BKR series is strictly excluded.
            options = [
                {"id": "GST", "label": "GST Series (GST-)"},
                {"id": "JGST", "label": "JSPL GST Series (JGST-)"},
                {"id": "IN", "label": "IN Series (JSPL IN / MFN)"},
                {"id": "SERVICE", "label": "Service Series (SERVICE-)"},
                {"id": "ALL", "label": "All Series Combined (GST, JGST, SERVICE)"},
                {"id": "AMAZON", "label": "Amazon All Series (AFN & MFN Combined)"},
                {"id": "AFN", "label": "Amazon AFN Series (FBA Orders)"},
                {"id": "MFN", "label": "Amazon MFN Series (Merchant Orders)"}
            ]
            for p in sorted(series_set):
                if p not in ("GST", "BKR", "JGST", "JSPL", "AFN", "MFN", "AMAZON", "SERVICE", "SERV", "DELETED", "EDITED", "CANCELLED", "IN") and not p.startswith("BKR"):
                    options.append({"id": p, "label": f"{p} Series ({p}-*)"})
        elif company_code == "BKR" or company_id == 2:
            # BKR: GST, JGST (BKR Series), BKR Retail, ALL, Amazon.
            options = [
                {"id": "GST", "label": "GST Series (GST- / BKR-GST-)"},
                {"id": "JGST", "label": "BKR Series (JGST-)"},
                {"id": "BKR", "label": "BKR Retail Series (BKR-)"},
                {"id": "ALL", "label": "All Series Combined (GST & JGST Combined)"},
                {"id": "AMAZON", "label": "Amazon All Series (AFN & MFN Combined)"},
                {"id": "AFN", "label": "Amazon AFN Series (FBA Orders)"},
                {"id": "MFN", "label": "Amazon MFN Series (Merchant Orders)"}
            ]
            for p in sorted(series_set):
                if p not in ("GST", "BKR", "JGST", "JSPL", "AFN", "MFN", "AMAZON", "DELETED", "EDITED", "CANCELLED") and not p.startswith("JSPL"):
                    options.append({"id": p, "label": f"{p} Series ({p}-*)"})
        else:
            options = [
                {"id": "GST", "label": "GST Series (GST-)"},
                {"id": "AFN", "label": "Amazon AFN Series (FBA Orders)"},
                {"id": "MFN", "label": "Amazon MFN Series (Merchant Orders)"},
                {"id": "AMAZON", "label": "Amazon All Series (AFN & MFN Combined)"},
                {"id": "BKR", "label": "BKR Retail Series (BKR-)"},
                {"id": "JGST", "label": "JSPL GST Series (JGST-)"},
                {"id": "ALL", "label": "All Series Combined (Excl. Amazon)"}
            ]
            for p in sorted(series_set):
                if p not in ("GST", "BKR", "JGST", "AFN", "MFN", "AMAZON", "DELETED", "EDITED", "CANCELLED"):
                    options.append({"id": p, "label": f"{p} Series ({p}-*)"})

        # Add warehouse / FC series options for the company (VSHB, KWZ2, BLR4, etc.)
        wh_query = db.query(Warehouse).filter(Warehouse.status == "ACTIVE")
        if company_id:
            wh_query = wh_query.filter(Warehouse.company_id == company_id)
        warehouses = wh_query.order_by(Warehouse.id.asc()).all()

        existing_ids = {opt["id"] for opt in options}
        for w in warehouses:
            code = (w.code or "").strip().upper()
            if not code or code in ("DEFAULT", "TEST-WH-MFN", "AUTO_GODOWN"):
                continue
            if code not in existing_ids:
                if code == "VSHB":
                    lbl = "VSHB Series (JSPL Central / VSHB)" if (company_id == 3 or company_code == "JSPL") else f"VSHB Series ({w.name})"
                else:
                    lbl = f"{code} Series ({w.name})"
                options.append({"id": code, "label": lbl})
                existing_ids.add(code)

        # Also detect any active invoice series prefixes present in AmazonLiveAllocation
        alloc_prefixes = (
            db.query(func.distinct(func.substring(AmazonLiveAllocation.invoice_number, r'^([A-Z0-9]+)-')))
            .filter(AmazonLiveAllocation.company_id == company_id if company_id else True)
            .filter(AmazonLiveAllocation.invoice_number.isnot(None))
            .all()
        )
        for row in alloc_prefixes:
            p = (row[0] or "").strip().upper()
            if p and p not in existing_ids and p not in ("DEFAULT", "TEST", "AMZ"):
                options.append({"id": p, "label": f"{p} Series (Amazon FC {p})"})
                existing_ids.add(p)

        return options

    @staticmethod
    def _export_dataset(
        db: Session,
        company_id: Optional[int],
        data_rows: List[List[Any]],
        title_str: str,
        filename_base: str,
        sheet_title: str,
        report_type_label: str,
        file_format: str = "csv"
    ) -> Tuple[Union[str, bytes], str, str, int]:
        """
        Shared exporter converting data rows into CSV or styled Excel (.xlsx).
        """
        num_cols = len(REPORT_COLUMNS)
        amount_col_indices = {13, 14, 15, 16, 17, 20, 21, 22, 23, 24, 26, 36, 37, 38}

        if file_format.lower() == "csv":
            output = io.StringIO()
            writer = csv.writer(output)
            
            # Row 1: empty row
            writer.writerow([""] * num_cols)
            # Row 2: Title repeated across columns
            writer.writerow([title_str] * num_cols)
            # Row 3: Column Headers
            writer.writerow(REPORT_COLUMNS)
            # Data & Subtotals & Grand Total Rows
            for r in data_rows:
                formatted_r = list(r)
                for idx in range(len(formatted_r)):
                    c_idx = idx + 1
                    val = formatted_r[idx]
                    if val is not None and val != "":
                        if c_idx in amount_col_indices:
                            try:
                                formatted_r[idx] = f"{round(float(val), 2):.2f}"
                            except (ValueError, TypeError):
                                pass
                        elif isinstance(val, float):
                            formatted_r[idx] = f"{round(val, 2):.2f}"
                writer.writerow(formatted_r)

            content = output.getvalue()
            filename = f"{filename_base}.csv"
            media_type = "text/csv"

            # Save to Reports Dir and Log in ReportHistory
            filepath = os.path.join(REPORTS_DIR, filename)
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)

            if company_id:
                rep_hist = ReportHistory(
                    company_id=company_id,
                    report_type=report_type_label,
                    file_path=filepath,
                    download_link=f"/api/reports/download/{filename}"
                )
                db.add(rep_hist)
                db.commit()

            return content, filename, media_type, len(data_rows)

        else:
            # Excel (.xlsx) formatting via openpyxl
            import openpyxl
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
            from openpyxl.utils import get_column_letter

            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = sheet_title[:31]

            # Row 1: empty row
            ws.append([""] * num_cols)

            # Row 2: Title banner merged across columns
            ws.append([title_str] * num_cols)
            title_cell = ws.cell(row=2, column=1)
            title_cell.font = Font(name="Calibri", size=11, bold=True, color="1E293B")
            title_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
            for c in range(1, num_cols + 1):
                ws.cell(row=2, column=c).fill = title_fill

            # Row 3: Header Row
            ws.append(REPORT_COLUMNS)
            header_fill = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
            header_font = Font(name="Calibri", size=10, bold=True, color="0F172A")
            for c in range(1, num_cols + 1):
                cell = ws.cell(row=3, column=c)
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

            thin_border = Border(
                left=Side(style='thin', color='E2E8F0'),
                right=Side(style='thin', color='E2E8F0'),
                top=Side(style='thin', color='E2E8F0'),
                bottom=Side(style='thin', color='E2E8F0')
            )
            subtotal_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
            grand_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")

            # Append Data Rows & track column widths simultaneously
            col_widths = {c: len(str(REPORT_COLUMNS[c-1])) for c in range(1, num_cols + 1)}
            current_row_idx = 4
            for r in data_rows:
                ws.append(r)
                is_subtotal = (len(r) > 1 and r[1] == "BILL NO. WISE TOTALS")
                is_grand = (len(r) > 1 and r[1] == "GRAND TOTALS")

                for c_idx in range(1, min(len(r) + 1, num_cols + 1)):
                    cell = ws.cell(row=current_row_idx, column=c_idx)
                    cell.border = thin_border
                    if is_grand:
                        cell.font = Font(name="Calibri", size=10, bold=True, color="92400E")
                        cell.fill = grand_fill
                    elif is_subtotal:
                        cell.font = Font(name="Calibri", size=10, bold=True, color="1E293B")
                        cell.fill = subtotal_fill
                    else:
                        cell.font = Font(name="Calibri", size=10, color="334155")

                    # Right-align numeric columns
                    if c_idx in (12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 24, 26, 36, 37, 38):
                        cell.alignment = Alignment(horizontal="right")

                    # Set fixed 2 decimal places for amounts/rates, integer format for quantity
                    if c_idx in amount_col_indices and cell.value is not None and cell.value != "":
                        try:
                            fval = float(cell.value)
                            cell.value = round(fval, 2)
                            cell.number_format = "0.00"
                        except (ValueError, TypeError):
                            pass
                    elif c_idx == 12 and cell.value is not None and cell.value != "":
                        try:
                            fval = float(cell.value)
                            if fval.is_integer():
                                cell.value = int(fval)
                                cell.number_format = "0"
                            else:
                                cell.value = round(fval, 2)
                                cell.number_format = "0.00"
                        except (ValueError, TypeError):
                            pass

                    val_len = len(str(r[c_idx-1] or ''))
                    if val_len > col_widths.get(c_idx, 0):
                        col_widths[c_idx] = val_len

                current_row_idx += 1

            # Auto-fit column widths using tracked maximums
            for c_idx, max_len in col_widths.items():
                col_letter = get_column_letter(c_idx)
                ws.column_dimensions[col_letter].width = min(max(max_len + 3, 10), 45)

            stream = io.BytesIO()
            wb.save(stream)
            excel_bytes = stream.getvalue()

            filename = f"{filename_base}.xlsx"
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

            filepath = os.path.join(REPORTS_DIR, filename)
            with open(filepath, "wb") as f:
                f.write(excel_bytes)

            if company_id:
                rep_hist = ReportHistory(
                    company_id=company_id,
                    report_type=report_type_label,
                    file_path=filepath,
                    download_link=f"/api/reports/download/{filename}"
                )
                db.add(rep_hist)
                db.commit()

            return excel_bytes, filename, media_type, len(data_rows)

    @staticmethod
    def generate_series_sales_report(
        db: Session,
        company_id: Optional[int] = None,
        series: str = "GST",
        date_from: Optional[Union[date, str]] = None,
        date_to: Optional[Union[date, str]] = None,
        file_format: str = "csv"
    ) -> Tuple[Union[str, bytes], str, str, int]:
        """
        Generates the Accountant Series-Wise Sales Report in the exact 47-column format.
        """
        date_from = parse_date_param(date_from)
        date_to = parse_date_param(date_to)
        if date_from is None:
            now_dt = datetime.utcnow()
            date_from = date(now_dt.year, now_dt.month, 1)
        series_clean = (series or "GST").strip().upper()
        
        # 1. Fetch Sales Matching Filter
        sales_query = db.query(Sale).filter(Sale.status != 'Cancelled')
        if company_id:
            sales_query = sales_query.filter(Sale.company_id == company_id)

        if date_from:
            sales_query = sales_query.filter(Sale.sale_date >= datetime.combine(date_from, datetime.min.time()))
        if date_to:
            sales_query = sales_query.filter(Sale.sale_date <= datetime.combine(date_to, datetime.max.time()))

        if series_clean == "GST":
            # Strictly GST- or BKR-GST- bills. Explicitly exclude JGST- (JSPL GST series).
            sales_query = sales_query.filter(
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
        elif series_clean == "AMAZON":
            sales_query = sales_query.filter(
                or_(
                    Sale.transaction_origin == "AMAZON",
                    Sale.bill_number.ilike("AMZ%"),
                    Sale.invoice_number.ilike("AMZ%"),
                    Sale.bill_number.ilike("%AMZN%"),
                    Sale.invoice_number.ilike("%AMZN%"),
                    Sale.bill_number.ilike("AFN%"),
                    Sale.invoice_number.ilike("AFN%"),
                    Sale.bill_number.ilike("MFN%"),
                    Sale.invoice_number.ilike("MFN%")
                )
            )
        elif series_clean == "AFN":
            # Amazon AFN (FBA) Fulfillment Network
            sales_query = sales_query.filter(
                or_(
                    Sale.bill_number.ilike("AFN%"),
                    Sale.invoice_number.ilike("AFN%")
                )
            )
        elif series_clean == "MFN":
            # Amazon MFN (Merchant) Fulfillment Network
            sales_query = sales_query.filter(
                or_(
                    Sale.bill_number.ilike("MFN%"),
                    Sale.invoice_number.ilike("MFN%")
                )
            )
        elif series_clean == "BKR":
            # BKR is strictly company exclusive to BKR (company_id = 2)
            if company_id and company_id != 2:
                sales_query = sales_query.filter(Sale.id == -1)
            else:
                sales_query = sales_query.filter(
                    and_(
                        or_(Sale.bill_number.ilike("BKR%"), Sale.invoice_number.ilike("BKR%")),
                        ~Sale.bill_number.ilike("%GST%"),
                        ~Sale.invoice_number.ilike("%GST%")
                    )
                )
        elif series_clean == "JGST":
            # Strictly matches JGST% and explicitly excludes GST% (e.g. GST-129 to GST-137)
            sales_query = sales_query.filter(
                and_(
                    or_(
                        Sale.bill_number.ilike("JGST%"),
                        Sale.invoice_number.ilike("JGST%")
                    ),
                    ~Sale.bill_number.ilike("GST%"),
                    ~Sale.invoice_number.ilike("GST%")
                )
            )
        elif series_clean in ("SERVICE", "SERV"):
            sales_query = sales_query.filter(
                or_(
                    Sale.bill_number.ilike("SERVICE%"),
                    Sale.invoice_number.ilike("SERVICE%"),
                    Sale.bill_number.ilike("SERV%"),
                    Sale.invoice_number.ilike("SERV%")
                )
            )
        elif series_clean == "ALL":
            # All Series Combined must strictly exclude Amazon orders and respect company exclusivity
            sales_query = sales_query.filter(
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
                # JSPL: strictly exclude BKR retail series
                sales_query = sales_query.filter(
                    and_(
                        ~Sale.bill_number.ilike("BKR%"),
                        ~Sale.invoice_number.ilike("BKR%")
                    )
                )
            elif company_id == 2:
                # BKR: includes GST, JGST, and BKR series (Row 44: REPORT SHOWS SERIES OF GST & JGST IN ALL SERIES COMBINED IN BKR)
                sales_query = sales_query.filter(
                    and_(
                        ~Sale.bill_number.ilike("JSPL%"),
                        ~Sale.invoice_number.ilike("JSPL%")
                    )
                )
        else:
            pattern = f"{series_clean}%"
            sales_query = sales_query.filter(
                or_(
                    Sale.bill_number.ilike(pattern),
                    Sale.invoice_number.ilike(pattern)
                )
            )

        sales_query = sales_query.options(
            selectinload(Sale.items).selectinload(SaleItem.product)
        )
        sales = sales_query.order_by(Sale.sale_date.asc(), Sale.id.asc()).all()

        # Check if series matches an active warehouse code (e.g. VSHB, IN, KWZ2, BLR4, BOM5, etc.)
        matched_warehouse_query = db.query(Warehouse).filter(
            func.upper(Warehouse.code) == series_clean,
            Warehouse.status == "ACTIVE"
        )
        if company_id:
            matched_wh = matched_warehouse_query.filter(Warehouse.company_id == company_id).first()
            if not matched_wh:
                matched_wh = db.query(Warehouse).filter(
                    func.upper(Warehouse.code) == series_clean,
                    Warehouse.status == "ACTIVE"
                ).first()
        else:
            matched_wh = matched_warehouse_query.first()

        is_in_series = series_clean == "IN" or (bool(matched_wh) and (matched_wh.code or "").strip().upper() == "IN")
        is_amazon_target = series_clean in ("AMAZON", "AFN", "MFN", "IN") or bool(matched_wh)
        amazon_allocations = []
        if is_amazon_target:
            alloc_date_col = get_allocation_date_expr(db, is_in_series)
            alloc_query = db.query(AmazonLiveAllocation).filter(
                AmazonLiveAllocation.status == AllocationStatus.SHIPPED,
                or_(
                    AmazonLiveAllocation.allocated_qty > 0,
                    AmazonLiveAllocation.reconciled_qty > 0
                ),
                AmazonLiveAllocation.invoice_number.isnot(None),
                AmazonLiveAllocation.invoice_number != '',
                ~AmazonLiveAllocation.invoice_number.ilike('%-C-%'),
                ~AmazonLiveAllocation.invoice_number.ilike('CN-%'),
                ~AmazonLiveAllocation.amazon_line_item_id.ilike('%_REF%'),
                ~AmazonLiveAllocation.amazon_line_item_id.ilike('%_CANCEL%'),
                ~AmazonLiveAllocation.amazon_line_item_id.ilike('%_shipment_%'),
                or_(
                    AmazonLiveAllocation.net_amount.is_(None),
                    AmazonLiveAllocation.net_amount > 0
                )
            )
            if company_id and series_clean not in ("IN",):
                has_allocs = db.query(AmazonLiveAllocation.id).filter(AmazonLiveAllocation.company_id == company_id).first()
                if has_allocs:
                    alloc_query = alloc_query.filter(AmazonLiveAllocation.company_id == company_id)
            if series_clean in ("AMAZON", "ALL"):
                pass  # All Amazon allocations (both AFN and MFN)
            elif series_clean == "AFN":
                alloc_query = alloc_query.filter(AmazonLiveAllocation.amazon_network_at_allocation == AmazonNetworkType.AFN)
            elif series_clean == "MFN":
                alloc_query = alloc_query.filter(AmazonLiveAllocation.amazon_network_at_allocation == AmazonNetworkType.MFN)
            elif series_clean == "IN" or (matched_wh and matched_wh.code.upper() == "IN"):
                alloc_query = alloc_query.filter(
                    or_(
                        AmazonLiveAllocation.warehouse_id == 38,
                        AmazonLiveAllocation.invoice_number.ilike("IN-%")
                    )
                )
            elif matched_wh:
                if matched_wh.code.upper() in ("BKR_CENTRAL",) or (matched_wh.warehouse_type and matched_wh.warehouse_type.value == "CENTRAL" and company_id == 2):
                    alloc_query = alloc_query.filter(
                        or_(
                            AmazonLiveAllocation.warehouse_id == matched_wh.id,
                            AmazonLiveAllocation.amazon_network_at_allocation == AmazonNetworkType.MFN
                        )
                    )
                else:
                    alloc_query = alloc_query.filter(AmazonLiveAllocation.warehouse_id == matched_wh.id)
            else:
                # Strict isolation: if series code is given but warehouse not found by ID, filter by invoice_number prefix
                alloc_query = alloc_query.filter(
                    or_(
                        AmazonLiveAllocation.invoice_number.ilike(f"{series_clean}-%"),
                        AmazonLiveAllocation.warehouse_id == -1
                    )
                )
            if date_from:
                alloc_query = alloc_query.filter(alloc_date_col >= datetime.combine(date_from, datetime.min.time()))
            if date_to:
                alloc_query = alloc_query.filter(alloc_date_col <= datetime.combine(date_to, datetime.max.time()))
            sort_date_col = (
                func.coalesce(
                    AmazonLiveAllocation.invoice_date,
                    AmazonLiveAllocation.shipment_date,
                    AmazonLiveAllocation.order_date,
                )
                if is_in_series
                else alloc_date_col
            )
            amazon_allocations = alloc_query.order_by(
                sort_date_col.asc(),
                AmazonLiveAllocation.invoice_number.asc(),
                AmazonLiveAllocation.id.asc()
            ).all()

            # Deduplicate allocations by (order_id, sku, invoice_number) to ensure strictly 1 outward sales row per SKU per invoice
            unique_allocs = []
            seen_alloc_keys = {}
            for a in amazon_allocations:
                key = (
                    (a.order_id or "").strip(),
                    (a.sku or "").strip().upper(),
                    (a.invoice_number or "").strip().upper()
                )
                if key not in seen_alloc_keys:
                    seen_alloc_keys[key] = a
                    unique_allocs.append(a)
                else:
                    prev = seen_alloc_keys[key]
                    if (a.net_amount or 0) > (prev.net_amount or 0):
                        idx = unique_allocs.index(prev)
                        unique_allocs[idx] = a
                        seen_alloc_keys[key] = a
            amazon_allocations = unique_allocs

        d_from_str = date_from.strftime("%d/%m/%Y") if date_from else "01/10/2026"
        d_to_str = date_to.strftime("%d/%m/%Y") if date_to else datetime.utcnow().strftime("%d/%m/%Y")
        if series_clean == "ALL":
            title_str = f"SALE REPORT FOR ACCOUNTANT-ALL (EXCL. AMAZON) From {d_from_str} to {d_to_str}"
        else:
            title_str = f"SALE REPORT FOR ACCOUNTANT-{series_clean} From {d_from_str} to {d_to_str}"

        data_rows: List[List[Any]] = []
        sno = 0
        grand_qty = 0
        grand_gross = 0.0
        grand_sgst = 0.0
        grand_cgst = 0.0
        grand_igst = 0.0
        grand_net = 0.0
        grand_cost = 0.0
        grand_credit = 0.0
        grand_cash = 0.0

        for sale in sales:
            items = sale.items or []
            if not items:
                continue

            bill_no = sale.invoice_number or sale.bill_number
            bill_date = sale.sale_date.strftime("%d/%m/%Y") if sale.sale_date else ""
            party_name = sale.customer_name or "CUSTOMER A/C"
            gst_no = sale.customer_gstin or ""
            gst_state = sale.customer_state or deduce_state_from_gstin(gst_no, "Chandigarh")

            addr_parts = [p.strip() for p in (sale.customer_address or "").replace("\r", "\n").split("\n") if p.strip()]
            if not addr_parts:
                addr_parts = [p.strip() for p in (sale.customer_address or "").split(",") if p.strip()]
            
            addr1 = addr_parts[0] if len(addr_parts) > 0 else ""
            addr2 = addr_parts[1] if len(addr_parts) > 1 else ""
            addr3 = addr_parts[2] if len(addr_parts) > 2 else (sale.customer_state or "")

            bill_qty = 0
            bill_gross = 0.0
            bill_sgst = 0.0
            bill_cgst = 0.0
            bill_igst = 0.0
            bill_net = 0.0
            bill_cost = 0.0
            bill_credit = 0.0
            bill_cash = 0.0

            for it in items:
                sno += 1
                prod = it.product
                item_code = it.sku
                item_name = it.product_name or (prod.name if prod else it.sku)
                hsn_code = it.hsn_sac or (prod.hsn if prod else "") or ""
                pack_size = it.unit or (prod.unit if prod else "") or ""
                qty = it.quantity or 1

                gst_rate = float(it.gst_rate if it.gst_rate is not None else ((prod.default_gst_rate or 0) if prod else 0))
                if gst_rate == 0:
                    group_tax = "GST TAXFREE"
                else:
                    group_tax = f"GST {int(gst_rate) if gst_rate.is_integer() else gst_rate}%"

                if it.taxable_amount and it.taxable_amount > 0:
                    gross_amt = round(float(it.taxable_amount), 2)
                    rate_unit = round(gross_amt / qty, 2)
                elif it.line_total and gst_rate > 0:
                    gross_amt = round(float(it.line_total) / (1 + (gst_rate / 100.0)), 2)
                    rate_unit = round(gross_amt / qty, 2)
                else:
                    rate_unit = round(float(it.selling_price or 0.0), 2)
                    gross_amt = round(rate_unit * qty, 2)

                sgst = round(float(it.sgst or 0.0), 2)
                cgst = round(float(it.cgst or 0.0), 2)
                igst = round(float(it.igst or 0.0), 2)

                if igst > 0:
                    tax_region = "IGST"
                    tax_3 = int(gst_rate) if gst_rate.is_integer() else gst_rate
                elif sgst > 0 or cgst > 0:
                    tax_region = "CGST/SGST"
                    half_rate = gst_rate / 2.0
                    tax_3 = int(half_rate) if half_rate.is_integer() else half_rate
                else:
                    is_interstate = bool(sale.customer_state and sale.customer_state.lower() != "chandigarh")
                    if is_interstate and gst_rate > 0:
                        tax_region = "IGST"
                        igst = round(gross_amt * (gst_rate / 100.0), 2)
                        tax_3 = int(gst_rate) if gst_rate.is_integer() else gst_rate
                    elif gst_rate > 0:
                        tax_region = "CGST/SGST"
                        half_rate = gst_rate / 2.0
                        cgst = round(gross_amt * (half_rate / 100.0), 2)
                        sgst = round(gross_amt * (half_rate / 100.0), 2)
                        tax_3 = int(half_rate) if half_rate.is_integer() else half_rate
                    else:
                        tax_region = "CGST/SGST"
                        tax_3 = ""

                if it.line_total and it.line_total > 0:
                    net_amt = round(float(it.line_total), 2)
                else:
                    net_amt = round(gross_amt + sgst + cgst + igst, 2)

                pur_rate = float(prod.item_rate if prod and prod.item_rate else 0.0)
                pur_rate_str = f"{round(pur_rate, 2):g}" if pur_rate > 0 else ""
                rate_1_str = f"{pur_rate:.4f}" if pur_rate > 0 else ""
                cost_amt = round(pur_rate * qty, 2) if pur_rate > 0 else ""

                is_credit = bool(sale.customer_gstin) or sale.invoice_type == "B2B" or \
                            (sale.payment_method or "").lower() in ["credit", "unpaid", "bank transfer", "cheque", "neft", "rtgs"]
                
                credit_col = net_amt if is_credit else ""
                cash_col = net_amt if not is_credit else ""
                hsn_desc = (prod.category if prod and prod.category else "Other") or "Other"

                row = [
                    sno,                                       # 0: SNO.
                    bill_no,                                   # 1: BILL NO.
                    bill_date,                                 # 2: BILL DATE
                    item_code,                                 # 3: ITEM CODE
                    item_name,                                 # 4: ITEM NAME
                    hsn_code,                                  # 5: hsn code
                    group_tax,                                 # 6: GROUP11.GRP1
                    gst_no,                                    # 7: GST NO.
                    gst_state,                                 # 8: GST STATE NAME
                    party_name,                                # 9: PARTY NAME
                    pack_size,                                 # 10: PACK / SIZE
                    qty,                                       # 11: SALE QUANTITY
                    rate_unit,                                 # 12: RATE/UNIT
                    gross_amt,                                 # 13: GROSS AMOUNT
                    sgst if sgst > 0 else "",                  # 14: TOTAL SGST AMOUNT
                    cgst if cgst > 0 else "",                  # 15: TOTAL CGST AMOUNT
                    igst if igst > 0 else "",                  # 16: TOTAL IGST AMOUNT
                    "",                                        # 17: TD(%)
                    "",                                        # 18: CD(%)
                    "",                                        # 19: FREIGHT
                    tax_3,                                     # 20: TAX-3(%)
                    net_amt,                                   # 21: NET AMOUNT
                    "",                                        # 22: CD VALUE
                    cash_col,                                  # 23: CASH
                    tax_region,                                # 24: TAX REGION
                    "",                                        # 25: SCHEME(RS.)
                    sale.payment_remarks or " ",               # 26: REMARKS-3
                    sale.payment_reference or " ",             # 27: REMARKS-1
                    " ",                                       # 28: REMARKS-2
                    sale.customer_mobile or "",                # 29: RCU MOBILE NO.
                    sale.customer_email or "",                 # 30: RCU EMAIL ID
                    "",                                        # 31: ADJUST/UNIT
                    "",                                        # 32: RCU DISCOUNT CARD NO.
                    sale.buyer_order_no or " ",                # 33: ORDER NO.
                    "",                                        # 34: GODOWN NAME
                    pur_rate_str,                              # 35: PUR RATE
                    rate_1_str,                                # 36: RATE-1
                    "",                                        # 37: LOT PURCHASE RATE
                    sale.dispatch_through or "",               # 38: TRANSPORT MODE
                    addr2 or " ",                              # 39: CITY NAME
                    addr1,                                     # 40: ADDRESS-1
                    addr2,                                     # 41: ADDRESS-2
                    addr3,                                     # 42: ADDRESS-3
                    hsn_code,                                  # 43: HSN CODE
                    hsn_desc                                   # 44: HSN DESCRIPTION
                ]
                data_rows.append(row)

                bill_qty += qty
                bill_gross += gross_amt
                bill_sgst += sgst
                bill_cgst += cgst
                bill_igst += igst
                bill_net += net_amt
                if pur_rate > 0:
                    bill_cost += (pur_rate * qty)
                if is_credit:
                    bill_credit += net_amt
                else:
                    bill_cash += net_amt

            subtotal_row = [
                "",                                            # 0: SNO.
                "BILL NO. WISE TOTALS",                        # 1: BILL NO.
                "", "", "", "", "", "", "", "", "",            # 2-10: (empty)
                bill_qty,                                      # 11: SALE QUANTITY
                "",                                            # 12: RATE/UNIT
                round(bill_gross, 2),                          # 13: GROSS AMOUNT
                round(bill_sgst, 2) if bill_sgst > 0 else "",  # 14: TOTAL SGST AMOUNT
                round(bill_cgst, 2) if bill_cgst > 0 else "",  # 15: TOTAL CGST AMOUNT
                round(bill_igst, 2) if bill_igst > 0 else "",  # 16: TOTAL IGST AMOUNT
                "", "", "", "",                                # 17-20: (empty)
                round(bill_net, 2),                            # 21: NET AMOUNT
                "",                                            # 22: CD VALUE
                round(bill_cash, 2) if bill_cash > 0 else "",  # 23: CASH
                "", "", "", "", "", "", "", "", "", "",        # 24-33: (empty)
                "", "", "", "", "", "", "", "", "", "", ""     # 34-44: (empty)
            ]
            data_rows.append(subtotal_row)

            grand_qty += bill_qty
            grand_gross += bill_gross
            grand_sgst += bill_sgst
            grand_cgst += bill_cgst
            grand_igst += bill_igst
            grand_net += bill_net
            grand_cost += bill_cost
            grand_credit += bill_credit
            grand_cash += bill_cash

        # Process Amazon allocations
        if (series_clean in ("AMAZON", "AFN", "MFN", "IN") or matched_wh) and amazon_allocations:
            prod_query = db.query(Product)
            if company_id and series_clean not in ("IN",):
                prod_query = prod_query.filter(Product.company_id == company_id)
            all_prods = prod_query.all()
            prod_map_by_company = {(p.company_id, p.sku.upper()): p for p in all_prods}
            prod_map_sku = {p.sku.upper(): p for p in all_prods}
            wh_map = {w.id: w for w in db.query(Warehouse).all()}
            hub_map = {h.id: h for h in db.query(StateHub).all()}

            # Group allocations by bill number so multiple line items under the same invoice
            # are presented together followed by a single BILL NO. WISE TOTALS row.
            bill_groups_map: Dict[str, List[Tuple[str, Any]]] = {}
            for alloc in amazon_allocations:
                wh = wh_map.get(alloc.warehouse_id) if alloc.warehouse_id else None
                b_no = alloc.invoice_number or (f"IN-{alloc.id}" if (alloc.amazon_network_at_allocation and alloc.amazon_network_at_allocation.value == "MFN") or (wh and wh.code == "IN") else f"{wh.code if wh else 'AMZ'}-{alloc.id}")
                bill_groups_map.setdefault(b_no, []).append((b_no, alloc))
            alloc_groups = list(bill_groups_map.values())

            for group in alloc_groups:
                b_qty = 0
                b_gross = 0.0
                b_sgst = 0.0
                b_cgst = 0.0
                b_igst = 0.0
                b_net = 0.0
                b_cost = 0.0

                for bill_no, alloc in group:
                    sno += 1
                    alloc_sku = (alloc.sku or "").strip().upper()
                    prod, base_prod = resolve_product_and_base(
                        alloc.sku, alloc.company_id, prod_map_by_company, prod_map_sku
                    )
                    wh = wh_map.get(alloc.warehouse_id) if alloc.warehouse_id else None
                    hub = hub_map.get(wh.hub_id) if (wh and wh.hub_id) else None

                    # Resolve seller origin state accurately from StateHub or warehouse metadata
                    if hub and hub.state:
                        origin_state = hub.state.strip().title()
                    elif wh and ((wh.code or "").upper() in ("VSHB", "IN", "BKR_CENTRAL", "AUTO_GODOWN") or (wh.warehouse_type and "CENTRAL" in str(wh.warehouse_type).upper())):
                        origin_state = "Chandigarh"
                    elif alloc.amazon_network_at_allocation and getattr(alloc.amazon_network_at_allocation, "value", str(alloc.amazon_network_at_allocation)).upper() == "MFN":
                        origin_state = "Chandigarh"
                    elif wh and ("KARNATAKA" in (wh.name or "").upper() or any((wh.code or "").upper().startswith(p) for p in ("BLR", "KWZ"))):
                        origin_state = "Karnataka"
                    elif wh and ("MAHARASTRA" in (wh.name or "").upper() or "MAHARASHTRA" in (wh.name or "").upper() or any((wh.code or "").upper().startswith(p) for p in ("BOM", "PNQ", "ISK"))):
                        origin_state = "Maharashtra"
                    elif wh and ("WEST_BANGA" in (wh.name or "").upper() or "WEST BENGAL" in (wh.name or "").upper() or any((wh.code or "").upper().startswith(p) for p in ("CCX", "CCU"))):
                        origin_state = "West Bengal"
                    elif wh and ("TAMIL_NADU" in (wh.name or "").upper() or "TAMIL NADU" in (wh.name or "").upper() or any((wh.code or "").upper().startswith(p) for p in ("CJB", "MAA"))):
                        origin_state = "Tamil Nadu"
                    elif wh and ("TELANGANA" in (wh.name or "").upper() or (wh.code or "").upper().startswith("HYD")):
                        origin_state = "Telangana"
                    elif wh and ("MADHYA_PRA" in (wh.name or "").upper() or "MADHYA PRADESH" in (wh.name or "").upper() or any((wh.code or "").upper().startswith(p) for p in ("SIDA", "IDX"))):
                        origin_state = "Madhya Pradesh"
                    elif wh and ("UTTARPRADE" in (wh.name or "").upper() or "UTTAR PRADESH" in (wh.name or "").upper() or (wh.code or "").upper().startswith("LKO")):
                        origin_state = "Uttar Pradesh"
                    elif wh and ("GUJARATH" in (wh.name or "").upper() or "GUJARAT" in (wh.name or "").upper() or (wh.code or "").upper().startswith("AMD")):
                        origin_state = "Gujarat"
                    else:
                        origin_state = "Chandigarh" if (company_id in (2, 3) or series_clean in ("VSHB", "IN", "MFN")) else "Karnataka"

                    is_central = (
                        (wh and (wh.code or "").upper() in ("VSHB", "IN", "BKR_CENTRAL", "AUTO_GODOWN")) or
                        (wh and wh.warehouse_type and "CENTRAL" in str(wh.warehouse_type).upper()) or
                        (alloc.amazon_network_at_allocation and getattr(alloc.amazon_network_at_allocation, "value", str(alloc.amazon_network_at_allocation)).upper() == "MFN") or
                        series_clean in ("VSHB", "IN", "MFN")
                    )

                    godown_name = wh.name if wh else (alloc.amazon_network_at_allocation.value if alloc.amazon_network_at_allocation else "Amazon AFN")

                    # Structure origin addresses accurately
                    if is_central:
                        addr_1 = hub.address if (hub and hub.address) else "Plot no: 150, Industrial & Business Park-2"
                        addr_2 = hub.city if (hub and hub.city) else "Chandigarh"
                        addr_3 = f"{origin_state} - 160002"
                    elif hub and hub.address:
                        addr_parts = [p.strip() for p in hub.address.split(",") if p.strip()]
                        addr_1 = addr_parts[0] if len(addr_parts) > 0 else f"Amazon FC {godown_name}"
                        addr_2 = addr_parts[1] if len(addr_parts) > 1 else (hub.city or "")
                        addr_3 = addr_parts[2] if len(addr_parts) > 2 else origin_state
                    else:
                        addr_1 = f"Amazon FC {godown_name}"
                        addr_2 = hub.city if (hub and hub.city) else ""
                        addr_3 = origin_state

                    order_id = alloc.order_id
                    item_code = alloc.sku
                    prod_name_clean = (prod.name or "").strip() if prod else ""
                    if prod_name_clean and prod_name_clean.upper() != alloc_sku:
                        item_name = prod_name_clean
                    elif base_prod and base_prod.name:
                        item_name = base_prod.name
                    else:
                        item_name = prod_name_clean or alloc.sku

                    hsn_code = (
                        alloc.hsn_code
                        or (prod.hsn if prod and prod.hsn else "")
                        or (base_prod.hsn if base_prod and base_prod.hsn else "")
                        or ""
                    )
                    hsn_desc = (
                        (prod.category if prod and prod.category else None)
                        or (base_prod.category if base_prod and base_prod.category else None)
                        or "Other"
                    )
                    pack_size = (
                        (prod.unit if prod and prod.unit else None)
                        or (base_prod.unit if base_prod and base_prod.unit else None)
                        or ""
                    )
                    qty = alloc.allocated_qty or alloc.reconciled_qty or 1

                    fallback_rate = (
                        float(prod.default_gst_rate)
                        if (prod and prod.default_gst_rate is not None)
                        else (float(base_prod.default_gst_rate) if (base_prod and base_prod.default_gst_rate is not None) else 18.0)
                    )

                    pur_rate = (
                        float(prod.item_rate)
                        if (prod and prod.item_rate and float(prod.item_rate) > 0)
                        else (float(base_prod.item_rate) if (base_prod and base_prod.item_rate and float(base_prod.item_rate) > 0) else 0.0)
                    )
                    pur_rate_str = f"{round(pur_rate, 2):g}" if pur_rate > 0 else ""
                    rate_1_str = f"{pur_rate:.4f}" if pur_rate > 0 else ""

                    cust_gstin = (alloc.customer_gstin or "").strip()
                    dest_state, _, default_b2c_party = resolve_state_info(
                        alloc.state_name, cust_gstin, fallback_state=origin_state
                    )
                    is_intra = bool(alloc.state_name and dest_state.upper() == origin_state.upper())

                    if alloc.gross_amount is not None and alloc.net_amount is not None:
                        gross_amt = round(float(alloc.gross_amount), 2)
                        net_amt = round(float(alloc.net_amount), 2)
                        total_tax = round(float(alloc.tax_amount), 2) if alloc.tax_amount is not None else round(net_amt - gross_amt, 2)
                        gst_rate = derive_gst_rate(gross_amt, total_tax, fallback_rate)
                        rate_unit = round(gross_amt / qty, 2)
                    else:
                        gst_rate = fallback_rate
                        selling_price = pur_rate * 1.35 if pur_rate > 0 else 500.0
                        rate_unit = round(selling_price / (1 + (gst_rate / 100.0)), 2)
                        gross_amt = round(rate_unit * qty, 2)
                        total_tax = round(gross_amt * (gst_rate / 100.0), 2)
                        net_amt = round(gross_amt + total_tax, 2)

                    if abs(gst_rate) <= 0.005:
                        group_tax = "GST TAXFREE"
                    else:
                        group_tax = f"GST {int(gst_rate) if float(gst_rate).is_integer() else gst_rate}%"

                    if abs(total_tax) <= 0.005:
                        sgst = 0.0
                        cgst = 0.0
                        igst = 0.0
                        tax_3 = 0
                        tax_region = "CGST/SGST" if is_intra else "IGST"
                    elif is_intra:
                        sgst = round(total_tax / 2.0, 2)
                        cgst = round(total_tax - sgst, 2)
                        igst = 0.0
                        half_rate = gst_rate / 2.0
                        tax_3 = int(half_rate) if float(half_rate).is_integer() else round(half_rate, 2)
                        tax_region = "CGST/SGST"
                    else:
                        sgst = 0.0
                        cgst = 0.0
                        igst = round(total_tax, 2)
                        tax_3 = int(gst_rate) if float(gst_rate).is_integer() else round(gst_rate, 2)
                        tax_region = "IGST"

                    cost_amt = round(pur_rate * qty, 2) if pur_rate > 0 else ""

                    if is_in_series:
                        actual_dt = alloc.invoice_date or alloc.shipment_date or alloc.order_date or alloc.updated_at or alloc.created_at
                    else:
                        actual_dt = alloc.shipment_date or alloc.invoice_date or alloc.order_date or alloc.updated_at or alloc.created_at
                    alloc_dt = actual_dt.strftime("%d/%m/%Y") if actual_dt else datetime.utcnow().strftime("%d/%m/%Y")

                    state_name = dest_state
                    raw_party = (alloc.party_name or "").strip()
                    party_name = raw_party if raw_party else default_b2c_party

                    row = [
                        sno, bill_no, alloc_dt, item_code, item_name, hsn_code, group_tax,
                        cust_gstin,
                        state_name,
                        party_name, pack_size, qty, rate_unit, gross_amt,
                        sgst if sgst > 0 else "", cgst if cgst > 0 else "", igst if igst > 0 else "",
                        "", "", "", tax_3, net_amt, "",
                        net_amt, tax_region, "", " ", f"AMZ-SYNC-{alloc.amazon_line_item_id or ''}", " ",
                        "", "", "", "", order_id, godown_name,
                        pur_rate_str,
                        rate_1_str,
                        "", "Amazon Logistics", " ", addr_1, addr_2, addr_3,
                        hsn_code, hsn_desc
                    ]
                    data_rows.append(row)

                    b_qty += qty
                    b_gross += gross_amt
                    b_sgst += sgst
                    b_cgst += cgst
                    b_igst += igst
                    b_net += net_amt
                    if pur_rate > 0:
                        b_cost += (pur_rate * qty)

                subtotal_row = [
                    "", "BILL NO. WISE TOTALS",
                    "", "", "", "", "", "", "", "", "",
                    b_qty, "", round(b_gross, 2),
                    round(b_sgst, 2) if b_sgst > 0 else "",
                    round(b_cgst, 2) if b_cgst > 0 else "",
                    round(b_igst, 2) if b_igst > 0 else "",
                    "", "", "", "", round(b_net, 2), "",
                    round(b_net, 2), "", "", "", "", "", "", "", "", "", "",
                    "", "", "", "", "", "", "", "", "", "", ""
                ]
                data_rows.append(subtotal_row)

                grand_qty += b_qty
                grand_gross += b_gross
                grand_sgst += b_sgst
                grand_cgst += b_cgst
                grand_igst += b_igst
                grand_net += b_net
                grand_cost += b_cost
                grand_cash += b_net

        # Final Grand Totals Row
        if sno > 0:
            grand_total_row = [
                "",                                                # 0: SNO.
                "GRAND TOTALS",                                    # 1: BILL NO.
                "", "", "", "", "", "", "", "", "",                # 2-10: (empty)
                grand_qty,                                         # 11: SALE QUANTITY
                "",                                                # 12: RATE/UNIT
                round(grand_gross, 2),                             # 13: GROSS AMOUNT
                round(grand_sgst, 2) if grand_sgst > 0 else "",    # 14: TOTAL SGST AMOUNT
                round(grand_cgst, 2) if grand_cgst > 0 else "",    # 15: TOTAL CGST AMOUNT
                round(grand_igst, 2) if grand_igst > 0 else "",    # 16: TOTAL IGST AMOUNT
                "", "", "", "",                                    # 17-20: (empty)
                round(grand_net, 2),                               # 21: NET AMOUNT
                "",                                                # 22: CD VALUE
                round(grand_cash, 2) if grand_cash > 0 else "",    # 23: CASH
                "", "", "", "", "", "", "", "", "", "",            # 24-33: (empty)
                "", "", "", "", "", "", "", "", "", "", ""         # 34-44: (empty)
            ]
            data_rows.append(grand_total_row)

        timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename_base = f"Accountant_Sales_{series_clean}_{timestamp_str}"

        report_label = f"Accountant Sales ({series_clean})"
        if series_clean == "AFN":
            report_label = "Accountant Sales (Amazon AFN - FBA)"
        elif series_clean == "MFN":
            report_label = "Accountant Sales (Amazon MFN - Merchant)"
        elif series_clean == "ALL":
            report_label = "Accountant Sales (All Series - Excl. Amazon)"

        return SeriesReportService._export_dataset(
            db=db,
            company_id=company_id,
            data_rows=data_rows,
            title_str=title_str,
            filename_base=filename_base,
            sheet_title=f"{series_clean[:10]}_Sales",
            report_type_label=report_label,
            file_format=file_format
        )

    @staticmethod
    def _export_hsn_purchase_dataset(
        db: Session,
        company_id: Optional[int],
        data_rows: List[List[Any]],
        title_str: str,
        filename_base: str,
        sheet_title: str,
        report_type_label: str,
        file_format: str = "csv"
    ) -> Tuple[Union[str, bytes], str, str, int]:
        num_cols = len(PURCHASE_REPORT_COLUMNS)
        purchase_amount_cols = {11, 12, 14}
        if file_format.lower() == "csv":
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow([""] * num_cols)
            writer.writerow([title_str] * num_cols)
            writer.writerow(PURCHASE_REPORT_COLUMNS)
            for r in data_rows:
                formatted_r = list(r)
                for idx in range(len(formatted_r)):
                    c_idx = idx + 1
                    val = formatted_r[idx]
                    if val is not None and val != "":
                        if c_idx in purchase_amount_cols:
                            try:
                                formatted_r[idx] = f"{round(float(val), 2):.2f}"
                            except (ValueError, TypeError):
                                pass
                        elif isinstance(val, float):
                            formatted_r[idx] = f"{round(val, 2):.2f}"
                writer.writerow(formatted_r)
            content = output.getvalue()
            filename = f"{filename_base}.csv"
            media_type = "text/csv"
            filepath = os.path.join(REPORTS_DIR, filename)
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            if company_id:
                rep_hist = ReportHistory(
                    company_id=company_id,
                    report_type=report_type_label,
                    file_path=filepath,
                    download_link=f"/api/reports/download/{filename}"
                )
                db.add(rep_hist)
                db.commit()
            return content, filename, media_type, len(data_rows)
        else:
            import openpyxl
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
            from openpyxl.utils import get_column_letter

            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = sheet_title[:31]

            ws.append([""] * num_cols)
            ws.append([title_str] * num_cols)
            title_cell = ws.cell(row=2, column=1)
            title_cell.font = Font(name="Tahoma", size=12, bold=True, color="1E293B")
            title_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
            for c in range(1, num_cols + 1):
                ws.cell(row=2, column=c).fill = title_fill

            ws.append(PURCHASE_REPORT_COLUMNS)
            header_fill = PatternFill(start_color="F0F0F0", end_color="F0F0F0", fill_type="solid")
            header_font = Font(name="Courier New", size=8, bold=True, color="0F172A")
            for c in range(1, num_cols + 1):
                cell = ws.cell(row=3, column=c)
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

            thin_border = Border(
                left=Side(style='thin', color='E2E8F0'),
                right=Side(style='thin', color='E2E8F0'),
                top=Side(style='thin', color='E2E8F0'),
                bottom=Side(style='thin', color='E2E8F0')
            )
            grand_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")

            col_widths = {c: len(str(PURCHASE_REPORT_COLUMNS[c-1])) for c in range(1, num_cols + 1)}
            current_row_idx = 4
            for r in data_rows:
                ws.append(r)
                is_grand = (len(r) > 9 and r[0] == "" and str(r[9]).strip() != "")

                for c_idx in range(1, min(len(r) + 1, num_cols + 1)):
                    cell = ws.cell(row=current_row_idx, column=c_idx)
                    cell.border = thin_border
                    if is_grand:
                        cell.font = Font(name="Tahoma", size=10, bold=True, color="92400E")
                        cell.fill = grand_fill
                    else:
                        cell.font = Font(name="Tahoma", size=10, color="334155")

                    if c_idx in (10, 11, 12, 14):
                        cell.alignment = Alignment(horizontal="right")

                    if c_idx in purchase_amount_cols and cell.value is not None and cell.value != "":
                        try:
                            fval = float(cell.value)
                            cell.value = round(fval, 2)
                            cell.number_format = "0.00"
                        except (ValueError, TypeError):
                            pass
                    elif c_idx == 10 and cell.value is not None and cell.value != "":
                        try:
                            fval = float(cell.value)
                            if fval.is_integer():
                                cell.value = int(fval)
                                cell.number_format = "0"
                            else:
                                cell.value = round(fval, 2)
                                cell.number_format = "0.00"
                        except (ValueError, TypeError):
                            pass

                    val_len = len(str(r[c_idx-1] or ''))
                    if val_len > col_widths.get(c_idx, 0):
                        col_widths[c_idx] = val_len

                current_row_idx += 1

            for c_idx, max_len in col_widths.items():
                col_letter = get_column_letter(c_idx)
                ws.column_dimensions[col_letter].width = min(max(max_len + 3, 10), 45)

            stream = io.BytesIO()
            wb.save(stream)
            excel_bytes = stream.getvalue()

            filename = f"{filename_base}.xlsx"
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            filepath = os.path.join(REPORTS_DIR, filename)
            with open(filepath, "wb") as f:
                f.write(excel_bytes)

            if company_id:
                rep_hist = ReportHistory(
                    company_id=company_id,
                    report_type=report_type_label,
                    file_path=filepath,
                    download_link=f"/api/reports/download/{filename}"
                )
                db.add(rep_hist)
                db.commit()

            return excel_bytes, filename, media_type, len(data_rows)

    @staticmethod
    def _export_inventory_register_dataset(
        db: Session,
        company_id: Optional[int],
        data_rows: List[List[Any]],
        filename_base: str,
        sheet_title: str,
        report_type_label: str,
        file_format: str = "excel"
    ) -> Tuple[Union[str, bytes], str, str, int]:
        inv_amount_cols = {17, 20, 21}
        inv_qty_cols = {6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18}
        if file_format.lower() == "csv":
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(INVENTORY_REGISTER_COLUMNS)
            for r in data_rows:
                formatted_r = list(r)
                for idx in range(len(formatted_r)):
                    c_idx = idx + 1
                    val = formatted_r[idx]
                    if val is not None and val != "":
                        if c_idx in inv_amount_cols:
                            try:
                                formatted_r[idx] = f"{round(float(val), 2):.2f}"
                            except (ValueError, TypeError):
                                pass
                        elif isinstance(val, float):
                            formatted_r[idx] = f"{round(val, 2):.2f}"
                writer.writerow(formatted_r)
            content = output.getvalue()
            filename = f"{filename_base}.csv"
            media_type = "text/csv"
            filepath = os.path.join(REPORTS_DIR, filename)
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            if company_id:
                rep_hist = ReportHistory(
                    company_id=company_id,
                    report_type=report_type_label,
                    file_path=filepath,
                    download_link=f"/api/reports/download/{filename}"
                )
                db.add(rep_hist)
                db.commit()
            return content, filename, media_type, len(data_rows)
        else:
            import openpyxl
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
            from openpyxl.utils import get_column_letter

            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = sheet_title[:31]

            ws.append(INVENTORY_REGISTER_COLUMNS)
            header_fill = PatternFill(start_color="F0F0F0", end_color="F0F0F0", fill_type="solid")
            header_font = Font(name="Calibri", size=10, bold=True, color="0F172A")
            for c in range(1, 22):
                cell = ws.cell(row=1, column=c)
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

            thin_border = Border(
                left=Side(style='thin', color='E2E8F0'),
                right=Side(style='thin', color='E2E8F0'),
                top=Side(style='thin', color='E2E8F0'),
                bottom=Side(style='thin', color='E2E8F0')
            )
            grand_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")

            col_widths = {c: len(str(INVENTORY_REGISTER_COLUMNS[c-1])) for c in range(1, 22)}
            current_row_idx = 2
            for r in data_rows:
                ws.append(r)
                is_grand = (r[1] == "GRAND TOTALS")

                for c_idx in range(1, 22):
                    cell = ws.cell(row=current_row_idx, column=c_idx)
                    cell.border = thin_border
                    if is_grand:
                        cell.font = Font(name="Calibri", size=10, bold=True, color="92400E")
                        cell.fill = grand_fill
                    else:
                        cell.font = Font(name="Calibri", size=10, color="334155")

                    if c_idx in (6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21):
                        cell.alignment = Alignment(horizontal="right")

                    if c_idx in inv_amount_cols and cell.value is not None and cell.value != "":
                        try:
                            fval = float(cell.value)
                            cell.value = round(fval, 2)
                            cell.number_format = "0.00"
                        except (ValueError, TypeError):
                            pass
                    elif c_idx in inv_qty_cols and cell.value is not None and cell.value != "":
                        try:
                            fval = float(cell.value)
                            if fval.is_integer():
                                cell.value = int(fval)
                                cell.number_format = "0"
                            else:
                                cell.value = round(fval, 2)
                                cell.number_format = "0.00"
                        except (ValueError, TypeError):
                            pass

                    val_len = len(str(r[c_idx-1] or ''))
                    if val_len > col_widths[c_idx]:
                        col_widths[c_idx] = val_len

                current_row_idx += 1

            for c_idx, max_len in col_widths.items():
                col_letter = get_column_letter(c_idx)
                ws.column_dimensions[col_letter].width = min(max(max_len + 3, 10), 45)

            stream = io.BytesIO()
            wb.save(stream)
            excel_bytes = stream.getvalue()

            filename = f"{filename_base}.xlsx"
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            filepath = os.path.join(REPORTS_DIR, filename)
            with open(filepath, "wb") as f:
                f.write(excel_bytes)

            if company_id:
                rep_hist = ReportHistory(
                    company_id=company_id,
                    report_type=report_type_label,
                    file_path=filepath,
                    download_link=f"/api/reports/download/{filename}"
                )
                db.add(rep_hist)
                db.commit()

            return excel_bytes, filename, media_type, len(data_rows)

    @staticmethod
    def generate_purchase_report(
        db: Session,
        company_id: Optional[int] = None,
        vendor_id: Optional[int] = None,
        date_from: Optional[Union[date, str]] = None,
        date_to: Optional[Union[date, str]] = None,
        file_format: str = "csv"
    ) -> Tuple[Union[str, bytes], str, str, int]:
        """
        Generates the Official 15-Column HSN WISE PURCHASE REPORT matching media_1793182489464_8bbd9f4d.xlsx.
        """
        date_from = parse_date_param(date_from)
        date_to = parse_date_param(date_to)
        query = db.query(Purchase)
        if company_id:
            query = query.filter(Purchase.company_id == company_id)
        if vendor_id:
            query = query.filter(Purchase.vendor_id == vendor_id)
        if date_from:
            query = query.filter(func.coalesce(Purchase.date, Purchase.created_at) >= datetime.combine(date_from, datetime.min.time()))
        if date_to:
            query = query.filter(func.coalesce(Purchase.date, Purchase.created_at) <= datetime.combine(date_to, datetime.max.time()))

        query = query.options(
            selectinload(Purchase.items),
            selectinload(Purchase.vendor)
        )
        purchases = query.order_by(func.coalesce(Purchase.date, Purchase.created_at).asc(), Purchase.id.asc()).all()

        prod_map = {prod.sku.upper(): prod for prod in db.query(Product).all()}

        d_from_str = date_from.strftime("%d/%m/%Y") if date_from else "01/10/2026"
        d_to_str = date_to.strftime("%d/%m/%Y") if date_to else datetime.utcnow().strftime("%d/%m/%Y")
        title_str = f"HSN WISE PURCHASE REPORT From {d_from_str} to {d_to_str}"

        data_rows: List[List[Any]] = []
        sno = 0
        grand_qty = 0
        grand_gross = 0.0
        grand_net = 0.0

        for p in purchases:
            items = p.items or []
            if not items:
                continue

            bill_no = p.invoice_number or f"PUR-{p.id}"
            p_date = p.date or p.created_at
            bill_date = p_date.strftime("%d/%m/%Y") if p_date else ""
            vendor = p.vendor
            party_name = vendor.name if vendor else (p.vendor_name or "Vendor A/C")
            gst_no = vendor.gst_number if vendor and vendor.gst_number else ""
            gst_state = deduce_state_from_gstin(gst_no, "Chandigarh")

            for it in items:
                sno += 1
                prod = prod_map.get(it.product_sku.upper()) if it.product_sku else None
                item_code = it.product_sku
                item_name = it.description or (prod.name if prod else it.product_sku)
                hsn_code = it.hsn or (prod.hsn if prod else "") or ""
                pack_size = prod.unit if prod else (getattr(it, "unit", "") or "PCS")
                qty = float(it.qty or 0)
                rate_unit = float(it.unit_cost or 0)
                gross_amt = round(qty * rate_unit, 2)
                gst_rate = float(it.gst_pct or (prod.default_gst_rate if prod else 18.0) or 0)

                is_interstate = (gst_no and not gst_no.startswith("04")) or (gst_state.lower() != "chandigarh")
                tax_region = "IGST" if is_interstate else "CGST/SGST"

                tax_amount = round(gross_amt * (gst_rate / 100.0), 2)
                net_amt = round(float(it.line_total or (gross_amt + tax_amount)), 2)
                company_name = (prod.brand if (prod and getattr(prod, 'brand', None)) else "GENERAL") or "GENERAL"
                hsn_desc = prod.category if prod and prod.category else "Other"

                row = [
                    sno,                                       # 0: SNO.
                    bill_no,                                   # 1: BILL NO.
                    bill_date,                                 # 2: BILL DATE
                    party_name,                                # 3: PARTY NAME
                    company_name,                              # 4: COMPANY NAME
                    item_code,                                 # 5: ITEM CODE
                    item_name,                                 # 6: ITEM NAME
                    pack_size,                                 # 7: PACK / SIZE
                    "1",                                       # 8: LOT NUMBER
                    qty,                                       # 9: TOTAL QUANTITY
                    gross_amt,                                 # 10: GROSS AMOUNT
                    net_amt,                                   # 11: NET AMOUNT
                    tax_region,                                # 12: TAX REGION
                    gst_rate,                                  # 13: TAX-1(%)
                    hsn_code,                                  # 14: HSN CODE
                    hsn_desc                                   # 15: HSN DESCRIPTION
                ]
                data_rows.append(row)

                grand_qty += qty
                grand_gross += gross_amt
                grand_net += net_amt

        if sno > 0:
            grand_total_row = [
                "", "", "", "", "", "", "", "", "",
                grand_qty,
                round(grand_gross, 2),
                round(grand_net, 2),
                "", "", "", ""
            ]
            data_rows.append(grand_total_row)

        timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename_base = f"HSN_Wise_Purchases_{timestamp_str}"

        return SeriesReportService._export_hsn_purchase_dataset(
            db=db,
            company_id=company_id,
            data_rows=data_rows,
            title_str=title_str,
            filename_base=filename_base,
            sheet_title="Report",
            report_type_label="HSN Wise Purchase Report",
            file_format=file_format
        )

    @staticmethod
    def generate_inventory_register(
        db: Session,
        company_id: Optional[int] = None,
        search: Optional[str] = None,
        date_from: Optional[Union[date, str]] = None,
        date_to: Optional[Union[date, str]] = None,
        file_format: str = "excel"
    ) -> Tuple[Union[str, bytes], str, str, int]:
        """
        Generates the 21-Column Closing Stock / Inventory Register matching media_1793182489464_3f43db89.xlsx.
        """
        date_from = parse_date_param(date_from)
        date_to = parse_date_param(date_to)

        prod_query = db.query(Product)
        if company_id:
            prod_query = prod_query.filter(Product.company_id == company_id)
        if search and isinstance(search, str) and search.strip():
            s_val = search.strip()
            prod_query = prod_query.filter(
                or_(
                    Product.sku.ilike(f"%{s_val}%"),
                    Product.name.ilike(f"%{s_val}%")
                )
            )

        products = prod_query.order_by(Product.sku.asc()).all()
        prod_ids = [p.id for p in products]

        inv_sums = dict(
            db.query(Inventory.product_id, func.sum(Inventory.current_qty))
            .filter(Inventory.product_id.in_(prod_ids) if prod_ids else False)
            .group_by(Inventory.product_id)
            .all()
        )

        data_rows: List[List[Any]] = []
        sno = 0
        grand_closing_stock = 0.0
        grand_opening_stock = 0.0
        grand_closing_val = 0.0

        for p in products:
            sno += 1
            company_name = getattr(p, "brand", None) or "(NIL)"
            sku = p.sku
            name = p.name
            pack_size = p.unit or ""
            closing_stock = float(inv_sums.get(p.id, 0) or 0)
            opening_stock = closing_stock
            hsn = p.hsn or ""
            gst_rate = float(p.default_gst_rate or 18.0)
            gst_tax = f"GST {int(gst_rate) if gst_rate.is_integer() else gst_rate}%"
            pur_rate = float(p.item_rate or 0.0)
            closing_val = round(closing_stock * pur_rate, 2)

            row = [
                sno,                                           # 0: SNO.
                company_name,                                  # 1: COMPANY NAME
                sku,                                           # 2: ITEM CODE
                name,                                          # 3: ITEM NAME
                pack_size,                                     # 4: PACK/SIZE
                closing_stock,                                 # 5: CLOSING STOCK
                opening_stock,                                 # 6: OPENING STOCK-1
                "",                                            # 7: PURCHASE-1
                "",                                            # 8: PUR FREE QTY
                "",                                            # 9: PUR.RETURN-1
                "",                                            # 10: RECEIPTS-1
                "",                                            # 11: SALE-1
                "",                                            # 12: SALE FREE QTY
                "",                                            # 13: SALE RETURN-1
                "",                                            # 14: SR FREE QTY
                "",                                            # 15: NET SALE-1
                "",                                            # 16: NET SALE VALUE-1
                "",                                            # 17: ISSUES-1
                hsn,                                           # 18: GROUP9
                gst_tax,                                       # 19: GST TAX
                closing_val                                    # 20: CLOSING VALUE(PUR RATE)
            ]
            data_rows.append(row)

            grand_closing_stock += closing_stock
            grand_opening_stock += opening_stock
            grand_closing_val += closing_val

        if sno > 0:
            grand_row = [
                "",                                            # 0: SNO.
                "GRAND TOTALS",                                # 1: COMPANY NAME
                "", "", "",                                    # 2-4: (empty)
                grand_closing_stock,                           # 5: CLOSING STOCK
                grand_opening_stock,                           # 6: OPENING STOCK-1
                "", "", "", "", "", "", "", "", "", "", "",    # 7-17: (empty)
                "", "",                                        # 18-19: (empty)
                round(grand_closing_val, 2)                    # 20: CLOSING VALUE(PUR RATE)
            ]
            data_rows.append(grand_row)

        timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename_base = f"Inventory_Register_{timestamp_str}"

        return SeriesReportService._export_inventory_register_dataset(
            db=db,
            company_id=company_id,
            data_rows=data_rows,
            filename_base=filename_base,
            sheet_title="Report",
            report_type_label="Closing Stock Register",
            file_format=file_format
        )

    @staticmethod
    def _export_sales_return_dataset(
        db: Session,
        company_id: Optional[int],
        data_rows: List[List[Any]],
        title_str: str,
        filename_base: str,
        sheet_title: str = "Sales_Returns",
        report_type_label: str = "Sales Returns",
        file_format: str = "excel"
    ) -> Tuple[Union[str, bytes], str, str, int]:
        """
        Shared exporter converting 35-column sales return data rows into CSV or styled Excel (.xlsx).
        Matches exact layout of SALE RETURN FORMAT.xlsx.
        """
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter

        num_cols = len(ACCOUNTANT_SALES_RETURN_COLUMNS)
        sales_return_amount_cols = {12, 15, 16, 21, 22, 24, 25, 26}
        if file_format.lower() == "csv":
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow([""] * num_cols)
            writer.writerow([title_str] * num_cols)
            writer.writerow(ACCOUNTANT_SALES_RETURN_COLUMNS)
            for r in data_rows:
                formatted_r = list(r)
                for idx in range(len(formatted_r)):
                    c_idx = idx + 1
                    val = formatted_r[idx]
                    if val is not None and val != "":
                        if c_idx in sales_return_amount_cols:
                            try:
                                formatted_r[idx] = f"{round(float(val), 2):.2f}"
                            except (ValueError, TypeError):
                                pass
                        elif isinstance(val, float):
                            formatted_r[idx] = f"{round(val, 2):.2f}"
                writer.writerow(formatted_r)
            content = output.getvalue()
            filename = f"{filename_base}.csv"
            media_type = "text/csv"
            filepath = os.path.join(REPORTS_DIR, filename)
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            if company_id:
                rep_hist = ReportHistory(
                    company_id=company_id,
                    report_type=report_type_label,
                    file_path=filepath,
                    download_link=f"/api/reports/download/{filename}"
                )
                db.add(rep_hist)
                db.commit()
            return content, filename, media_type, len(data_rows)

        # Excel (.xlsx) formatting matching SALE RETURN FORMAT.xlsx
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = sheet_title[:31]

        # Row 1: empty row
        ws.append([""] * num_cols)

        # Row 2: Title row
        ws.append([title_str] * num_cols)
        ws.row_dimensions[2].height = 20
        title_font = Font(name="Tahoma", size=10, bold=False, color="000000")
        for c in range(1, num_cols + 1):
            cell = ws.cell(row=2, column=c)
            cell.font = title_font

        # Row 3: Header Row (Courier New 8pt bold, fill #F0F0F0)
        ws.append(ACCOUNTANT_SALES_RETURN_COLUMNS)
        ws.row_dimensions[3].height = 22
        header_fill = PatternFill(start_color="FFF0F0F0", end_color="FFF0F0F0", fill_type="solid")
        header_font = Font(name="Courier New", size=8, bold=True, color="000000")
        thin_border = Border(
            left=Side(style="thin", color="D1D5DB"),
            right=Side(style="thin", color="D1D5DB"),
            top=Side(style="thin", color="D1D5DB"),
            bottom=Side(style="thin", color="D1D5DB")
        )
        for c in range(1, num_cols + 1):
            cell = ws.cell(row=3, column=c)
            cell.fill = header_fill
            cell.font = header_font
            cell.border = thin_border
            cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

        # Styles for data, subtotals, and grand totals
        data_font = Font(name="Tahoma", size=10, color="000000")
        subtotal_font = Font(name="Tahoma", size=10, bold=True, color="0000FF")
        subtotal_fill = PatternFill(start_color="FFDEFEF0", end_color="FFDEFEF0", fill_type="solid")
        grand_font = Font(name="Tahoma", size=10, bold=True, color="FFFFFF00")
        grand_fill = PatternFill(start_color="FF0000FF", end_color="FF0000FF", fill_type="solid")

        col_widths = {c: len(str(ACCOUNTANT_SALES_RETURN_COLUMNS[c-1])) for c in range(1, num_cols + 1)}
        current_row_idx = 4

        for r in data_rows:
            ws.append(r)
            is_subtotal = (len(r) > 1 and str(r[1]).strip() == "BILL NO. WISE TOTALS")
            is_grand = (len(r) > 1 and str(r[1]).strip() == "GRAND TOTALS")

            for c_idx in range(1, min(len(r) + 1, num_cols + 1)):
                cell = ws.cell(row=current_row_idx, column=c_idx)
                cell.border = thin_border

                if is_grand:
                    cell.font = grand_font
                    cell.fill = grand_fill
                elif is_subtotal:
                    cell.font = subtotal_font
                    cell.fill = subtotal_fill
                else:
                    cell.font = data_font

                # Numeric right-alignment: Col 12, 14, 15, 16, 21, 22, 24, 25, 26
                if c_idx in (12, 14, 15, 16, 21, 22, 24, 25, 26):
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                else:
                    cell.alignment = Alignment(horizontal="left", vertical="center")

                if c_idx in sales_return_amount_cols and cell.value is not None and cell.value != "":
                    try:
                        fval = float(cell.value)
                        cell.value = round(fval, 2)
                        cell.number_format = "0.00"
                    except (ValueError, TypeError):
                        pass
                elif c_idx == 14 and cell.value is not None and cell.value != "":
                    try:
                        fval = float(cell.value)
                        if fval.is_integer():
                            cell.value = int(fval)
                            cell.number_format = "0"
                        else:
                            cell.value = round(fval, 2)
                            cell.number_format = "0.00"
                    except (ValueError, TypeError):
                        pass

                val_len = len(str(r[c_idx-1] or ""))
                if val_len > col_widths.get(c_idx, 0):
                    col_widths[c_idx] = val_len

            current_row_idx += 1

        for col_idx, width in col_widths.items():
            col_letter = get_column_letter(col_idx)
            ws.column_dimensions[col_letter].width = min(max(width + 3, 10), 55)

        ws.freeze_panes = "A4"

        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        content_bytes = out.getvalue()
        filename = f"{filename_base}.xlsx"

        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filepath = os.path.join(REPORTS_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(content_bytes)
        if company_id:
            rep_hist = ReportHistory(
                company_id=company_id,
                report_type=report_type_label,
                file_path=filepath,
                download_link=f"/api/reports/download/{filename}"
            )
            db.add(rep_hist)
            db.commit()
        return content_bytes, filename, media_type, len(data_rows)

    @staticmethod
    def generate_accountant_sales_returns_report(
        db: Session,
        company_id: Optional[int] = None,
        date_from: Optional[Union[date, str]] = None,
        date_to: Optional[Union[date, str]] = None,
        returns_filter: str = "all",
        file_format: str = "excel"
    ) -> Tuple[Union[str, bytes], str, str, int]:
        """
        Generates the unified 35-column Sales Return Register for Accountant matching SALE RETURN FORMAT.xlsx.
        Combines POS Billing Returns (SR-xx) and Amazon Returns (GGSR-xx) with BILL NO. WISE TOTALS and GRAND TOTALS.
        Works seamlessly for JSPL (Company 3) and BKR (Company 2).
        """
        date_from = parse_date_param(date_from)
        date_to = parse_date_param(date_to)
        d_from_str = date_from.strftime("%d/%m/%Y") if date_from else "01/10/2026"
        d_to_str = date_to.strftime("%d/%m/%Y") if date_to else datetime.utcnow().strftime("%d/%m/%Y")
        title_str = f"SALE REPORT FOR ACCOUNTANT From {d_from_str} to {d_to_str}"

        # State GST code mapping
        STATE_CODES = {
            "JAMMU AND KASHMIR": ("Jammu and Kashmir", "01"),
            "HIMACHAL PRADESH": ("Himachal Pradesh", "02"),
            "PUNJAB": ("Punjab", "03"),
            "CHANDIGARH": ("Chandigarh", "04"),
            "UTTARAKHAND": ("Uttarakhand", "05"),
            "HARYANA": ("Haryana", "06"),
            "DELHI": ("Delhi", "07"),
            "RAJASTHAN": ("Rajasthan", "08"),
            "UTTAR PRADESH": ("Uttar Pradesh", "09"),
            "BIHAR": ("Bihar", "10"),
            "SIKKIM": ("Sikkim", "11"),
            "ARUNACHAL PRADESH": ("Arunachal Pradesh", "12"),
            "NAGALAND": ("Nagaland", "13"),
            "MANIPUR": ("Manipur", "14"),
            "MIZORAM": ("Mizoram", "15"),
            "TRIPURA": ("Tripura", "16"),
            "MEGHALAYA": ("Meghalaya", "17"),
            "ASSAM": ("Assam", "18"),
            "WEST BENGAL": ("West Bengal", "19"),
            "JHARKHAND": ("Jharkhand", "20"),
            "ODISHA": ("Odisha", "21"),
            "CHHATTISGARH": ("Chhattisgarh", "22"),
            "MADHYA PRADESH": ("Madhya Pradesh", "23"),
            "GUJARAT": ("Gujarat", "24"),
            "DADRA AND NAGAR HAVELI AND DAMAN AND DIU": ("Dadra and Nagar Haveli", "26"),
            "MAHARASHTRA": ("Maharashtra", "27"),
            "ANDHRA PRADESH": ("Andhra Pradesh", "28"),
            "KARNATAKA": ("Karnataka", "29"),
            "GOA": ("Goa", "30"),
            "LAKSHADWEEP": ("Lakshadweep", "31"),
            "KERALA": ("Kerala", "32"),
            "TAMIL NADU": ("Tamil Nadu", "33"),
            "PUDUCHERRY": ("Puducherry", "34"),
            "ANDAMAN AND NICOBAR ISLANDS": ("Andaman and Nicobar Island", "35"),
            "ANDAMAN AND NICOBAR ISLAND": ("Andaman and Nicobar Island", "35"),
            "TELANGANA": ("Telangana", "36"),
            "LADAKH": ("Ladakh", "38"),
        }

        def get_state_info(raw_state: Optional[str]) -> Tuple[str, str]:
            if not raw_state:
                return "Chandigarh", "04"
            clean = raw_state.strip().upper()
            if clean in STATE_CODES:
                return STATE_CODES[clean]
            for k, (sname, scode) in STATE_CODES.items():
                if k in clean or clean in k:
                    return sname, scode
            return raw_state.strip().title(), "00"

        # Pre-cache catalog products
        all_prods = db.query(Product).all()
        prod_map = {p.sku.upper(): p for p in all_prods if p.sku}

        data_rows: List[List[Any]] = []
        sno = 0
        grand_tax = 0.0
        grand_qty = 0
        grand_gross = 0.0
        grand_net = 0.0

        include_pos = returns_filter in ("all", "pos", "billing")
        include_amazon = returns_filter in ("all", "amazon")

        # 1. POS SALES RETURNS
        if include_pos:
            pos_q = db.query(SalesReturn)
            if company_id:
                pos_q = pos_q.filter(SalesReturn.company_id == company_id)
            if date_from:
                pos_q = pos_q.filter(func.coalesce(SalesReturn.return_date, SalesReturn.created_at) >= datetime.combine(date_from, datetime.min.time()))
            if date_to:
                pos_q = pos_q.filter(func.coalesce(SalesReturn.return_date, SalesReturn.created_at) <= datetime.combine(date_to, datetime.max.time()))

            pos_q = pos_q.options(
                selectinload(SalesReturn.items).selectinload(SalesReturnItem.product),
                selectinload(SalesReturn.sale)
            )
            pos_returns = pos_q.order_by(func.coalesce(SalesReturn.return_date, SalesReturn.created_at).asc(), SalesReturn.id.asc()).all()

            for ret in pos_returns:
                items = ret.items or []
                if not items:
                    continue

                bill_no = ret.return_number or f"SR-{ret.id}"
                r_date = ret.return_date or ret.created_at
                bill_date = r_date.strftime("%d/%m/%Y") if r_date else ""
                party_name = (ret.customer_name or "Retail Customer A/C").ljust(70)
                original_bill = ret.sale.bill_number if (ret.sale and ret.sale.bill_number) else (f"JGST-{ret.sale_id}" if ret.sale_id else "")

                # State
                sale_state = ret.sale.customer_state if (ret.sale and ret.sale.customer_state) else "Chandigarh"
                gst_state_name, gst_state_code = get_state_info(sale_state)
                gst_no = (ret.sale.customer_gstin if (ret.sale and ret.sale.customer_gstin) else "") or " "

                b_tax = 0.0
                b_qty = 0
                b_gross = 0.0
                b_net = 0.0

                for it in items:
                    sno += 1
                    item_code = it.sku_snapshot or ""
                    prod = prod_map.get(item_code.upper())
                    item_name = it.product_name_snapshot or (prod.name if prod else item_code)
                    pack_size = it.unit_snapshot or (prod.unit if prod else "PCS")
                    qty = it.returned_quantity or 1
                    rate_unit = float(it.unit_price or 0.0)
                    gross_amt = round(qty * rate_unit, 2)
                    gst_rate = float(it.tax_rate or (prod.default_gst_rate if prod else 18.0) or 18.0)
                    tax_amt = round(gross_amt * (gst_rate / 100.0), 2)
                    net_amt = round(float(it.total_price or (gross_amt + tax_amt)), 2)
                    hsn_code = it.hsn_snapshot or (prod.hsn if prod else "84248200")
                    hsn_desc = prod.category if prod and prod.category else "Agricultural or horticultural"

                    # Format row in exact 35 columns
                    row = [
                        sno,                                            # 0: SNO.
                        bill_no,                                        # 1: BILL NO.
                        bill_date,                                      # 2: BILL DATE
                        item_name,                                      # 3: ITEM NAME
                        item_code,                                      # 4: ITEM CODE
                        None,                                           # 5: ADJUST/ITEM
                        party_name,                                     # 6: PARTY NAME
                        gst_no,                                         # 7: GST NO.
                        gst_state_name,                                 # 8: GST STATE NAME
                        gst_state_code,                                 # 9: GST STATE CODE
                        pack_size,                                      # 10: PACK / SIZE
                        -abs(tax_amt),                                  # 11: TAX (RS)
                        "1",                                            # 12: LOT NUMBER
                        -abs(qty),                                      # 13: TOTAL QUANTITY
                        round(rate_unit, 2),                            # 14: RATE/UNIT
                        -abs(gross_amt),                                # 15: GROSS AMOUNT
                        None,                                           # 16: CD(%)
                        None,                                           # 17: FREIGHT
                        None,                                           # 18: ADJUSTMENT
                        None,                                           # 19: ADJUST/UNIT
                        gst_rate,                                       # 20: TAX (%)
                        -abs(net_amt),                                  # 21: NET AMOUNT
                        None,                                           # 22: CD VALUE
                        -abs(gross_amt),                                # 23: AMOUNT W/O TAX
                        -abs(net_amt),                                  # 24: CREDIT
                        None,                                           # 25: CASH
                        None,                                           # 26: SCHEME(RS.)
                        original_bill,                                  # 27: REMARKS-1
                        ret.sale.customer_phone if ret.sale else None,  # 28: RCU MOBILE NO.
                        " ",                                            # 29: REMARKS-2
                        None,                                           # 30: RCU DISCOUNT CARD NO.
                        None,                                           # 31: RCU EMAIL ID
                        " ",                                            # 32: ORDER NO.
                        hsn_code,                                       # 33: HSN CODE
                        hsn_desc                                        # 34: HSN DESCRIPTION
                    ]
                    data_rows.append(row)

                    b_tax += tax_amt
                    b_qty += qty
                    b_gross += gross_amt
                    b_net += net_amt

                # Subtotal row for this bill
                subtotal_row = [
                    None,                                           # 0: SNO.
                    "BILL NO. WISE TOTALS",                         # 1: BILL NO.
                    None, None, None, None, None, None, None, None, None, # 2-10
                    -round(b_tax, 2),                               # 11: TAX (RS)
                    None,                                           # 12: LOT NUMBER
                    -b_qty,                                         # 13: TOTAL QUANTITY
                    None,                                           # 14: RATE/UNIT
                    -round(b_gross, 2),                             # 15: GROSS AMOUNT
                    None, None, None, None, None,                   # 16-20
                    -round(b_net, 2),                               # 21: NET AMOUNT
                    None,                                           # 22: CD VALUE
                    -round(b_gross, 2),                             # 23: AMOUNT W/O TAX
                    -round(b_net, 2),                               # 24: CREDIT
                    None, None, None, None, None, None, None, None, None, None # 25-34
                ]
                data_rows.append(subtotal_row)

                grand_tax += b_tax
                grand_qty += b_qty
                grand_gross += b_gross
                grand_net += b_net

        # 2. AMAZON RETURNS
        if include_amazon:
            # Query returned allocations or amazon returns
            alloc_date_col = func.coalesce(
                AmazonLiveAllocation.shipment_date,
                AmazonLiveAllocation.invoice_date,
                AmazonLiveAllocation.order_date,
                AmazonLiveAllocation.created_at
            )
            amz_q = db.query(AmazonLiveAllocation).filter(
                AmazonLiveAllocation.status == AllocationStatus.RETURNED,
                AmazonLiveAllocation.invoice_number.isnot(None),
                AmazonLiveAllocation.invoice_number != ""
            )
            if company_id:
                amz_q = amz_q.filter(AmazonLiveAllocation.company_id == company_id)
            if date_from:
                amz_q = amz_q.filter(alloc_date_col >= datetime.combine(date_from, datetime.min.time()))
            if date_to:
                amz_q = amz_q.filter(alloc_date_col <= datetime.combine(date_to, datetime.max.time()))

            amz_returns = amz_q.order_by(alloc_date_col.asc(), AmazonLiveAllocation.id.asc()).all()

            # Sequence counter for GGSR numbers
            ggsr_counter = 240

            for alloc in amz_returns:
                sno += 1
                ggsr_counter += 1
                bill_no = f"GGSR-{ggsr_counter}"

                r_dt = alloc.shipment_date or alloc.invoice_date or alloc.order_date or alloc.created_at
                bill_date = r_dt.strftime("%d/%m/%Y") if r_dt else ""

                state_raw = alloc.state_name or "Haryana"
                gst_state_name, gst_state_code = get_state_info(state_raw)
                state_abbr = (gst_state_name[:3] if len(gst_state_name) >= 3 else "HRY").upper()
                if gst_state_name.upper() == "HARYANA":
                    state_abbr = "HRY"
                elif gst_state_name.upper() == "UTTARAKHAND":
                    state_abbr = "UT"
                elif gst_state_name.upper() == "RAJASTHAN":
                    state_abbr = "RJ"
                elif gst_state_name.upper() == "TAMIL NADU":
                    state_abbr = "TN"
                elif gst_state_name.upper() == "ARUNACHAL PRADESH":
                    state_abbr = "AR"
                elif gst_state_name.upper() == "SIKKIM":
                    state_abbr = "SK"
                elif "ANDAMAN" in gst_state_name.upper():
                    state_abbr = "AN"

                party_name = f"AMAZON SELLER PORTAL CUSTOMER ({state_abbr})".ljust(70)
                original_inv = alloc.invoice_number or ""

                item_code = alloc.sku or ""
                prod = prod_map.get(item_code.upper())
                item_name = prod.name if prod else item_code
                pack_size = prod.unit if (prod and prod.unit) else (prod.brand if (prod and prod.brand) else "PCS")
                qty = alloc.allocated_qty or alloc.reconciled_qty or 1

                net_amt = float(alloc.net_amount or 0.0)
                gross_amt = float(alloc.gross_amount or 0.0)
                tax_amt = float(alloc.tax_amount or 0.0)

                gst_rate = float(prod.default_gst_rate or 18.0) if prod else 18.0
                if gross_amt > 0 and tax_amt > 0:
                    calculated_rate = round((tax_amt / gross_amt) * 100)
                    if calculated_rate in (5, 12, 18, 28):
                        gst_rate = calculated_rate

                if gross_amt == 0.0 and net_amt > 0.0:
                    gross_amt = round(net_amt / (1 + (gst_rate / 100.0)), 2)
                    tax_amt = round(net_amt - gross_amt, 2)
                elif net_amt == 0.0 and gross_amt > 0.0:
                    tax_amt = round(gross_amt * (gst_rate / 100.0), 2)
                    net_amt = round(gross_amt + tax_amt, 2)

                rate_unit = round(gross_amt / qty, 2) if qty > 0 else gross_amt
                hsn_code = alloc.hsn_code or (prod.hsn if prod else "84248200")
                hsn_desc = prod.category if prod and prod.category else "Agricultural or horticultural"

                row = [
                    sno,                                            # 0: SNO.
                    bill_no,                                        # 1: BILL NO.
                    bill_date,                                      # 2: BILL DATE
                    item_name,                                      # 3: ITEM NAME
                    item_code,                                      # 4: ITEM CODE
                    None,                                           # 5: ADJUST/ITEM
                    party_name,                                     # 6: PARTY NAME
                    alloc.customer_gstin or " ",                    # 7: GST NO.
                    gst_state_name,                                 # 8: GST STATE NAME
                    gst_state_code,                                 # 9: GST STATE CODE
                    pack_size,                                      # 10: PACK / SIZE
                    -abs(tax_amt),                                  # 11: TAX (RS)
                    "1",                                            # 12: LOT NUMBER
                    -abs(qty),                                      # 13: TOTAL QUANTITY
                    round(rate_unit, 2),                            # 14: RATE/UNIT
                    -abs(gross_amt),                                # 15: GROSS AMOUNT
                    None,                                           # 16: CD(%)
                    None,                                           # 17: FREIGHT
                    None,                                           # 18: ADJUSTMENT
                    None,                                           # 19: ADJUST/UNIT
                    gst_rate,                                       # 20: TAX (%)
                    -abs(net_amt),                                  # 21: NET AMOUNT
                    None,                                           # 22: CD VALUE
                    -abs(gross_amt),                                # 23: AMOUNT W/O TAX
                    -abs(net_amt),                                  # 24: CREDIT
                    None,                                           # 25: CASH
                    None,                                           # 26: SCHEME(RS.)
                    original_inv,                                   # 27: REMARKS-1
                    None,                                           # 28: RCU MOBILE NO.
                    " ",                                            # 29: REMARKS-2
                    None,                                           # 30: RCU DISCOUNT CARD NO.
                    None,                                           # 31: RCU EMAIL ID
                    " ",                                            # 32: ORDER NO.
                    hsn_code,                                       # 33: HSN CODE
                    hsn_desc                                        # 34: HSN DESCRIPTION
                ]
                data_rows.append(row)

                # Subtotal row for this return
                subtotal_row = [
                    None,                                           # 0: SNO.
                    "BILL NO. WISE TOTALS",                         # 1: BILL NO.
                    None, None, None, None, None, None, None, None, None, # 2-10
                    -round(tax_amt, 2),                             # 11: TAX (RS)
                    None,                                           # 12: LOT NUMBER
                    -qty,                                           # 13: TOTAL QUANTITY
                    None,                                           # 14: RATE/UNIT
                    -round(gross_amt, 2),                           # 15: GROSS AMOUNT
                    None, None, None, None, None,                   # 16-20
                    -round(net_amt, 2),                             # 21: NET AMOUNT
                    None,                                           # 22: CD VALUE
                    -round(gross_amt, 2),                           # 23: AMOUNT W/O TAX
                    -round(net_amt, 2),                             # 24: CREDIT
                    None, None, None, None, None, None, None, None, None, None # 25-34
                ]
                data_rows.append(subtotal_row)

                grand_tax += tax_amt
                grand_qty += qty
                grand_gross += gross_amt
                grand_net += net_amt

        # Grand Totals Row
        if sno > 0:
            grand_total_row = [
                None,                                           # 0: SNO.
                "GRAND TOTALS",                                 # 1: BILL NO.
                None, None, None, None, None, None, None, None, None, # 2-10
                -round(grand_tax, 2),                           # 11: TAX (RS)
                None,                                           # 12: LOT NUMBER
                -grand_qty,                                     # 13: TOTAL QUANTITY
                None,                                           # 14: RATE/UNIT
                -round(grand_gross, 2),                         # 15: GROSS AMOUNT
                None, None, None, None, None,                   # 16-20
                -round(grand_net, 2),                           # 21: NET AMOUNT
                None,                                           # 22: CD VALUE
                -round(grand_gross, 2),                         # 23: AMOUNT W/O TAX
                -round(grand_net, 2),                           # 24: CREDIT
                None, None, None, None, None, None, None, None, None, None # 25-34
            ]
            data_rows.append(grand_total_row)

        timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        comp_label = "JSPL" if company_id == 3 else ("BKR" if company_id == 2 else "All")
        filename_base = f"Sales_Returns_{comp_label}_{timestamp_str}"

        return SeriesReportService._export_sales_return_dataset(
            db=db,
            company_id=company_id,
            data_rows=data_rows,
            title_str=title_str,
            filename_base=filename_base,
            sheet_title="Sales_Returns",
            report_type_label=f"Accountant Sales Returns ({comp_label})",
            file_format=file_format
        )

    @staticmethod
    def generate_amazon_returns_report(
        db: Session,
        company_id: Optional[int] = None,
        date_from: Optional[Union[date, str]] = None,
        date_to: Optional[Union[date, str]] = None,
        file_format: str = "excel"
    ) -> Tuple[Union[str, bytes], str, str, int]:
        """
        Generates Amazon Returns in the exact 35-column format matching SALE RETURN FORMAT.xlsx.
        """
        return SeriesReportService.generate_accountant_sales_returns_report(
            db=db,
            company_id=company_id,
            date_from=date_from,
            date_to=date_to,
            returns_filter="amazon",
            file_format=file_format
        )

    @staticmethod
    def generate_sales_returns_report(
        db: Session,
        company_id: Optional[int] = None,
        date_from: Optional[Union[date, str]] = None,
        date_to: Optional[Union[date, str]] = None,
        file_format: str = "excel"
    ) -> Tuple[Union[str, bytes], str, str, int]:
        """
        Generates Sales Returns (POS billing + Amazon returns) in the exact 35-column format matching SALE RETURN FORMAT.xlsx.
        """
        return SeriesReportService.generate_accountant_sales_returns_report(
            db=db,
            company_id=company_id,
            date_from=date_from,
            date_to=date_to,
            returns_filter="all",
            file_format=file_format
        )

    @staticmethod
    def generate_amazon_mtr_report(
        db: Session,
        company_id: Optional[int] = None,
        warehouse_code: Optional[str] = None,
        date_from: Optional[Union[date, str]] = None,
        date_to: Optional[Union[date, str]] = None,
        file_format: str = "excel"
    ) -> Tuple[Union[str, bytes], str, str, int]:
        """
        Generates the Amazon Merchant Tax Report (MTR) in the official 86-column Logic ERP format.
        Matches media_1792838959189_748ab04f.xlsx and B2C & B2B JSPL OCTOBER.xlsx uploaded by user.
        Includes all invoices: Shipments, Refunds (with Credit Notes), and Cancellations.
        """
        import openpyxl
        from openpyxl.utils import get_column_letter

        date_from = parse_date_param(date_from)
        date_to = parse_date_param(date_to)
        if date_from is None:
            now_dt = datetime.utcnow()
            date_from = date(now_dt.year, now_dt.month, 1)

        wh_clean = (warehouse_code or "").strip().upper()
        is_in_series = (wh_clean == "IN")
        alloc_date_col = get_allocation_date_expr(db, is_in_series)

        # Exclude zero-qty synthetic stubs while capturing Shipments, Refunds, and valid Cancellations
        alloc_query = db.query(AmazonLiveAllocation).filter(
            or_(
                AmazonLiveAllocation.allocated_qty > 0,
                AmazonLiveAllocation.reconciled_qty > 0,
            )
        )
        if company_id and wh_clean not in ("IN",):
            has_allocs = db.query(AmazonLiveAllocation.id).filter(AmazonLiveAllocation.company_id == company_id).first()
            if has_allocs:
                alloc_query = alloc_query.filter(AmazonLiveAllocation.company_id == company_id)

        matched_wh = None
        if wh_clean and wh_clean not in ("ALL", "AMAZON"):
            if wh_clean == "MFN":
                alloc_query = alloc_query.filter(AmazonLiveAllocation.amazon_network_at_allocation == AmazonNetworkType.MFN)
            elif wh_clean == "AFN":
                alloc_query = alloc_query.filter(AmazonLiveAllocation.amazon_network_at_allocation == AmazonNetworkType.AFN)
            elif wh_clean == "IN":
                alloc_query = alloc_query.filter(
                    or_(
                        AmazonLiveAllocation.warehouse_id == 38,
                        AmazonLiveAllocation.invoice_number.ilike("IN-%")
                    )
                )
            else:
                wh_q = db.query(Warehouse).filter(func.upper(Warehouse.code) == wh_clean, Warehouse.status == "ACTIVE")
                if company_id:
                    wh_cand = wh_q.filter(Warehouse.company_id == company_id).first()
                    matched_wh = wh_cand if wh_cand else wh_q.first()
                else:
                    matched_wh = wh_q.first()

                if matched_wh:
                    alloc_query = alloc_query.filter(
                        or_(
                            AmazonLiveAllocation.warehouse_id == matched_wh.id,
                            AmazonLiveAllocation.invoice_number.ilike(f"{wh_clean}-%")
                        )
                    )
                else:
                    alloc_query = alloc_query.filter(AmazonLiveAllocation.invoice_number.ilike(f"{wh_clean}-%"))

        if date_from:
            alloc_query = alloc_query.filter(alloc_date_col >= datetime.combine(date_from, datetime.min.time()))
        if date_to:
            alloc_query = alloc_query.filter(alloc_date_col <= datetime.combine(date_to, datetime.max.time()))

        sort_date_col = (
            func.coalesce(
                AmazonLiveAllocation.invoice_date,
                AmazonLiveAllocation.shipment_date,
                AmazonLiveAllocation.order_date,
            )
            if is_in_series
            else alloc_date_col
        )
        allocations = alloc_query.order_by(
            sort_date_col.asc(),
            AmazonLiveAllocation.invoice_number.asc(),
            AmazonLiveAllocation.id.asc()
        ).all()

        # Deduplicate duplicate cancellation/shipment rows per (order_id, sku, trans_type)
        dedup_allocs = []
        seen_mtr_keys: Dict[Tuple[str, str, str], int] = {}
        for a in allocations:
            a_st = (a.status.value if hasattr(a.status, "value") else str(a.status or "")).upper()
            if a_st == "CANCELLED" or "_CANCEL" in (a.amazon_line_item_id or "").upper():
                tt = "Cancel"
            elif a_st in ("RETURNED", "REFUNDED") or "-C-" in (a.invoice_number or "") or (a.invoice_number or "").startswith("CN-") or "_REF" in (a.amazon_line_item_id or "").upper():
                tt = "Refund"
            else:
                tt = "Shipment"
            key = ((a.order_id or "").strip(), (a.sku or "").strip().upper(), tt)
            if key not in seen_mtr_keys:
                seen_mtr_keys[key] = len(dedup_allocs)
                dedup_allocs.append(a)
            else:
                idx = seen_mtr_keys[key]
                prev = dedup_allocs[idx]
                if float(a.net_amount or 0) > float(prev.net_amount or 0) or (
                    "_CANCEL" in (prev.amazon_line_item_id or "") and "_CANCEL" not in (a.amazon_line_item_id or "")
                ):
                    dedup_allocs[idx] = a
        allocations = dedup_allocs

        # Cache reference lookups
        all_warehouses = db.query(Warehouse).all()
        wh_map = {w.id: w for w in all_warehouses}
        wh_code_map = {w.code.upper(): w for w in all_warehouses if w.code}

        all_products = db.query(Product).all()
        prod_map_by_company = {(p.company_id, p.sku.upper()): p for p in all_products if p.sku}
        prod_map_sku = {p.sku.upper(): p for p in all_products if p.sku}

        # Official GSTIN mapping for JSPL FC locations
        FC_GSTIN_MAP = {
            "AMD2": "24AAFCJ8215N1ZA",
            "BLR4": "29AAFCJ8215N1ZT",
            "BLR5": "29AAFCJ8215N1ZT",
            "BLR7": "29AAFCJ8215N1ZT",
            "BLR8": "29AAFCJ8215N1ZT",
            "BOM5": "27AAFCJ8215N1Z4",
            "BOM7": "27AAFCJ8215N1Z4",
            "DEL2": "07AAFCJ8215N1ZU",
            "DEL4": "07AAFCJ8215N1ZU",
            "DEL5": "07AAFCJ8215N1ZU",
            "HYD8": "36AAFCJ8215N1ZQ",
            "IN": "04AAFCJ8215N1ZC",
            "KWZ2": "19AAFCJ8215N1ZY",
            "MAA4": "33AAFCJ8215N1Z2",
            "MAA5": "33AAFCJ8215N1Z2",
            "PNQ3": "27AAFCJ8215N1Z4",
            "VSHB": "04AAFCJ8215N1ZC"
        }

        data_rows: List[List[Any]] = []

        for alloc in allocations:
            wh = wh_map.get(alloc.warehouse_id)
            if not wh and alloc.invoice_number and "-" in alloc.invoice_number:
                prefix = alloc.invoice_number.split("-")[0].upper()
                wh = wh_code_map.get(prefix)

            prod, base_prod = resolve_product_and_base(
                alloc.sku, alloc.company_id, prod_map_by_company, prod_map_sku
            )

            # Dates
            inv_dt = alloc.invoice_date or alloc.shipment_date or alloc.order_date or alloc.created_at
            ord_dt = alloc.order_date or alloc.created_at or inv_dt
            ship_dt = alloc.shipment_date or inv_dt

            # Determine transaction type
            alloc_status_str = (alloc.status.value if hasattr(alloc.status, "value") else str(alloc.status or "")).upper()
            is_returned = (alloc_status_str in ("RETURNED", "REFUNDED") or "-C-" in (alloc.invoice_number or "") or (alloc.invoice_number or "").startswith("CN-"))
            is_cancelled = (alloc_status_str == "CANCELLED")

            if is_cancelled:
                trans_type = "Cancel"
                invoice_num = None
            elif is_returned:
                trans_type = "Refund"
                invoice_num = alloc.invoice_number
            else:
                trans_type = "Shipment"
                invoice_num = alloc.invoice_number

            order_id = alloc.order_id or ""
            wh_prefix = (wh.code if wh else ("IN" if (alloc.invoice_number or "").startswith("IN-") else "VSHB"))
            shipment_id = f"A{alloc.id:09d}{wh_prefix}"
            shipment_item_id = int(alloc.amazon_line_item_id) if (alloc.amazon_line_item_id and alloc.amazon_line_item_id.isdigit()) else (575786880000 + alloc.id)
            qty = alloc.allocated_qty or alloc.reconciled_qty or 1
            alloc_sku_upper = (alloc.sku or "").strip().upper()
            prod_name_clean = (prod.name or "").strip() if prod else ""
            if prod_name_clean and prod_name_clean.upper() != alloc_sku_upper:
                item_desc = prod_name_clean
            elif base_prod and base_prod.name:
                item_desc = base_prod.name
            else:
                item_desc = prod_name_clean or (alloc.sku or "")
            asin = getattr(prod, "asin", None) or "B0DYNNSY96"
            hsn = (
                alloc.hsn_code
                or (prod.hsn if prod and prod.hsn else "")
                or ""
            )
            sku = alloc.sku or ""

            # FC GSTIN
            seller_gstin = FC_GSTIN_MAP.get(wh_prefix.upper(), "04AAFCJ8215N1ZC")

            # Ship-to State & Customer details
            is_b2b = bool(alloc.customer_gstin and len(alloc.customer_gstin.strip()) >= 15)
            buyer_gstin = alloc.customer_gstin.strip() if is_b2b else None
            bill_state_name, bill_state_code, _ = resolve_state_info(
                alloc.state_name or "CHANDIGARH", buyer_gstin, fallback_state="Chandigarh"
            )
            ship_state_name, ship_state_code, default_b2c_party = resolve_state_info(
                alloc.state_name or "CHANDIGARH",
                None if (alloc.state_name and alloc.state_name.strip()) else buyer_gstin,
                fallback_state="Chandigarh"
            )
            fallback_rate = (
                float(prod.default_gst_rate)
                if (prod and prod.default_gst_rate is not None)
                else (float(base_prod.default_gst_rate) if (base_prod and base_prod.default_gst_rate is not None) else 18.0)
            )
            tax_rate = fallback_rate

            # Amounts calculation
            if is_cancelled:
                invoice_amt = 0.0
                tax_exclusive_gross = 0.0
                total_tax_amt = 0.0
                cgst_amt = 0.0
                sgst_amt = 0.0
                igst_amt = 0.0
                tax_rate = 0.0
                credit_note_no = None
                credit_note_date = None
            else:
                raw_net = float(alloc.net_amount) if alloc.net_amount is not None else None
                raw_gross = float(alloc.gross_amount) if alloc.gross_amount is not None else None
                raw_tax = float(alloc.tax_amount) if alloc.tax_amount is not None else None

                if raw_gross is not None and raw_net is not None:
                    if raw_tax is None:
                        raw_tax = round(raw_net - raw_gross, 2)
                    tax_rate = derive_gst_rate(raw_gross, raw_tax, fallback_rate)
                elif raw_net is not None and raw_net != 0.0:
                    raw_gross = round(raw_net / (1 + (tax_rate / 100.0)), 2)
                    raw_tax = round(raw_net - raw_gross, 2)
                elif raw_gross is not None and raw_gross != 0.0:
                    raw_tax = round(raw_gross * (tax_rate / 100.0), 2)
                    raw_net = round(raw_gross + raw_tax, 2)
                else:
                    raw_gross = 0.0
                    raw_tax = 0.0
                    raw_net = 0.0
                    tax_rate = 0.0

                # Intrastate vs Interstate
                is_intra = (seller_gstin[:2] == bill_state_code)
                if abs(raw_tax) <= 0.005:
                    cgst_amt = 0.0
                    sgst_amt = 0.0
                    igst_amt = 0.0
                elif is_intra:
                    cgst_amt = round(raw_tax / 2.0, 2)
                    sgst_amt = round(raw_tax - cgst_amt, 2)
                    igst_amt = 0.0
                else:
                    cgst_amt = 0.0
                    sgst_amt = 0.0
                    igst_amt = round(raw_tax, 2)

                tax_exclusive_gross = round(raw_gross, 2)
                invoice_amt = round(raw_net, 2)
                total_tax_amt = round(raw_tax, 2)

                if is_returned:
                    qty = -abs(qty)
                    tax_exclusive_gross = -abs(tax_exclusive_gross)
                    total_tax_amt = -abs(total_tax_amt)
                    cgst_amt = -abs(cgst_amt)
                    sgst_amt = -abs(sgst_amt)
                    igst_amt = -abs(igst_amt)
                    invoice_amt = -abs(invoice_amt)
                    credit_note_no = f"CN-{alloc.id}"
                    credit_note_date = inv_dt
                else:
                    credit_note_no = None
                    credit_note_date = None

            cgst_rate = round(tax_rate / 2.0, 2) if (cgst_amt != 0.0) else 0.0
            sgst_rate = round(tax_rate / 2.0, 2) if (sgst_amt != 0.0) else 0.0
            igst_rate = tax_rate if (igst_amt != 0.0) else 0.0

            # 86-column official Logic ERP MTR Row
            row = [
                seller_gstin,           # 0: Seller Gstin
                invoice_num,            # 1: Invoice Number
                inv_dt,                 # 2: Invoice Date
                trans_type,             # 3: Transaction Type
                order_id,               # 4: Order Id
                shipment_id,            # 5: Shipment Id
                ship_dt if not is_cancelled else None, # 6: Shipment Date
                ord_dt if not is_cancelled else None,  # 7: Order Date
                shipment_item_id,       # 8: Shipment Item Id
                qty,                    # 9: Quantity
                item_desc,              # 10: Item Description
                asin,                   # 11: Asin
                hsn,                    # 12: Hsn/sac
                sku,                    # 13: Sku
                None,                   # 14: Item Serial No.
                "Amazon Seller Services Private Limited", # 15: Bill From Name
                "Bengaluru",            # 16: Bill From City
                "Karnataka",            # 17: Bill From State
                "560042",               # 18: Bill From Postal Code
                wh_prefix,              # 19: Ship From Name
                "Plot no: 150, Industrial & Business Park-2", # 20: Ship From Address
                "Chandigarh",           # 21: Ship From City
                "IN",                   # 22: Ship From Country
                seller_gstin,           # 23: Ship From Gstin
                "160002",               # 24: Ship From Postal Code
                "Chandigarh",           # 25: Ship From State
                (alloc.party_name or "").strip() or default_b2c_party, # 26: Ship To Name
                ship_state_name,        # 27: Ship To City
                "IN",                   # 28: Ship To Country
                invoice_amt,            # 29: Invoice Amount
                tax_exclusive_gross,    # 30: Tax Exclusive Gross
                total_tax_amt,          # 31: Total Tax Amount
                cgst_rate,              # 32: Cgst Rate
                cgst_amt,               # 33: Cgst Amount
                sgst_rate,              # 34: Sgst Rate
                sgst_amt,               # 35: Sgst Amount
                igst_rate,              # 36: Igst Rate
                igst_amt,               # 37: Igst Amount
                0.0,                    # 38: Utgst Rate
                0.0,                    # 39: Utgst Amount
                0.0,                    # 40: Cess Rate
                0.0,                    # 41: Cess Amount
                None,                   # 42: Warehouse Id
                bill_state_name,        # 43: Customer Bill To State
                ship_state_name,        # 44: Customer Ship To State
                buyer_gstin,            # 45: Buyer Gstin
                "IN",                   # 46: Place of Supply
                "Principal Place",      # 47: Ship From Place
                None,                   # 48: Shipping Partner
                None,                   # 49: Tracking Number
                None,                   # 50: Carrier Status
                None,                   # 51: Fulfillment Channel
                None,                   # 52: Sales Channel
                None,                   # 53: Ship Service Level
                None,                   # 54: Principal Amount
                None,                   # 55: Shipping Amount
                None,                   # 56: Gift Wrap Amount
                None,                   # 57: Item Promo Discount
                None,                   # 58: Shipment Promo Discount
                None,                   # 59: TCS CGST Rate
                None,                   # 60: TCS CGST Amount
                None,                   # 61: TCS SGST Rate
                None,                   # 62: TCS SGST Amount
                None,                   # 63: TCS IGST Rate
                None,                   # 64: TCS IGST Amount
                None,                   # 65: TCS UTGST Rate
                None,                   # 66: TCS UTGST Amount
                None,                   # 67: TCS Cess Rate
                None,                   # 68: TCS Cess Amount
                None,                   # 69: Shipping HSN
                None,                   # 70: Gift Wrap HSN
                None,                   # 71: Gift Wrap Tax Amount
                None,                   # 72: Shipping Tax Amount
                None,                   # 73: Shipping Discount
                None,                   # 74: Shipping Discount Tax Amount
                None,                   # 75: Gift Wrap Discount
                None,                   # 76: Gift Wrap Discount Tax Amount
                credit_note_no,         # 77: Credit Note No
                credit_note_date,       # 78: Credit Note Date
                None,                   # 79: Is B2B
                None,                   # 80: Reverse Charge
                None,                   # 81: E-Commerce Operator GSTIN
                None,                   # 82: E-Commerce Operator Name
                None,                   # 83: Original Invoice Number
                None,                   # 84: Original Invoice Date
                None                    # 85: Reason for Credit Note
            ]
            data_rows.append(row)

        timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        suffix = f"_{wh_clean}" if wh_clean and wh_clean != "ALL" else ""
        filename_base = f"Amazon_MTR_Report{suffix}_{timestamp_str}"

        # 86 Official MTR Headers
        MTR_HEADERS = [
            "Seller Gstin", "Invoice Number", "Invoice Date", "Transaction Type", "Order Id",
            "Shipment Id", "Shipment Date", "Order Date", "Shipment Item Id", "Quantity",
            "Item Description", "Asin", "Hsn/sac", "Sku", "Item Serial No.",
            "Bill From Name", "Bill From City", "Bill From State", "Bill From Postal Code",
            "Ship From Name", "Ship From Address", "Ship From City", "Ship From Country",
            "Ship From Gstin", "Ship From Postal Code", "Ship From State",
            "Ship To Name", "Ship To City", "Ship To Country", "Invoice Amount",
            "Tax Exclusive Gross", "Total Tax Amount", "Cgst Rate", "Cgst Amount",
            "Sgst Rate", "Sgst Amount", "Igst Rate", "Igst Amount", "Utgst Rate",
            "Utgst Amount", "Cess Rate", "Cess Amount", "Warehouse Id",
            "Customer Bill To State", "Customer Ship To State", "Buyer Gstin",
            "Place of Supply", "Ship From Place", "Shipping Partner", "Tracking Number",
            "Carrier Status", "Fulfillment Channel", "Sales Channel", "Ship Service Level",
            "Principal Amount", "Shipping Amount", "Gift Wrap Amount", "Item Promo Discount",
            "Shipment Promo Discount", "TCS CGST Rate", "TCS CGST Amount", "TCS SGST Rate",
            "TCS SGST Amount", "TCS IGST Rate", "TCS IGST Amount", "TCS UTGST Rate",
            "TCS UTGST Amount", "TCS Cess Rate", "TCS Cess Amount", "Shipping HSN",
            "Gift Wrap HSN", "Gift Wrap Tax Amount", "Shipping Tax Amount",
            "Shipping Discount", "Shipping Discount Tax Amount", "Gift Wrap Discount",
            "Gift Wrap Discount Tax Amount", "Credit Note No", "Credit Note Date",
            "Is B2B", "Reverse Charge", "E-Commerce Operator GSTIN",
            "E-Commerce Operator Name", "Original Invoice Number",
            "Original Invoice Date", "Reason for Credit Note"
        ]

        mtr_amount_cols = {30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 72, 73, 74, 75, 76, 77}
        if file_format.lower() == "csv":
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(MTR_HEADERS)
            for r in data_rows:
                formatted_r = list(r)
                for idx in range(len(formatted_r)):
                    c_idx = idx + 1
                    val = formatted_r[idx]
                    if val is not None and val != "":
                        if c_idx in mtr_amount_cols:
                            try:
                                formatted_r[idx] = f"{round(float(val), 2):.2f}"
                            except (ValueError, TypeError):
                                pass
                        elif isinstance(val, float):
                            formatted_r[idx] = f"{round(val, 2):.2f}"
                writer.writerow(formatted_r)
            content = output.getvalue()
            filename = f"{filename_base}.csv"
            media_type = "text/csv"
            filepath = os.path.join(REPORTS_DIR, filename)
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            if company_id:
                rep_hist = ReportHistory(
                    company_id=company_id,
                    report_type=f"Amazon MTR ({wh_clean or 'All'})",
                    file_path=filepath,
                    download_link=f"/api/reports/download/{filename}"
                )
                db.add(rep_hist)
                db.commit()
            return content, filename, media_type, len(data_rows)

        # Excel (.xlsx) formatting matching 456.xlsx and B2C & B2B JSPL OCTOBER.xlsx
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = (wh_clean or "MTR_Report")[:31]

        ws.append(MTR_HEADERS)
        for r in data_rows:
            ws.append(r)

        from openpyxl.styles import Alignment
        for row_idx in range(2, ws.max_row + 1):
            for c_idx in range(1, len(MTR_HEADERS) + 1):
                cell = ws.cell(row=row_idx, column=c_idx)
                if c_idx in mtr_amount_cols and cell.value is not None and cell.value != "":
                    try:
                        fval = float(cell.value)
                        cell.value = round(fval, 2)
                        cell.number_format = "0.00"
                        cell.alignment = Alignment(horizontal="right")
                    except (ValueError, TypeError):
                        pass
                elif c_idx == 10 and cell.value is not None and cell.value != "":
                    try:
                        fval = float(cell.value)
                        if fval.is_integer():
                            cell.value = int(fval)
                            cell.number_format = "0"
                        else:
                            cell.value = round(fval, 2)
                            cell.number_format = "0.00"
                        cell.alignment = Alignment(horizontal="right")
                    except (ValueError, TypeError):
                        pass

        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        content_bytes = out.getvalue()
        filename = f"{filename_base}.xlsx"

        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filepath = os.path.join(REPORTS_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(content_bytes)
        if company_id:
            rep_hist = ReportHistory(
                company_id=company_id,
                report_type=f"Amazon MTR ({wh_clean or 'All'})",
                file_path=filepath,
                download_link=f"/api/reports/download/{filename}"
            )
            db.add(rep_hist)
            db.commit()
        return content_bytes, filename, media_type, len(data_rows)

    @staticmethod
    def generate_accountant_report(
        db: Session,
        report_type: str = "sales",
        company_id: Optional[int] = None,
        series: str = "GST",
        vendor_id: Optional[int] = None,
        date_from: Optional[Union[date, str]] = None,
        date_to: Optional[Union[date, str]] = None,
        file_format: str = "csv"
    ) -> Tuple[Union[str, bytes], str, str, int]:
        """
        Master dispatcher generating the requested report category in the exact 47-column accountant format
        or official 86-column Amazon MTR format.
        """
        date_from = parse_date_param(date_from)
        date_to = parse_date_param(date_to)
        rt = (report_type or "sales").strip().lower()
        if rt in ("purchases", "purchase", "purchase_register"):
            return SeriesReportService.generate_purchase_report(
                db=db,
                company_id=company_id,
                vendor_id=vendor_id,
                date_from=date_from,
                date_to=date_to,
                file_format=file_format
            )
        elif rt in ("amazon_returns", "amazon-returns", "amazon_return"):
            return SeriesReportService.generate_amazon_returns_report(
                db=db,
                company_id=company_id,
                date_from=date_from,
                date_to=date_to,
                file_format=file_format
            )
        elif rt in ("sales_returns", "sales-returns", "pos_returns", "returns"):
            return SeriesReportService.generate_sales_returns_report(
                db=db,
                company_id=company_id,
                date_from=date_from,
                date_to=date_to,
                file_format=file_format
            )
        elif rt in ("amazon_mtr", "amazon-mtr", "mtr"):
            return SeriesReportService.generate_amazon_mtr_report(
                db=db,
                company_id=company_id,
                warehouse_code=series,
                date_from=date_from,
                date_to=date_to,
                file_format=file_format
            )
        elif rt in ("inventory", "stock", "closing_stock", "inventory_register"):
            return SeriesReportService.generate_inventory_register(
                db=db,
                company_id=company_id,
                file_format=file_format
            )
        else:
            return SeriesReportService.generate_series_sales_report(
                db=db,
                company_id=company_id,
                series=series,
                date_from=date_from,
                date_to=date_to,
                file_format=file_format
            )

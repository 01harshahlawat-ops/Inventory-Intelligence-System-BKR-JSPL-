import os
import io
import re
from datetime import datetime
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import dotenv_values
from typing import Dict, Any, Optional

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENV_PATH = os.path.join(BASE_DIR, ".env")
env_config = dotenv_values(ENV_PATH)
DATABASE_URL = env_config.get("DATABASE_URL") or "postgresql://postgres:postgres@localhost:5432/transformation_engine"


def clean_str(val):
    if pd.isna(val) or val is None:
        return None
    s = str(val).strip()
    return s if s and s.lower() not in ("nan", "none", "null") else None


def clean_int(val, default=1):
    try:
        if pd.isna(val) or val is None:
            return default
        return int(float(val))
    except (ValueError, TypeError):
        return default


def clean_float(val):
    try:
        if pd.isna(val) or val is None:
            return None
        return float(val)
    except (ValueError, TypeError):
        return None


def clean_dt(val):
    if pd.isna(val) or val is None:
        return None
    if isinstance(val, pd.Timestamp):
        return val.to_pydatetime().replace(microsecond=0)
    if isinstance(val, datetime):
        return val.replace(microsecond=0)
    try:
        s = str(val).strip()
        is_iso = bool(re.match(r"^\d{4}-\d{2}-\d{2}", s))
        dt = pd.to_datetime(s, dayfirst=not is_iso)
        if pd.isna(dt):
            return None
        return dt.to_pydatetime().replace(microsecond=0)
    except Exception:
        return None


def clean_hsn(val):
    if pd.isna(val) or val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ("nan", "none"):
        return None
    try:
        f = float(s)
        return str(int(f))
    except Exception:
        return s


def deduce_warehouse_id(inv_num, wh_code_to_id, default_wh=14):
    if not inv_num:
        return default_wh
    inv_str = str(inv_num).strip().upper()
    for code, wh_id in wh_code_to_id.items():
        if inv_str.startswith(f"{code}-"):
            return wh_id
    if inv_str.isdigit():
        return wh_code_to_id.get("VSHB", default_wh)
    return default_wh


def map_transaction_status(tx_type):
    if not tx_type:
        return "SHIPPED"
    t = str(tx_type).strip().lower()
    if t == "shipment":
        return "SHIPPED"
    elif t in ("refund", "return"):
        return "RETURNED"
    elif t in ("cancel", "cancelled", "freereplacement"):
        return "CANCELLED"
    return "SHIPPED"


def ingest_amazon_mtr(
    file_bytes: Optional[bytes] = None,
    file_path: Optional[str] = None,
    target_company_id: Optional[int] = 3
) -> Dict[str, Any]:
    """
    Ingests an Amazon Merchant Tax Report (MTR) Excel or CSV file.
    Follows AGENTS.md:
    - Raw psycopg2 and execute_values for high-performance single-query batch execution.
    - Strict SKU variant isolation.
    - Full transaction disambiguation (Shipment, Refund, Cancel, FreeReplacement).
    """
    if file_bytes:
        try:
            df = pd.read_excel(io.BytesIO(file_bytes))
        except Exception:
            df = pd.read_csv(io.BytesIO(file_bytes))
    elif file_path and os.path.exists(file_path):
        if file_path.endswith(".csv"):
            df = pd.read_csv(file_path)
        else:
            df = pd.read_excel(file_path)
    else:
        raise ValueError("Either file_bytes or a valid file_path must be provided.")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Load active warehouses
    cur.execute("SELECT id, UPPER(code), company_id FROM warehouses WHERE status = 'ACTIVE';")
    wh_code_to_id = {}
    for wid, wcode, wcomp in cur.fetchall():
        if wcode:
            wh_code_to_id[wcode] = wid

    if "IN" not in wh_code_to_id:
        wh_code_to_id["IN"] = 38
    if "VSHB" not in wh_code_to_id:
        wh_code_to_id["VSHB"] = 14

    # Preload existing allocations
    cur.execute("""
        SELECT id, order_id, sku, amazon_line_item_id, warehouse_id, status
        FROM amazon_live_allocations;
    """)
    existing_records = cur.fetchall()

    db_by_order_sku_status = {}
    db_by_line_item_id = {}

    for row in existing_records:
        rec_id, o_id, sku, line_id, wid, stat = row
        o_clean = (o_id or "").strip()
        s_clean = " ".join((sku or "").strip().upper().split())
        l_clean = (line_id or "").strip()
        stat_clean = (stat or "").strip().upper()

        if o_clean and s_clean and stat_clean:
            if (o_clean, s_clean, stat_clean) not in db_by_order_sku_status:
                db_by_order_sku_status[(o_clean, s_clean, stat_clean)] = rec_id
        if l_clean:
            db_by_line_item_id[l_clean] = (rec_id, stat_clean)

    unified_records = {}
    ref_counts = {}
    row_count = 0

    for _, row in df.iterrows():
        order_id = clean_str(row.get("Order Id"))
        sku = clean_str(row.get("Sku"))
        if not order_id or not sku:
            continue

        sku_upper = " ".join(sku.upper().split())

        raw_line_id = clean_str(row.get("Shipment Item Id"))
        if raw_line_id and "." in raw_line_id:
            try:
                raw_line_id = str(int(float(raw_line_id)))
            except Exception:
                pass

        if not raw_line_id:
            raw_line_id = f"MTR_{order_id}_{sku_upper}"

        tx_type = clean_str(row.get("Transaction Type"))
        status = map_transaction_status(tx_type)

        if tx_type == "Refund":
            cnt = ref_counts.get((order_id, raw_line_id), 0) + 1
            ref_counts[(order_id, raw_line_id)] = cnt
            line_item_id = f"{raw_line_id}_REF_{cnt}" if cnt > 1 else f"{raw_line_id}_REF"
        elif tx_type in ("Cancel", "Cancelled"):
            line_item_id = f"{raw_line_id}_CANCEL"
        elif tx_type == "FreeReplacement":
            line_item_id = f"{raw_line_id}_REPL"
        else:
            line_item_id = raw_line_id

        inv_num = clean_str(row.get("Invoice Number"))
        inv_date = clean_dt(row.get("Invoice Date"))
        ship_date = clean_dt(row.get("Shipment Date"))
        order_date = clean_dt(row.get("Order Date")) or inv_date

        seller_gstin = clean_str(row.get("Seller Gstin")) or ""
        company_id = 2 if seller_gstin.startswith("04AEFPS") else (target_company_id or 3)

        warehouse_id = deduce_warehouse_id(inv_num, wh_code_to_id, default_wh=14)

        f_channel = clean_str(row.get("Fulfillment Channel")) or ""
        is_mfn = (
            warehouse_id == 38 or
            (inv_num and inv_num.startswith("IN-")) or
            f_channel.upper() == "MFN"
        )
        amazon_network = "MFN" if is_mfn else "AFN"

        qty = clean_int(row.get("Quantity"), 1)
        gross_amt = clean_float(row.get("Tax Exclusive Gross"))
        tax_amt = clean_float(row.get("Total Tax Amount"))
        net_amt = clean_float(row.get("Invoice Amount"))

        if net_amt is not None and gross_amt is None:
            gst_pct = 18.0
            if "gst_rate" in row and pd.notna(row["gst_rate"]):
                gst_pct = clean_float(row["gst_rate"]) or 18.0
            gross_amt = round(net_amt / (1.0 + (gst_pct / 100.0)), 2)
            tax_amt = round(net_amt - gross_amt, 2)

        buyer_name = clean_str(row.get("Buyer Name"))
        state_name = clean_str(row.get("Ship To State"))
        hsn_code = clean_hsn(row.get("Hsn/sac"))
        cust_gstin = clean_str(row.get("Customer Bill To Gstid")) or clean_str(row.get("Customer Ship To Gstid"))

        item_key = (order_id, line_item_id)
        unified_records[item_key] = {
            "company_id": company_id,
            "order_id": order_id,
            "line_item_id": line_item_id,
            "raw_line_id": raw_line_id,
            "sku_upper": sku_upper,
            "warehouse_id": warehouse_id,
            "amazon_network": amazon_network,
            "qty": qty,
            "status": status,
            "order_date": order_date,
            "inv_num": inv_num,
            "inv_date": inv_date,
            "ship_date": ship_date,
            "gross_amt": gross_amt,
            "tax_amt": tax_amt,
            "net_amt": net_amt,
            "buyer_name": buyer_name,
            "state_name": state_name,
            "hsn_code": hsn_code,
            "cust_gstin": cust_gstin
        }
        row_count += 1

    to_insert = []
    to_update = []
    matched_db_ids = set()

    for item_key, item in unified_records.items():
        order_id = item["order_id"]
        line_item_id = item["line_item_id"]
        raw_line_id = item["raw_line_id"]
        sku_upper = item["sku_upper"]
        item_status = item["status"]

        matched_id = None
        if line_item_id in db_by_line_item_id and db_by_line_item_id[line_item_id][0] not in matched_db_ids:
            matched_id = db_by_line_item_id[line_item_id][0]
        elif (
            item_status == "CANCELLED"
            and raw_line_id in db_by_line_item_id
            and db_by_line_item_id[raw_line_id][1] == "CANCELLED"
            and db_by_line_item_id[raw_line_id][0] not in matched_db_ids
        ):
            matched_id = db_by_line_item_id[raw_line_id][0]
        elif (order_id, sku_upper, item_status) in db_by_order_sku_status:
            cand_id = db_by_order_sku_status[(order_id, sku_upper, item_status)]
            if cand_id not in matched_db_ids:
                matched_id = cand_id
        elif item_status == "SHIPPED" and (order_id, sku_upper, "PENDING") in db_by_order_sku_status:
            cand_id = db_by_order_sku_status[(order_id, sku_upper, "PENDING")]
            if cand_id not in matched_db_ids:
                matched_id = cand_id

        if matched_id:
            matched_db_ids.add(matched_id)
            to_update.append((
                matched_id,
                sku_upper,
                line_item_id,
                item["warehouse_id"],
                item["amazon_network"],
                item["qty"],
                item["qty"],
                item["status"],
                True,
                item["order_date"],
                item["inv_num"],
                item["inv_date"],
                item["ship_date"],
                item["gross_amt"],
                item["tax_amt"],
                item["net_amt"],
                item["buyer_name"],
                item["state_name"],
                item["hsn_code"],
                item["cust_gstin"]
            ))
        else:
            to_insert.append((
                item["company_id"],
                order_id,
                line_item_id,
                sku_upper,
                item["warehouse_id"],
                item["amazon_network"],
                item["qty"],
                item["qty"],
                item["status"],
                True,
                item["order_date"],
                item["inv_num"],
                item["inv_date"],
                item["ship_date"],
                item["gross_amt"],
                item["tax_amt"],
                item["net_amt"],
                item["buyer_name"],
                item["state_name"],
                item["hsn_code"],
                item["cust_gstin"]
            ))

    # Execute Updates
    if to_update:
        update_query = """
            UPDATE amazon_live_allocations AS a
            SET
                sku = v.sku,
                amazon_line_item_id = v.amazon_line_item_id,
                warehouse_id = v.warehouse_id,
                amazon_network_at_allocation = v.amazon_network_at_allocation::"amazonnetworktype",
                allocated_qty = v.allocated_qty,
                reconciled_qty = v.reconciled_qty,
                status = v.status::"allocationstatus",
                closed = v.closed,
                order_date = v.order_date,
                invoice_number = v.invoice_number,
                invoice_date = v.invoice_date,
                shipment_date = v.shipment_date,
                gross_amount = v.gross_amount,
                tax_amount = v.tax_amount,
                net_amount = v.net_amount,
                party_name = v.party_name,
                state_name = v.state_name,
                hsn_code = v.hsn_code,
                customer_gstin = v.customer_gstin,
                updated_at = NOW()
            FROM (VALUES %s) AS v(
                id, sku, amazon_line_item_id, warehouse_id, amazon_network_at_allocation,
                allocated_qty, reconciled_qty, status, closed, order_date,
                invoice_number, invoice_date, shipment_date, gross_amount,
                tax_amount, net_amount, party_name, state_name, hsn_code, customer_gstin
            )
            WHERE a.id = v.id;
        """
        for i in range(0, len(to_update), 1000):
            chunk = to_update[i:i + 1000]
            execute_values(cur, update_query, chunk, page_size=1000)
            conn.commit()

    # Execute Inserts
    if to_insert:
        insert_query = """
            INSERT INTO amazon_live_allocations (
                company_id, order_id, amazon_line_item_id, sku, warehouse_id,
                amazon_network_at_allocation, allocated_qty, reconciled_qty,
                status, closed, order_date, invoice_number, invoice_date,
                shipment_date, gross_amount, tax_amount, net_amount,
                party_name, state_name, hsn_code, customer_gstin,
                created_at, updated_at
            ) VALUES %s
            ON CONFLICT (order_id, sku, amazon_line_item_id)
            DO UPDATE SET
                warehouse_id = EXCLUDED.warehouse_id,
                amazon_network_at_allocation = EXCLUDED.amazon_network_at_allocation,
                allocated_qty = EXCLUDED.allocated_qty,
                reconciled_qty = EXCLUDED.reconciled_qty,
                status = EXCLUDED.status,
                closed = EXCLUDED.closed,
                order_date = EXCLUDED.order_date,
                invoice_number = EXCLUDED.invoice_number,
                invoice_date = EXCLUDED.invoice_date,
                shipment_date = EXCLUDED.shipment_date,
                gross_amount = EXCLUDED.gross_amount,
                tax_amount = EXCLUDED.tax_amount,
                net_amount = EXCLUDED.net_amount,
                party_name = EXCLUDED.party_name,
                state_name = EXCLUDED.state_name,
                hsn_code = EXCLUDED.hsn_code,
                customer_gstin = EXCLUDED.customer_gstin,
                updated_at = NOW();
        """
        insert_payload = [
            (
                r[0], r[1], r[2], r[3], r[4],
                r[5], r[6], r[7], r[8], r[9],
                r[10], r[11], r[12], r[13], r[14],
                r[15], r[16], r[17], r[18], r[19],
                r[20], pd.Timestamp.now().to_pydatetime(), pd.Timestamp.now().to_pydatetime()
            )
            for r in to_insert
        ]
        for i in range(0, len(insert_payload), 1000):
            chunk = insert_payload[i:i + 1000]
            execute_values(cur, insert_query, chunk, page_size=1000)
            conn.commit()

    # Calculate summary
    shipment_items = [v for v in unified_records.values() if v["status"] == "SHIPPED"]
    refund_items = [v for v in unified_records.values() if v["status"] == "RETURNED"]

    total_shipment_qty = sum(v["qty"] for v in shipment_items)
    total_shipment_gross = sum(v["gross_amt"] or 0.0 for v in shipment_items)
    total_shipment_tax = sum(v["tax_amt"] or 0.0 for v in shipment_items)
    total_shipment_net = sum(v["net_amt"] or 0.0 for v in shipment_items)

    total_refund_qty = sum(v["qty"] for v in refund_items)
    total_refund_gross = sum(v["gross_amt"] or 0.0 for v in refund_items)
    total_refund_tax = sum(v["tax_amt"] or 0.0 for v in refund_items)
    total_refund_net = sum(v["net_amt"] or 0.0 for v in refund_items)

    # Sync refund items into amazon_returns table
    if refund_items:
        ret_insert_query = """
            INSERT INTO amazon_returns (
                company_id, amazon_return_id, amazon_order_id, order_item_id,
                sku, asin, product_name, quantity, return_reason,
                return_status, requested_at, received_at, last_synced_at,
                created_at, updated_at
            ) VALUES %s
            ON CONFLICT (company_id, amazon_return_id, order_item_id)
            DO NOTHING;
        """
        ret_payload = [
            (
                r["company_id"],
                f"{'MFN' if (r['amazon_network'] == 'MFN' or r['warehouse_id'] == 38 or (r['inv_num'] and r['inv_num'].startswith('IN-'))) else 'AFN'}-{r['inv_num'] or r['order_id']}",
                r["order_id"],
                r["line_item_id"],
                r["sku_upper"],
                None,
                r["sku_upper"],
                abs(r["qty"] or 1),
                f"{'MFN' if (r['amazon_network'] == 'MFN' or r['warehouse_id'] == 38 or (r['inv_num'] and r['inv_num'].startswith('IN-'))) else 'AFN'} Customer Return ({r['inv_num'] or 'Standard'})",
                "Received",
                r["order_date"] or r["ship_date"],
                r["ship_date"] or r["order_date"],
                pd.Timestamp.now().to_pydatetime(),
                pd.Timestamp.now().to_pydatetime(),
                pd.Timestamp.now().to_pydatetime()
            )
            for r in refund_items
        ]
        execute_values(cur, ret_insert_query, ret_payload, page_size=1000)
        conn.commit()

    cur.close()
    conn.close()

    return {
        "success": True,
        "total_rows_parsed": row_count,
        "records_updated": len(to_update),
        "records_inserted": len(to_insert),
        "shipments": {
            "count": len(shipment_items),
            "quantity": total_shipment_qty,
            "gross_amount": round(total_shipment_gross, 2),
            "tax_amount": round(total_shipment_tax, 2),
            "net_amount": round(total_shipment_net, 2)
        },
        "refunds": {
            "count": len(refund_items),
            "quantity": total_refund_qty,
            "gross_amount": round(total_refund_gross, 2),
            "tax_amount": round(total_refund_tax, 2),
            "net_amount": round(total_refund_net, 2)
        }
    }

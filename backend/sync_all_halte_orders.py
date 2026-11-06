import os
import json
import requests
from datetime import datetime
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import execute_values, Json

load_dotenv('backend/.env')

DATABASE_URL = os.getenv("DATABASE_URL")
HALTE_API_URL = os.getenv("HALTE_API_URL", "https://halte.in")
HALTE_API_KEY = os.getenv("HALTE_API_KEY", "sdbl573th5ige8ityi65iubtlnrshvopbw3jv")

print(f"Connecting to Halte.in API: {HALTE_API_URL}/api/haltedb/orders?sync_all=true&format=grouped")

res = requests.get(
    f"{HALTE_API_URL}/api/haltedb/orders",
    headers={"x-api-key": HALTE_API_KEY},
    params={"sync_all": "true", "format": "grouped"},
    timeout=60
)
res.raise_for_status()
data = res.json()
orders = data.get("orders", [])
print(f"Fetched {len(orders)} orders from Halte.in")

# Prepare rows for bulk upsert
rows = []
for ord_data in orders:
    order_id = ord_data.get("order_id")
    if not order_id:
        continue
    
    order_time_raw = ord_data.get("order_time")
    parsed_order_time = None
    if order_time_raw:
        try:
            parsed_order_time = datetime.fromisoformat(order_time_raw.replace("Z", "+00:00"))
        except Exception:
            pass

    rows.append((
        order_id,
        parsed_order_time,
        ord_data.get("order_state", "UNPAID"),
        float(ord_data.get("total_amount") or 0.0),
        ord_data.get("customer_name"),
        ord_data.get("customer_phone"),
        ord_data.get("customer_email"),
        ord_data.get("ship_city"),
        ord_data.get("ship_state"),
        ord_data.get("ship_postal_code"),
        Json(ord_data.get("shipping_address") or {}),
        Json(ord_data.get("billing_address") or {}),
        Json(ord_data.get("items") or []),
        "PENDING",
        datetime.utcnow()
    ))

print(f"Prepared {len(rows)} records for bulk insertion into PostgreSQL...")

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

query = """
    INSERT INTO halte_website_orders (
        order_id,
        order_time,
        order_state,
        total_amount,
        customer_name,
        customer_phone,
        customer_email,
        ship_city,
        ship_state,
        ship_postal_code,
        shipping_address,
        billing_address,
        items,
        inventory_status,
        updated_at
    ) VALUES %s
    ON CONFLICT (order_id) DO UPDATE SET
        order_time = EXCLUDED.order_time,
        order_state = EXCLUDED.order_state,
        total_amount = EXCLUDED.total_amount,
        customer_name = COALESCE(EXCLUDED.customer_name, halte_website_orders.customer_name),
        customer_phone = COALESCE(EXCLUDED.customer_phone, halte_website_orders.customer_phone),
        customer_email = COALESCE(EXCLUDED.customer_email, halte_website_orders.customer_email),
        ship_city = COALESCE(EXCLUDED.ship_city, halte_website_orders.ship_city),
        ship_state = COALESCE(EXCLUDED.ship_state, halte_website_orders.ship_state),
        ship_postal_code = COALESCE(EXCLUDED.ship_postal_code, halte_website_orders.ship_postal_code),
        shipping_address = EXCLUDED.shipping_address,
        billing_address = EXCLUDED.billing_address,
        items = EXCLUDED.items,
        updated_at = EXCLUDED.updated_at
"""

execute_values(cur, query, rows)
conn.commit()

# Query counts
cur.execute("SELECT COUNT(*) FROM halte_website_orders")
total_in_db = cur.fetchone()[0]

cur.execute("SELECT COUNT(*) FROM halte_website_orders WHERE order_time < '2026-08-01'")
before_aug = cur.fetchone()[0]

cur.execute("SELECT COUNT(*) FROM halte_website_orders WHERE order_time >= '2026-08-01'")
from_aug = cur.fetchone()[0]

cur.execute("SELECT MIN(order_time), MAX(order_time) FROM halte_website_orders")
earliest, latest = cur.fetchone()

cur.close()
conn.close()

print(f"BULK SYNC SUCCESSFUL!")
print(f"Total orders in DB: {total_in_db}")
print(f"Orders from BEFORE 1st Aug 2026: {before_aug}")
print(f"Orders from 1st Aug 2026 onwards: {from_aug}")
print(f"Earliest order in DB: {earliest}")
print(f"Latest order in DB: {latest}")

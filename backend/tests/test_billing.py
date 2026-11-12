import pytest
from app.models.schema import CompanySettings, Product, Inventory, Warehouse

@pytest.fixture
def setup_billing_data(db_session, seeded_company_context):
    company = seeded_company_context["company"]
    
    # POS requires BKR code
    company.code = "BKR"
    db_session.commit()

    # Create settings
    settings = CompanySettings(
        company_id=company.id,
        tally_enabled=True,
        tally_endpoint_url="http://mocktally:9000",
        tally_payload_format="XML",
        legal_name="BKR Solutions Pvt Ltd",
        gstin="27AAAAA0000A1Z5",
    )
    db_session.add(settings)
    db_session.flush()

    # Create product
    product = Product(
        company_id=company.id,
        sku="TEST-001",
        name="Test Product",
        item_rate=100.0,
        default_gst_rate=18.0,
    )
    db_session.add(product)
    db_session.flush()

    # Create warehouse
    warehouse = Warehouse(company_id=company.id, name="Main Warehouse")
    db_session.add(warehouse)
    db_session.flush()

    # Add inventory
    inv = Inventory(
        company_id=company.id,
        product_id=product.id,
        warehouse_id=warehouse.id
    )
    inv._allow_mutation = True
    inv.current_qty = 50
    inv.available_qty = 50
    db_session.add(inv)
    db_session.commit()

    return {"company_id": company.id, "product_id": product.id, "sku": "TEST-001"}

def test_company_settings_api(client, setup_billing_data):
    # Get settings
    response = client.get("/api/settings/")
    assert response.status_code == 200
    data = response.json()
    assert data["tally_enabled"] is True
    assert data["tally_payload_format"] == "XML"
    assert data["legal_name"] == "BKR Solutions Pvt Ltd"

    # Update settings
    payload = {"tally_payload_format": "JSON"}
    response = client.put("/api/settings/", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["tally_payload_format"] == "JSON"

def test_b2b_pos_checkout_and_tally_sync(client, setup_billing_data):
    # Checkout payload
    payload = {
        "invoice_type": "B2B",
        "customer_name": "Test Client",
        "customer_gstin": "27BBBBB0000B1Z5",
        "customer_state": "Maharashtra",
        "customer_state_code": "27",
        "place_of_supply": "Maharashtra",
        "payment_method": "UPI",
        "payment_reference": "UPI123456",
        "total_taxable_amount": 100.0,
        "total_tax": 18.0,
        "grand_total": 118.0,
        "items": [
            {
                "product_id": setup_billing_data["product_id"],
                "sku": setup_billing_data["sku"],
                "product_name": "Test Product",
                "quantity": 1,
                "selling_price": 100.0,
                "discount": 0.0,
                "gst_rate": 18.0,
                "taxable_amount": 100.0,
                "cgst": 9.0,
                "sgst": 9.0,
                "igst": 0.0,
                "line_total": 118.0
            }
        ]
    }

    # B2B Sale - This should try to sync with Tally in the background
    response = client.post("/api/pos/sale", json=payload)
    assert response.status_code == 200, response.json()
    data = response.json()
    assert data["message"] == "Sale completed successfully"
    receipt = data["receipt"]
    
    assert receipt["invoice_type"] == "B2B"
    assert receipt["payment_reference"] == "UPI123456"
    assert receipt["company"]["gstin"] == "27AAAAA0000A1Z5" # Snapshot works
    assert receipt["tally"]["status"] in ["FAILED", "PENDING", "SUCCESS"]
    
    sale_id = receipt["id"]

    # History API Filter
    hist_res = client.get("/api/pos/history?invoice_type=B2B")
    assert hist_res.status_code == 200
    assert len(hist_res.json()["items"]) >= 1

    # Single Invoice API
    inv_res = client.get(f"/api/pos/sales/{sale_id}")
    assert inv_res.status_code == 200
    assert inv_res.json()["receipt"]["id"] == sale_id

def test_b2c_pos_checkout_no_tally(client, setup_billing_data):
    payload = {
        "invoice_type": "B2C",
        "payment_method": "Cash",
        "total_taxable_amount": 200.0,
        "total_tax": 36.0,
        "grand_total": 236.0,
        "items": [
            {
                "product_id": setup_billing_data["product_id"],
                "sku": setup_billing_data["sku"],
                "product_name": "Test Product",
                "quantity": 2,
                "selling_price": 100.0,
                "discount": 0.0,
                "gst_rate": 18.0,
                "taxable_amount": 200.0,
                "cgst": 18.0,
                "sgst": 18.0,
                "igst": 0.0,
                "line_total": 236.0
            }
        ]
    }

    response = client.post("/api/pos/sale", json=payload)
    assert response.status_code == 200, response.json()
    data = response.json()
    receipt = data["receipt"]
    
    assert receipt["invoice_type"] == "B2C"
    # B2C should be NOT_APPLICABLE for Tally
    assert receipt["tally"]["status"] == "NOT_APPLICABLE"


def test_pos_checkout_origin_warehouse_address(client, db_session, setup_billing_data):
    from app.models.schema import StateHub, WarehouseType, Sale, InventoryMovement

    company_id = setup_billing_data["company_id"]
    product_id = setup_billing_data["product_id"]
    sku = setup_billing_data["sku"]

    # Create StateHub in Karnataka
    hub = StateHub(
        company_id=company_id,
        hub_code="BLR_HUB",
        hub_name="Karnataka Hub",
        gstin="29AAFCJ8215N1Z0",
        address="Hub Road, Bengaluru, Karnataka",
        state="Karnataka",
        state_code="29",
        status="Active"
    )
    db_session.add(hub)
    db_session.flush()

    # Create FC warehouse in Karnataka
    fc_wh = Warehouse(
        company_id=company_id,
        name="JSPL BLR4",
        code="BLR4",
        warehouse_type=WarehouseType.FULFILLMENT_CENTER,
        address="Building 2, Devanahalli, Bengaluru, Karnataka 562149",
        hub_id=hub.id,
        status="ACTIVE"
    )
    db_session.add(fc_wh)
    db_session.flush()

    # Add stock in this FC warehouse
    fc_inv = Inventory(
        company_id=company_id,
        product_id=product_id,
        warehouse_id=fc_wh.id
    )
    fc_inv._allow_mutation = True
    fc_inv.current_qty = 20
    fc_inv.available_qty = 20
    db_session.add(fc_inv)
    db_session.commit()

    payload = {
        "invoice_type": "B2C",
        "origin_warehouse_id": fc_wh.id,
        "payment_method": "Cash",
        "total_taxable_amount": 100.0,
        "total_tax": 18.0,
        "grand_total": 118.0,
        "items": [
            {
                "product_id": product_id,
                "sku": sku,
                "product_name": "Test Product",
                "quantity": 1,
                "selling_price": 100.0,
                "discount": 0.0,
                "gst_rate": 18.0,
                "taxable_amount": 100.0,
                "cgst": 0.0,
                "sgst": 0.0,
                "igst": 18.0,
                "line_total": 118.0
            }
        ]
    }

    response = client.post("/api/pos/sale", json=payload)
    assert response.status_code == 200, response.json()
    data = response.json()
    receipt = data["receipt"]
    sale_id = receipt["id"]

    # 1. Returned receipt must show the FC warehouse address and state, not the central address
    assert receipt["company"]["address"] == "Building 2, Devanahalli, Bengaluru, Karnataka 562149"
    assert receipt["company"]["gstin"] == "29AAFCJ8215N1Z0"
    assert receipt["company"]["state"] == "Karnataka"
    assert receipt["company"]["state_code"] == "29"

    # 2. Database Sale snapshot row must store the FC warehouse address
    sale_row = db_session.query(Sale).filter(Sale.id == sale_id).first()
    assert sale_row.company_address_snapshot == "Building 2, Devanahalli, Bengaluru, Karnataka 562149"
    assert sale_row.company_gstin_snapshot == "29AAFCJ8215N1Z0"
    assert sale_row.company_state_snapshot == "Karnataka"
    assert sale_row.company_state_code_snapshot == "29"

    # 3. Inventory movement must be deducted from the FC warehouse
    mov = db_session.query(InventoryMovement).filter(InventoryMovement.reference_id == sale_row.bill_number).first()
    assert mov is not None
    assert mov.warehouse_id == fc_wh.id

    # 4. Viewing the invoice later via GET /api/pos/sales/{id} must also show the FC warehouse address
    view_res = client.get(f"/api/pos/sales/{sale_id}")
    assert view_res.status_code == 200
    view_receipt = view_res.json()["receipt"]
    assert view_receipt["company"]["address"] == "Building 2, Devanahalli, Bengaluru, Karnataka 562149"
    assert view_receipt["company"]["gstin"] == "29AAFCJ8215N1Z0"


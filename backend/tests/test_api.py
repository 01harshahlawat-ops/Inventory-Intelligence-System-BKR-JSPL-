import pytest

def test_create_warehouse(client):
    response = client.post("/api/warehouses/", json={"name": "Delhi WH", "code": "DEL01"})
    assert response.status_code == 200
    assert response.json()["code"] == "DEL01"

def test_create_product(client):
    response = client.post("/api/products/", json={"sku": "TEST-123", "name": "Test Product", "min_stock_level": 10})
    assert response.status_code == 200
    assert response.json()["sku"] == "TEST-123"

def test_dashboard_empty(client):
    response = client.get("/api/dashboard/metrics")
    assert response.status_code == 200
    metrics = response.json()
    assert metrics["kpis"]["total_products"] == 0
    assert metrics["kpis"]["total_warehouses"] == 0
    assert metrics["kpis"]["total_inventory"] == 0

def test_reports_empty_db(client):
    # Should 404 because no items are low stock
    response = client.post("/api/reports/generate/low-stock?format=csv")
    assert response.status_code == 404

# For full testing of upload and event engine, we'll write a specific Event Engine test.
def test_event_engine(db_session, seeded_company_context):
    from app.services.inventory_event_engine import InventoryEventEngine
    from app.models.schema import Product, Warehouse, Inventory

    company = seeded_company_context["company"]
    
    wh = Warehouse(name="Test WH", code="WH01", company_id=company.id)
    db_session.add(wh)
    
    prod = Product(sku="E-SKU-1", name="Engine Prod", min_stock_level=5, company_id=company.id)
    db_session.add(prod)
    db_session.commit()
    
    # Process ADD event
    movement = InventoryEventEngine.process_event(
        db=db_session,
        company_id=company.id,
        product_sku="E-SKU-1",
        warehouse_id=wh.id,
        quantity=10,
        event_type="ADD",
        source="Manual",
        reference_id="MAN-1"
    )
    db_session.commit()
    
    assert movement.qty_before == 0
    assert movement.qty_after == 10
    assert movement.qty_changed == 10
    
    inv = db_session.query(Inventory).first()
    assert inv.current_qty == 10
    
    # Process DEDUCT event
    movement2 = InventoryEventEngine.process_event(
        db=db_session,
        company_id=company.id,
        product_sku="E-SKU-1",
        warehouse_id=wh.id,
        quantity=3,
        event_type="DEDUCT",
        source="Amazon",
        reference_id="AMZ-1"
    )
    db_session.commit()
    
    assert movement2.qty_before == 10
    assert movement2.qty_after == 7
    assert movement2.qty_changed == -3
    
    inv2 = db_session.query(Inventory).first()
    assert inv2.current_qty == 7
    
    # Process REPLACE event
    movement3 = InventoryEventEngine.process_event(
        db=db_session,
        company_id=company.id,
        product_sku="E-SKU-1",
        warehouse_id=wh.id,
        quantity=25,
        event_type="REPLACE",
        source="Upload",
        reference_id="UP-1",
        metadata_payload={"file": "test.xlsx"}
    )
    db_session.commit()
    
    assert movement3.qty_before == 7
    assert movement3.qty_after == 25
    assert movement3.qty_changed == 18
    assert movement3.metadata_payload.get("file") == "test.xlsx"
    
    inv3 = db_session.query(Inventory).first()
    assert inv3.current_qty == 25

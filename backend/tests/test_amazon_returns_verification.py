import pytest
from app.services.inventory_event_engine import InventoryEventEngine
from app.models.schema import Product, Warehouse, Inventory, AmazonReturn, Company

def test_amazon_return_restock_with_negative_stock(db_session, seeded_company_context):
    company = seeded_company_context["company"]
    
    wh = Warehouse(name="Central VSHB", code="VSHB", company_id=company.id, status="ACTIVE")
    db_session.add(wh)
    
    prod = Product(sku="LG0657", name="BKR Nylon Trimmer Line", company_id=company.id)
    db_session.add(prod)
    db_session.flush()
    
    # Establish existing negative stock (-5)
    inv = Inventory(
        company_id=company.id,
        warehouse_id=wh.id,
        product_id=prod.id
    )
    inv._allow_mutation = True
    inv.current_qty = -5
    inv.reserved_qty = 0
    inv.available_qty = -5
    inv._allow_mutation = False
    db_session.add(inv)
    db_session.flush()
    
    # Create Amazon Return record
    amz_ret = AmazonReturn(
        company_id=company.id,
        amazon_return_id="AFN-VSHB-1215",
        amazon_order_id="171-8000399-3433955",
        order_item_id="item-1215",
        sku="LG0657",
        quantity=1,
        return_status="Received"
    )
    db_session.add(amz_ret)
    db_session.commit()
    
    # Simulate restock event
    movement = InventoryEventEngine.process_event(
        db=db_session,
        company_id=company.id,
        product_sku="LG0657",
        warehouse_id=wh.id,
        quantity=1,
        event_type="ADD",
        source="Amazon Return",
        reference_id=amz_ret.amazon_return_id,
        user_id=seeded_company_context["user"].id,
        allow_negative_stock=True
    )
    db_session.commit()
    
    assert movement.qty_before == -5
    assert movement.qty_after == -4
    assert movement.qty_changed == 1
    
    db_session.refresh(inv)
    assert inv.current_qty == -4
    assert inv.available_qty == -4

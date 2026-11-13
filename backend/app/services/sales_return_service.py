import logging
import uuid
from sqlalchemy.orm import Session
from app.models.schema import SalesReturn, SalesReturnItem, SaleItem
from app.services.inventory_event_engine import InventoryEventEngine
from app.services.audit_log_service import AuditLogService
from app.models.schema import Warehouse, InventoryMovement

class SalesReturnService:

    @staticmethod
    def create_draft(db: Session, company_id: int, return_data: dict, user_id: int = None) -> SalesReturn:
        return_type = (return_data.get("return_type") or "OFFLINE").strip().upper()
        return_number = return_data.get("return_number")
        if not return_number or return_number.startswith("RTN-"):
            from app.services.document_number_service import DocumentNumberService
            from app.models.schema import DocumentTypeEnum
            from app.services.invoice_number_service import _get_fiscal_year_string
            from datetime import datetime as dt
            fy = _get_fiscal_year_string(dt.today().date())
            prefix = "GGSR" if ("AMAZON" in return_type or "GGSR" in return_type) else "SR"
            return_number = DocumentNumberService.generate_number(
                db=db,
                company_id=company_id,
                document_type=DocumentTypeEnum.RETURN,
                fiscal_year=fy,
                prefix_override=prefix
            )

        sales_return = SalesReturn(
            company_id=company_id,
            idempotency_key=return_data.get("idempotency_key"),
            sale_id=return_data.get("sale_id"),
            return_number=return_number,
            return_type=return_type,
            customer_name=return_data.get("customer_name"),
            total_taxable_amount=return_data.get("total_taxable_amount", 0.0),
            total_tax=return_data.get("total_tax", 0.0),
            grand_total=return_data.get("grand_total", 0.0),
            status="Draft",
            created_by=user_id
        )
        db.add(sales_return)
        db.flush()

        from sqlalchemy import func
        from app.models.schema import Product
        
        # Aggregate return quantities per sale_item_id or handle non-sale items (Amazon Returns)
        sale_items_map = {}
        direct_items = []

        for item in return_data.get("items", []):
            sale_item_id = item.get("sale_item_id")
            if sale_item_id:
                if sale_item_id not in sale_items_map:
                    sale_items_map[sale_item_id] = {**item, "returned_quantity": 0}
                sale_items_map[sale_item_id]["returned_quantity"] += item.get("returned_quantity", 0)
            else:
                direct_items.append(item)

        for sale_item_id, item in sale_items_map.items():
            sale_item = db.query(SaleItem).filter(SaleItem.id == sale_item_id).first()
            if not sale_item:
                raise ValueError(f"SaleItem {sale_item_id} not found")
                
            returned_qty = item.get("returned_quantity", 0)
            
            previously_returned = db.query(func.sum(SalesReturnItem.returned_quantity))\
                .join(SalesReturn)\
                .filter(SalesReturnItem.sale_item_id == sale_item_id, SalesReturn.status != 'Cancelled')\
                .scalar() or 0
                
            if returned_qty + previously_returned > sale_item.quantity:
                raise ValueError(f"Cannot return {returned_qty} items. Only {sale_item.quantity - previously_returned} remaining for return.")
                
            rtn_item = SalesReturnItem(
                return_id=sales_return.id,
                sale_item_id=sale_item_id,
                product_id=sale_item.product_id,
                sku_snapshot=sale_item.sku,
                product_name_snapshot=sale_item.product_name,
                hsn_snapshot=sale_item.hsn_sac,
                unit_snapshot=sale_item.unit,
                returned_quantity=returned_qty,
                return_reason=item.get("return_reason"),
                unit_price=sale_item.selling_price,
                tax_rate=sale_item.gst_rate,
                tax_amount=(sale_item.cgst + sale_item.sgst + sale_item.igst) * (returned_qty / sale_item.quantity) if sale_item.quantity > 0 else 0,
                total_price=(sale_item.selling_price * returned_qty) + ((sale_item.cgst + sale_item.sgst + sale_item.igst) * (returned_qty / sale_item.quantity) if sale_item.quantity > 0 else 0)
            )
            db.add(rtn_item)

        # Process direct items (e.g. Amazon Returns)
        for item in direct_items:
            sku = (item.get("sku_snapshot") or item.get("sku") or "").strip().upper()
            prod = None
            if sku:
                prod = db.query(Product).filter(Product.company_id == company_id, func.upper(Product.sku) == sku).first()
            elif item.get("product_id"):
                prod = db.query(Product).filter(Product.id == item.get("product_id")).first()

            returned_qty = int(item.get("returned_quantity", 1))
            unit_price = float(item.get("unit_price") or (prod.selling_price if prod and prod.selling_price else 0.0))
            tax_rate = float(item.get("tax_rate") or (prod.gst_rate if prod and prod.gst_rate is not None else 18.0))
            taxable_val = unit_price * returned_qty
            tax_amount = taxable_val * (tax_rate / 100.0)
            total_price = taxable_val + tax_amount

            rtn_item = SalesReturnItem(
                return_id=sales_return.id,
                sale_item_id=None,
                product_id=prod.id if prod else item.get("product_id"),
                sku_snapshot=sku or (prod.sku if prod else "ITEM"),
                product_name_snapshot=item.get("product_name_snapshot") or item.get("product_name") or (prod.name if prod else sku),
                hsn_snapshot=item.get("hsn_snapshot") or (prod.hsn_code if prod else "9503"),
                unit_snapshot=item.get("unit_snapshot") or (prod.unit if prod else "PCS"),
                returned_quantity=returned_qty,
                return_reason=item.get("return_reason") or "Customer Return",
                unit_price=unit_price,
                tax_rate=tax_rate,
                tax_amount=tax_amount,
                total_price=total_price
            )
            db.add(rtn_item)

        db.flush()

        # Calculate totals dynamically based on items
        total_taxable = sum((item.returned_quantity * item.unit_price) for item in sales_return.items)
        total_tax = sum(item.tax_amount for item in sales_return.items)
        sales_return.total_taxable_amount = total_taxable
        sales_return.total_tax = total_tax
        sales_return.grand_total = total_taxable + total_tax
        
        AuditLogService.log(
            db,
            company_id=company_id,
            entity_type="SalesReturn",
            entity_id=sales_return.id,
            event_type="RETURN_CREATED",
            message=f"Sales Return {sales_return.return_number} created"
        )
        
        db.flush()
        logging.getLogger(__name__).info("Return processed", extra={"return_id": sales_return.id, "return_number": sales_return.return_number})
        return sales_return

    @staticmethod
    def complete_return(db: Session, company_id: int, return_id: int, user_id: int = None, warehouse_id: int = None):
        sales_return = db.query(SalesReturn).filter(SalesReturn.id == return_id, SalesReturn.company_id == company_id).first()
        if not sales_return:
            raise ValueError("SalesReturn not found")
        if sales_return.status != "Draft":
            raise ValueError("Only Draft returns can be completed")

        target_warehouse_id = warehouse_id
        
        # 1. Try to find the originating warehouse from the original Sale's inventory movements
        if not target_warehouse_id and sales_return.sale_id:
            movement = db.query(InventoryMovement).filter(
                InventoryMovement.reference_id == sales_return.sale.bill_number,
                InventoryMovement.source.in_(["POS_SALE", "OFFLINE_POS", "B2B_SALE"])
            ).first()
            if movement:
                target_warehouse_id = movement.warehouse_id
                print(f"[SALES RETURN] Found original warehouse: {target_warehouse_id} via movement source: {movement.source}")

        # 2. Fallback to the company's default active warehouse
        if not target_warehouse_id:
            warehouses = db.query(Warehouse).filter(
                Warehouse.company_id == company_id,
                Warehouse.status == "ACTIVE"
            ).order_by(Warehouse.id.asc()).all()
            if not warehouses:
                raise ValueError("No active warehouse found to accept return stock.")
            
            target_warehouse_id = warehouses[0].id
            for w in warehouses:
                code = (w.code or "").strip().upper()
                name = (w.name or "").strip().lower()
                if code in ["DEFAULT", "MAIN", "POS"] or "default" in name or "main" in name:
                    target_warehouse_id = w.id
                    break

        sales_return.status = "Completed"
        
        for item in sales_return.items:
            if item.product_id and item.sku_snapshot:
                InventoryEventEngine.process_event(
                    db=db,
                    company_id=company_id,
                    product_sku=item.sku_snapshot,
                    warehouse_id=target_warehouse_id,
                    quantity=item.returned_quantity,
                    event_type="RETURN",
                    source="Customer Return",
                    reference_id=sales_return.return_number,
                    user_id=user_id,
                    metadata_payload={"return_id": sales_return.id}
                )

        AuditLogService.log(
            db,
            company_id=company_id,
            entity_type="SalesReturn",
            entity_id=sales_return.id,
            event_type="RETURN_COMPLETED",
            message=f"Sales Return {sales_return.return_number} completed",
            metadata={"warehouse_id": target_warehouse_id}
        )
        
        db.flush()
        logging.getLogger(__name__).info("Return processed", extra={"return_id": sales_return.id, "return_number": sales_return.return_number})
        return sales_return

    @staticmethod
    def cancel_return(db: Session, company_id: int, return_id: int):
        sales_return = db.query(SalesReturn).filter(SalesReturn.id == return_id, SalesReturn.company_id == company_id).first()
        if not sales_return:
            raise ValueError("SalesReturn not found")
        if sales_return.status != "Draft":
            raise ValueError("Only Draft returns can be cancelled")
        
        sales_return.status = "Cancelled"
        
        AuditLogService.log(
            db,
            company_id=company_id,
            entity_type="SalesReturn",
            entity_id=sales_return.id,
            event_type="RETURN_CANCELLED",
            message=f"Sales Return {sales_return.return_number} cancelled"
        )
        
        db.flush()
        logging.getLogger(__name__).info("Return processed", extra={"return_id": sales_return.id, "return_number": sales_return.return_number})
        return sales_return

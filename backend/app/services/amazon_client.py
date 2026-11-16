import abc
import os
import logging
from typing import List, Dict, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class AmazonClient(abc.ABC):
    @abc.abstractmethod
    def fetch_orders(self, since: datetime = None) -> List[Dict[str, Any]]:
        """
        Fetch recent orders from Amazon.
        Each order should be a dict containing at least:
        - order_id: str
        - items: List[Dict] with 'sku' and 'quantity'
        """

class MockAmazonClient(AmazonClient):
    def fetch_orders(self, *args, **kwargs) -> List[Dict[str, Any]]:
        """
        Mock client disabled to prevent polluting the production database with fake orders.
        """
        return []

    def request_and_download_shipment_report(self, *args, **kwargs) -> str:
        return ""

class SPAPIAmazonClient(AmazonClient):
    def __init__(self):
        try:
            from sp_api.api import Orders, Reports
            self.Orders = Orders
            self.Reports = Reports
        except ImportError:
            logger.error("sp-api-python package is not installed. Run: pip install python-amazon-sp-api")
            self.Orders = None
            self.Reports = None
            
        self.credentials = dict(
            refresh_token=os.getenv("LWA_REFRESH_TOKEN"),
            lwa_app_id=os.getenv("LWA_CLIENT_ID"),
            lwa_client_secret=os.getenv("LWA_CLIENT_SECRET"),
        )
        if os.getenv("SP_API_USE_IAM", "false").lower() == "true":
            self.credentials.update(
                aws_secret_key=os.getenv("AWS_SECRET_KEY"),
                aws_access_key=os.getenv("AWS_ACCESS_KEY"),
                role_arn=os.getenv("AWS_IAM_ROLE_ARN"),
            )
        self.marketplace = os.getenv("MARKETPLACE_ID", "IN")
        
    def fetch_orders(
        self, 
        since: datetime = None, 
        existing_order_ids: set = None,
        on_page_callback = None,
        max_pages: int = None
    ) -> List[Dict[str, Any]]:
        """
        Fetches orders from Amazon SP-API OrdersV0 with NextToken pagination support.
        Optimized to skip get_order_items calls for orders already present in existing_order_ids.
        Calls on_page_callback(parsed_page) per page if provided for incremental processing.
        """
        if not self.Orders:
            logger.error("Cannot fetch orders. SP-API library missing.")
            return []
            
        try:
            import time
            from sp_api.base import Marketplaces
            marketplace = getattr(Marketplaces, self.marketplace, Marketplaces.IN)
            orders_api = self.Orders(credentials=self.credentials, marketplace=marketplace)
            
            created_after = since.isoformat() if since else (datetime.utcnow() - timedelta(days=7)).isoformat()
            
            def fetch_with_backoff(call_fn, *args, **kwargs):
                retries = 4
                for attempt in range(retries):
                    try:
                        return call_fn(*args, **kwargs)
                    except Exception as e:
                        err_str = str(e)
                        if "TooManyRequests" in err_str or "QuotaExceeded" in err_str or "429" in err_str:
                            wait_time = 2 ** (attempt + 1)
                            logger.warning(f"SP-API throttled (attempt {attempt + 1}/{retries}). Backing off for {wait_time}s...")
                            time.sleep(wait_time)
                            continue
                        raise e

            all_orders = []
            next_token = None
            page_num = 0
            existing_ids = existing_order_ids or set()

            while True:
                page_num += 1
                logger.info(f"Fetching Amazon orders page {page_num} (NextToken={'Yes' if next_token else 'Initial'})...")

                if next_token:
                    res = fetch_with_backoff(orders_api.get_orders, NextToken=next_token)
                else:
                    res = fetch_with_backoff(
                        orders_api.get_orders, 
                        CreatedAfter=created_after, 
                        OrderStatuses=["Pending", "Unshipped", "PartiallyShipped", "Shipped", "Canceled"]
                    )

                if not res or not hasattr(res, 'payload'):
                    break

                payload = res.payload or {}
                orders_data = payload.get("Orders", [])
                next_token = payload.get("NextToken")

                logger.info(f"Page {page_num} returned {len(orders_data)} orders. NextToken present: {bool(next_token)}")

                page_orders = []
                for amazon_order in orders_data:
                    order_id = amazon_order.get("AmazonOrderId")
                    status = amazon_order.get("OrderStatus")
                    fulfillment_channel = amazon_order.get("FulfillmentChannel", "MFN")
                    last_update_date = amazon_order.get("LastUpdateDate")
                    purchase_date = amazon_order.get("PurchaseDate")
                    order_total_dict = amazon_order.get("OrderTotal") or {}
                    total_amount = float(order_total_dict.get("Amount", 0.0) if order_total_dict else 0.0)

                    # Performance optimization: if order already exists in our DB, we already have its items!
                    parsed_items = []
                    if order_id not in existing_ids and status != "Canceled":
                        # Fetch order items for new orders with rate limiting matching Amazon quota
                        time.sleep(1.0)
                        try:
                            items_res = fetch_with_backoff(orders_api.get_order_items, order_id)
                            items_data = (items_res.payload or {}).get("OrderItems", []) if items_res else []
                            for item in items_data:
                                item_price_dict = item.get("ItemPrice") or {}
                                parsed_items.append({
                                    "amazon_line_item_id": item.get("OrderItemId", "default"),
                                    "sku": item.get("SellerSKU"),
                                    "quantity": item.get("QuantityOrdered", 1),
                                    "price": float(item_price_dict.get("Amount", 0.0) if item_price_dict else 0.0),
                                    "title": item.get("Title")
                                })
                        except Exception as item_err:
                            logger.error(f"Failed to fetch order items for {order_id}: {item_err}")

                    page_orders.append({
                        "order_id": order_id,
                        "status": status,
                        "fulfillment_channel": fulfillment_channel,
                        "items": parsed_items,
                        "purchase_date": purchase_date,
                        "total": total_amount,
                        "last_update_date": last_update_date,
                        "is_known_order": (order_id in existing_ids)
                    })

                all_orders.extend(page_orders)

                # Incremental commit callback
                if on_page_callback and callable(on_page_callback):
                    try:
                        on_page_callback(page_orders)
                    except Exception as cb_err:
                        logger.error(f"Error in on_page_callback: {cb_err}", exc_info=True)

                if not next_token:
                    logger.info("Reached last page of Amazon orders (no NextToken).")
                    break

                if max_pages and page_num >= max_pages:
                    logger.info(f"Reached max_pages limit ({max_pages}). Stopping pagination.")
                    break

                # Respect SP-API get_orders rate limit between pages
                time.sleep(1.5)

            return all_orders
        except Exception as e:
            logger.error(f"Failed to fetch orders from SP-API: {e}", exc_info=True)
            return []

    def request_and_download_shipment_report(self, start_date: datetime, end_date: datetime = None) -> str:
        """
        Requests Amazon Fulfilled Shipments Report (GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL),
        polls until processingStatus == 'DONE', and downloads the report document content (CSV/TSV string).
        """
        if not self.Reports:
            raise RuntimeError("SP-API Reports library not available")

        import time
        from sp_api.base import Marketplaces
        marketplace = getattr(Marketplaces, self.marketplace, Marketplaces.IN)
        reports_api = self.Reports(credentials=self.credentials, marketplace=marketplace)

        end_dt = end_date or datetime.utcnow()
        logger.info(f"Requesting Amazon Fulfilled Shipments Report from {start_date} to {end_dt}...")
        
        create_res = reports_api.create_report(
            reportType="GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL",
            dataStartTime=start_date.isoformat(),
            dataEndTime=end_dt.isoformat()
        )
        report_id = (create_res.payload or {}).get("reportId")
        if not report_id:
            raise RuntimeError(f"Failed to create report: {create_res}")

        logger.info(f"Report created with ID: {report_id}. Waiting for Amazon processing...")
        max_attempts = 40
        for attempt in range(max_attempts):
            time.sleep(10)
            rep_res = reports_api.get_report(report_id)
            payload = rep_res.payload or {}
            status = payload.get("processingStatus")
            logger.info(f"Report {report_id} status: {status} (attempt {attempt + 1}/{max_attempts})")

            if status == "DONE":
                doc_id = payload.get("reportDocumentId")
                logger.info(f"Report ready! Downloading document {doc_id}...")
                doc_res = reports_api.get_report_document(doc_id, download=True)
                doc_payload = doc_res.payload or {}
                return doc_payload.get("document", "")
            elif status in ("CANCELLED", "FATAL"):
                raise RuntimeError(f"Amazon report processing failed with status: {status}")

        raise TimeoutError("Timed out waiting for Amazon to generate shipment report.")


def get_amazon_client() -> AmazonClient:
    client_type = os.getenv("AMAZON_CLIENT", "mock").lower()
    if client_type == "spapi":
        return SPAPIAmazonClient()
    return MockAmazonClient()

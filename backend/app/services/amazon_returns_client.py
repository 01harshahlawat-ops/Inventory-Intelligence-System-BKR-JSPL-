import abc
import os
from typing import List, Dict, Any
from datetime import datetime, timedelta

class AmazonReturnsClient(abc.ABC):
    @abc.abstractmethod
    def fetch_returns(self, since: datetime = None) -> List[Dict[str, Any]]:
        """
        Fetch recent returns from Amazon.
        Each return should be a dict containing at least:
        - amazon_return_id: str
        - amazon_order_id: str
        - order_item_id: str
        - sku: str
        - asin: str
        - product_name: str
        - quantity: int
        - return_reason: str
        - return_status: str ("In Transit", "Received")
        - requested_at: datetime string
        - received_at: datetime string (optional)
        """

class MockAmazonReturnsClient(AmazonReturnsClient):
    def fetch_returns(self, since: datetime = None) -> List[Dict[str, Any]]:
        """
        Mock client. Disabled per user request to prevent dummy data generation.
        """
        return []

class SPAPIAmazonReturnsClient(AmazonReturnsClient):
    def __init__(self):
        try:
            from sp_api.api import Reports
            from sp_api.base import Marketplaces
            self.Reports = Reports
            self.Marketplaces = Marketplaces
        except ImportError:
            self.Reports = None
            self.Marketplaces = None
            
        self.credentials = dict(
            refresh_token=os.getenv("LWA_REFRESH_TOKEN") or os.getenv("SP_API_REFRESH_TOKEN"),
            lwa_app_id=os.getenv("LWA_CLIENT_ID") or os.getenv("SP_API_LWA_APP_ID"),
            lwa_client_secret=os.getenv("LWA_CLIENT_SECRET") or os.getenv("SP_API_LWA_CLIENT_SECRET"),
        )
        if os.getenv("SP_API_USE_IAM", "false").lower() == "true":
            self.credentials.update(
                aws_secret_key=os.getenv("AWS_SECRET_KEY") or os.getenv("SP_API_AWS_SECRET_KEY"),
                aws_access_key=os.getenv("AWS_ACCESS_KEY") or os.getenv("SP_API_AWS_ACCESS_KEY"),
                role_arn=os.getenv("AWS_IAM_ROLE_ARN") or os.getenv("SP_API_ROLE_ARN"),
            )
        self.marketplace_str = os.getenv("MARKETPLACE_ID", "IN")

    def fetch_returns(self, since: datetime = None) -> List[Dict[str, Any]]:
        """
        Fetches real customer returns from Amazon SP-API.
        Reads both FBA customer returns (GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA)
        and MFN returns (GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE).
        """
        if not self.Reports:
            import logging
            logging.getLogger(__name__).error("Cannot fetch returns: sp-api-python package is missing.")
            return []

        import time
        import logging
        from datetime import timezone
        logger = logging.getLogger(__name__)

        marketplace = getattr(self.Marketplaces, self.marketplace_str, self.Marketplaces.IN)
        reports_api = self.Reports(credentials=self.credentials, marketplace=marketplace)

        def fetch_doc_with_backoff(doc_id: str, max_retries: int = 3) -> str:
            for attempt in range(max_retries):
                try:
                    res = reports_api.get_report_document(doc_id, download=True)
                    return (res.payload or {}).get("document", "")
                except Exception as e:
                    err_str = str(e)
                    if "QuotaExceeded" in err_str or "TooManyRequests" in err_str or "429" in err_str:
                        wait = 2 ** (attempt + 1)
                        logger.warning(f"Reports API rate limit reached on doc {doc_id}. Waiting {wait}s...")
                        time.sleep(wait)
                    else:
                        logger.error(f"Failed to download report document {doc_id}: {e}")
                        return ""
            return ""

        seen_keys = set()
        returns_list: List[Dict[str, Any]] = []

        # 1. Fetch FBA Returns
        try:
            logger.info("Fetching completed FBA returns reports from Amazon SP-API...")
            fba_rep_res = reports_api.get_reports(
                reportTypes=["GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA"],
                processingStatuses=["DONE"],
                pageSize=5
            )
            fba_reports = (fba_rep_res.payload or {}).get("reports", [])

            # Check if we should request a fresh report
            should_create_fba = False
            if not fba_reports:
                should_create_fba = True
            else:
                newest_str = fba_reports[0].get("createdTime")
                if newest_str:
                    try:
                        from dateutil import parser as dt_parser
                        newest_dt = dt_parser.isoparse(newest_str)
                        if datetime.now(timezone.utc) - newest_dt > timedelta(hours=12):
                            should_create_fba = True
                    except Exception:
                        pass

            if should_create_fba:
                try:
                    logger.info("Requesting fresh FBA customer returns report from Amazon...")
                    start_dt = (datetime.now(timezone.utc) - timedelta(days=60)).strftime("%Y-%m-%dT00:00:00Z")
                    cr = reports_api.create_report(
                        reportType="GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA",
                        dataStartTime=start_dt
                    )
                    new_rep_id = (cr.payload or {}).get("reportId")
                    if new_rep_id:
                        for _ in range(6):
                            time.sleep(5)
                            st = reports_api.get_report(new_rep_id)
                            st_payload = st.payload or {}
                            if st_payload.get("processingStatus") == "DONE":
                                fba_reports.insert(0, st_payload)
                                break
                            elif st_payload.get("processingStatus") in ["FATAL", "CANCELLED"]:
                                break
                except Exception as cr_err:
                    logger.warning(f"Could not request on-demand FBA returns report: {cr_err}")

            # Process newest FBA report (each report spans up to 60 days of returns)
            for r in fba_reports[:1]:
                doc_id = r.get("reportDocumentId")
                if not doc_id:
                    continue
                time.sleep(1.0)
                doc_content = fetch_doc_with_backoff(doc_id)
                if not doc_content:
                    continue

                lines = [l.strip() for l in doc_content.split("\n") if l.strip()]
                if len(lines) <= 1:
                    continue

                headers = [h.strip() for h in lines[0].split("\t")]
                for line in lines[1:]:
                    parts = [p.strip() for p in line.split("\t")]
                    row = dict(zip(headers, parts))
                    
                    order_id = row.get("order-id")
                    sku = row.get("sku")
                    if not order_id or not sku:
                        continue

                    lpn = row.get("license-plate-number") or ""
                    amazon_return_id = lpn if lpn else f"FBA-{order_id}-{sku}"
                    order_item_id = lpn if lpn else f"{order_id}-{sku}"
                    
                    key = (amazon_return_id, order_item_id)
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)

                    qty_str = row.get("quantity", "1")
                    try:
                        qty = int(qty_str)
                    except (ValueError, TypeError):
                        qty = 1

                    disposition = row.get("detailed-disposition", "")
                    reason = row.get("reason", "")
                    comments = row.get("customer-comments", "").strip()
                    fc = row.get("fulfillment-center-id", "")
                    
                    reason_parts = []
                    if disposition:
                        reason_parts.append(f"[{disposition}]")
                    if reason:
                        reason_parts.append(reason)
                    if fc:
                        reason_parts.append(f"(FC: {fc})")
                    if comments:
                        reason_parts.append(f"- {comments}")
                    full_reason = " ".join(reason_parts) if reason_parts else "Customer Return"

                    ret_date = row.get("return-date")

                    returns_list.append({
                        "amazon_return_id": amazon_return_id,
                        "amazon_order_id": order_id,
                        "order_item_id": order_item_id,
                        "sku": sku,
                        "asin": row.get("asin"),
                        "product_name": row.get("product-name"),
                        "quantity": qty,
                        "return_reason": full_reason,
                        "return_status": "Received",  # Physically received at Amazon FC
                        "requested_at": ret_date,
                        "received_at": ret_date,
                    })

        except Exception as fba_err:
            logger.error(f"Error fetching FBA returns: {fba_err}", exc_info=True)

        # 2. Fetch MFN Returns
        try:
            logger.info("Fetching completed MFN returns reports from Amazon SP-API...")
            mfn_rep_res = reports_api.get_reports(
                reportTypes=["GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE"],
                processingStatuses=["DONE"],
                pageSize=5
            )
            mfn_reports = (mfn_rep_res.payload or {}).get("reports", [])

            # Check if we should request a fresh MFN returns report
            should_create_mfn = False
            if not mfn_reports:
                should_create_mfn = True
            else:
                newest_str = mfn_reports[0].get("createdTime")
                if newest_str:
                    try:
                        from dateutil import parser as dt_parser
                        newest_dt = dt_parser.isoparse(newest_str)
                        if datetime.now(timezone.utc) - newest_dt > timedelta(hours=12):
                            should_create_mfn = True
                    except Exception:
                        pass

            if should_create_mfn:
                try:
                    logger.info("Requesting fresh MFN customer returns report from Amazon...")
                    start_dt = (datetime.now(timezone.utc) - timedelta(days=60)).strftime("%Y-%m-%dT00:00:00Z")
                    cr = reports_api.create_report(
                        reportType="GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE",
                        dataStartTime=start_dt
                    )
                    new_rep_id = (cr.payload or {}).get("reportId")
                    if new_rep_id:
                        for _ in range(6):
                            time.sleep(5)
                            st = reports_api.get_report(new_rep_id)
                            st_payload = st.payload or {}
                            if st_payload.get("processingStatus") == "DONE":
                                mfn_reports.insert(0, st_payload)
                                break
                            elif st_payload.get("processingStatus") in ["FATAL", "CANCELLED"]:
                                break
                except Exception as cr_err:
                    logger.warning(f"Could not request on-demand MFN returns report: {cr_err}")

            for r in mfn_reports[:1]:
                doc_id = r.get("reportDocumentId")
                if not doc_id:
                    continue
                time.sleep(1.0)
                doc_content = fetch_doc_with_backoff(doc_id)
                if not doc_content:
                    continue

                lines = [l.strip() for l in doc_content.split("\n") if l.strip()]
                if len(lines) <= 1:
                    continue

                headers = [h.strip() for h in lines[0].split("\t")]
                for line in lines[1:]:
                    parts = [p.strip() for p in line.split("\t")]
                    row = dict(zip(headers, parts))
                    
                    order_id = row.get("Order ID")
                    sku = (row.get("Merchant SKU") or row.get(" Merchant SKU") or "").strip()
                    if not order_id or not sku:
                        continue

                    rma = row.get("Amazon RMA ID") or ""
                    item_id = row.get("Order Item ID") or ""
                    amazon_return_id = rma if rma else (item_id if item_id else f"MFN-{order_id}-{sku}")
                    order_item_id = item_id if item_id else f"{order_id}-{sku}"

                    key = (amazon_return_id, order_item_id)
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)

                    qty_str = row.get("Return quantity", "1")
                    try:
                        qty = int(qty_str)
                    except (ValueError, TypeError):
                        qty = 1

                    req_status = row.get("Return request status", "Approved")
                    del_date = row.get("Return delivery date", "").strip()
                    req_date = row.get("Return request date", "").strip()

                    status = "Received" if (del_date or req_status in ["Delivered", "Received"]) else "In Transit"

                    returns_list.append({
                        "amazon_return_id": amazon_return_id,
                        "amazon_order_id": order_id,
                        "order_item_id": order_item_id,
                        "sku": sku,
                        "asin": row.get("ASIN"),
                        "product_name": row.get("Item Name"),
                        "quantity": qty,
                        "return_reason": row.get("Return reason") or "Merchant Return",
                        "return_status": status,
                        "requested_at": req_date or None,
                        "received_at": del_date or None,
                    })

        except Exception as mfn_err:
            logger.error(f"Error fetching MFN returns: {mfn_err}", exc_info=True)

        logger.info(f"SPAPIAmazonReturnsClient successfully fetched {len(returns_list)} unique returns.")
        return returns_list

def get_amazon_returns_client() -> AmazonReturnsClient:
    client_type = os.getenv("AMAZON_CLIENT", "mock").lower()
    if client_type == "spapi":
        return SPAPIAmazonReturnsClient()
    return MockAmazonReturnsClient()

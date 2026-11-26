from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional
import logging

import requests
from sqlalchemy.orm import Session

from app.models.schema import Sale, Company, CompanySettings
from app.services.tally_payload_builder import TallyPayloadBuilder
from app.services.audit_log_service import AuditLogService

logger = logging.getLogger(__name__)


@dataclass
class TallySyncResult:
    status: str  # SUCCESS | FAILED | NOT_APPLICABLE
    reference: Optional[str] = None
    error_message: Optional[str] = None


class TallyIntegrationService:
    """
    Optional integration layer.
    - Does not control whether a sale is saved (sale is already persisted).
    - Only updates Sale tally_* fields + logs audit events.
    """

    @staticmethod
    def is_enabled_for_company(db: Session, company_id: int) -> bool:
        settings = db.query(CompanySettings).filter(CompanySettings.company_id == company_id).first()
        return bool(settings and settings.tally_enabled)

    @staticmethod
    def sync_sale(db: Session, *, sale_id: int, mode: str = "PROCESSING") -> TallySyncResult:
        sale = db.query(Sale).filter(Sale.id == sale_id).first()
        if not sale:
            return TallySyncResult(status="FAILED", error_message="Sale not found")

        company = db.query(Company).filter(Company.id == sale.company_id).first()
        settings = db.query(CompanySettings).filter(CompanySettings.company_id == sale.company_id).first()

        # Only B2B can sync; B2C must never sync.
        if (sale.invoice_type or "B2C") != "B2B":
            sale.tally_sync_status = "NOT_APPLICABLE"
            sale.tally_sync_at = datetime.utcnow()
            db.flush()
            return TallySyncResult(status="NOT_APPLICABLE")

        if not settings or not settings.tally_enabled:
            sale.tally_sync_status = "NOT_APPLICABLE"
            sale.tally_sync_at = datetime.utcnow()
            db.flush()
            return TallySyncResult(status="NOT_APPLICABLE")

        endpoint = (settings.tally_endpoint_url or "").strip()
        payload_format = (settings.tally_payload_format or "XML").strip().upper()
        if not endpoint:
            sale.tally_sync_status = "FAILED"
            sale.tally_sync_at = datetime.utcnow()
            sale.tally_error_message = "Tally is enabled but endpoint URL is not configured."
            db.flush()
            AuditLogService.log(
                db,
                company_id=sale.company_id,
                entity_type="Sale",
                entity_id=sale.id,
                event_type="TALLY_SYNC_FAILED",
                message=sale.tally_error_message,
                metadata={"company_code": getattr(company, "code", None)},
            )
            return TallySyncResult(status="FAILED", error_message=sale.tally_error_message)

        sale.tally_sync_status = mode
        sale.tally_error_message = None
        db.flush()

        AuditLogService.log(
            db,
            company_id=sale.company_id,
            entity_type="Sale",
            entity_id=sale.id,
            event_type="TALLY_SYNC_STARTED",
            message="Tally synchronization started",
            metadata={"endpoint": endpoint, "format": payload_format},
        )

        try:
            if payload_format == "JSON":
                payload = TallyPayloadBuilder.build_json(sale)
                resp = requests.post(endpoint, json=payload, timeout=20)
            else:
                payload = TallyPayloadBuilder.build_xml(sale, db=db)
                resp = requests.post(endpoint, data=payload.encode("utf-8"), headers={"Content-Type": "text/xml"}, timeout=20)

            if 200 <= resp.status_code < 300:
                ref = (resp.text or "").strip()[:200] or None
                sale.tally_sync_status = "SUCCESS"
                sale.tally_sync_at = datetime.utcnow()
                sale.tally_reference = ref
                sale.tally_error_message = None
                db.flush()

                AuditLogService.log(
                    db,
                    company_id=sale.company_id,
                    entity_type="Sale",
                    entity_id=sale.id,
                    event_type="TALLY_SYNC_SUCCESS",
                    message="Tally synchronization succeeded",
                    metadata={"reference": ref},
                )
                return TallySyncResult(status="SUCCESS", reference=ref)

            error_msg = f"Tally sync failed: HTTP {resp.status_code} - {(resp.text or '').strip()[:500]}"
            sale.tally_sync_status = "FAILED"
            sale.tally_sync_at = datetime.utcnow()
            sale.tally_error_message = error_msg
            db.flush()

            AuditLogService.log(
                db,
                company_id=sale.company_id,
                entity_type="Sale",
                entity_id=sale.id,
                event_type="TALLY_SYNC_FAILED",
                message=error_msg,
                metadata={"http_status": resp.status_code},
            )
            return TallySyncResult(status="FAILED", error_message=error_msg)

        except Exception as exc:
            error_msg = f"Tally sync exception: {str(exc)}"
            logger.error(error_msg, exc_info=True)
            sale.tally_sync_status = "FAILED"
            sale.tally_sync_at = datetime.utcnow()
            sale.tally_error_message = error_msg
            db.flush()

            AuditLogService.log(
                db,
                company_id=sale.company_id,
                entity_type="Sale",
                entity_id=sale.id,
                event_type="TALLY_SYNC_FAILED",
                message=error_msg,
                metadata={"exception": str(exc)},
            )
            return TallySyncResult(status="FAILED", error_message=error_msg)


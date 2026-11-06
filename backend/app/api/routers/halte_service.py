import os
import logging
import requests
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models.db import get_db
from app.api.dependencies import get_current_user

logger = logging.getLogger("halte_service")

router = APIRouter(prefix="/halte-service", tags=["Halte Service Portal"])

HALTE_API_URL = os.getenv("HALTE_API_URL", "https://halte.in")
HALTE_API_KEY = os.getenv("HALTE_API_KEY", "sdbl573th5ige8ityi65iubtlnrshvopbw3jv")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class UpdateStatusRequest(BaseModel):
    booking_status: str
    remarks: Optional[str] = None
    technician_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/stats")
def get_service_stats():
    """Summary counts of service bookings from Halte.in web portal."""
    url = f"{HALTE_API_URL}/api/haltedb/service-bookings"
    headers = {"x-api-key": HALTE_API_KEY}
    params = {"limit": 1}

    try:
        res = requests.get(url, headers=headers, params=params, timeout=15)
        res.raise_for_status()
        data = res.json()
        summary = data.get("summary", {
            "total": 0, "pending": 0, "assigned": 0, "ongoing": 0, "completed": 0, "paid": 0
        })
        return {
            "success": True,
            "summary": summary
        }
    except Exception as e:
        logger.error(f"Failed to fetch Halte service stats: {e}", exc_info=True)
        return {
            "success": False,
            "summary": {"total": 0, "pending": 0, "assigned": 0, "ongoing": 0, "completed": 0, "paid": 0},
            "error": str(e)
        }


@router.get("/bookings")
def list_service_bookings(
    search: Optional[str] = Query(None),
    booking_status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500)
):
    """List service bookings submitted by customers on Halte.in."""
    url = f"{HALTE_API_URL}/api/haltedb/service-bookings"
    headers = {"x-api-key": HALTE_API_KEY}
    
    actual_limit = limit if isinstance(limit, int) else 100
    params = {"limit": actual_limit}

    if search and isinstance(search, str):
        params["search"] = search
    if booking_status and isinstance(booking_status, str):
        params["bookingStatus"] = booking_status

    try:
        res = requests.get(url, headers=headers, params=params, timeout=20)
        res.raise_for_status()
        data = res.json()
        return data
    except Exception as e:
        logger.error(f"Failed to fetch Halte service bookings: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to connect to Halte Service Portal: {str(e)}"
        )


@router.patch("/bookings/{booking_id}/status")
def update_service_booking_status(
    booking_id: str,
    req: UpdateStatusRequest
):
    """Update status of a service booking on Halte.in."""
    url = f"{HALTE_API_URL}/api/haltedb/service-bookings"
    headers = {"x-api-key": HALTE_API_KEY, "Content-Type": "application/json"}
    payload = {
        "booking_id": booking_id,
        "booking_status": req.booking_status,
        "remarks": req.remarks,
        "technician_id": req.technician_id
    }

    try:
        res = requests.patch(url, headers=headers, json=payload, timeout=15)
        res.raise_for_status()
        return res.json()
    except Exception as e:
        logger.error(f"Failed to update Halte service booking {booking_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to update booking on Halte.in: {str(e)}"
        )

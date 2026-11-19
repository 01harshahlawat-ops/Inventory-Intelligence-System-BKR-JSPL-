import logging
import time
from datetime import datetime

from app.models.db import SessionLocal
from app.models.schema import Company, CompanySettings, AmazonReturnSyncLog
from app.services.amazon_returns_service import AmazonReturnsService
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

def run_amazon_returns_sync_job(company_id: int):
    """
    Executes the Amazon Returns Sync for a specific company, logs the execution,
    and handles failures gracefully.
    """
    db = SessionLocal()
    start_time = datetime.utcnow()
    start_time_ts = time.time()
    
    # Create the running log
    log_entry = AmazonReturnSyncLog(
        company_id=company_id,
        started_at=start_time,
        status="Running"
    )
    db.add(log_entry)
    db.commit()
    db.refresh(log_entry)
    
    status = "Failed"
    error_msg = None
    records_created = 0
    records_updated = 0
    
    try:
        # Perform the actual sync
        records_created, records_updated = AmazonReturnsService.sync_returns(db, company_id=company_id)
        status = "Success"
    except Exception as e:
        logger.error(f"Amazon Returns Sync failed for company {company_id}: {e}", exc_info=True)
        error_msg = str(e)
        raise
    finally:
        end_time_ts = time.time()
        
        # Update the log
        log_entry.completed_at = datetime.utcnow()
        log_entry.duration = end_time_ts - start_time_ts
        log_entry.status = status
        log_entry.error_message = error_msg
        log_entry.records_created = records_created
        log_entry.records_updated = records_updated
        
        try:
            db.commit()
        except Exception as e:
            logger.error(f"Failed to update AmazonReturnSyncLog for company {company_id}: {e}", exc_info=True)
            raise
        db.close()

def _orchestrate_amazon_returns_sync():
    """
    Orchestrator: fetches all active companies that have amazon returns sync enabled,
    and runs the sync job for each one.
    """
    db = SessionLocal()
    try:
        # Join Company and CompanySettings to fetch enabled active companies in one query
        companies = db.query(Company).join(
            CompanySettings, Company.id == CompanySettings.company_id
        ).filter(
            CompanySettings.amazon_returns_sync_enabled == True,
            Company.status.in_(["ACTIVE", "Active"])
        ).all()

        for company in companies:
            logger.info(f"Triggering Amazon Returns Sync for company {company.code} (ID: {company.id})")
            run_amazon_returns_sync_job(company_id=company.id)
    finally:
        db.close()

def register_amazon_returns_jobs(scheduler):
    """
    Registers the Amazon Returns Sync orchestrator in the main APScheduler instance.
    Configurable via AMAZON_RETURNS_POLL_INTERVAL_MINUTES, defaulting to 60 minutes.
    """
    returns_interval = int(os.getenv("AMAZON_RETURNS_POLL_INTERVAL_MINUTES", "60"))
    scheduler.add_job(
        _orchestrate_amazon_returns_sync,
        IntervalTrigger(minutes=returns_interval),
        id="amazon_returns_sync",
        replace_existing=True
    )
    logger.info(f"Registered Amazon Returns Sync job (Interval: {returns_interval}m)")

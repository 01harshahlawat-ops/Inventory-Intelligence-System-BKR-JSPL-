import fcntl
import logging
import os
import time
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.models.db import SessionLocal
from app.models.schema import JobExecutionLog, Inventory, InventorySnapshot, Company
from app.services.report_service import ReportService
from app.services.amazon_service import AmazonService
from app.services.amazon_returns_scheduler import register_amazon_returns_jobs
from app.services.service_reminder_service import ServiceReminderService

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()
_scheduler_lock_handle = None
_SCHEDULER_LOCK_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".scheduler.lock")


def _acquire_scheduler_lock() -> bool:
    global _scheduler_lock_handle

    if _scheduler_lock_handle is not None and hasattr(_scheduler_lock_handle, "closed") and not _scheduler_lock_handle.closed:
        return True

    try:
        lock_handle = open(_SCHEDULER_LOCK_PATH, "w")
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        lock_handle.write(str(os.getpid()))
        lock_handle.flush()
        _scheduler_lock_handle = lock_handle
        return True
    except (BlockingIOError, OSError):
        return False


def _release_scheduler_lock():
    global _scheduler_lock_handle

    if _scheduler_lock_handle is None:
        return

    try:
        if hasattr(_scheduler_lock_handle, "closed") and not _scheduler_lock_handle.closed:
            fcntl.flock(_scheduler_lock_handle.fileno(), fcntl.LOCK_UN)
    except Exception:
        pass
    finally:
        try:
            if hasattr(_scheduler_lock_handle, "closed") and not _scheduler_lock_handle.closed:
                _scheduler_lock_handle.close()
        except Exception:
            pass
        _scheduler_lock_handle = None

def execute_job_with_logging(job_name: str, func, company_id: int = None):
    """
    Wrapper to execute a job for a specific company, log it to the database, and handle exceptions.
    Each call creates its own DB session, executes the job, and closes the session.
    """
    db = SessionLocal()
    start_time = datetime.utcnow()
    start_time_ts = time.time()
    
    # Create the running log
    log_entry = JobExecutionLog(
        job_name=job_name,
        company_id=company_id,
        start_time=start_time,
        status="Running"
    )
    db.add(log_entry)
    db.commit()
    db.refresh(log_entry)
    
    status = "Failed"
    error_msg = None
    
    try:
        func(db, company_id)
        status = "Success"
    except Exception as e:
        logger.error(f"Job {job_name} failed: {e}", exc_info=True)
        error_msg = str(e)
        raise
    finally:
        end_time_ts = time.time()
        
        # Update the log
        log_entry.end_time = datetime.utcnow()
        log_entry.duration_seconds = end_time_ts - start_time_ts
        log_entry.status = status
        log_entry.error_message = error_msg
        
        try:
            db.commit()
        except Exception as e:
            logger.error(f"Failed to update JobExecutionLog for {job_name}: {e}")
        
        db.close()

# ---------------------------------------------------------
# Job Implementations
# ---------------------------------------------------------

def midnight_inventory_snapshot(db, company_id: int):
    """
    Reads all inventory and does a bulk insert into InventorySnapshots.
    Uses a transaction to ensure fast insertion.
    """
    now = datetime.utcnow()
    inventory_items = db.query(Inventory).filter(Inventory.company_id == company_id).all()
    
    snapshots = [
        InventorySnapshot(
            company_id=company_id,
            date=now,
            warehouse_id=item.warehouse_id,
            product_id=item.product_id,
            quantity=item.current_qty
        )
        for item in inventory_items
    ]
    
    # Bulk insert
    db.bulk_save_objects(snapshots)
    db.commit()
    logger.info(f"Created {len(snapshots)} inventory snapshots for {now.date()} for company {company_id}")

def daily_replenishment_report(db, company_id: int):
    """
    Generates the daily replenishment report.
    """
    try:
        ReportService.generate_replenishment(db, company_id=company_id, format="xlsx")
    except ValueError as e:
        logger.info(f"No replenishment needed for company {company_id}: {e}")
        
    try:
        ReportService.generate_replenishment(db, company_id=company_id, format="csv")
    except ValueError:
        pass
    logger.info(f"Daily replenishment reports generated successfully for company {company_id}.")

def poll_amazon_orders(db, company_id: int):
    """
    Polls Amazon for new orders for a specific company.
    """
    processed, skipped = AmazonService.poll_orders(db, company_id=company_id)
    logger.info(f"Amazon polling complete for company {company_id}. Processed: {processed}, Skipped (Duplicates): {skipped}")

# ---------------------------------------------------------
# Orchestration functions (NO logging for orchestrators)
# ---------------------------------------------------------

def _run_for_all_companies(job_name_template: str, job_func):
    """
    Orchestrator: fetches all active companies and runs job_func for each one
    via execute_job_with_logging. The orchestrator itself is NOT logged.
    """
    db = SessionLocal()
    try:
        companies = db.query(Company).filter(Company.status == "Active").all()
        company_ids = [c.id for c in companies]
        company_codes = {c.id: c.code for c in companies}
    finally:
        db.close()
    
    for cid in company_ids:
        execute_job_with_logging(
            f"{job_name_template} (Co: {company_codes[cid]})",
            job_func,
            company_id=cid
        )

def _orchestrate_midnight_snapshot():
    _run_for_all_companies("Midnight Snapshot", midnight_inventory_snapshot)

def _orchestrate_daily_replenishment():
    _run_for_all_companies("Daily Replenishment Report", daily_replenishment_report)

def _orchestrate_amazon_polling():
    default_co_id = int(os.getenv("DEFAULT_AMAZON_COMPANY_ID", "3"))
    execute_job_with_logging("Amazon Polling", poll_amazon_orders, company_id=default_co_id)

def daily_service_reminders(db, company_id: int):
    count = ServiceReminderService.generate_reminders(db, company_id)
    logger.info(f"Generated {count} service reminders for company {company_id}")

def _orchestrate_daily_service_reminders():
    _run_for_all_companies("Daily Service Reminders", daily_service_reminders)

# ---------------------------------------------------------
# Scheduler Setup
# ---------------------------------------------------------

def start_scheduler() -> bool:
    if os.getenv("ENABLE_SCHEDULER", "true").lower() not in ("true", "1", "yes"):
        logger.info("Background scheduler disabled via ENABLE_SCHEDULER=false")
        return False

    if scheduler.running:
        return True

    if not _acquire_scheduler_lock():
        logger.info("Scheduler startup skipped because another process already owns the scheduler lock.")
        return False
        
    # Midnight Snapshot Job (00:00 every day)
    scheduler.add_job(
        _orchestrate_midnight_snapshot,
        CronTrigger(hour=0, minute=0),
        id="midnight_snapshot",
        replace_existing=True
    )
    
    # Daily Replenishment Report (14:00 every day)
    scheduler.add_job(
        _orchestrate_daily_replenishment,
        CronTrigger(hour=14, minute=0),
        id="daily_replenishment_report",
        replace_existing=True
    )
    
    # Daily Service Reminders (02:00 every day)
    scheduler.add_job(
        _orchestrate_daily_service_reminders,
        CronTrigger(hour=2, minute=0),
        id="daily_service_reminders",
        replace_existing=True
    )
    
    # Amazon Polling (every X minutes, default 60 to prevent egress exhaustion)
    poll_interval = int(os.getenv("AMAZON_POLL_INTERVAL_MINUTES", "60"))
    scheduler.add_job(
        _orchestrate_amazon_polling,
        IntervalTrigger(minutes=poll_interval),
        id="amazon_polling",
        replace_existing=True
    )
    
    # Amazon Returns Sync
    register_amazon_returns_jobs(scheduler)
    
    # Start scheduler
    scheduler.start()
    logger.info("APScheduler started with jobs initialized.")
    return True

def shutdown_scheduler():
    if scheduler.running:
        scheduler.shutdown()
        logger.info("APScheduler shutdown successfully.")
    _release_scheduler_lock()

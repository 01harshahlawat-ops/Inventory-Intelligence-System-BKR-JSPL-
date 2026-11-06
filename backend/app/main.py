from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.dependencies import get_current_user
from fastapi import Depends, APIRouter

import logging
import os
import shutil
from typing import List

import pandas as pd
from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from contextlib import asynccontextmanager

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.models.context import ExecutionContext
from app.repositories.config_repository import ConfigRepository
from app.repositories.lookup_repository import LookupRepository
from app.engines.transformation import TransformationEngine
from app.engines.validation import ValidationEngine
from app.services.transformation_service import TransformationService
from app.plugins.plugin_registry import PluginRegistry

# New routers
from app.api.routers.products import router as products_router
from app.api.routers import fix_sku, debug_sku, debug_db, purchases
from app.api.routers import fix_sku, debug_sku, debug_db, reports, replenishment, transfers, accounting, amazon_returns, defective_inventory, returns_reports
from app.api.routers.sales_returns import router as sales_returns_router
from app.api.routers.delivery_challans import router as delivery_challans_router
from app.api.routers.fc_returns import router as fc_returns_router
from app.api.routers.business_reports import router as business_reports_router
from app.api.routers.warehouses import router as warehouses_router
from app.api.routers.inventory import router as inventory_router
from app.api.routers.state_hubs import router as state_hubs_router
from app.api.routers.warehouse_inventory import router as warehouse_inventory_router
from app.api.routers.dashboard import router as dashboard_router
from app.api.routers.companies import router as companies_router
from app.api.routers import fix_sku, debug_sku, debug_db, amazon
from app.api.routers.auth import router as auth_router
from app.api.routers import customers, vendors
from app.api.routers.users import router as users_router
from app.api.routers.pos import router as pos_router
from app.api.routers.company_settings import router as company_settings_router
from app.api.routers.fc_dispatches import router as fc_dispatches_router
from app.api.routers.fc_returns import router as fc_returns_router
from app.api.routers.damage_claims import router as damage_claims_router
from app.api.routers.services import router as services_router
from app.api.routers.bkr_services import router as bkr_services_router
from app.api.routers.admin_approvals import router as admin_approvals_router
from app.api.routers.service_reminders import router as service_reminders_router
from app.api.routers.documents import router as documents_router
from app.api.routers.bulk_upload import router as bulk_upload_router
from app.api.routers.einvoice import router as einvoice_router
from app.api.routers.halte_orders import router as halte_orders_router

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
import uuid
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.logging_context import request_id_var, route_var, method_var, ContextFilter

from logging.handlers import RotatingFileHandler

LOGS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
os.makedirs(LOGS_DIR, exist_ok=True)

# Max 10MB, keep 5 backups
file_handler = RotatingFileHandler(
    os.path.join(LOGS_DIR, "app.log"),
    maxBytes=10_000_000,
    backupCount=5
)
console_handler = logging.StreamHandler()

logging.basicConfig(
    level=logging.INFO, 
    format="%(asctime)s %(levelname)s [%(request_id)s] [%(method)s %(route)s] %(name)s: %(message)s",
    handlers=[file_handler, console_handler]
)
for handler in logging.root.handlers:
    handler.addFilter(ContextFilter())

logger = logging.getLogger("amazon_logic_transformer")
logger.addFilter(ContextFilter())

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
CONFIG_DIR = os.path.join(BASE_DIR, "config")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "outputs")
LOGS_DIR = os.path.join(BASE_DIR, "logs")
LOOKUP_DIR = os.path.join(BASE_DIR, "lookup_tables")

for d in (UPLOAD_DIR, OUTPUT_DIR, LOGS_DIR):
    os.makedirs(d, exist_ok=True)

# ---------------------------------------------------------------------------
# Repositories & engines
# ---------------------------------------------------------------------------
config_repo = ConfigRepository(config_dir=CONFIG_DIR)
lookup_repo = LookupRepository(base_dir=LOOKUP_DIR)
plugin_registry = PluginRegistry()
transformation_engine = TransformationEngine(registry=plugin_registry)
validation_engine = ValidationEngine()

transformation_service = TransformationService(
    transformation_engine=transformation_engine,
    validation_engine=validation_engine,
    config_repo=config_repo,
    output_dir=OUTPUT_DIR,
    logs_dir=LOGS_DIR,
)

from app.services.scheduler_service import start_scheduler, shutdown_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting up Amazon Logic Transformer...")
    start_scheduler()
    yield
    # Shutdown
    logger.info("Shutting down Amazon Logic Transformer...")
    shutdown_scheduler()

# ---------------------------------------------------------------------------
# FastAPI
# ---------------------------------------------------------------------------
app = FastAPI(title="Amazon Logic Transformer", version="1.0.0", lifespan=lifespan)

from app.api.dependencies import decode_access_token

def get_user_key(request: Request):
    if hasattr(request.state, "user") and request.state.user:
        return str(request.state.user.id)
    auth = request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        try:
            token = auth.split(" ")[1]
            payload = decode_access_token(token)
            if "sub" in payload:
                return str(payload["sub"])
        except Exception:
            pass
    return request.client.host if request.client else "unknown"

from app.core.limiter import limiter
limiter.key_func = get_user_key

app.state.limiter = limiter

from app.services.metrics_service import log_metric

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    user_id = get_user_key(request)
    logger.warning(f"RATE_LIMIT_HIT | user={user_id} | path={request.url.path}")
    log_metric("rate_limit_hit", 1)
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Slow down."}
    )
app.add_middleware(SlowAPIMiddleware)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unexpected error occurred")
    log_metric("api_failure", 1, {"route": request.url.path, "method": request.method})
    return JSONResponse(
        status_code=500,
        content={"detail": f"System Error: {str(exc)}", "traceback": __import__("traceback").format_exc()}
    )

class LoggingContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        req_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request_id_var.set(req_id)
        route_var.set(request.url.path)
        method_var.set(request.method)
        # Assuming current_user dependency gets the company/user, but middleware runs first.
        # We can extract it from headers or token if needed, or leave it for later.
        
        response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response

app.add_middleware(LoggingContextMiddleware)

import os

origins = [
    "http://localhost:5173", 
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "https://halte-data-transformation.vercel.app",
    "https://inventory-intelligence-system-bkr-j.vercel.app"
]

# Allow dynamic origins via environment variable (useful for Vercel preview URLs)
env_origins = os.getenv("ALLOWED_ORIGINS", "")
if env_origins:
    origins.extend([o.strip() for o in env_origins.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Inventory Management Routers

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    errors = exc.errors()
    error_msgs = []
    for error in errors:
        loc = "->".join(str(l) for l in error.get("loc", []))
        msg = error.get("msg", "")
        error_msgs.append(f"{loc}: {msg}")
    
    error_str = "Validation Error: " + ", ".join(error_msgs)
    # Return a STRING in detail so stuck React frontends don't crash when passing detail to toast.error
    return JSONResponse(status_code=422, content={"detail": error_str})


@app.get("/api/debug/logs")
def get_debug_logs():
    import os
    try:
        log_path = os.path.join(LOGS_DIR, "app.log")
        with open(log_path, "r") as f:
            lines = f.readlines()
            return {"logs": lines[-10000:]}
    except Exception as e:
        return {"error": str(e)}

app.include_router(state_hubs_router, prefix="/api")
app.include_router(warehouse_inventory_router, prefix="/api")
app.include_router(companies_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(customers.router, prefix="/api/customers")
app.include_router(vendors.router, prefix="/api/vendors")
app.include_router(fix_sku.router, prefix="/api")
app.include_router(debug_sku.router, prefix="/api")
app.include_router(debug_db.router, prefix="/api")
app.include_router(products_router, prefix="/api")
app.include_router(warehouses_router, prefix="/api")
app.include_router(inventory_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(purchases.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(pos_router, prefix="/api")
app.include_router(company_settings_router, prefix="/api")
app.include_router(replenishment.router, prefix="/api")
app.include_router(transfers.router, prefix="/api")
app.include_router(accounting.router, prefix="/api")
app.include_router(amazon_returns.router, prefix="/api")
app.include_router(amazon.router, prefix="/api")
app.include_router(amazon.router)
app.include_router(defective_inventory.router, prefix="/api")
app.include_router(returns_reports.router, prefix="/api")

# Phase 6
app.include_router(sales_returns_router, prefix="/api")
app.include_router(delivery_challans_router, prefix="/api")
app.include_router(services_router, prefix="/api")
app.include_router(service_reminders_router, prefix="/api")
app.include_router(documents_router, prefix="/api")

# Phase 9: Warehouse Logistics & Fulfillment Center Dispatch
app.include_router(fc_dispatches_router, prefix="/api")
app.include_router(fc_returns_router, prefix="/api")

# Phase 10A: Business Reports
app.include_router(business_reports_router, prefix="/api")
app.include_router(damage_claims_router, prefix="/api")
app.include_router(bkr_services_router, prefix="/api")
app.include_router(admin_approvals_router, prefix="/api/admin-approvals", tags=["Admin Approvals"])
app.include_router(einvoice_router, prefix="/api")
app.include_router(halte_orders_router, prefix="/api")

# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------
class UploadResponse(BaseModel):
    files: list
    message: str


class StatsResponse(BaseModel):
    rows_read: int = 0
    rows_processed: int = 0
    rows_removed: int = 0
    rows_failed: int = 0
    duplicate_invoices: int = 0
    missing_gst: int = 0
    missing_account_code: int = 0
    execution_time_ms: float = 0.0


class TransformResponse(BaseModel):
    output_filename: str = ""
    audit_filename: str = ""
    requirement_filename: str = ""
    duplicate_filename: str = ""
    stats: StatsResponse
    warnings: list
    message: str = ""


class DryRunResponse(BaseModel):
    preview_data: list
    preview_columns: list
    stats: StatsResponse
    warnings: list


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _build_context() -> ExecutionContext:
    mapping = config_repo.load_mapping()
    rules = config_repo.load_rules()
    lookups_cfg = config_repo.load_lookups_config()

    # Load Excel lookup tables
    loaded_lookups = {}
    for key, path in lookups_cfg.items():
        full_path = os.path.join(LOOKUP_DIR, path)
        if os.path.exists(full_path):
            try:
                if key == "account_lookup":
                    df = pd.read_excel(full_path, header=2)
                else:
                    df = pd.read_excel(full_path)
                # Clean column names
                df.columns = df.columns.str.strip()
                # Drop fully-empty rows
                df = df.dropna(how="all")
                loaded_lookups[key] = df
                logger.info("Loaded lookup '%s' with %d rows.", key, len(df))
            except Exception as exc:
                logger.error("Failed to load lookup %s: %s", path, exc)

    return ExecutionContext(mapping=mapping, rules=rules, lookups=loaded_lookups)


def _read_uploaded_files(filenames: List[str]) -> pd.DataFrame:
    frames = []
    for fname in filenames:
        safe_name = os.path.basename(fname)
        path = os.path.join(UPLOAD_DIR, safe_name)
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail=f"File not found: {safe_name}")
        df = pd.read_excel(path)
        frames.append(df)
    if not frames:
        raise HTTPException(status_code=400, detail="No files to process.")
    return pd.concat(frames, ignore_index=True)





# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

legacy_router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])


@app.get("/")
def health_check():
    return {"status": "ok", "message": "Amazon Logic Transformer is running."}


@legacy_router.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    """Upload one or more Excel files."""
    uploaded = []
    for f in files:
        if not f.filename.endswith((".xlsx", ".xls")):
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {f.filename}")
        dest = os.path.join(UPLOAD_DIR, os.path.basename(f.filename))
        with open(dest, "wb") as out:
            content = await f.read()
            out.write(content)
        uploaded.append({"name": f.filename, "size": len(content)})
        logger.info("Uploaded: %s (%d bytes)", f.filename, len(content))
    return UploadResponse(files=uploaded, message=f"{len(uploaded)} file(s) uploaded.")


@legacy_router.post("/transform")
async def transform(body: dict):
    """Run the full transformation pipeline and generate the output Excel."""
    filenames = body.get("filenames", [])
    if not filenames:
        raise HTTPException(status_code=400, detail="No filenames provided.")

    context = _build_context()
    context.current_data = _read_uploaded_files(filenames)

    # Run pipeline via service
    output_filename, audit_filename, result_dict = transformation_service.process(context, filenames)

    return TransformResponse(**result_dict)


@legacy_router.post("/dry-run")
async def dry_run(body: dict):
    """Run the pipeline without saving – return preview and stats."""
    filenames = body.get("filenames", [])
    if not filenames:
        raise HTTPException(status_code=400, detail="No filenames provided.")

    context = _build_context()
    context.current_data = _read_uploaded_files(filenames)

    transformation_engine.execute_pipeline(context)
    validation_engine.validate(context)

    preview = []
    columns = []
    if context.current_data is not None and not context.current_data.empty:
        preview_df = context.current_data.head(25).fillna("")
        columns = preview_df.columns.tolist()
        preview = preview_df.astype(str).values.tolist()

    return DryRunResponse(
        preview_data=preview,
        preview_columns=columns,
        stats=StatsResponse(**context.statistics.model_dump()),
        warnings=[w.model_dump() for w in context.warnings],
    )


@legacy_router.get("/download/{filename}")
async def download_file(filename: str):
    """Download a generated output file."""
    safe_filename = os.path.basename(filename)
    path = os.path.join(OUTPUT_DIR, safe_filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(
        path=path,
        filename=safe_filename,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@legacy_router.get("/config")
async def get_config():
    """Return the current configuration (mapping + rules + lookups)."""
    return {
        "mapping": config_repo.load_mapping(),
        "rules": config_repo.load_rules(),
        "lookups": config_repo.load_lookups_config(),
    }




@legacy_router.put("/config")
async def update_config(body: dict):
    """Update configuration files."""
    if "mapping" in body:
        config_repo.save_mapping(body["mapping"])
    if "rules" in body:
        config_repo.save_rules(body["rules"])
    if "lookups" in body:
        config_repo.save_lookups_config(body["lookups"])
    return {"status": "ok", "message": "Configuration updated."}


@legacy_router.get("/uploaded-files")
async def list_uploaded_files():
    """List files currently in the uploads directory."""
    files = []
    if os.path.exists(UPLOAD_DIR):
        for f in os.listdir(UPLOAD_DIR):
            fp = os.path.join(UPLOAD_DIR, f)
            if os.path.isfile(fp):
                files.append({"name": f, "size": os.path.getsize(fp)})
    return {"files": files}


@legacy_router.delete("/reset")
async def reset():
    """Clear uploads and outputs."""
    for d in (UPLOAD_DIR, OUTPUT_DIR):
        if os.path.exists(d):
            shutil.rmtree(d)
            os.makedirs(d)
    return {"status": "ok", "message": "All uploads and outputs cleared."}


app.include_router(bulk_upload_router, prefix="/api")
app.include_router(legacy_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)

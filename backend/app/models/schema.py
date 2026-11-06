from sqlalchemy.orm import relationship, validates
from sqlalchemy.ext.hybrid import hybrid_property

from sqlalchemy import Column, Index, Numeric, Integer, String, Float, Boolean, ForeignKey, DateTime, Enum as SQLEnum, Text, UniqueConstraint, JSON, text
import enum
from datetime import datetime
from app.models.db import Base


class VendorTransaction(Base):
    __tablename__ = 'vendor_transactions'

    id = Column(Integer, primary_key=True, index=True)
    vendor_id = Column(Integer, ForeignKey('vendors.id'), nullable=False)
    transaction_type = Column(String(50), nullable=False) # 'INVOICE' or 'PAYMENT'
    amount = Column(Numeric(15, 2), nullable=False)
    ref_purchase_id = Column(Integer, ForeignKey('purchases.id'), nullable=True)
    txn_ref = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    vendor = relationship("Vendor", backref="transactions")
    purchase = relationship("Purchase")

class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    code = Column(String, unique=True, index=True, nullable=False)
    status = Column(String, default="Active")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    users = relationship("CompanyUser", back_populates="company", cascade="all, delete-orphan")
    products = relationship("Product", back_populates="company", cascade="all, delete-orphan")
    warehouses = relationship("Warehouse", back_populates="company", cascade="all, delete-orphan")
    inventories = relationship("Inventory", back_populates="company", cascade="all, delete-orphan")
    movements = relationship("InventoryMovement", back_populates="company", cascade="all, delete-orphan")
    amazon_sync_logs = relationship("AmazonSyncLog", back_populates="company", cascade="all, delete-orphan")
    reports = relationship("ReportHistory", back_populates="company", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="company", cascade="all, delete-orphan")
    job_logs = relationship("JobExecutionLog", back_populates="company", cascade="all, delete-orphan")
    sales_returns = relationship("SalesReturn", backref="company_ref", cascade="all, delete-orphan")
    delivery_challans = relationship("DeliveryChallan", backref="company_ref", cascade="all, delete-orphan")

class CompanyUser(Base):
    __tablename__ = "company_users"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    role = Column(String, default="Admin")
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint('user_id', 'company_id', name='uix_user_company'),)

    user = relationship("User", back_populates="company_access")
    company = relationship("Company", back_populates="users")

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="Viewer") # Admin or Viewer
    created_at = Column(DateTime, default=datetime.utcnow)

    company_access = relationship("CompanyUser", back_populates="user")

class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    sku = Column(String, index=True, nullable=False)
    name = Column(String, nullable=False)
    category = Column(String)
    brand = Column(String)
    item_rate = Column(Float, default=0.0)
    min_stock_level = Column(Integer, default=0)
    reorder_level = Column(Integer, default=0)
    safety_stock = Column(Integer, default=0)
    preferred_transfer_qty = Column(Integer, default=1)
    status = Column(String, default="Active")
    hsn = Column(String)
    default_gst_rate = Column(Float, nullable=True) # None triggers 0% warning in POS
    barcode = Column(String)
    unit = Column(String)
    
    __table_args__ = (UniqueConstraint('company_id', 'sku', name='uix_company_sku'),)

    company = relationship("Company", back_populates="products")
    
    inventories = relationship("Inventory", back_populates="product", cascade="all, delete-orphan")
    movements = relationship("InventoryMovement", back_populates="product", cascade="all, delete-orphan")

class StateHub(Base):
    __tablename__ = "state_hubs"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    hub_code = Column(String, index=True, nullable=False)
    hub_name = Column(String, nullable=False)
    gstin = Column(String, nullable=True)
    address = Column(String, nullable=True)
    city = Column(String, nullable=True)
    state = Column(String, nullable=True)
    state_code = Column(String, nullable=True)
    contact_person = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    status = Column(String, default="Active")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint('company_id', 'hub_code', name='uix_company_hub_code'),)

    company = relationship("Company")
    warehouses = relationship("Warehouse", back_populates="hub")


import enum
from sqlalchemy import Enum

class WarehouseType(str, enum.Enum):
    CENTRAL = "CENTRAL"
    FULFILLMENT_CENTER = "FULFILLMENT_CENTER"
    REGIONAL = "REGIONAL"
    TRANSIT = "TRANSIT"

class WarehouseStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    UNDER_MAINTENANCE = "UNDER_MAINTENANCE"
    BLOCKED = "BLOCKED"

class Warehouse(Base):
    __tablename__ = "warehouses"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    hub_id = Column(Integer, ForeignKey("state_hubs.id"), nullable=True)
    name = Column(String, nullable=False)
    code = Column(String, index=True)
    warehouse_type = Column(Enum(WarehouseType), default=WarehouseType.FULFILLMENT_CENTER)
    status = Column(Enum(WarehouseStatus), default=WarehouseStatus.ACTIVE)
    address = Column(String, nullable=True)
    contact_person = Column(String, nullable=True)
    manager = Column(String, nullable=True)
    phone_number = Column(String, nullable=True)
    email = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint('company_id', 'code', name='uix_company_warehouse_code'),)

    company = relationship("Company", back_populates="warehouses")
    hub = relationship("StateHub", back_populates="warehouses")
    inventories = relationship("Inventory", back_populates="warehouse", cascade="all, delete-orphan")
    movements = relationship("InventoryMovement", back_populates="warehouse", cascade="all, delete-orphan")
    users = relationship("WarehouseUser", back_populates="warehouse", cascade="all, delete-orphan")
    external_mappings = relationship("WarehouseExternalMapping", back_populates="warehouse", cascade="all, delete-orphan")


class AmazonNetworkType(str, enum.Enum):
    MFN = "MFN"
    AFN = "AFN"

class AllocationStatus(str, enum.Enum):
    PENDING = "Pending"
    UNSHIPPED = "Unshipped"
    SHIPPED = "Shipped"
    CANCELLED = "Cancelled"
    RETURNED = "Returned"
    REFUNDED = "Refunded"

class DLQType(str, enum.Enum):
    MATCH_FAILED = "MATCH_FAILED"
    RATE_LIMIT = "RATE_LIMIT"
    DATA_MISMATCH = "DATA_MISMATCH"
    API_FAILURE = "API_FAILURE"

class AmazonLiveAllocation(Base):
    __tablename__ = "amazon_live_allocations"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    order_id = Column(String, nullable=False, index=True)
    amazon_line_item_id = Column(String, nullable=False, index=True)
    sku = Column(String, nullable=False, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)
    amazon_network_at_allocation = Column(Enum(AmazonNetworkType), nullable=True)
    allocated_qty = Column(Integer, default=0)
    reconciled_qty = Column(Integer, default=0)
    status = Column(Enum(AllocationStatus), default=AllocationStatus.PENDING)
    closed = Column(Boolean, default=False)
    order_date = Column(DateTime, nullable=True, index=True)
    invoice_number = Column(String, nullable=True, index=True)
    invoice_date = Column(DateTime, nullable=True)
    gross_amount = Column(Numeric(12, 2), nullable=True)
    tax_amount = Column(Numeric(12, 2), nullable=True)
    net_amount = Column(Numeric(12, 2), nullable=True)
    party_name = Column(String(255), nullable=True)
    state_name = Column(String(100), nullable=True)
    hsn_code = Column(String(50), nullable=True)
    customer_gstin = Column(String(50), nullable=True)
    shipment_date = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint('order_id', 'sku', 'amazon_line_item_id', name='uix_amazon_order_sku_line'),
        Index('idx_order_sku_lineitem', 'order_id', 'sku', 'amazon_line_item_id'),
        Index('idx_unreconciled_allocations', 'reconciled_qty', 'allocated_qty'),
        Index('idx_updated_at', 'updated_at'),
        Index('idx_status', 'status')
    )

class AmazonOrderEventLog(Base):
    __tablename__ = "amazon_order_event_logs"

    id = Column(Integer, primary_key=True, index=True)
    allocation_id = Column(Integer, ForeignKey("amazon_live_allocations.id"), nullable=False)
    previous_status = Column(String, nullable=True)
    new_status = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)

class AmazonDLQ(Base):
    __tablename__ = "amazon_dlq"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    dlq_type = Column(Enum(DLQType), nullable=False)
    reference_id = Column(String, nullable=True, index=True)
    payload = Column(JSON, nullable=True)
    error_message = Column(String, nullable=True)
    retry_count = Column(Integer, default=0)
    status = Column(String, default="ACTIVE")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class WarehouseExternalMapping(Base):
    __tablename__ = "warehouse_external_mappings"

    id = Column(Integer, primary_key=True, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    marketplace = Column(String, nullable=False) # e.g. Amazon, Zepto
    external_code = Column(String, nullable=False, index=True) # e.g. BOM1
    amazon_network = Column(Enum(AmazonNetworkType), nullable=True)
    
    __table_args__ = (UniqueConstraint('warehouse_id', 'marketplace', name='uix_warehouse_marketplace'),)
    
    warehouse = relationship("Warehouse", back_populates="external_mappings")

class WarehouseUser(Base):
    __tablename__ = "warehouse_users"

    id = Column(Integer, primary_key=True, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    permission = Column(String, default="VIEW") # VIEW, MANAGE
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint('warehouse_id', 'user_id', name='uix_warehouse_user'),)

    warehouse = relationship("Warehouse", back_populates="users")
    user = relationship("User")

class Inventory(Base):
    __tablename__ = "inventory"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    current_qty = Column(Integer, default=0, server_default=text('0'), nullable=False)
    reserved_qty = Column(Integer, default=0, server_default=text('0'), nullable=False)
    available_qty = Column(Integer, default=0, server_default=text('0'), nullable=False)
    version_id = Column(Integer, nullable=False, default=1, server_default=text('1'))
    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    _allow_mutation = False

    __mapper_args__ = {
        "version_id_col": version_id
    }

    @validates('current_qty', 'reserved_qty', 'available_qty')
    def validate_inventory_mutation(self, key, value):
        if not getattr(self, '_allow_mutation', False):
            raise Exception(f"Direct inventory mutation forbidden on {key}. Must use InventoryEventEngine.")
        return value

    __table_args__ = (UniqueConstraint('company_id', 'product_id', 'warehouse_id', name='uix_company_prod_wh'),)

    company = relationship("Company", back_populates="inventories")
    product = relationship("Product", back_populates="inventories")
    warehouse = relationship("Warehouse", back_populates="inventories")

    @hybrid_property
    def product_sku(self):
        return self.product.sku if self.product else None

class InventoryMovement(Base):
    __tablename__ = "inventory_movements"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    qty_before = Column(Integer, nullable=False)
    qty_changed = Column(Integer, nullable=False)
    qty_after = Column(Integer, nullable=False)
    source = Column(String, nullable=False) # Upload, Amazon, Manual, Transfer
    reference_id = Column(String) # e.g. INV-12345
    operation_id = Column(String, unique=True, nullable=True, index=True) # Idempotency key
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    metadata_payload = Column(JSON, default=dict)

    company = relationship("Company", back_populates="movements")
    product = relationship("Product", back_populates="movements")
    warehouse = relationship("Warehouse", back_populates="movements")

    @hybrid_property
    def product_sku(self):
        return self.product.sku if self.product else None

class InventorySnapshot(Base):
    __tablename__ = "inventory_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    date = Column(DateTime, default=datetime.utcnow)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, default=0)

    company = relationship("Company")
    warehouse = relationship("Warehouse")
    product = relationship("Product")

class AmazonSyncLog(Base):
    __tablename__ = "amazon_sync_logs"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    order_id = Column(String, index=True, nullable=True)
    sync_start_time = Column(DateTime, default=datetime.utcnow)
    sync_end_time = Column(DateTime, nullable=True)
    status = Column(String, default="IN_PROGRESS")
    api_response_status = Column(String, nullable=True)
    orders_processed = Column(Integer, default=0)
    movements_created = Column(Integer, default=0)
    skipped_duplicates = Column(Integer, default=0)
    failed_items = Column(Integer, default=0)
    unknown_skus = Column(String, nullable=True) # JSON string array
    next_token = Column(String, nullable=True)
    errors = Column(String, nullable=True)
    
    __table_args__ = (UniqueConstraint('company_id', 'order_id', name='uix_company_order_id'),)

    company = relationship("Company", back_populates="amazon_sync_logs")

class ReportHistory(Base):
    __tablename__ = "reports_history"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    report_type = Column(String, nullable=False)
    generated_at = Column(DateTime, default=datetime.utcnow)
    file_path = Column(String, nullable=False)
    download_link = Column(String, nullable=False)

    company = relationship("Company", back_populates="reports")

class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
    alert_type = Column(String, nullable=False) # LowStock, NegativeStock, SyncError
    message = Column(String, nullable=False)
    is_resolved = Column(Boolean, default=False)

    company = relationship("Company", back_populates="alerts")

class JobExecutionLog(Base):
    __tablename__ = "job_execution_logs"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    job_name = Column(String, nullable=False, index=True)
    start_time = Column(DateTime, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    duration_seconds = Column(Float, nullable=True)
    status = Column(String, nullable=False) # e.g. "Running", "Success", "Failed"
    error_message = Column(String, nullable=True)

    company = relationship("Company", back_populates="job_logs")

class CompanySettings(Base):
    """
    Per-company settings used by Billing/POS without changing the core Company table.
    Stores:
    - optional company profile fields (to snapshot into invoices)
    - tally integration configuration (optional)
    """
    __tablename__ = "company_settings"

    company_id = Column(Integer, ForeignKey("companies.id"), primary_key=True)

    # Company profile (source for snapshot)
    legal_name = Column(String, nullable=True)
    gstin = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    state = Column(String, nullable=True)
    state_code = Column(String, nullable=True)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    bank_details = Column(JSON, nullable=True)  # {bank_name, account_no, ifsc, branch, upi, ...}
    smtp_settings = Column(JSON, nullable=True) # {host, port, username, password, use_tls, from_email}

    # Billing default text
    declaration = Column(Text, nullable=True)

    # Integration Settings
    export_internal_distribution_to_accounting = Column(Boolean, default=False)
    terms_of_delivery_default = Column(String, nullable=True)

    # Tally Integration (optional)
    tally_enabled = Column(Boolean, default=False)
    tally_endpoint_url = Column(String, nullable=True)
    tally_payload_format = Column(String, default="XML")  # XML | JSON
    
    replenishment_enabled = Column(Boolean, default=False)
    replenishment_time = Column(String, default="14:30")
    replenishment_buffer_minutes = Column(Integer, default=30)
    
    # Amazon Returns Integration
    amazon_sync_enabled = Column(Boolean, default=False)
    amazon_returns_sync_enabled = Column(Boolean, default=False)
    amazon_returns_sync_interval_minutes = Column(Integer, default=5)

    # E-Invoice Integration (GSP / ClearTax / Masters India / Sandbox)
    einvoice_enabled = Column(Boolean, default=False)
    einvoice_provider = Column(String, default="CLEARTAX")  # CLEARTAX | MASTERS_INDIA | SANDBOX
    einvoice_config = Column(JSON, nullable=True)  # {auth_token, gstin, client_id, client_secret, environment, auto_generate}

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    company = relationship("Company")


class DocumentTypeEnum(str, enum.Enum):
    SALE = "SALE"
    DISPATCH = "DISPATCH"
    CHALLAN = "CHALLAN"
    RETURN = "RETURN"
    DAMAGE = "DAMAGE"
    SERVICE = "SERVICE"
    BATCH = "BATCH"
    TRANSFER = "TRANSFER"
    JOB_CARD = "JOB_CARD"
    SERVICE_INVOICE = "SERVICE_INVOICE"

class DocumentSequence(Base):
    """
    Unified per-company document numbering sequence.
    """
    __tablename__ = "document_sequences"
    __table_args__ = (UniqueConstraint('company_id', 'document_type', 'fiscal_year', 'prefix', name='uix_company_doctype_fy_prefix_sequence'),)

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    document_type = Column(SQLEnum(DocumentTypeEnum), nullable=False)
    fiscal_year = Column(String, nullable=False)  # e.g. "26-27"
    prefix = Column(String, nullable=True) # Optional prefix override
    last_number = Column(Integer, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    company = relationship("Company")


class AuditLog(Base):
    """
    Lightweight audit logging for important operational events.
    (e.g. invoice created, tally sync started/success/failed)
    """
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    entity_type = Column(String, nullable=False)  # "Sale", etc.
    entity_id = Column(Integer, nullable=False)
    event_type = Column(String, nullable=False)   # "INVOICE_CREATED", "TALLY_SYNC_STARTED", ...
    message = Column(Text, nullable=True)
    metadata_payload = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    company = relationship("Company")


class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = (
        UniqueConstraint('company_id', 'bill_number', name='uix_company_bill_number'),
        UniqueConstraint('company_id', 'idempotency_key', name='uix_company_sale_idempotency_key'),
    )

    id = Column(Integer, primary_key=True, index=True)
    idempotency_key = Column(String, nullable=True, index=True)
    bill_number = Column(String, index=True, nullable=False)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    customer_name = Column(String, nullable=True)
    customer_mobile = Column(String, nullable=True)
    sale_date = Column(DateTime, default=datetime.utcnow)
    total_taxable_amount = Column(Float, default=0.0)
    total_tax = Column(Float, default=0.0)
    grand_total = Column(Float, default=0.0)
    payment_method = Column(String, nullable=True) # Cash, UPI, Card, Bank Transfer, Cheque, Credit, COD, Mix
    payment_reference = Column(String, nullable=True)  # UPI txn ref, cheque no, etc.
    payment_remarks = Column(Text, nullable=True)  # Split/mixed payment details, remarks
    payment_date = Column(DateTime, nullable=True)
    status = Column(String, default="Completed") # Draft, Completed, Cancelled, Returned
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # ------------------------------------------------------------------
    # Invoice/Billing Snapshot Fields (extend Sale for now; future-proofed
    # by keeping renderer/export services separate from persistence)
    # ------------------------------------------------------------------

    # Invoice identity
    invoice_number = Column(String, nullable=True, index=True)
    invoice_type = Column(String, default="B2C")  # B2C | B2B
    transaction_origin = Column(String, nullable=True)  # POS, AMAZON, FC_DISPATCH, INTERNAL_DISTRIBUTION, SERVICE, MANUAL

    # Customer snapshot
    customer_gstin = Column(String, nullable=True)
    customer_address = Column(Text, nullable=True)
    customer_state = Column(String, nullable=True)
    customer_state_code = Column(String, nullable=True)
    place_of_supply = Column(String, nullable=True)
    
    # Shipping snapshot (Ship To)
    shipping_name = Column(String, nullable=True)
    shipping_address = Column(Text, nullable=True)
    shipping_state = Column(String, nullable=True)
    shipping_state_code = Column(String, nullable=True)
    shipping_gstin = Column(String, nullable=True)
    customer_email = Column(String, nullable=True)
    customer_phone = Column(String, nullable=True)

    # Invoice information
    buyer_order_no = Column(String, nullable=True)
    buyer_order_date = Column(String, nullable=True)
    payment_terms = Column(String, nullable=True)
    delivery_note = Column(String, nullable=True)
    delivery_note_date = Column(DateTime, nullable=True)
    dispatch_document_number = Column(String, nullable=True)
    dispatch_through = Column(String, nullable=True)
    destination = Column(String, nullable=True)
    vehicle_number = Column(String, nullable=True)
    lr_rr_number = Column(String, nullable=True)
    terms_of_delivery = Column(String, nullable=True)

    # Company snapshot (do NOT fetch from Company at print time)
    company_name_snapshot = Column(String, nullable=True)
    company_gstin_snapshot = Column(String, nullable=True)
    company_address_snapshot = Column(Text, nullable=True)
    company_state_snapshot = Column(String, nullable=True)
    company_state_code_snapshot = Column(String, nullable=True)
    company_email_snapshot = Column(String, nullable=True)
    company_phone_snapshot = Column(String, nullable=True)
    company_logo_url_snapshot = Column(String, nullable=True)
    company_bank_details_snapshot = Column(JSON, nullable=True)

    # Optional e-invoice fields (if needed later)
    einvoice_irn = Column(String, nullable=True)
    einvoice_ack_no = Column(String, nullable=True)
    einvoice_ack_date = Column(DateTime, nullable=True)
    einvoice_qr_code_data = Column(Text, nullable=True)
    einvoice_status = Column(String, default="NOT_GENERATED")  # NOT_GENERATED | GENERATED | FAILED | CANCELLED
    einvoice_error_message = Column(Text, nullable=True)
    einvoice_canceled_at = Column(DateTime, nullable=True)
    einvoice_cancel_reason = Column(String, nullable=True)
    eway_bill_number = Column(String, nullable=True)
    eway_bill_date = Column(DateTime, nullable=True)

    # Tally sync metadata (B2B only, optional and configurable)
    tally_sync_status = Column(String, default="NOT_APPLICABLE")  # NOT_APPLICABLE|PENDING|PROCESSING|SUCCESS|FAILED|RETRYING|CANCELLED
    tally_sync_at = Column(DateTime, nullable=True)
    tally_reference = Column(String, nullable=True)
    tally_error_message = Column(Text, nullable=True)

    company = relationship("Company")
    creator = relationship("User")
    items = relationship("SaleItem", back_populates="sale", cascade="all, delete-orphan")

class SaleItem(Base):
    __tablename__ = "sale_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    sku = Column(String, nullable=False)
    quantity = Column(Integer, nullable=False)
    selling_price = Column(Float, nullable=False)
    gst_rate = Column(Float, default=0.0)
    taxable_amount = Column(Float, default=0.0)
    cgst = Column(Float, default=0.0)
    sgst = Column(Float, default=0.0)
    igst = Column(Float, default=0.0)
    line_total = Column(Float, default=0.0)

    # Invoice line snapshot fields
    product_name = Column(String, nullable=True)
    hsn_sac = Column(String, nullable=True)
    unit = Column(String, nullable=True)
    discount = Column(Float, default=0.0)

    sale = relationship("Sale", back_populates="items")
    product = relationship("Product")


# ------------------------------------------------------------------
# Inter-Company Stock Replenishment & Transfer Models
# ------------------------------------------------------------------

class ReplenishmentRun(Base):
    __tablename__ = "replenishment_runs"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    run_date = Column(DateTime, default=datetime.utcnow)
    status = Column(String, nullable=False) # Success, Failed, Skipped
    reason = Column(Text, nullable=True)
    amazon_sync_log_id = Column(Integer, ForeignKey("amazon_sync_logs.id"), nullable=True)

    company = relationship("Company")
    recommendations = relationship("ReplenishmentRecommendation", back_populates="run", cascade="all, delete-orphan")


class ReplenishmentRecommendation(Base):
    __tablename__ = "replenishment_recommendations"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("replenishment_runs.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    current_stock = Column(Integer, default=0)
    reserved_stock = Column(Integer, default=0)
    available_stock = Column(Integer, default=0)
    today_demand = Column(Integer, default=0)
    safety_stock = Column(Integer, default=0)
    recommended_qty = Column(Integer, default=0)
    status = Column(String, default="Pending") # Pending, Approved, Dismissed

    run = relationship("ReplenishmentRun", back_populates="recommendations")
    product = relationship("Product")


class StockTransfer(Base):
    __tablename__ = "stock_transfers"
    __table_args__ = (
        UniqueConstraint('from_company_id', 'idempotency_key', name='uix_from_company_transfer_idempotency_key'),
    )

    id = Column(Integer, primary_key=True, index=True)
    idempotency_key = Column(String, nullable=True, index=True)
    transfer_number = Column(String, index=True, unique=True, nullable=False)
    from_company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    to_company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    
    # Draft, Pending Approval, Approved, Invoice Generated, Dispatched, Received, Completed, Cancelled
    status = Column(String, default="Draft")
    
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    dispatch_date = Column(DateTime, nullable=True)
    received_date = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    total_value = Column(Float, default=0.0)

    # Link to the generated B2B Sale Invoice
    invoice_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    source_warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)
    destination_warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)
    execution_idempotency_key = Column(String, nullable=True)

    from_company = relationship("Company", foreign_keys=[from_company_id])
    to_company = relationship("Company", foreign_keys=[to_company_id])
    creator = relationship("User", foreign_keys=[created_by])
    approver = relationship("User", foreign_keys=[approved_by])
    invoice = relationship("Sale", foreign_keys=[invoice_id])
    source_warehouse = relationship("Warehouse", foreign_keys=[source_warehouse_id])
    destination_warehouse = relationship("Warehouse", foreign_keys=[destination_warehouse_id])
    items = relationship("StockTransferItem", back_populates="transfer", cascade="all, delete-orphan")


class StockTransferItem(Base):
    __tablename__ = "stock_transfer_items"

    id = Column(Integer, primary_key=True, index=True)
    transfer_id = Column(Integer, ForeignKey("stock_transfers.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    
    requested_qty = Column(Integer, default=0)
    approved_qty = Column(Integer, default=0)
    dispatched_qty = Column(Integer, default=0)
    received_qty = Column(Integer, default=0)
    
    unit_price = Column(Float, default=0.0)
    total_value = Column(Float, default=0.0)

    transfer = relationship("StockTransfer", back_populates="items")
    product = relationship("Product")


# ------------------------------------------------------------------
# Amazon Returns Synchronization Models
# ------------------------------------------------------------------

class AmazonReturn(Base):
    __tablename__ = "amazon_returns"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    amazon_return_id = Column(String, index=True, nullable=False)
    amazon_order_id = Column(String, index=True, nullable=False)
    order_item_id = Column(String, nullable=False)
    sku = Column(String, index=True, nullable=False)
    asin = Column(String, nullable=True)
    product_name = Column(String, nullable=True)
    quantity = Column(Integer, default=1)
    return_reason = Column(String, nullable=True)
    
    # "In Transit", "Received"
    return_status = Column(String, default="In Transit")
    
    # Phase 2: Inspection fields
    inspection_status = Column(String, nullable=True) # e.g. "RESTOCKED", "DEFECTIVE"
    inspection_notes = Column(Text, nullable=True)
    inspection_images = Column(JSON, default=list)
    inspected_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    inspected_at = Column(DateTime, nullable=True)
    
    requested_at = Column(DateTime, nullable=True)
    received_at = Column(DateTime, nullable=True)

    last_synced_at = Column(DateTime, default=datetime.utcnow)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint('company_id', 'amazon_return_id', 'order_item_id', name='uix_company_return_item'),)

    company = relationship("Company")


class AmazonReturnSyncLog(Base):
    __tablename__ = "amazon_return_sync_logs"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    status = Column(String, nullable=False) # e.g., "Running", "Success", "Failed"
    records_created = Column(Integer, default=0)
    records_updated = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    duration = Column(Float, nullable=True)

    company = relationship("Company")


class DefectiveInventory(Base):
    __tablename__ = "defective_inventory"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    amazon_return_id = Column(Integer, ForeignKey("amazon_returns.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    
    sku_snapshot = Column(String, index=True, nullable=False)
    product_name_snapshot = Column(String, nullable=True)
    
    quantity = Column(Integer, default=1)
    return_reason = Column(String, nullable=True)
    
    inspection_notes = Column(Text, nullable=True)
    inspection_images = Column(JSON, default=list)
    inspector_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    inspection_date = Column(DateTime, nullable=True)
    
    status = Column(String, default="NEW") # Enums: NEW, UNDER_REVIEW, REPAIR, RETURN_VENDOR, SCRAPPED, DISPOSED
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    company = relationship("Company")
    amazon_return = relationship("AmazonReturn")
    product = relationship("Product")
    inspector = relationship("User")

# =====================================================================
# Sales Returns & Delivery Documents (Phase 6)
# =====================================================================

class SalesReturn(Base):
    __tablename__ = "sales_returns"
    __table_args__ = (
        UniqueConstraint('company_id', 'idempotency_key', name='uix_company_salesreturn_idempotency_key'),
    )

    id = Column(Integer, primary_key=True, index=True)
    idempotency_key = Column(String, nullable=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    return_number = Column(String, index=True, nullable=False, unique=True)
    return_type = Column(String, default="OFFLINE") # ONLINE | OFFLINE
    return_date = Column(DateTime, default=datetime.utcnow)
    
    # Snapshots for header
    customer_name = Column(String, nullable=True)
    
    # Totals
    total_taxable_amount = Column(Float, default=0.0)
    total_tax = Column(Float, default=0.0)
    grand_total = Column(Float, default=0.0)
    
    status = Column(String, default="Draft") # Draft, Completed, Cancelled
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    sale = relationship('Sale')
    items = relationship('SalesReturnItem', back_populates='sales_return', cascade='all, delete-orphan')

class SalesReturnItem(Base):
    __tablename__ = "sales_return_items"

    id = Column(Integer, primary_key=True, index=True)
    return_id = Column(Integer, ForeignKey("sales_returns.id"), nullable=False)
    sale_item_id = Column(Integer, ForeignKey("sale_items.id"), nullable=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    
    # Independent snapshots to preserve historical integrity
    sku_snapshot = Column(String, nullable=True)
    product_name_snapshot = Column(String, nullable=True)
    hsn_snapshot = Column(String, nullable=True)
    unit_snapshot = Column(String, nullable=True)
    
    # Return details
    returned_quantity = Column(Integer, default=0)
    return_reason = Column(String, nullable=True)
    
    # Pricing
    unit_price = Column(Float, default=0.0)
    tax_rate = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    total_price = Column(Float, default=0.0)
    
    sales_return = relationship('SalesReturn', back_populates='items')
    sale_item = relationship('SaleItem')
    product = relationship('Product')


class DeliveryChallan(Base):
    __tablename__ = "delivery_challans"

    id = Column(Integer, primary_key=True, index=True)
    challan_number = Column(String, index=True, nullable=False, unique=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    challan_date = Column(DateTime, default=datetime.utcnow)
    
    # Immutable snapshots (just like invoices)
    seller_snapshot = Column(JSON, nullable=True)
    buyer_snapshot = Column(JSON, nullable=True)
    shipping_snapshot = Column(JSON, nullable=True)
    
    # Transport Details
    vehicle_number = Column(String, nullable=True)
    transport_mode = Column(String, nullable=True)
    eway_bill = Column(String, nullable=True)
    remarks = Column(Text, nullable=True)
    
    status = Column(String, default="Draft") # Draft, Generated, Printed, Cancelled, Completed
    print_count = Column(Integer, default=0, server_default=text('0'))
    last_printed_at = Column(DateTime, nullable=True)
    
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    sale = relationship('Sale')
    items = relationship('DeliveryChallanItem', back_populates='delivery_challan', cascade='all, delete-orphan')

class DeliveryChallanItem(Base):
    __tablename__ = "delivery_challan_items"

    id = Column(Integer, primary_key=True, index=True)
    challan_id = Column(Integer, ForeignKey("delivery_challans.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    
    # Snapshots
    sku_snapshot = Column(String, nullable=True)
    product_name_snapshot = Column(String, nullable=True)
    hsn_snapshot = Column(String, nullable=True)
    unit_snapshot = Column(String, nullable=True)
    
    quantity = Column(Integer, default=0)
    
    # Optional Pricing (Challans don't always show price, but often do for insurance/eway bill)
    unit_price = Column(Float, default=0.0)
    tax_rate = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    total_price = Column(Float, default=0.0)
    
    delivery_challan = relationship('DeliveryChallan', back_populates='items')
    product = relationship('Product')

# =====================================================================
# Service Management (Phase 7)
# =====================================================================


class ServiceRecord(Base):
    __tablename__ = "service_records"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    service_number = Column(String, index=True, nullable=False, unique=True)
    
    # Customer Identity
    customer_id = Column(Integer, ForeignKey("sales.id"), nullable=True) # Will link to Sale or dedicated customer in future, for now nullable
    customer_name_snapshot = Column(String, nullable=False)
    customer_mobile_snapshot = Column(String, nullable=True)
    customer_email_snapshot = Column(String, nullable=True)
    customer_address_snapshot = Column(String, nullable=True)
    
    # Source Details
    source_type = Column(String, default="manual") # "invoice" | "manual"
    source_invoice_id = Column(String, nullable=True)
    
    # Metadata
    invoice_number = Column(String, nullable=True)
    sale_type = Column(String, nullable=True) # Online, Offline
    marketplace = Column(String, nullable=True) # Amazon, Offline
    
    service_date = Column(DateTime, default=datetime.utcnow)
    service_type = Column(String, nullable=False) # Repair, Replacement, Installation, General Service
    status = Column(String, default="Pending") # Pending, In Progress, Completed, Cancelled
    
    # Machinery Details
    machine_type = Column(String, nullable=True)
    brand = Column(String, nullable=True)
    power_type = Column(String, nullable=True) # Petrol, Electric, Manual
    warranty = Column(Boolean, default=False)
    
    complaint = Column(Text, nullable=True)
    technician_notes = Column(Text, nullable=True)
    service_location = Column(String, nullable=True)
    
    # Bill Fields
    labour_charges = Column(Float, default=0.0)
    spare_charges = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    grand_total = Column(Float, default=0.0)
    
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    company = relationship("Company")
    creator = relationship("User")
    items = relationship('ServiceRecordItem', back_populates='service_record', cascade='all, delete-orphan')
    job_cards = relationship('JobCard', back_populates='service_record', cascade='all, delete-orphan')


class ServiceRecordItem(Base):
    __tablename__ = "service_record_items"

    id = Column(Integer, primary_key=True, index=True)
    service_record_id = Column(Integer, ForeignKey("service_records.id"), nullable=False)
    
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    sku_snapshot = Column(String, nullable=True)
    quantity = Column(Integer, default=1)
    serial_number = Column(String, nullable=True)
    
    # Replacement Tracking
    replacement_product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    replacement_quantity = Column(Integer, default=0)
    
    service_record = relationship('ServiceRecord', back_populates='items')
    product = relationship('Product', foreign_keys=[product_id])
    replacement_product = relationship('Product', foreign_keys=[replacement_product_id])


class ServiceReminder(Base):
    __tablename__ = "service_reminders"
    __table_args__ = (UniqueConstraint('sale_id', 'product_id', name='uix_sale_product_reminder'),)

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    
    customer_id = Column(Integer, nullable=True) # Placeholder for future FK
    customer_name_snapshot = Column(String, nullable=True)
    customer_mobile_snapshot = Column(String, nullable=True)
    
    sale_date = Column(DateTime, nullable=False)
    reminder_date = Column(DateTime, nullable=False)
    
    status = Column(String, default="Pending") # Pending, Contacted, Completed, Dismissed
    created_at = Column(DateTime, default=datetime.utcnow)
    
    company = relationship("Company")
    sale = relationship("Sale")
    product = relationship("Product")
from datetime import datetime

class FCDispatch(Base):
    __tablename__ = "fc_dispatches"
    __table_args__ = (
        UniqueConstraint('company_id', 'idempotency_key', name='uix_company_dispatch_idempotency_key'),
    )

    id = Column(Integer, primary_key=True, index=True)
    idempotency_key = Column(String, nullable=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    invoice_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    delivery_challan_id = Column(Integer, ForeignKey("delivery_challans.id"), nullable=True)
    
    dispatch_number = Column(String, index=True, nullable=False, unique=True)
    dispatch_type = Column(String, nullable=False, default="STANDARD") # STANDARD, EMERGENCY
    dispatch_status = Column(String, default="Draft") # Draft, Invoice Generated, Challan Generated, Inventory Updated, Completed, Completed with Errors, XML Pending, Cancelled
    
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    company = relationship("Company")
    warehouse = relationship("Warehouse", foreign_keys=[warehouse_id])
    invoice = relationship("Sale")
    delivery_challan = relationship("DeliveryChallan")
    items = relationship("FCDispatchItem", back_populates="dispatch", cascade="all, delete-orphan")
    timeline = relationship("DispatchTimeline", back_populates="dispatch", cascade="all, delete-orphan")

class DispatchTimeline(Base):
    __tablename__ = "dispatch_timeline"

    id = Column(Integer, primary_key=True, index=True)
    dispatch_id = Column(Integer, ForeignKey("fc_dispatches.id"), nullable=False)
    step = Column(String, nullable=False)
    status = Column(String, nullable=False)
    performed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    performed_at = Column(DateTime, default=datetime.utcnow)
    remarks = Column(Text, nullable=True)

    dispatch = relationship("FCDispatch", back_populates="timeline")
    user = relationship("User")


class FCDispatchItem(Base):
    __tablename__ = "fc_dispatch_items"

    id = Column(Integer, primary_key=True, index=True)
    dispatch_id = Column(Integer, ForeignKey("fc_dispatches.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    
    sku_snapshot = Column(String, nullable=True)
    product_name_snapshot = Column(String, nullable=True)
    hsn_snapshot = Column(String, nullable=True)
    
    quantity = Column(Integer, nullable=False, default=1)
    unit_price = Column(Float, nullable=False, default=0.0)
    gst_rate = Column(Float, nullable=False, default=0.0)
    
    taxable_amount = Column(Float, nullable=False, default=0.0)
    tax_amount = Column(Float, nullable=False, default=0.0)
    total_amount = Column(Float, nullable=False, default=0.0)
    
    dispatch = relationship("FCDispatch", back_populates="items")
    product = relationship("Product")


class FCReturn(Base):
    __tablename__ = "fc_returns"
    __table_args__ = (
        UniqueConstraint('company_id', 'idempotency_key', name='uix_company_fcreturn_idempotency_key'),
    )

    id = Column(Integer, primary_key=True, index=True)
    idempotency_key = Column(String, nullable=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    dispatch_id = Column(Integer, ForeignKey("fc_dispatches.id"), nullable=True)
    
    return_number = Column(String, index=True, nullable=False, unique=True)
    status = Column(String, default="Draft") # Draft, Completed, Cancelled
    
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    company = relationship("Company")
    warehouse = relationship("Warehouse")
    dispatch = relationship("FCDispatch")
    items = relationship("FCReturnItem", back_populates="fc_return", cascade="all, delete-orphan")


class FCReturnItem(Base):
    __tablename__ = "fc_return_items"

    id = Column(Integer, primary_key=True, index=True)
    fc_return_id = Column(Integer, ForeignKey("fc_returns.id"), nullable=False)
    dispatch_item_id = Column(Integer, ForeignKey("fc_dispatch_items.id"), nullable=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    
    quantity = Column(Integer, nullable=False, default=1)
    return_reason = Column(String, nullable=True)
    
    fc_return = relationship("FCReturn", back_populates="items")
    dispatch_item = relationship("FCDispatchItem")
    product = relationship("Product")


class DamageClaim(Base):
    __tablename__ = "damage_claims"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    
    claim_number = Column(String, index=True, nullable=False, unique=True)
    quantity = Column(Integer, nullable=False, default=1)
    
    video_reference = Column(String, nullable=True) # URL or File Path
    remarks = Column(Text, nullable=True)
    
    claim_status = Column(String, default="Pending") # Pending, Approved, Rejected
    
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    company = relationship("Company")
    warehouse = relationship("Warehouse")
    product = relationship("Product")

class JobCard(Base):
    __tablename__ = "job_cards"
    
    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    service_record_id = Column(Integer, ForeignKey("service_records.id"), nullable=False, index=True)
    job_card_number = Column(String, unique=True, index=True, nullable=False)
    date = Column(DateTime, default=datetime.utcnow)
    
    # Workshop/Assignment
    workshop_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    status = Column(String(50), default="OPEN") # OPEN, IN_PROGRESS, COMPLETED, LOCKED
    is_verified = Column(Boolean, default=False)
    
    company = relationship("Company")
    service_record = relationship("ServiceRecord", back_populates="job_cards")
    workshop = relationship("Warehouse")
    assignee = relationship("User")
    items = relationship("JobCardItem", back_populates="job_card", cascade="all, delete-orphan")
    invoices = relationship("ServiceInvoice", back_populates="job_card", cascade="all, delete-orphan")

    @property
    def customer_name(self):
        return self.service_record.customer_name_snapshot if self.service_record else None

    @property
    def customer_mobile(self):
        return self.service_record.customer_mobile_snapshot if self.service_record else None

    @property
    def address(self):
        return self.service_record.customer_address_snapshot if self.service_record else None

    @property
    def product_name(self):
        return self.service_record.machine_type if self.service_record else None

    @property
    def brand(self):
        return self.service_record.brand if self.service_record else None

    @property
    def complaint(self):
        return self.service_record.complaint if self.service_record else None

class JobCardItem(Base):
    __tablename__ = "job_cards_items"
    
    id = Column(Integer, primary_key=True, index=True)
    job_card_id = Column(Integer, ForeignKey("job_cards.id"), nullable=False)
    
    source = Column(String, nullable=False, default="manual") # "product" | "manual"
    source_invoice_item_id = Column(Integer, nullable=True)
    
    item_name = Column(String, nullable=False) # Manual text or product name
    product_sku = Column(String, nullable=True) # Optional link to inventory product
    
    qty = Column(Float, default=1.0)
    rate = Column(Float, default=0.0)
    amount = Column(Float, default=0.0)
    
    job_card = relationship("JobCard", back_populates="items")

class ServiceInvoice(Base):
    __tablename__ = "service_invoices"
    
    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    invoice_number = Column(String, unique=True, index=True, nullable=False)
    job_card_id = Column(Integer, ForeignKey("job_cards.id"), nullable=False, unique=True)
    date = Column(DateTime, default=datetime.utcnow)
    
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    total_amount = Column(Float, default=0.0)
    cgst_amount = Column(Float, default=0.0)
    sgst_amount = Column(Float, default=0.0)
    grand_total = Column(Float, default=0.0)
    
    company = relationship("Company")
    job_card = relationship("JobCard", back_populates="invoices")
    items = relationship("ServiceInvoiceItem", back_populates="invoice", cascade="all, delete-orphan")

class ServiceInvoiceItem(Base):
    __tablename__ = "service_invoice_items"
    
    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("service_invoices.id"), nullable=False)
    
    description = Column(String, nullable=False)
    product_sku = Column(String, nullable=True)
    hsn = Column(String, nullable=True)
    gst_rate = Column(Float, default=0.0)
    
    qty = Column(Float, default=1.0)
    rate = Column(Float, default=0.0)
    amount = Column(Float, default=0.0)
    
    invoice = relationship("ServiceInvoice", back_populates="items")

from sqlalchemy.dialects.postgresql import JSONB
JSONB_COMPAT = JSON().with_variant(JSONB, "postgresql")


class OfflineSale(Base):
    """Offline POS queue — stores sales that were created while offline for later sync."""
    __tablename__ = "offline_sales"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    payload = Column(JSONB_COMPAT, nullable=False)
    status = Column(String, default="PENDING", nullable=False)  # PENDING / SYNCED / FAILED
    idempotency_key = Column(String, nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    synced_at = Column(DateTime, nullable=True)
    error_message = Column(String, nullable=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True)  # linked after sync

    company = relationship("Company")
    operator = relationship("User")


class AdminApprovalRequest(Base):
    __tablename__ = "admin_approval_requests"
    
    id = Column(Integer, primary_key=True, index=True)
    request_type = Column(String, nullable=False)
    payload = Column(JSONB_COMPAT, nullable=False)
    payload_hash = Column(String, index=True)
    expires_at = Column(DateTime)

    requested_by = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), index=True)
    related_entity = Column(Integer)
    status = Column(String, nullable=False, default="PENDING", index=True)
    approver_id = Column(Integer, ForeignKey("users.id"), index=True)
    approved_at = Column(DateTime)
    admin_comment = Column(String)
    before_snapshot = Column(JSONB_COMPAT)
    after_snapshot = Column(JSONB_COMPAT)
    idempotency_key = Column(String, unique=True, index=True)
    priority = Column(Integer, default=10)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint('request_type', 'idempotency_key', name='uq_request_type_idempotency_key'),
    )

class AdminApprovalEvent(Base):
    __tablename__ = "admin_approval_events"
    
    id = Column(Integer, primary_key=True, index=True)
    approval_request_id = Column(Integer, ForeignKey("admin_approval_requests.id"), nullable=False)
    event_type = Column(String, nullable=False)
    actor_id = Column(Integer, ForeignKey("users.id"))
    data = Column(JSONB_COMPAT)
    created_at = Column(DateTime, default=datetime.utcnow)



class Customer(Base):
    __tablename__ = 'customers'
    
    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey('companies.id'), nullable=False)
    name = Column(String, nullable=False)
    mobile = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    gstin = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    state = Column(String, nullable=True)
    state_code = Column(String, nullable=True)
    place_of_supply = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    company = relationship("Company")

class Vendor(Base):
    __tablename__ = "vendors"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    contact = Column(String, nullable=True)
    payable_balance = Column(Float, default=0.0)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    gst_number = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    address = Column(String, nullable=True)
    bank_details = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    company = relationship("Company")

class Purchase(Base):
    __tablename__ = "purchases"
    __table_args__ = (
        UniqueConstraint('company_id', 'invoice_number', name='uix_company_invoice_number'),
        UniqueConstraint('company_id', 'idempotency_key', name='uix_company_idempotency_key'),
    )
    
    id = Column(Integer, primary_key=True, index=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String, default="DRAFT", nullable=False, index=True)
    invoice_number = Column(String, nullable=True)
    total_amount = Column(Float, default=0.0)
    idempotency_key = Column(String, nullable=False)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    received_at = Column(DateTime, nullable=True)
    
    # Financial tracking added for Vendor Ledgers
    payment_status = Column(String(50), default='UNPAID')
    date = Column(DateTime, nullable=True)
    payment_terms = Column(String, nullable=True)
    eway_bill = Column(String, nullable=True)
    vehicle_number = Column(String, nullable=True)
    vendor_name = Column(String, nullable=True)
    amount_paid = Column(Numeric(15, 2), default=0.0)
    payment_method = Column(String(50), nullable=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)
    
    vendor = relationship("Vendor")
    company = relationship("Company")
    operator = relationship("User")
    warehouse = relationship("Warehouse")
    items = relationship("PurchaseItem", back_populates="purchase", cascade="all, delete-orphan")

class PurchaseItem(Base):
    __tablename__ = "purchase_items"
    
    id = Column(Integer, primary_key=True, index=True)
    purchase_id = Column(Integer, ForeignKey("purchases.id", ondelete="CASCADE"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    product_sku = Column(String, nullable=False, index=True)
    description = Column(String, nullable=True)
    qty = Column(Float, nullable=False, default=1.0)
    unit_cost = Column(Float, nullable=False, default=0.0)
    gst_pct = Column(Float, default=0.0)
    hsn = Column(String, nullable=True)
    line_total = Column(Float, nullable=False, default=0.0)
    
    purchase = relationship("Purchase", back_populates="items")
    product = relationship("Product")

class OfflinePurchase(Base):
    __tablename__ = "offline_purchases"
    __table_args__ = (
        UniqueConstraint('company_id', 'idempotency_key', name='uix_offline_company_idempotency'),
    )
    
    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    payload = Column(JSONB_COMPAT, nullable=False)
    status = Column(String, default="PENDING", nullable=False, index=True)
    idempotency_key = Column(String, nullable=False)
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    synced_at = Column(DateTime, nullable=True)
    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=True)
    
    company = relationship("Company")
    operator = relationship("User")
    purchase = relationship("Purchase")


class HalteWebsiteOrder(Base):
    __tablename__ = "halte_website_orders"

    order_id = Column(Integer, primary_key=True, index=True)
    order_time = Column(DateTime, nullable=True)
    order_state = Column(String(50), nullable=True, index=True)
    total_amount = Column(Float, default=0.0)
    customer_name = Column(String(255), nullable=True)
    customer_phone = Column(String(50), nullable=True)
    customer_email = Column(String(255), nullable=True)
    ship_city = Column(String(100), nullable=True)
    ship_state = Column(String(100), nullable=True)
    ship_postal_code = Column(String(20), nullable=True)
    shipping_address = Column(JSONB_COMPAT, nullable=True)
    billing_address = Column(JSONB_COMPAT, nullable=True)
    items = Column(JSONB_COMPAT, nullable=True)
    inventory_status = Column(String(50), default="PENDING", nullable=False, index=True)
    deducted_at = Column(DateTime, nullable=True)
    deducted_movement_ids = Column(JSONB_COMPAT, default=list)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)




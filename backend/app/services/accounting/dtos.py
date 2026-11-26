from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

class InvoiceLineDTO(BaseModel):
    product_sku: str
    product_name: str
    hsn_sac: Optional[str] = None
    quantity: float
    unit: Optional[str] = None
    rate: float
    line_total: float
    taxable_amount: float
    discount: float = 0.0
    cgst: float = 0.0
    sgst: float = 0.0
    igst: float = 0.0

class InvoiceDTO(BaseModel):
    sale_id: int
    invoice_number: str
    invoice_date: datetime
    invoice_type: str # B2B, B2C
    
    # Customer
    customer_name: Optional[str] = None
    customer_gstin: Optional[str] = None
    customer_state: Optional[str] = None
    customer_address: Optional[str] = None
    place_of_supply: Optional[str] = None
    
    # Totals
    total_taxable_amount: float
    total_tax: float
    grand_total: float

    # E-Invoice
    einvoice_irn: Optional[str] = None
    einvoice_ack_no: Optional[str] = None
    einvoice_ack_date: Optional[datetime] = None
    einvoice_qr_code_data: Optional[str] = None
    
    # Lines
    lines: List[InvoiceLineDTO] = []
    
    # Context
    company_id: int
    
class AccountingExportResult(BaseModel):
    success: bool
    payload: Optional[str] = None
    reference_id: Optional[str] = None
    error_message: Optional[str] = None
    file_path: Optional[str] = None

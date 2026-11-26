import os
import hashlib
import json
from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session

from app.models.schema import Sale, Company
from app.models.accounting_schema import AccountingExportBatch, AccountingExportLog
from app.services.accounting.dtos import InvoiceDTO, InvoiceLineDTO
from app.services.accounting.tally_connector import TallyXMLConnector
from app.services.document_number_service import DocumentNumberService
from app.models.schema import DocumentTypeEnum

EXPORT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "exports", "accounting")

class AccountingIntegrationEngine:
    def __init__(self, db: Session, company_id: int):
        self.db = db
        self.company_id = company_id
        self.connector = TallyXMLConnector(db, company_id)
        
        # Ensure export directory exists
        os.makedirs(EXPORT_DIR, exist_ok=True)

    def _build_invoice_dto(self, sale: Sale) -> InvoiceDTO:
        lines = []
        for item in sale.items:
            lines.append(InvoiceLineDTO(
                product_sku=item.sku,
                product_name=item.product_name or item.product.name,
                hsn_sac=item.hsn_sac or item.product.hsn,
                quantity=item.quantity,
                unit=item.unit or item.product.unit,
                rate=item.selling_price,
                line_total=item.line_total,
                taxable_amount=item.taxable_amount,
                discount=item.discount,
                cgst=item.cgst,
                sgst=item.sgst,
                igst=item.igst
            ))
            
        return InvoiceDTO(
            sale_id=sale.id,
            invoice_number=sale.invoice_number or sale.bill_number,
            invoice_date=sale.sale_date,
            invoice_type=sale.invoice_type,
            customer_name=sale.customer_name,
            customer_gstin=sale.customer_gstin,
            customer_state=sale.customer_state,
            customer_address=sale.customer_address,
            place_of_supply=sale.place_of_supply,
            total_taxable_amount=sale.total_taxable_amount,
            total_tax=sale.total_tax,
            grand_total=sale.grand_total,
            einvoice_irn=sale.einvoice_irn,
            einvoice_ack_no=sale.einvoice_ack_no,
            einvoice_ack_date=sale.einvoice_ack_date,
            einvoice_qr_code_data=sale.einvoice_qr_code_data,
            lines=lines,
            company_id=self.company_id
        )

    def _validate_dto(self, dto: InvoiceDTO) -> List[str]:
        errors = []
        if not dto.customer_name:
            errors.append("Customer name is missing.")
        if dto.grand_total <= 0:
            errors.append("Invoice total must be > 0.")
        # Check Dr=Cr
        sum_components = round(dto.total_taxable_amount + dto.total_tax, 2)
        diff = round(abs(dto.grand_total - sum_components), 2)
        if diff > 1.0: # allow up to 1 rupee roundoff
            errors.append(f"Taxable + Tax does not match Grand Total. Diff: {diff}")
        return errors

    def export_documents(self, category: str, subtype: str, document_ids: List[int], user_id: Optional[int] = None, user_role: Optional[str] = None, force_reexport: bool = False, force_reexport_reason: Optional[str] = None) -> AccountingExportBatch:
        if category == "Sales Invoice":
            # Locking the rows to prevent concurrent exports of the same documents
            sales = self.db.query(Sale).filter(
                Sale.id.in_(document_ids), 
                Sale.company_id == self.company_id,
                Sale.invoice_type == subtype
            ).with_for_update().all()
            
            if len(sales) != len(document_ids):
                raise ValueError("Mismatch in selected documents. Some documents may not belong to the requested category/subtype or do not exist.")
            
            # Check for already exported if not force_reexport
            if force_reexport:
                if user_role != "admin":
                    raise ValueError("Only Admins can force re-export documents.")
                if not force_reexport_reason:
                    raise ValueError("A reason is mandatory for force re-exporting documents.")
            else:
                already_exported = self.db.query(AccountingExportLog).filter(
                    AccountingExportLog.sale_id.in_(document_ids),
                    AccountingExportLog.status.in_(["Generated", "Downloaded", "Imported"])
                ).count()
                if already_exported > 0:
                    raise ValueError("Some documents have already been exported. Use force_reexport to bypass.")

            
            # Generate sequential batch number
            today = datetime.now()
            start_year = today.year if today.month >= 4 else today.year - 1
            fy = f"{str(start_year)[-2:]}-{str(start_year + 1)[-2:]}"
            
            company = self.db.query(Company).filter(Company.id == self.company_id).first()
            company_code = company.code if company else "CMP"
            prefix = f"BATCH/{company_code}"
            
            batch_number = DocumentNumberService.generate_number(
                db=self.db,
                company_id=self.company_id,
                document_type=DocumentTypeEnum.BATCH,
                fiscal_year=fy,
                prefix_override=prefix
            )

            batch = AccountingExportBatch(
                batch_number=batch_number,
                company_id=self.company_id,
                batch_type=category,
                batch_subtype=subtype,
                generated_by=user_id,
                invoice_count=len(sales),
                status="Queued",
                template_version=getattr(self.connector, "template_version", "v1"),
                erp_version="1.0.0",
                force_reexport_reason=force_reexport_reason if force_reexport else None
            )
            self.db.add(batch)
            self.db.flush() # get batch ID
            
            dtos_to_export = []
            logs = []
            
            for sale in sales:
                dto = self._build_invoice_dto(sale)
                validation_errors = self._validate_dto(dto)
                
                log = AccountingExportLog(
                    company_id=self.company_id,
                    batch_id=batch.id,
                    sale_id=sale.id,
                    status="Generating" if not validation_errors else "Failed",
                    last_error=", ".join(validation_errors) if validation_errors else None
                )
                self.db.add(log)
                logs.append(log)
                
                if not validation_errors:
                    dtos_to_export.append(dto)
            
            if not dtos_to_export:
                batch.status = "Failed"
                batch.errors = "All documents failed validation."
                self.db.commit()
                return batch
                
            batch.status = "Generating"
            self.db.commit()
                
            result = self.connector.generate_invoice_export(dtos_to_export, category)
            
            if result.success and result.payload:
                # Save XML to disk
                filename = f"batch_{batch.id}_{datetime.now().strftime('%Y%m%d%H%M%S')}.xml"
                file_path = os.path.join(EXPORT_DIR, filename)
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(result.payload)
                    
                checksum = hashlib.sha256(result.payload.encode('utf-8')).hexdigest()
                
                # Save Manifest
                manifest = {
                    "batch_number": batch.batch_number,
                    "batch_id": batch.id,
                    "template": batch.template_version,
                    "erp_version": batch.erp_version,
                    "generated_at": datetime.now().isoformat(),
                    "invoice_count": batch.invoice_count,
                    "total_value": sum(d.grand_total for d in dtos_to_export),
                    "checksum": checksum
                }
                manifest_path = file_path.replace('.xml', '_manifest.json')
                with open(manifest_path, 'w', encoding='utf-8') as f:
                    json.dump(manifest, f, indent=2)
                    
                batch.file_path = file_path
                batch.checksum_sha256 = checksum
                batch.status = "Generated" # Ready to be 'Downloaded'
                for log in logs:
                    if log.status == "Generating":
                        log.status = "Generated"
                        log.last_export_time = datetime.utcnow()
            else:
                batch.status = "Failed"
                batch.errors = result.error_message
                for log in logs:
                    if log.status == "Generating":
                        log.status = "Failed"
                        if not log.last_error:
                            log.last_error = "Batch generation failed."

            self.db.commit()
            return batch
        else:
            raise ValueError(f"Category {category} is not supported for export yet.")

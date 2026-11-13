from sqlalchemy.orm import Session
from sqlalchemy import text, update
from sqlalchemy.exc import IntegrityError
from app.models.schema import DocumentSequence, DocumentTypeEnum, Company
import logging
import re

logger = logging.getLogger(__name__)

class DocumentNumberService:

    @staticmethod
    def get_last_sale_number(db: Session, company_id: int, prefix: str) -> tuple[int, int]:
        """
        Scan existing sales for this company and prefix, returning (max_numeric_val, digits_length).
        Supports formats like:
          - GST-253
          - JGST-17
          - BKR-GST-534
          - BKR/26-27/00012
          - GST/253
        """
        from app.models.schema import Sale
        prefix_clean = prefix.strip().upper()
        sales = db.query(Sale.bill_number, Sale.invoice_number).filter(
            Sale.company_id == company_id,
            Sale.status != "Cancelled"
        ).all()

        pattern_strict = re.compile(rf'^{re.escape(prefix_clean)}(?:/[0-9\-]+)?[-/]?(\d+)$', re.IGNORECASE)
        pattern_prefix = re.compile(rf'^(?:[A-Z0-9]+-)?{re.escape(prefix_clean)}(?:/[0-9\-]+)?[-/]?(\d+)$', re.IGNORECASE)

        max_num = 0
        found_len = 0
        for s in sales:
            for val in (s.invoice_number, s.bill_number):
                if not val:
                    continue
                val = val.strip()
                # Skip internal tracking timestamp strings (e.g. JSPL-20261008-110948698692-2DE3E0)
                if re.search(r'\d{8}-\d{6}', val):
                    continue
                m = pattern_strict.match(val) or pattern_prefix.match(val)
                if m:
                    num_str = m.group(1)
                    num = int(num_str)
                    if num > max_num:
                        max_num = num
                        found_len = len(num_str)
        return max_num, found_len

    @staticmethod
    def get_last_dispatch_number(db: Session, company_id: int, prefix: str, fiscal_year: str) -> int:
        """Scan existing FCDispatches for this prefix and fiscal year to find highest number."""
        from app.models.schema import FCDispatch
        pattern = f"{prefix}/{fiscal_year}/%"
        dispatches = db.query(FCDispatch.dispatch_number).filter(
            FCDispatch.dispatch_number.like(pattern)
        ).all()
        max_num = 0
        for (d_num,) in dispatches:
            if not d_num:
                continue
            m = re.search(r'(\d+)$', d_num.strip())
            if m:
                num = int(m.group(1))
                if num > max_num:
                    max_num = num
        return max_num

    @staticmethod
    def get_last_challan_number(db: Session, company_id: int, prefix: str, fiscal_year: str) -> int:
        """Scan existing DeliveryChallans for this prefix and fiscal year to find highest number."""
        from app.models.schema import DeliveryChallan
        pattern = f"{prefix}/{fiscal_year}/%"
        challans = db.query(DeliveryChallan.challan_number).filter(
            DeliveryChallan.challan_number.like(pattern)
        ).all()
        max_num = 0
        for (c_num,) in challans:
            if not c_num:
                continue
            m = re.search(r'(\d+)$', c_num.strip())
            if m:
                num = int(m.group(1))
                if num > max_num:
                    max_num = num
        return max_num

    @staticmethod
    def get_last_return_number(db: Session, company_id: int, prefix: str) -> tuple[int, int]:
        """
        Scan existing SalesReturns for this company and prefix, returning (max_numeric_val, digits_length).
        Supports formats like:
          - SR-001
          - SR-15
          - GGSR-001
          - GGSR-241
        """
        from app.models.schema import SalesReturn
        prefix_clean = prefix.strip().upper()
        returns = db.query(SalesReturn.return_number).filter(
            SalesReturn.company_id == company_id,
            SalesReturn.status != "Cancelled"
        ).all()

        pattern = re.compile(rf'^{re.escape(prefix_clean)}[-/]?(\d+)$', re.IGNORECASE)

        max_num = 0
        found_len = 0
        for (val,) in returns:
            if not val:
                continue
            val = val.strip()
            m = pattern.match(val)
            if m:
                num_str = m.group(1)
                num = int(num_str)
                if num > max_num:
                    max_num = num
                    found_len = len(num_str)
        return max_num, found_len

    @staticmethod
    def _format_sale_number(prefix: str, num: int, digits_len: int = 0) -> str:
        pref = prefix.strip().upper()
        if pref in ['SERVICE', 'SERV', 'BKR', 'JSPL', 'GST', 'JGST', 'SR', 'GGSR']:
            pad = max(3, digits_len)
            return f"{pref}-{num:0{pad}d}" if num < (10 ** pad) else f"{pref}-{num}"
        elif digits_len >= 3:
            return f"{pref}-{num:0{digits_len}d}" if num < (10 ** digits_len) else f"{pref}-{num}"
        elif digits_len > 0:
            return f"{pref}-{num:0{digits_len}d}" if num < (10 ** digits_len) else f"{pref}-{num}"
        else:
            return f"{pref}-{num}"

    @staticmethod
    def get_next_number_preview(
        db: Session,
        company_id: int,
        document_type: DocumentTypeEnum,
        fiscal_year: str,
        prefix_override: str = None
    ) -> dict:
        """
        Preview what the next auto-generated document number will be without incrementing.
        """
        company = db.query(Company).filter(Company.id == company_id).first()
        company_prefix = company.code if company and company.code else f"COMP{company_id}"
        prefix = (prefix_override or company_prefix).strip().upper()

        if document_type == DocumentTypeEnum.SALE:
            last_sale_num, digits_len = DocumentNumberService.get_last_sale_number(db, company_id, prefix)

            seq = db.query(DocumentSequence).filter(
                DocumentSequence.company_id == company_id,
                DocumentSequence.document_type == document_type,
                DocumentSequence.fiscal_year == fiscal_year,
                DocumentSequence.prefix == prefix
            ).first()

            current_max = max(seq.last_number if seq else 0, last_sale_num)
            next_num = current_max + 1
            formatted = DocumentNumberService._format_sale_number(prefix, next_num, digits_len)

            return {
                "prefix": prefix,
                "last_number": current_max,
                "next_number": next_num,
                "formatted_next_number": formatted
            }
        elif document_type == DocumentTypeEnum.DISPATCH:
            last_dispatch_num = DocumentNumberService.get_last_dispatch_number(db, company_id, prefix, fiscal_year)
            seq = db.query(DocumentSequence).filter(
                DocumentSequence.company_id == company_id,
                DocumentSequence.document_type == document_type,
                DocumentSequence.fiscal_year == fiscal_year,
                DocumentSequence.prefix == prefix
            ).first()
            current_max = max(seq.last_number if seq else 0, last_dispatch_num)
            next_num = current_max + 1
            formatted = f"{prefix}/{fiscal_year}/{next_num:05d}"
            return {
                "prefix": prefix,
                "last_number": current_max,
                "next_number": next_num,
                "formatted_next_number": formatted
            }
        elif document_type == DocumentTypeEnum.CHALLAN:
            last_challan_num = DocumentNumberService.get_last_challan_number(db, company_id, prefix, fiscal_year)
            seq = db.query(DocumentSequence).filter(
                DocumentSequence.company_id == company_id,
                DocumentSequence.document_type == document_type,
                DocumentSequence.fiscal_year == fiscal_year,
                DocumentSequence.prefix == prefix
            ).first()
            current_max = max(seq.last_number if seq else 0, last_challan_num)
            next_num = current_max + 1
            formatted = f"{prefix}/{fiscal_year}/{next_num:05d}"
            return {
                "prefix": prefix,
                "last_number": current_max,
                "next_number": next_num,
                "formatted_next_number": formatted
            }
        elif document_type == DocumentTypeEnum.RETURN:
            prefix = (prefix_override or "SR").strip().upper()
            last_return_num, digits_len = DocumentNumberService.get_last_return_number(db, company_id, prefix)
            seq = db.query(DocumentSequence).filter(
                DocumentSequence.company_id == company_id,
                DocumentSequence.document_type == document_type,
                DocumentSequence.fiscal_year == fiscal_year,
                DocumentSequence.prefix == prefix
            ).first()
            current_max = max(seq.last_number if seq else 0, last_return_num)
            next_num = current_max + 1
            formatted = DocumentNumberService._format_sale_number(prefix, next_num, max(3, digits_len))
            return {
                "prefix": prefix,
                "last_number": current_max,
                "next_number": next_num,
                "formatted_next_number": formatted
            }
        else:
            seq = db.query(DocumentSequence).filter(
                DocumentSequence.company_id == company_id,
                DocumentSequence.document_type == document_type,
                DocumentSequence.fiscal_year == fiscal_year,
                DocumentSequence.prefix == prefix
            ).first()
            current_max = seq.last_number if seq else 0
            next_num = current_max + 1
            formatted = f"{prefix}/{fiscal_year}/{next_num:05d}"
            return {
                "prefix": prefix,
                "last_number": current_max,
                "next_number": next_num,
                "formatted_next_number": formatted
            }

    @staticmethod
    def sync_sequence_with_number(
        db: Session,
        company_id: int,
        prefix: str,
        fiscal_year: str,
        number_used: int
    ):
        """
        Synchronize DocumentSequence when a custom number is used so auto-generation continues from last + 1.
        """
        prefix = prefix.strip().upper()
        seq = db.query(DocumentSequence).filter(
            DocumentSequence.company_id == company_id,
            DocumentSequence.document_type == DocumentTypeEnum.SALE,
            DocumentSequence.fiscal_year == fiscal_year,
            DocumentSequence.prefix == prefix
        ).with_for_update().first()

        if seq:
            if number_used > seq.last_number:
                seq.last_number = number_used
        else:
            seq = DocumentSequence(
                company_id=company_id,
                document_type=DocumentTypeEnum.SALE,
                fiscal_year=fiscal_year,
                prefix=prefix,
                last_number=number_used
            )
            db.add(seq)
        db.flush()

    @staticmethod
    def generate_number(
        db: Session,
        company_id: int,
        document_type: DocumentTypeEnum,
        fiscal_year: str,
        prefix_override: str = None
    ) -> str:
        company = db.query(Company).filter(Company.id == company_id).first()
        company_prefix = company.code if company and company.code else f"COMP{company_id}"
        
        if prefix_override:
            prefix = prefix_override.strip().upper()
        else:
            if document_type == DocumentTypeEnum.RETURN:
                prefix = "SR"
            elif document_type != DocumentTypeEnum.SALE:
                prefix = f"{company_prefix}/{document_type.value}"
            else:
                prefix = company_prefix

        # Special handling for SALE: always base on MAX(existing sales, seq.last_number) + 1
        if document_type == DocumentTypeEnum.SALE:
            last_sale_num, digits_len = DocumentNumberService.get_last_sale_number(db, company_id, prefix)

            seq = db.query(DocumentSequence).filter(
                DocumentSequence.company_id == company_id,
                DocumentSequence.document_type == document_type,
                DocumentSequence.fiscal_year == fiscal_year,
                DocumentSequence.prefix == prefix
            ).with_for_update().first()

            if seq:
                current_max = max(seq.last_number, last_sale_num)
                seq.last_number = current_max + 1
                next_num = seq.last_number
            else:
                next_num = last_sale_num + 1
                seq = DocumentSequence(
                    company_id=company_id,
                    document_type=document_type,
                    fiscal_year=fiscal_year,
                    prefix=prefix,
                    last_number=next_num
                )
                db.add(seq)
                try:
                    db.flush()
                except IntegrityError:
                    db.rollback()
                    seq = db.query(DocumentSequence).filter(
                        DocumentSequence.company_id == company_id,
                        DocumentSequence.document_type == document_type,
                        DocumentSequence.fiscal_year == fiscal_year,
                        DocumentSequence.prefix == prefix
                    ).with_for_update().first()
                    current_max = max(seq.last_number, last_sale_num)
                    seq.last_number = current_max + 1
                    next_num = seq.last_number

            db.flush()
            return DocumentNumberService._format_sale_number(prefix, next_num, digits_len)

        # Handling for DISPATCH: always base on MAX(existing dispatches, seq.last_number) + 1
        if document_type == DocumentTypeEnum.DISPATCH:
            from app.models.schema import FCDispatch
            last_dispatch_num = DocumentNumberService.get_last_dispatch_number(db, company_id, prefix, fiscal_year)

            seq = db.query(DocumentSequence).filter(
                DocumentSequence.company_id == company_id,
                DocumentSequence.document_type == document_type,
                DocumentSequence.fiscal_year == fiscal_year,
                DocumentSequence.prefix == prefix
            ).with_for_update().first()

            if seq:
                current_max = max(seq.last_number, last_dispatch_num)
                seq.last_number = current_max + 1
                next_num = seq.last_number
            else:
                next_num = last_dispatch_num + 1
                seq = DocumentSequence(
                    company_id=company_id,
                    document_type=document_type,
                    fiscal_year=fiscal_year,
                    prefix=prefix,
                    last_number=next_num
                )
                db.add(seq)
                try:
                    db.flush()
                except IntegrityError:
                    db.rollback()
                    seq = db.query(DocumentSequence).filter(
                        DocumentSequence.company_id == company_id,
                        DocumentSequence.document_type == document_type,
                        DocumentSequence.fiscal_year == fiscal_year,
                        DocumentSequence.prefix == prefix
                    ).with_for_update().first()
                    current_max = max(seq.last_number, last_dispatch_num)
                    seq.last_number = current_max + 1
                    next_num = seq.last_number

            db.flush()
            # Double safety check: loop until candidate does not exist in DB
            candidate = f"{prefix}/{fiscal_year}/{next_num:05d}"
            while db.query(FCDispatch.id).filter(FCDispatch.dispatch_number == candidate).first():
                next_num += 1
                seq.last_number = next_num
                candidate = f"{prefix}/{fiscal_year}/{next_num:05d}"
                db.flush()

            return candidate

        # Handling for CHALLAN: always base on MAX(existing challans, seq.last_number) + 1
        if document_type == DocumentTypeEnum.CHALLAN:
            from app.models.schema import DeliveryChallan
            last_challan_num = DocumentNumberService.get_last_challan_number(db, company_id, prefix, fiscal_year)

            seq = db.query(DocumentSequence).filter(
                DocumentSequence.company_id == company_id,
                DocumentSequence.document_type == document_type,
                DocumentSequence.fiscal_year == fiscal_year,
                DocumentSequence.prefix == prefix
            ).with_for_update().first()

            if seq:
                current_max = max(seq.last_number, last_challan_num)
                seq.last_number = current_max + 1
                next_num = seq.last_number
            else:
                next_num = last_challan_num + 1
                seq = DocumentSequence(
                    company_id=company_id,
                    document_type=document_type,
                    fiscal_year=fiscal_year,
                    prefix=prefix,
                    last_number=next_num
                )
                db.add(seq)
                try:
                    db.flush()
                except IntegrityError:
                    db.rollback()
                    seq = db.query(DocumentSequence).filter(
                        DocumentSequence.company_id == company_id,
                        DocumentSequence.document_type == document_type,
                        DocumentSequence.fiscal_year == fiscal_year,
                        DocumentSequence.prefix == prefix
                    ).with_for_update().first()
                    current_max = max(seq.last_number, last_challan_num)
                    seq.last_number = current_max + 1
                    next_num = seq.last_number

            db.flush()
            candidate = f"{prefix}/{fiscal_year}/{next_num:05d}"
            while db.query(DeliveryChallan.id).filter(DeliveryChallan.challan_number == candidate).first():
                next_num += 1
                seq.last_number = next_num
                candidate = f"{prefix}/{fiscal_year}/{next_num:05d}"
                db.flush()

            return candidate

        # Handling for RETURN: always base on MAX(existing returns, seq.last_number) + 1
        if document_type == DocumentTypeEnum.RETURN:
            from app.models.schema import SalesReturn
            prefix = (prefix_override or "SR").strip().upper()
            last_return_num, digits_len = DocumentNumberService.get_last_return_number(db, company_id, prefix)

            seq = db.query(DocumentSequence).filter(
                DocumentSequence.company_id == company_id,
                DocumentSequence.document_type == document_type,
                DocumentSequence.fiscal_year == fiscal_year,
                DocumentSequence.prefix == prefix
            ).with_for_update().first()

            if seq:
                current_max = max(seq.last_number, last_return_num)
                seq.last_number = current_max + 1
                next_num = seq.last_number
            else:
                next_num = last_return_num + 1
                seq = DocumentSequence(
                    company_id=company_id,
                    document_type=document_type,
                    fiscal_year=fiscal_year,
                    prefix=prefix,
                    last_number=next_num
                )
                db.add(seq)
                try:
                    db.flush()
                except IntegrityError:
                    db.rollback()
                    seq = db.query(DocumentSequence).filter(
                        DocumentSequence.company_id == company_id,
                        DocumentSequence.document_type == document_type,
                        DocumentSequence.fiscal_year == fiscal_year,
                        DocumentSequence.prefix == prefix
                    ).with_for_update().first()
                    current_max = max(seq.last_number, last_return_num)
                    seq.last_number = current_max + 1
                    next_num = seq.last_number

            db.flush()
            pad_len = max(3, digits_len)
            candidate = DocumentNumberService._format_sale_number(prefix, next_num, pad_len)
            while db.query(SalesReturn.id).filter(SalesReturn.return_number == candidate).first():
                next_num += 1
                seq.last_number = next_num
                candidate = DocumentNumberService._format_sale_number(prefix, next_num, pad_len)
                db.flush()

            return candidate

        # Standard handling for other document types
        result = db.execute(
            update(DocumentSequence)
            .where(
                DocumentSequence.company_id == company_id,
                DocumentSequence.document_type == document_type,
                DocumentSequence.fiscal_year == fiscal_year,
                DocumentSequence.prefix == prefix
            )
            .values(last_number=DocumentSequence.last_number + 1)
        )

        if result.rowcount > 0:
            seq = db.query(DocumentSequence).filter(
                DocumentSequence.company_id == company_id,
                DocumentSequence.document_type == document_type,
                DocumentSequence.fiscal_year == fiscal_year,
                DocumentSequence.prefix == prefix
            ).first()
            return f"{prefix}/{fiscal_year}/{seq.last_number:05d}"

        try:
            seq = DocumentSequence(
                company_id=company_id,
                document_type=document_type,
                fiscal_year=fiscal_year,
                prefix=prefix,
                last_number=1
            )
            db.add(seq)
            db.flush()
            return f"{prefix}/{fiscal_year}/00001"
        except IntegrityError:
            db.rollback()
            result = db.execute(
                update(DocumentSequence)
                .where(
                    DocumentSequence.company_id == company_id,
                    DocumentSequence.document_type == document_type,
                    DocumentSequence.fiscal_year == fiscal_year,
                    DocumentSequence.prefix == prefix
                )
                .values(last_number=DocumentSequence.last_number + 1)
            )

            seq = db.query(DocumentSequence).filter(
                DocumentSequence.company_id == company_id,
                DocumentSequence.document_type == document_type,
                DocumentSequence.fiscal_year == fiscal_year,
                DocumentSequence.prefix == prefix
            ).first()
            return f"{prefix}/{fiscal_year}/{seq.last_number:05d}"

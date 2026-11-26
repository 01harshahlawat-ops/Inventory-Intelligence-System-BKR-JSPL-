from __future__ import annotations

from datetime import datetime
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session

from app.models.schema import Sale


class TallyPayloadBuilder:
    """
    Pure transformation: Sale -> payload (no networking).
    This is intentionally decoupled so later we can swap Sale->Invoice domain
    without changing integration workflow.
    """

    @staticmethod
    def build_json(sale: Sale) -> Dict[str, Any]:
        return {
            "invoice_number": sale.invoice_number,
            "bill_number": sale.bill_number,
            "invoice_type": sale.invoice_type,
            "invoice_date": sale.sale_date.isoformat() if sale.sale_date else datetime.utcnow().isoformat(),
            "company": {
                "name": sale.company_name_snapshot,
                "gstin": sale.company_gstin_snapshot,
                "address": sale.company_address_snapshot,
                "state": sale.company_state_snapshot,
                "state_code": sale.company_state_code_snapshot,
            },
            "customer": {
                "name": sale.customer_name,
                "gstin": sale.customer_gstin,
                "address": sale.customer_address,
                "state": sale.customer_state,
                "state_code": sale.customer_state_code,
                "place_of_supply": sale.place_of_supply,
                "phone": sale.customer_phone,
                "email": sale.customer_email,
            },
            "totals": {
                "taxable": sale.total_taxable_amount,
                "tax": sale.total_tax,
                "grand_total": sale.grand_total,
            },
            "einvoice": {
                "irn": sale.einvoice_irn,
                "ack_no": sale.einvoice_ack_no,
                "ack_date": sale.einvoice_ack_date.isoformat() if sale.einvoice_ack_date else None,
                "qr_code_data": sale.einvoice_qr_code_data,
                "status": sale.einvoice_status,
                "eway_bill_number": sale.eway_bill_number,
            },
            "items": [
                {
                    "sku": i.sku,
                    "name": i.product_name,
                    "hsn_sac": i.hsn_sac,
                    "gst_rate": i.gst_rate,
                    "quantity": i.quantity,
                    "unit": i.unit,
                    "rate": i.selling_price,
                    "discount": i.discount,
                    "taxable_value": i.taxable_amount,
                    "cgst": i.cgst,
                    "sgst": i.sgst,
                    "igst": i.igst,
                    "line_total": i.line_total,
                }
                for i in (sale.items or [])
            ],
        }

    @staticmethod
    def build_xml(sale: Sale, db: Optional[Session] = None) -> str:
        """
        Builds official TallyPrime-compliant XML Envelope with full line items,
        tax ledgers, and E-Invoice IRN details.
        """
        if db:
            try:
                from app.services.accounting.integration_engine import AccountingIntegrationEngine
                engine = AccountingIntegrationEngine(db, sale.company_id)
                dto = engine._build_invoice_dto(sale)
                res = engine.connector.generate_invoice_export([dto], category="Sales Invoice")
                if res.success and res.payload:
                    return res.payload
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(f"Could not use TallyXMLConnector, using standalone builder: {e}")

        # Standalone builder fallback generating valid Tally XML Envelope
        inv_no = sale.invoice_number or sale.bill_number or "INV-1"
        inv_dt = sale.sale_date.strftime("%Y%m%d") if sale.sale_date else datetime.utcnow().strftime("%Y%m%d")
        party_name = sale.customer_name or "Cash"
        party_gstin = sale.customer_gstin or ""
        grand_total = sale.grand_total or 0.0

        irn_block = ""
        if sale.einvoice_irn:
            ack_dt = sale.einvoice_ack_date.strftime("%Y%m%d") if sale.einvoice_ack_date else ""
            irn_block = f"""
            <IRN>{sale.einvoice_irn}</IRN>
            <IRNACKNO>{sale.einvoice_ack_no or ""}</IRNACKNO>
            <IRNACKDATE>{ack_dt}</IRNACKDATE>
            <SIGNEDQRCODE>{sale.einvoice_qr_code_data or ""}</SIGNEDQRCODE>"""

        items_xml = []
        tot_cgst = 0.0
        tot_sgst = 0.0
        tot_igst = 0.0
        for item in (sale.items or []):
            rate = item.selling_price or 0.0
            qty = item.quantity or 0
            uom = item.unit or "nos"
            taxable = item.taxable_amount or (rate * qty)
            tot_cgst += (item.cgst or 0.0)
            tot_sgst += (item.sgst or 0.0)
            tot_igst += (item.igst or 0.0)
            items_xml.append(f"""            <ALLINVENTORYENTRIES.LIST>
              <STOCKITEMNAME>{item.sku or item.product_name}</STOCKITEMNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <RATE>{rate:.2f}/{uom}</RATE>
              <AMOUNT>{taxable:.2f}</AMOUNT>
              <ACTUALQTY>{qty} {uom}</ACTUALQTY>
              <BILLEDQTY>{qty} {uom}</BILLEDQTY>
              <ACCOUNTINGALLOCATIONS.LIST>
                <LEDGERNAME>Sales</LEDGERNAME>
                <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                <AMOUNT>{taxable:.2f}</AMOUNT>
              </ACCOUNTINGALLOCATIONS.LIST>
            </ALLINVENTORYENTRIES.LIST>""")

        taxes_xml = []
        if tot_cgst > 0:
            taxes_xml.append(f"""            <LEDGERENTRIES.LIST>
              <LEDGERNAME>CGST</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>{tot_cgst:.2f}</AMOUNT>
            </LEDGERENTRIES.LIST>""")
        if tot_sgst > 0:
            taxes_xml.append(f"""            <LEDGERENTRIES.LIST>
              <LEDGERNAME>SGST</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>{tot_sgst:.2f}</AMOUNT>
            </LEDGERENTRIES.LIST>""")
        if tot_igst > 0:
            taxes_xml.append(f"""            <LEDGERENTRIES.LIST>
              <LEDGERNAME>IGST</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>{tot_igst:.2f}</AMOUNT>
            </LEDGERENTRIES.LIST>""")

        lines_str = "\n".join(items_xml)
        taxes_str = "\n".join(taxes_xml)

        return f"""<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Sales" ACTION="Create">
            <DATE>{inv_dt}</DATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <VOUCHERNUMBER>{inv_no}</VOUCHERNUMBER>
            <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
            <ISINVOICE>Yes</ISINVOICE>
            <NARRATION>Generated by ERP</NARRATION>{irn_block}
            <PARTYGSTIN>{party_gstin}</PARTYGSTIN>
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>{party_name}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
              <AMOUNT>-{grand_total:.2f}</AMOUNT>
              <BILLALLOCATIONS.LIST>
                <NAME>{inv_no}</NAME>
                <BILLTYPE>New Ref</BILLTYPE>
                <AMOUNT>-{grand_total:.2f}</AMOUNT>
              </BILLALLOCATIONS.LIST>
            </LEDGERENTRIES.LIST>
{lines_str}
{taxes_str}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>"""


import React from 'react';
import styles from './DeliveryChallanRenderer.module.css';
import InvoiceHeader from '../invoice/sections/InvoiceHeader';
import InvoiceParties from '../invoice/sections/InvoiceParties';
import { amountInWords } from '../../utils/amountInWords';
import { formatDate } from '../../utils/dateUtils';

const formatCurrency = (val) => {
  return Number(val || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

export default function DeliveryChallanRenderer({ challan }) {
  if (!challan) return null;

  // Reconstruct an invoice-like object so we can reuse InvoiceHeader & InvoiceParties
  const mockInvoice = {
    invoice_number: challan.challan_number,
    invoice_date: challan.challan_date,
    seller_snapshot: challan.seller_snapshot,
    buyer_snapshot: challan.buyer_snapshot,
    shipping_snapshot: challan.shipping_snapshot,
  };

  const isInterState = challan.seller_snapshot?.state !== challan.buyer_snapshot?.state;
  const hasIGST = isInterState;

  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let grandTotal = 0;

  challan.items?.forEach(item => {
    const qty = parseFloat(item.quantity || 0);
    const price = parseFloat(item.unit_price || 0);
    const taxAmt = parseFloat(item.tax_amount || 0);
    const total = parseFloat(item.total_price || 0);
    const taxValue = qty * price;
    
    totalTaxable += taxValue;
    grandTotal += total;

    if (isInterState) {
      totalIgst += taxAmt;
    } else {
      totalCgst += taxAmt / 2;
      totalSgst += taxAmt / 2;
    }
  });

  return (
    <div className={styles.invoiceA4}>
      <h2 style={{ textAlign: 'center', marginBottom: '10px', fontWeight: 'bold' }}>DELIVERY CHALLAN</h2>
      
      <div className={styles.mainBorder}>
        <InvoiceHeader invoice={mockInvoice} company={challan.seller_snapshot} />
        <InvoiceParties invoice={mockInvoice} company={challan.seller_snapshot} customer={challan.buyer_snapshot} shipping={challan.shipping_snapshot} />
        
        {/* Challan Meta Details */}
        <div className={styles.metaSection}>
          <div className={styles.metaRow}>
            <div className={styles.metaItem}>
              <strong>Challan No.:</strong> {challan.challan_number}
            </div>
            <div className={styles.metaItem}>
              <strong>Dated:</strong> {formatDate(challan.challan_date)}
            </div>
            {challan.vehicle_number && (
              <div className={styles.metaItem}>
                <strong>Vehicle No.:</strong> {challan.vehicle_number}
              </div>
            )}
            {challan.transport_mode && (
              <div className={styles.metaItem}>
                <strong>Mode/Terms of Payment:</strong> {challan.transport_mode}
              </div>
            )}
            {challan.eway_bill && (
              <div className={styles.metaItem}>
                <strong>E-Way Bill No.:</strong> {challan.eway_bill}
              </div>
            )}
          </div>
        </div>

        {/* Items Table */}
        <div className={styles.itemsContainer}>
          <table className={styles.itemsTable}>
            <thead>
              <tr>
                <th style={{width: '5%'}}>Sl No.</th>
                <th style={{width: '40%'}}>Description of Goods</th>
                <th style={{width: '10%'}}>HSN/SAC</th>
                <th style={{width: '10%'}}>Quantity</th>
                <th style={{width: '10%'}}>Rate</th>
                <th style={{width: '10%'}}>per</th>
                <th style={{width: '15%'}} className={styles.textRight}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {challan.items?.map((item, index) => (
                <tr key={index}>
                  <td className={styles.textCenter}>{index + 1}</td>
                  <td>
                    <strong>{item.product_name_snapshot}</strong>
                    <br />
                    <small>SKU: {item.sku_snapshot}</small>
                  </td>
                  <td className={styles.textCenter}>{item.hsn_snapshot}</td>
                  <td className={styles.textRight}>
                    <strong>{item.quantity}</strong> {item.unit_snapshot}
                  </td>
                  <td className={styles.textRight}>{formatCurrency(item.unit_price)}</td>
                  <td className={styles.textCenter}>{item.unit_snapshot}</td>
                  <td className={styles.textRight}>{formatCurrency(item.quantity * item.unit_price)}</td>
                </tr>
              ))}
              
              {/* Spacer rows */}
              {[...Array(Math.max(0, 10 - (challan.items?.length || 0)))].map((_, i) => (
                <tr key={`spacer-${i}`} className={styles.spacerRow}>
                  <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="6" className={styles.textRight}><strong>Total Taxable Value</strong></td>
                <td className={styles.textRight}><strong>{formatCurrency(totalTaxable)}</strong></td>
              </tr>
              {hasIGST ? (
                <tr>
                  <td colSpan="6" className={styles.textRight}><strong>IGST</strong></td>
                  <td className={styles.textRight}><strong>{formatCurrency(totalIgst)}</strong></td>
                </tr>
              ) : (
                <>
                  <tr>
                    <td colSpan="6" className={styles.textRight}><strong>CGST</strong></td>
                    <td className={styles.textRight}><strong>{formatCurrency(totalCgst)}</strong></td>
                  </tr>
                  <tr>
                    <td colSpan="6" className={styles.textRight}><strong>SGST</strong></td>
                    <td className={styles.textRight}><strong>{formatCurrency(totalSgst)}</strong></td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan="6" className={styles.textRight}><strong>Grand Total</strong></td>
                <td className={styles.textRight}><strong>{formatCurrency(grandTotal)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer */}
        <div className={styles.summaryContainer}>
          <div className={styles.amountChargeable}>
            Amount Chargeable (in words)<br/>
            <strong>INR {grandTotal ? amountInWords(grandTotal) : ''}</strong>
          </div>
          
          {challan.remarks && (
            <div style={{ padding: '10px' }}>
              <strong>Remarks: </strong> {challan.remarks}
            </div>
          )}

          <div className={styles.footerLayout}>
            <div className={styles.footerLeft}>
              <div className={styles.declarationSection}>
                <div className={styles.declarationTitle}>Declaration & Instructions</div>
                <div>We declare that this challan shows the actual price of the goods described and that all particulars are true and correct.</div>
                <div style={{ marginTop: '6px', fontStyle: 'italic', fontWeight: '600' }}>
                  Important: This bill/challan is NOT a proof of item sold and cannot be considered as a valid proof of purchase.
                </div>
              </div>
            </div>
            
            <div className={styles.footerRight}>
              <div className={styles.signCompany}>for {challan.seller_snapshot?.name}</div>
              <div className={styles.signSpace}></div>
              <div className={styles.signLabel}>Authorised Signatory</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

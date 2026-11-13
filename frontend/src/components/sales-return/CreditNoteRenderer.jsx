import React, { forwardRef } from 'react';
import styles from './CreditNoteRenderer.module.css';
import { formatDate } from '../../utils/dateUtils';
import amountInWords from '../../utils/amountInWords';
import { FiPrinter, FiX } from 'react-icons/fi';

const CreditNoteRenderer = forwardRef(({ returnData, onClose }, ref) => {
  if (!returnData) return null;

  const {
    return_number,
    return_date,
    return_type,
    status,
    company = {},
    customer = {},
    original_invoice = {},
    is_interstate = false,
    items = [],
    totals = {}
  } = returnData;

  const handlePrint = () => {
    window.print();
  };

  const grandTotal = Number(totals.grand_total || returnData.grand_total || 0);
  const wordsText = amountInWords(Math.round(grandTotal));

  return (
    <div className={styles.creditNoteWrapper} ref={ref}>
      <div className={styles.actionBar}>
        <button className={styles.printBtn} onClick={handlePrint}>
          <FiPrinter /> Print Credit Note
        </button>
        {onClose && (
          <button className={styles.closeBtn} onClick={onClose}>
            <FiX /> Close
          </button>
        )}
      </div>

      <div className={styles.creditNoteContent}>
        {/* Header */}
        <div className={styles.headerContainer}>
          <div className={styles.companyInfo}>
            <div className={styles.companyTitle}>{company.name || 'JAGAN SHOPSMART PVT LTD'}</div>
            <div className={styles.companySub}>{company.address || 'Plot no: 150, Industrial & Business Park-2, Chandigarh (UT)- 160002'}</div>
            <div className={styles.companySub}>
              <strong>GSTIN:</strong> {company.gstin || '04AABCJ8215N1Z4'} | <strong>STATE:</strong> {company.state || 'Chandigarh'} ({company.state_code || '04'})
            </div>
            <div className={styles.companySub}>
              {company.email && <><strong>EMAIL:</strong> {company.email} | </>}
              {company.phone && <><strong>PHONE:</strong> {company.phone}</>}
            </div>
          </div>
          <div className={styles.documentTitleBox}>
            <div className={styles.documentTitle}>CREDIT NOTE / SALES RETURN</div>
            <span className={styles.documentSubtitle}>Issued under Section 34 of CGST Act, 2017</span>
            {status && (
              <div style={{ marginTop: '4px', fontSize: '10px', fontWeight: 'bold' }}>
                STATUS: <span style={{ color: status === 'Completed' ? '#15803d' : '#b45309' }}>{status.toUpperCase()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Metadata & Buyer Box */}
        <div className={styles.metaGrid}>
          <div className={styles.metaColLeft}>
            <div className={styles.sectionHeader}>Credit Note Details</div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Credit Note No.:</span>
              <span className={styles.metaValue}>{return_number}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Credit Note Date:</span>
              <span className={styles.metaValue}>{formatDate(return_date)}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Return Series / Type:</span>
              <span className={styles.metaValue}>{return_type === 'AMAZON' ? 'AMAZON RETURN (GGSR)' : 'OFFLINE POS RETURN (SR)'}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Original Invoice No.:</span>
              <span className={styles.metaValue}>{original_invoice.invoice_number || original_invoice.bill_number || 'N/A'}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Original Invoice Date:</span>
              <span className={styles.metaValue}>{formatDate(original_invoice.sale_date)}</span>
            </div>
          </div>

          <div className={styles.metaColRight}>
            <div className={styles.sectionHeader}>Customer / Recipient Details</div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Party / M/S:</span>
              <span className={styles.metaValue}>{customer.name || 'Retail Customer'}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Billing Address:</span>
              <span className={styles.metaValue}>{customer.address || '-'}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>State / Place of Supply:</span>
              <span className={styles.metaValue}>{customer.state || 'Chandigarh'} {customer.state_code ? `(${customer.state_code})` : ''}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>GSTIN / UIN:</span>
              <span className={styles.metaValue}>{customer.gstin || 'URP (Unregistered)'}</span>
            </div>
            {customer.mobile && (
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Phone / Mobile:</span>
                <span className={styles.metaValue}>{customer.mobile}</span>
              </div>
            )}
          </div>
        </div>

        {/* Items Table */}
        <table className={styles.itemsTable}>
          <thead>
            <tr>
              <th style={{ width: '30px' }}>#</th>
              <th>Description of Goods / SKU</th>
              <th style={{ width: '65px' }}>HSN/SAC</th>
              <th style={{ width: '45px' }}>Qty</th>
              <th style={{ width: '40px' }}>Unit</th>
              <th style={{ width: '65px' }}>Rate (₹)</th>
              <th style={{ width: '75px' }}>Taxable (₹)</th>
              <th style={{ width: '50px' }}>GST %</th>
              {!is_interstate ? (
                <>
                  <th style={{ width: '60px' }}>CGST (₹)</th>
                  <th style={{ width: '60px' }}>SGST (₹)</th>
                </>
              ) : (
                <th style={{ width: '70px' }}>IGST (₹)</th>
              )}
              <th style={{ width: '80px' }}>Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const qty = Number(item.quantity || item.returned_quantity || 1);
              const unitPrice = Number(item.unit_price || 0);
              const taxable = Number(item.taxable_amount || (qty * unitPrice));
              const gstRate = Number(item.tax_rate || 18);
              const cgst = Number(item.cgst || 0);
              const sgst = Number(item.sgst || 0);
              const igst = Number(item.igst || 0);
              const total = Number(item.total_price || (taxable + cgst + sgst + igst));

              return (
                <tr key={item.id || index}>
                  <td style={{ textAlign: 'center' }}>{index + 1}</td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{item.product_name || item.product_name_snapshot}</div>
                    <div style={{ fontSize: '9.5px', color: '#555' }}>SKU: {item.sku || item.sku_snapshot} {item.return_reason ? `| Reason: ${item.return_reason}` : ''}</div>
                  </td>
                  <td style={{ textAlign: 'center' }}>{item.hsn || item.hsn_snapshot || '9503'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{qty}</td>
                  <td style={{ textAlign: 'center' }}>{item.unit || item.unit_snapshot || 'PCS'}</td>
                  <td style={{ textAlign: 'right' }}>₹{unitPrice.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{taxable.toFixed(2)}</td>
                  <td style={{ textAlign: 'center' }}>{gstRate}%</td>
                  {!is_interstate ? (
                    <>
                      <td style={{ textAlign: 'right' }}>₹{cgst.toFixed(2)}</td>
                      <td style={{ textAlign: 'right' }}>₹{sgst.toFixed(2)}</td>
                    </>
                  ) : (
                    <td style={{ textAlign: 'right' }}>₹{igst.toFixed(2)}</td>
                  )}
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>₹{total.toFixed(2)}</td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={is_interstate ? 9 : 10} style={{ textAlign: 'center', padding: '12px' }}>
                  No returned items found.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* GST Slab Breakdown */}
        {totals.tax_breakdown && totals.tax_breakdown.length > 0 && (
          <table className={styles.taxSummaryTable}>
            <thead>
              <tr>
                <th>HSN/SAC</th>
                <th>Taxable Value (₹)</th>
                <th>GST Rate</th>
                {!is_interstate ? (
                  <>
                    <th>CGST Amount (₹)</th>
                    <th>SGST Amount (₹)</th>
                  </>
                ) : (
                  <th>IGST Amount (₹)</th>
                )}
                <th>Total Tax (₹)</th>
              </tr>
            </thead>
            <tbody>
              {totals.tax_breakdown.map((b, idx) => (
                <tr key={idx}>
                  <td style={{ textAlign: 'center' }}>{b.hsn}</td>
                  <td>₹{Number(b.taxable || 0).toFixed(2)}</td>
                  <td style={{ textAlign: 'center' }}>{b.gst_rate}%</td>
                  {!is_interstate ? (
                    <>
                      <td>₹{Number(b.cgst || 0).toFixed(2)}</td>
                      <td>₹{Number(b.sgst || 0).toFixed(2)}</td>
                    </>
                  ) : (
                    <td>₹{Number(b.igst || 0).toFixed(2)}</td>
                  )}
                  <td style={{ fontWeight: 700 }}>₹{Number(b.total_tax || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Totals & Amount in words */}
        <div className={styles.totalsGrid}>
          <div className={styles.wordsBox}>
            <div className={styles.wordsTitle}>Total Amount in Words:</div>
            <div className={styles.wordsText}>INR {wordsText} Only</div>
          </div>
          <div className={styles.numbersBox}>
            <div className={styles.summaryLine}>
              <span>Total Taxable Value:</span>
              <span>₹{Number(totals.total_taxable_amount || returnData.total_taxable_amount || 0).toFixed(2)}</span>
            </div>
            {!is_interstate ? (
              <>
                <div className={styles.summaryLine}>
                  <span>Total CGST:</span>
                  <span>₹{Number(totals.cgst_amount || 0).toFixed(2)}</span>
                </div>
                <div className={styles.summaryLine}>
                  <span>Total SGST:</span>
                  <span>₹{Number(totals.sgst_amount || 0).toFixed(2)}</span>
                </div>
              </>
            ) : (
              <div className={styles.summaryLine}>
                <span>Total IGST:</span>
                <span>₹{Number(totals.igst_amount || 0).toFixed(2)}</span>
              </div>
            )}
            <div className={styles.summaryLine}>
              <span>Total Tax:</span>
              <span>₹{Number(totals.total_tax || returnData.total_tax || 0).toFixed(2)}</span>
            </div>
            {totals.round_off !== undefined && (
              <div className={styles.summaryLine} style={{ color: '#555' }}>
                <span>Round Off:</span>
                <span>{totals.round_off >= 0 ? `+₹${Number(totals.round_off).toFixed(2)}` : `-₹${Math.abs(Number(totals.round_off)).toFixed(2)}`}</span>
              </div>
            )}
            <div className={styles.summaryTotalLine}>
              <span>Total Credit Allowed:</span>
              <span>₹{grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Footer & Signature */}
        <div className={styles.footerSection}>
          <div className={styles.declarationText}>
            <strong>Declaration:</strong><br />
            We declare that this Credit Note shows the actual value of goods returned and particulars are true and correct.
            The tax liability for the corresponding tax period has been adjusted accordingly.
          </div>
          <div className={styles.signatoryBox}>
            <div className={styles.signatoryLabel}>For {company.name || 'JAGAN SHOPSMART PVT LTD'}</div>
            <div className={styles.signatoryLine}>Authorized Signatory</div>
          </div>
        </div>
      </div>
    </div>
  );
});

CreditNoteRenderer.displayName = 'CreditNoteRenderer';

export default CreditNoteRenderer;

import React from 'react';
import styles from './ReceiptModal.module.css';
import { formatDate } from '../../utils/dateUtils';

const ReceiptModal = ({ receipt, onClose, isPreview, onComplete, isPending }) => {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.receiptContent} id="printable-receipt">
          <div className={styles.header}>
            <h2>{receipt.company?.name || 'Store'}</h2>
            <p>{receipt.company?.address || ''}</p>
            {receipt.company?.gstin && <p>GSTIN: {receipt.company.gstin}</p>}
            {receipt.company?.phone && <p>Ph: {receipt.company.phone}</p>}
          </div>

          <div className={styles.divider}></div>

          <div className={styles.row}>
            <span>Bill No:</span>
            <span className={styles.bold}>{receipt.invoice_number || receipt.bill_number}</span>
          </div>
          {(receipt.invoice_prefix || (receipt.invoice_number && receipt.invoice_number.includes('-'))) && (
            <div className={styles.row}>
              <span>Series:</span>
              <span className={styles.bold}>{receipt.invoice_prefix || receipt.invoice_number.split('-')[0]}</span>
            </div>
          )}
          <div className={styles.row}>
            <span>Date:</span>
            <span>{formatDate(receipt.sale_date)}</span>
          </div>
          {(receipt.buyer_order_no || receipt.order_no) && (
            <div className={styles.row}>
              <span>Order No:</span>
              <span className={styles.bold}>{receipt.buyer_order_no || receipt.order_no}</span>
            </div>
          )}
          {receipt.customer?.name && (
            <div className={styles.row}>
              <span>Customer:</span>
              <span>{receipt.customer?.name}</span>
            </div>
          )}
          {(receipt.customer?.phone || receipt.customer?.mobile) && (
            <div className={styles.row}>
              <span>Phone:</span>
              <span>{receipt.customer.phone || receipt.customer.mobile}</span>
            </div>
          )}

          <div className={styles.divider}></div>

          <table className={styles.itemsTable}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {receipt.items.map((item, idx) => (
                <tr key={idx}>
                  <td>
                    <div style={{fontWeight: 'bold'}}>{item.sku}</div>
                    {item.hsn_sac && <div style={{fontSize: '10px', color: '#555'}}>HSN: {item.hsn_sac}</div>}
                    <div style={{fontSize: '10px', color: '#666'}}>GST: {item.gst_rate}%</div>
                  </td>
                  <td>{item.quantity}</td>
                  <td>{(item.rate || 0).toFixed(2)}</td>
                  <td>{(item.line_total || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.divider}></div>

          <div className={styles.row}>
            <span>Taxable Amount:</span>
            <span>₹{(receipt.totals?.taxable_amount || 0).toFixed(2)}</span>
          </div>
          <div className={styles.row}>
            <span>Total Tax (GST):</span>
            <span>₹{(receipt.totals?.total_tax || 0).toFixed(2)}</span>
          </div>
          <div className={`${styles.row} ${styles.bold}`} style={{fontSize: '18px', marginTop: '8px'}}>
            <span>Grand Total:</span>
            <span>₹{(receipt.totals?.grand_total || 0).toFixed(2)}</span>
          </div>

          <div className={styles.divider}></div>
          
          <div className={styles.row}>
            <span>Payment Method:</span>
            <span>{receipt.payment_method}</span>
          </div>
          {receipt.payment_reference && (
            <div className={styles.row}>
              <span>Payment Ref:</span>
              <span>{receipt.payment_reference}</span>
            </div>
          )}
          {receipt.payment_remarks && (
            <div className={styles.row} style={{ background: '#f8fafc', padding: '4px 6px', borderRadius: '4px' }}>
              <span>Payment Remarks:</span>
              <span className={styles.bold}>{receipt.payment_remarks}</span>
            </div>
          )}

          <div className={styles.footer}>
            Thank you for shopping with us!
          </div>
        </div>
        
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={onClose}>
            {isPreview ? 'Back to Edit' : 'Close'}
          </button>
          {!isPreview && (
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handlePrint}>
              Print Receipt
            </button>
          )}
          {isPreview && (
            <button 
              className={`${styles.btn} ${styles.btnPrimary}`} 
              onClick={onComplete}
              disabled={isPending}
              style={{ background: '#28a745' }}
            >
              {isPending ? 'Processing...' : 'Confirm & Complete Sale'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReceiptModal;

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDate } from '../../utils/dateUtils';
import styles from './SalesReturnsPage.module.css';

export default function ViewReturnModal({ returnDetails, onClose }) {
  const navigate = useNavigate();

  if (!returnDetails) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        background: '#fff', padding: '24px', borderRadius: '8px', 
        width: '90%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '1.25rem' }}>View Sales Return: {returnDetails.return_number}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px', padding: '16px', background: '#f9fafb', borderRadius: '8px' }}>
          <div>
            <strong>Status:</strong> 
            <span className={`${styles.badge} ${styles[returnDetails.status?.toLowerCase()] || ''}`} style={{ marginLeft: '8px' }}>
              {returnDetails.status}
            </span>
          </div>
          <div><strong>Date:</strong> {formatDate(returnDetails.return_date || returnDetails.created_at)}</div>
          <div><strong>Customer:</strong> {returnDetails.customer_name || 'Walk-in Customer'}</div>
          <div><strong>Return Type:</strong> {returnDetails.return_type}</div>
        </div>

        <h4 style={{ marginBottom: '12px' }}>Returned Items</h4>
        <div style={{ border: '1px solid #eee', borderRadius: '8px', overflow: 'hidden' }}>
          <table className={styles.table}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th>Product</th>
                <th>Reason</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Unit Price</th>
                <th style={{ textAlign: 'right' }}>Tax</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {returnDetails.items?.map(item => (
                <tr key={item.id}>
                  <td>
                    <div><strong>{item.product_name_snapshot}</strong></div>
                    <small style={{ color: '#666' }}>SKU: {item.sku_snapshot}</small>
                  </td>
                  <td>{item.return_reason}</td>
                  <td style={{ textAlign: 'right' }}>{Math.round(item.returned_quantity || 0)} {item.unit_snapshot}</td>
                  <td style={{ textAlign: 'right' }}>₹ {Math.round(item.unit_price || 0)}</td>
                  <td style={{ textAlign: 'right' }}>₹ {Math.round(item.tax_amount || 0)}</td>
                  <td style={{ textAlign: 'right' }}>₹ {Math.round(item.total_price || 0)}</td>
                </tr>
              ))}
              {(!returnDetails.items || returnDetails.items.length === 0) && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '16px' }}>No items found</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f9fafb', fontWeight: 'bold' }}>
                <td colSpan="4" style={{ textAlign: 'right' }}>Totals:</td>
                <td style={{ textAlign: 'right' }}>₹ {Math.round(returnDetails.total_tax || 0)}</td>
                <td style={{ textAlign: 'right' }}>₹ {Math.round(returnDetails.grand_total || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
          {returnDetails.sale_id && (
            <button 
              onClick={() => {
                onClose();
                navigate(`/sales/${returnDetails.sale_id}/invoice`);
              }}
              style={{
                padding: '8px 16px', background: '#f8fafc', border: '1px solid #cbd5e1', 
                borderRadius: '6px', cursor: 'pointer', fontSize: '14px', color: '#334155'
              }}
            >
              View Original Invoice
            </button>
          )}
          <button 
            onClick={onClose}
            className={styles.primaryButton}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

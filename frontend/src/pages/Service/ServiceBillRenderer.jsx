import React from 'react';
import { formatDate } from '../../utils/dateUtils';

export default function ServiceBillRenderer({ service, company }) {
  if (!service) return null;

  return (
    <div style={{ 
      width: '210mm', 
      minHeight: '297mm', 
      padding: '20mm', 
      margin: '0 auto', 
      backgroundColor: 'white',
      color: 'black',
      boxShadow: '0 0 10px rgba(0,0,0,0.1)',
      fontFamily: 'sans-serif'
    }}>
      <div style={{ borderBottom: '2px solid black', paddingBottom: '16px', marginBottom: '24px', textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>{company?.name || 'Company Name'}</h1>
        <p style={{ margin: '8px 0 0', fontSize: '14px', color: '#444' }}>{company?.address || 'Company Address'}</p>
        <h2 style={{ marginTop: '24px', marginBottom: 0, fontSize: '20px', letterSpacing: '2px' }}>SERVICE BILL</h2>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '32px', fontSize: '14px' }}>
        <div>
          <p style={{ margin: '4px 0' }}><strong>Service ID:</strong> #{service.id}</p>
          <p style={{ margin: '4px 0' }}><strong>Customer Name:</strong> {service.customer_name || 'N/A'}</p>
          <p style={{ margin: '4px 0' }}><strong>Date:</strong> {formatDate(service.created_at || service.date)}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ margin: '4px 0' }}><strong>Status:</strong> {service.status}</p>
          <p style={{ margin: '4px 0' }}><strong>Service Type:</strong> {service.service_type}</p>
        </div>
      </div>

      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ borderBottom: '1px solid #ccc', paddingBottom: '8px', fontSize: '16px' }}>Complaint Details</h3>
        <p style={{ fontSize: '14px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>{service.complaint}</p>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '32px', fontSize: '14px' }}>
        <thead>
          <tr style={{ backgroundColor: '#f3f4f6' }}>
            <th style={{ padding: '12px', border: '1px solid #ccc', textAlign: 'left' }}>Item ID</th>
            <th style={{ padding: '12px', border: '1px solid #ccc', textAlign: 'left' }}>Sale Item ID</th>
            <th style={{ padding: '12px', border: '1px solid #ccc', textAlign: 'left' }}>Replacement Item ID</th>
          </tr>
        </thead>
        <tbody>
          {(service.items || []).length > 0 ? service.items.map(item => (
            <tr key={item.id}>
              <td style={{ padding: '12px', border: '1px solid #ccc' }}>{item.id}</td>
              <td style={{ padding: '12px', border: '1px solid #ccc' }}>{item.sale_item_id || 'N/A'}</td>
              <td style={{ padding: '12px', border: '1px solid #ccc' }}>{item.replacement_item_id || 'N/A'}</td>
            </tr>
          )) : (
            <tr>
              <td colSpan="3" style={{ padding: '12px', border: '1px solid #ccc', textAlign: 'center' }}>No items recorded</td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '32px' }}>
        <div style={{ width: '300px', borderTop: '2px solid black', paddingTop: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: 'bold' }}>
            <span>Total Amount:</span>
            <span>₹{service.total_amount || 0}</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '80px', display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ borderTop: '1px solid black', width: '200px', paddingTop: '8px' }}>Customer Signature</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ borderTop: '1px solid black', width: '200px', paddingTop: '8px' }}>Authorized Signatory</div>
        </div>
      </div>
    </div>
  );
}

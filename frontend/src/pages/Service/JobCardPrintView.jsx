import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useJobCard } from '../../hooks/useServices';
import { formatDate } from '../../utils/dateUtils';
import { FiPrinter, FiArrowLeft } from 'react-icons/fi';
import styles from './Service.module.css'; // Use existing styles

const JobCardPrintView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: jobCard, isLoading } = useJobCard(id);

  if (isLoading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading Job Card...</div>;
  }

  if (!jobCard) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Job Card not found.</div>;
  }


  return (
    <div style={{ backgroundColor: '#f3f4f6', minHeight: '100vh', padding: '2rem' }}>
      <div className="noPrint" style={{ maxWidth: '800px', margin: '0 auto 1rem', display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={() => navigate(-1)} style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem', backgroundColor: 'white', cursor: 'pointer' }}>
          <FiArrowLeft /> Back
        </button>
        <button onClick={() => window.print()} style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', fontWeight: 600 }}>
          <FiPrinter /> Print Job Card
        </button>
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto', backgroundColor: 'white', padding: '3rem', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', color: 'black' }} className="printBox">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #111827', paddingBottom: '1rem', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 800 }}>JOB CARD</h1>
            <p style={{ margin: '0.25rem 0 0', color: '#4b5563', fontSize: '1.125rem' }}>#{jobCard.job_card_number}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>JAGAN SHOPSMART PVT LTD</h2>
            <p style={{ margin: 0, color: '#4b5563' }}>Authorized Service Center</p>
            <p style={{ margin: 0, color: '#4b5563' }}>Date: {formatDate(jobCard.date)}</p>
          </div>
        </div>

        {/* Customer & Machine Info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
          <div style={{ border: '1px solid #d1d5db', padding: '1rem', borderRadius: '0.25rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>Customer Details</h3>
            <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div><strong>Name:</strong> {jobCard?.customer_name}</div>
              <div><strong>Phone:</strong> {jobCard?.customer_mobile || 'N/A'}</div>
              <div><strong>Address:</strong> {jobCard?.address || 'N/A'}</div>
            </div>
          </div>
          <div style={{ border: '1px solid #d1d5db', padding: '1rem', borderRadius: '0.25rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>Machine / Service Details</h3>
            <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div><strong>Machine Type:</strong> {jobCard?.product_name || 'N/A'}</div>
              <div><strong>Brand:</strong> {jobCard?.brand || 'N/A'}</div>
              <div><strong>Service Type:</strong> {jobCard?.service_type || 'N/A'}</div>
              <div><strong>Assigned To:</strong> {jobCard.assigned_to ? 'Tech ID: ' + jobCard.assigned_to : 'Unassigned' || 'Unassigned'}</div>
            </div>
          </div>
        </div>

        {/* Complaint */}
        <div style={{ border: '1px solid #d1d5db', padding: '1rem', borderRadius: '0.25rem', marginBottom: '2rem' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>Customer Complaint / Issue</h3>
          <p style={{ margin: 0, fontSize: '0.875rem', minHeight: '3rem' }}>
            {jobCard?.complaint || 'No specific complaint documented.'}
          </p>
        </div>

        {/* Estimated Items / Parts */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', borderBottom: '2px solid #111827', paddingBottom: '0.5rem' }}>Required Parts / Items (Estimate)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #d1d5db' }}>
                <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #e5e7eb' }}>S.No</th>
                <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #e5e7eb' }}>Item Description</th>
                <th style={{ padding: '0.5rem', textAlign: 'center', border: '1px solid #e5e7eb' }}>Qty</th>
                <th style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #e5e7eb' }}>Rate (Est)</th>
                <th style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #e5e7eb' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {jobCard.items?.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '0.5rem', textAlign: 'center', border: '1px solid #e5e7eb' }}>{idx + 1}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{item.item_name}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'center', border: '1px solid #e5e7eb' }}>{Math.round(item.qty || 0)}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #e5e7eb' }}>{Math.round(item.rate || 0)}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', border: '1px solid #e5e7eb' }}>{Math.round((item.qty || 0) * (item.rate || 0))}</td>
                </tr>
              ))}
              {(!jobCard.items || jobCard.items.length === 0) && (
                <tr>
                  <td colSpan="5" style={{ padding: '1rem', textAlign: 'center', color: '#6b7280', border: '1px solid #e5e7eb' }}>No parts estimated yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Technician Notes */}
        <div style={{ border: '1px solid #d1d5db', padding: '1rem', borderRadius: '0.25rem', marginBottom: '2rem' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>Technician Notes / Work Done</h3>
          <div style={{ minHeight: '100px' }}></div>
        </div>

        {/* Signatures */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4rem' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: '200px', borderTop: '1px solid #000', margin: '0 auto', paddingTop: '0.5rem' }}>
              Customer Signature
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: '200px', borderTop: '1px solid #000', margin: '0 auto', paddingTop: '0.5rem' }}>
              Technician Signature
            </div>
          </div>
        </div>

      </div>

      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .printBox, .printBox * {
            visibility: visible;
          }
          .printBox {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 2rem;
            box-shadow: none;
          }
          .noPrint {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
};

export default JobCardPrintView;

import React, { useState, useEffect } from 'react';
import { salesReturnsService } from '../../services/salesReturns';
import CreditNoteRenderer from '../../components/sales-return/CreditNoteRenderer';

export default function ViewReturnModal({ returnDetails, onClose }) {
  const [fullData, setFullData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (returnDetails?.id) {
      setLoading(true);
      setError('');
      salesReturnsService.getReturnDetail(returnDetails.id)
        .then(data => {
          setFullData(data);
        })
        .catch(err => {
          console.error('Failed to load credit note details', err);
          setError('Failed to load credit note details. Showing basic preview.');
          setFullData(returnDetails);
        })
        .finally(() => setLoading(false));
    }
  }, [returnDetails?.id]);

  if (!returnDetails) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1200,
      padding: '20px'
    }}>
      <div style={{
        background: '#f8fafc', padding: '16px', borderRadius: '10px', 
        width: '100%', maxWidth: '920px', maxHeight: '95vh', overflowY: 'auto',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
      }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', fontSize: '15px' }}>
            Loading Credit Note details...
          </div>
        ) : error && !fullData ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'red' }}>
            {error}
            <div style={{ marginTop: '16px' }}>
              <button onClick={onClose} style={{ padding: '8px 16px', cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        ) : (
          <CreditNoteRenderer returnData={fullData || returnDetails} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

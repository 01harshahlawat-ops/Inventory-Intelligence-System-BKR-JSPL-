import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './InterCompanyHistory.module.css';
import api from '../../services/api';
import { formatDate } from '../../utils/dateUtils';
import { useNotificationStore } from '../../stores/notificationStore';

const InterCompanyHistory = () => {
  const addNotification = useNotificationStore(state => state.addNotification);
  const [transfers, setTransfers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Mocking the backend for now as requested
    const fetchHistory = async () => {
      setIsLoading(true);
      try {
        const response = await api.get('/api/transfers?history=true');
        const data = Array.isArray(response.data) ? response.data : (response.data?.data || []);
        setTransfers(data);
      } catch (error) {
        addNotification({ type: 'error', title: 'Error', message: 'Error fetching inter-company history' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
  }, []);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Inter-Company History</h1>
      </header>

      <div className={styles.tableContainer}>
        {isLoading ? (
          <div className={styles.loading}>Loading...</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Transfer Number</th>
                <th>Date</th>
                <th>From</th>
                <th>To</th>
                <th>Invoice No</th>
                <th>Total Qty</th>
                <th>Total Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {transfers.length > 0 ? (
                transfers.map((trf) => (
                  <tr key={trf.id}>
                    <td>{trf.transfer_number}</td>
                    <td>{formatDate(trf.created_at)}</td>
                    <td>{trf.from_company_name}</td>
                    <td>{trf.to_company_name}</td>
                    <td>{trf.invoice_id || '-'}</td>
                    <td>{Math.round(trf.total_qty || 0)}</td>
                    <td>₹{Math.round(trf.total_amount || 0)}</td>
                    <td>
                      <span className={`${styles.status} ${styles[(trf.status || '').toLowerCase()] || ''}`}>
                        {trf.status}
                      </span>
                    </td>
                    <td>
                      {trf.invoice_id ? (
                        <button 
                          className={styles.viewBtn} 
                          onClick={() => navigate(`/sales/${trf.invoice_id}/invoice`)}
                        >
                          View Invoice
                        </button>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="9" className={styles.empty}>No transfer history found</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default InterCompanyHistory;

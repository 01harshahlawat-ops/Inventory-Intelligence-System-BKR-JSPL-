import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../../constants/routes';
import styles from './TransferList.module.css'; // Re-use existing table styles
import api from '../../services/api';
import { formatDate } from '../../utils/dateUtils';
import { useNotificationStore } from '../../stores/notificationStore';

const BKRRequirementsView = () => {
  const navigate = useNavigate();
  const addNotification = useNotificationStore(state => state.addNotification);
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTransfers = async () => {
      try {
        const res = await api.get('/api/transfers/?status=active');
        // The backend already filters active if status=active is passed.
        // Let's ensure we only show pending/in progress
        setTransfers(res.data.filter(t => t.status === 'Pending' || t.status === 'In Progress'));
      } catch (err) {
        addNotification({ type: 'error', title: 'Error', message: 'Failed to fetch transfers' });
      } finally {
        setLoading(false);
      }
    };
    fetchTransfers();
  }, []);

  if (loading) return <div className={styles.loading}>Loading JSPL Requirements...</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h1>JSPL Replenishment Requirements</h1>
        </div>
        <div className={styles.actions}>
          <button 
            className={styles.primaryBtn}
            onClick={() => navigate(ROUTES.LOGISTICS_BATCH_DISPATCH + '?source=BKR')}
            style={{ padding: '0.75rem 1.5rem', backgroundColor: '#2563eb', color: 'white', borderRadius: '6px', border: 'none', fontWeight: '500', cursor: 'pointer' }}
          >
            + New External Replenishment
          </button>
        </div>
      </div>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Request ID</th>
              <th>Requested By</th>
              <th>Date</th>
              <th>Items</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map(trf => (
              <tr key={trf.id}>
                <td>{trf.transfer_number || trf.id}</td>
                <td>{trf.from_company_name || 'JSPL'}</td>
                <td>{formatDate(trf.created_at)}</td>
                <td>{trf.items?.length || 0}</td>
                <td>
                  <span className={`${styles.badge} ${trf.status === 'Pending' ? styles.pending : styles.inProgress}`}>{trf.status}</span>
                </td>
                <td>
                  <button 
                    className={styles.linkBtn} 
                    onClick={() => navigate(ROUTES.REPLENISHMENT_BKR_INVOICE.replace(':id', trf.id))}
                  >
                    Process & Generate Bill
                  </button>
                </td>
              </tr>
            ))}
            {transfers.length === 0 && (
              <tr>
                <td colSpan="6" className={styles.emptyState}>No pending requirements.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BKRRequirementsView;

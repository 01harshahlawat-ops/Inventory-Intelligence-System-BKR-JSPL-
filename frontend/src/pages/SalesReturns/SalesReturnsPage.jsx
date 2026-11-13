import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiPlus, FiEye, FiCheck, FiX } from 'react-icons/fi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesReturnsService } from '../../services/salesReturns';
import { handleApiError } from '../../utils/errorHandler';
import { formatDate } from '../../utils/dateUtils';
import useCompanyStore from '../../stores/useCompanyStore';
import CreateReturnModal from './CreateReturnModal';
import ViewReturnModal from './ViewReturnModal';
import styles from './SalesReturnsPage.module.css';

export default function SalesReturnsPage() {
  const { returnId } = useParams();
  const navigate = useNavigate();
  const currentCompany = useCompanyStore(state => state.currentCompany);
  
  const queryClient = useQueryClient();
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewReturn, setViewReturn] = useState(null);

  useEffect(() => {
    if (returnId) {
      setViewReturn({ id: returnId });
    }
  }, [returnId]);

  const { data: returns = [], isLoading: loading, error: returnsError } = useQuery({
    queryKey: ['salesReturns', currentCompany?.id],
    queryFn: () => salesReturnsService.getReturns(),
    enabled: !!currentCompany?.id
  });

  if (returnsError) {
    handleApiError(returnsError, 'Failed to load sales returns.');
  }

  const completeMutation = useMutation({
    mutationFn: (id) => salesReturnsService.completeReturn(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesReturns'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (err) => handleApiError(err, 'Failed to complete return')
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => salesReturnsService.cancelReturn(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesReturns'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (err) => handleApiError(err, 'Failed to cancel return')
  });

  const handleStatusUpdate = (id, status) => {
    if (status === 'Completed') {
      completeMutation.mutate(id);
    } else if (status === 'Cancelled') {
      cancelMutation.mutate(id);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Sales Returns</h2>
        <button 
          className={styles.primaryButton}
          onClick={() => setShowCreateModal(true)}
        >
          <FiPlus /> New Return
        </button>
      </div>

      {returnsError && <div className={styles.errorText} style={{color: 'red', marginBottom: '16px'}}>Failed to load sales returns.</div>}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Return No</th>
              <th>Date</th>
              <th>Series / Type</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Total Amount</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="7" className={styles.empty}>Loading...</td>
              </tr>
            ) : returns.length === 0 ? (
              <tr>
                <td colSpan="7" className={styles.empty}>No sales returns found.</td>
              </tr>
            ) : (
              returns.map((ret) => (
                <tr key={ret.id}>
                  <td><strong>{ret.return_number}</strong></td>
                  <td>{formatDate(ret.return_date || ret.created_at)}</td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
                      background: (ret.return_type || '').includes('AMAZON') ? '#ffedd5' : '#e0e7ff',
                      color: (ret.return_type || '').includes('AMAZON') ? '#9a3412' : '#3730a3'
                    }}>
                      {(ret.return_type || '').includes('AMAZON') ? 'AMAZON (GGSR)' : 'OFFLINE (SR)'}
                    </span>
                  </td>
                  <td>{ret.customer_name || 'Walk-in Customer'}</td>
                  <td>
                    <span className={`${styles.badge} ${styles[ret.status?.toLowerCase()] || ''}`}>
                      {ret.status}
                    </span>
                  </td>
                  <td>₹ {Math.round(ret.grand_total || 0)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button className={styles.actionButton} onClick={() => setViewReturn(ret)}>
                        <FiEye /> View
                      </button>
                      
                      {ret.status === 'Draft' && (
                        <>
                          <button 
                            className={styles.actionButton} 
                            style={{ color: 'green' }}
                            onClick={() => handleStatusUpdate(ret.id, 'Completed')}
                          >
                            <FiCheck /> Complete
                          </button>
                          <button 
                            className={styles.actionButton} 
                            style={{ color: 'red' }}
                            onClick={() => handleStatusUpdate(ret.id, 'Cancelled')}
                          >
                            <FiX /> Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreateModal && (
        <CreateReturnModal 
          onClose={() => setShowCreateModal(false)} 
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['salesReturns'] });
            queryClient.invalidateQueries({ queryKey: ['inventory'] });
          }}
        />
      )}

      <ViewReturnModal 
        returnDetails={viewReturn} 
        onClose={() => {
          setViewReturn(null);
          if (returnId) navigate('/sales-returns', { replace: true });
        }} 
      />
    </div>
  );
}

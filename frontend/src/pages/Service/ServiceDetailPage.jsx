import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import useCompanyStore from '../../stores/useCompanyStore';
import { formatDate } from '../../utils/dateUtils';
import { FiArrowLeft, FiTool, FiUser, FiMapPin, FiInfo, FiCheckCircle, FiFileText, FiPrinter } from 'react-icons/fi';
import styles from './ServiceDetailPage.module.css';

export default function ServiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const currentCompany = useCompanyStore(state => state.currentCompany);
  
  const [service, setService] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const [newStatus, setNewStatus] = useState('');

  const fetchService = () => {
    setLoading(true);
    api.get(`/api/services/${id}`)
      .then(res => {
        setService(res.data);
        setNewStatus(res.data.status);
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (currentCompany?.id && id) {
      fetchService();
    }
  }, [currentCompany, id]);

  const handleUpdateStatus = async () => {
    if (newStatus === service.status) return;
    try {
      await api.post(`/api/services/${id}/status`, { status: newStatus });
      fetchService();
    } catch (err) {
      console.error(err);
      alert('Failed to update status');
    }
  };


  if (loading) return (
    <div style={{minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
      <div>Loading...</div>
    </div>
  );
  
  if (!service) return (
    <div style={{minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
      <div>Service record not found</div>
    </div>
  );


  const getStatusClass = (status) => {
    switch (status) {
      case 'Completed': return styles.statusCompleted;
      case 'In Progress': return styles.statusInProgress;
      case 'Cancelled': return styles.statusCancelled;
      default: return styles.statusPending;
    }
  };

  return (
    <div className={styles.pageContainer}>
      <div className={styles.mainWrapper}>
        
        {/* Header Area */}
        <div className={styles.headerCard}>
          <div>
            <div className={styles.titleWrapper}>
              <div className={styles.iconBox}><FiFileText /></div>
              <h1 className={styles.pageTitle}>Service Record</h1>
            </div>
            <p className={styles.pageSubtitle}>#{service.service_number} • Created {formatDate(service.created_at || service.service_date)}</p>
          </div>
          
          <div className={styles.actionWrapper}>
            <button onClick={() => navigate('/service/records')} className={styles.btnSecondary}>
              <FiArrowLeft /> Back to List
            </button>
            <button onClick={() => navigate(`/services/job-cards/new?serviceRecordId=${service.id}`)} className={styles.btnPrimary}>
              <FiTool /> Create Job Card
            </button>
          </div>
        </div>

        <div className={styles.gridLayout}>
          
          {/* Main Content Column */}
          <div className={styles.mainCol}>
            
            <div className={styles.contentCard}>
              <div className={styles.cardTopGradient}></div>
              
              <div className={styles.cardBody}>
                <div className={styles.cardHeader}>
                  <div>
                    <h2 className={styles.cardTitle}>Request Details</h2>
                    <span className={`${styles.statusBadge} ${getStatusClass(service.status)}`}>
                      <span className={styles.statusDot}></span>
                      {service.status}
                    </span>
                  </div>
                  <div style={{textAlign: 'right'}}>
                    <div style={{fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase'}}>Source</div>
                    <div className={styles.sourceTag}>{service.source_type.toUpperCase()}</div>
                  </div>
                </div>

                <div className={styles.detailsGrid}>
                  {/* Customer Info */}
                  <div className={styles.infoSection}>
                    <h3><FiUser color="#6366f1" /> Customer Information</h3>
                    <div className={styles.infoBox}>
                      <div style={{fontWeight: 700, fontSize: '1.125rem'}}>{service.customer_name_snapshot || 'Walk-in Customer'}</div>
                      <div style={{color: '#4b5563'}}>📞 {service.customer_mobile_snapshot || 'No phone provided'}</div>
                      <div style={{color: '#4b5563', display: 'flex', gap: '0.5rem'}}><FiMapPin style={{marginTop: '0.25rem', color: '#9ca3af'}}/> <span>{service.customer_address_snapshot || 'No address provided'}</span></div>
                    </div>
                  </div>

                  {/* Machine Info */}
                  <div className={styles.infoSection}>
                    <h3><FiTool color="#3b82f6" /> Machine Specifications</h3>
                    <div className={styles.infoBoxBlue}>
                      <div style={{fontWeight: 700, fontSize: '1.125rem'}}>{service.machine_type || 'Unspecified Machine'}</div>
                      <div className={styles.tagList}>
                        <span className={`${styles.tag} ${styles.tagBlue}`}>Brand: {service.brand || 'N/A'}</span>
                        <span className={`${styles.tag} ${styles.tagBlue}`}>Power: {service.power_type || 'N/A'}</span>
                        {service.warranty && <span className={`${styles.tag} ${styles.tagGreen}`}>Under Warranty</span>}
                      </div>
                      <div style={{fontSize: '0.875rem', color: '#4b5563', marginTop: '0.5rem'}}><strong>Service Type:</strong> {service.service_type}</div>
                      <div style={{fontSize: '0.875rem', color: '#4b5563'}}><strong>Location:</strong> {service.service_location || 'N/A'}</div>
                    </div>
                  </div>
                </div>

                {/* Complaint Box */}
                <div className={styles.infoSection}>
                  <h3 style={{marginBottom: '0.5rem'}}><FiInfo color="#ec4899" /> Issue Description</h3>
                  <div className={styles.complaintBox}>
                    {service.complaint || 'No specific complaint documented.'}
                  </div>
                </div>
              </div>
            </div>

            {/* Items & Replacements */}
            <div className={styles.contentCard} style={{padding: '2rem'}}>
              <h2 className={styles.cardTitle} style={{marginBottom: '1.5rem'}}>Linked Invoice Items</h2>
              {service.items && service.items.length > 0 ? (
                <div>
                  {service.items.map(item => (
                    <div key={item.id} className={styles.itemRow}>
                      <div>
                        <div style={{fontWeight: 700, color: '#1f2937'}}>SKU: {item.sku_snapshot || 'N/A'}</div>
                        <div style={{fontSize: '0.875rem', color: '#6b7280'}}>Original Qty: {item.quantity}</div>
                      </div>
                      {item.replacement_product_id ? (
                        <div style={{marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f0fdf4', color: '#15803d', padding: '0.5rem 1rem', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 700, border: '1px solid #bbf7d0'}}>
                          <FiCheckCircle /> Replaced (Qty: {item.replacement_quantity})
                        </div>
                      ) : (
                        <span style={{marginTop: '0.75rem', display: 'inline-block', fontSize: '0.875rem', fontWeight: 500, color: '#9ca3af', background: 'white', padding: '0.25rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #e5e7eb'}}>No Replacement</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{textAlign: 'center', padding: '2.5rem', background: '#f9fafb', borderRadius: '1rem', border: '1px dashed #e5e7eb', color: '#6b7280', fontWeight: 500}}>
                  No items were imported from an invoice.
                </div>
              )}
            </div>

          </div>

          {/* Sidebar Column */}
          <div className={styles.sideCol}>
            
            {/* Status Update Card */}
            <div className={styles.statusUpdateBox}>
              <h3 style={{fontSize: '1.125rem', fontWeight: 700, color: '#1f2937', margin: '0 0 1rem'}}>Update Status</h3>
              <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                <select 
                  style={{width: '100%', borderRadius: '0.75rem', border: '1px solid #e5e7eb', background: '#f9fafb', padding: '0.75rem 1rem', fontWeight: 500, color: '#374151', boxSizing: 'border-box'}}
                  value={newStatus} 
                  onChange={(e) => setNewStatus(e.target.value)}
                >
                  <option value="Pending">Pending</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
                <button 
                  onClick={handleUpdateStatus}
                  style={{width: '100%', padding: '0.75rem', background: '#111827', color: 'white', borderRadius: '0.75rem', fontWeight: 700, border: 'none', cursor: 'pointer'}}
                >
                  Save Status
                </button>
              </div>
            </div>

            {/* Job Card & Billing Card */}
            <div className={styles.billBox}>
              <h3 style={{fontSize: '1.25rem', fontWeight: 700, margin: '0 0 1.5rem'}}>Job Card & Billing</h3>
              
              {service.job_cards && service.job_cards.length > 0 ? (
                <div>
                  <div style={{marginBottom: '1rem', padding: '1rem', background: '#f3f4f6', borderRadius: '0.5rem', border: '1px solid #e5e7eb'}}>
                    <div style={{fontSize: '0.875rem', color: '#6b7280', fontWeight: 600}}>LINKED JOB CARD</div>
                    <div style={{fontWeight: 700, fontSize: '1.125rem', color: '#111827'}}>{service.job_cards[0].job_card_number}</div>
                    <div style={{marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                      <span style={{fontSize: '0.875rem', fontWeight: 500}}>Status:</span>
                      <span className={`${styles.statusBadge} ${getStatusClass(service.job_cards[0].status)}`} style={{padding: '0.25rem 0.5rem', fontSize: '0.75rem'}}>
                        {service.job_cards[0].status}
                      </span>
                    </div>
                  </div>
                  
                  {service.job_cards[0].status !== 'COMPLETED' && (!service.job_cards[0].invoices || service.job_cards[0].invoices.length === 0) && (
                    <div style={{fontSize: '0.875rem', color: '#dc2626', background: '#fef2f2', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem', border: '1px solid #fecaca'}}>
                      ⚠️ The Job Card must be marked as <b>COMPLETED</b> before generating a final tax invoice.
                    </div>
                  )}

                  <button 
                    onClick={() => {
                      navigate(`/services/job-cards/${service.job_cards[0].id}/print`);
                    }}
                    className={styles.btnOutline}
                    style={{width: '100%', justifyContent: 'center', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem'}}
                  >
                    <FiPrinter /> Print Job Card
                  </button>
                  <button 
                    onClick={() => {
                      const jc = service.job_cards[0];
                      if (jc.invoices && jc.invoices.length > 0) {
                        navigate(`/services/invoices/${jc.invoices[0].id}`);
                      } else {
                        navigate(`/services/job-cards/${jc.id}`);
                      }
                    }}
                    className={styles.btnPrimary}
                    disabled={service.job_cards[0].status !== 'COMPLETED' && (!service.job_cards[0].invoices || service.job_cards[0].invoices.length === 0)}
                    style={{width: '100%', justifyContent: 'center', opacity: (service.job_cards[0].status !== 'COMPLETED' && (!service.job_cards[0].invoices || service.job_cards[0].invoices.length === 0)) ? 0.5 : 1}}
                  >
                    {(service.job_cards[0].invoices && service.job_cards[0].invoices.length > 0) ? 'View Tax Invoice' : 'Generate Tax Invoice'}
                  </button>
                </div>
              ) : (
                <div style={{textAlign: 'center'}}>
                  <p style={{fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem'}}>
                    No Job Card found. You must create a Job Card to proceed with workflow and billing.
                  </p>
                  <button onClick={() => navigate(`/services/job-cards/new?serviceRecordId=${service.id}`)} className={styles.btnOutline} style={{width: '100%'}}>
                    Create Job Card
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

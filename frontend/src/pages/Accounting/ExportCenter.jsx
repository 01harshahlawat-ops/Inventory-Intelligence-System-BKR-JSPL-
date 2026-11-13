import React, { useState, useEffect } from 'react';
import { FiDownload, FiPlay, FiAlertCircle } from 'react-icons/fi';
import api from '../../services/api';
import { formatDate } from '../../utils/dateUtils';
import { useNotificationStore } from '../../stores/notificationStore';
import styles from './ExportCenter.module.css';

const CATEGORY_CONFIG = [
  { id: 'Sales Invoice', label: 'Sales Invoice', subtypes: [{ id: 'B2C', label: 'B2C' }, { id: 'B2B', label: 'B2B' }] },
  { id: 'Credit Note', label: 'Credit Note', subtypes: [{ id: 'Sales Return', label: 'Sales Return' }, { id: 'Purchase Return', label: 'Purchase Return' }] },
  { id: 'Debit Note', label: 'Debit Note', subtypes: [{ id: 'Damage Claim', label: 'Damage Claim' }] },
  { id: 'Purchase', label: 'Purchase', subtypes: [{ id: 'Standard', label: 'Standard' }, { id: 'Import', label: 'Import' }] }
];

const ExportCenter = () => {
  const [documentCategory, setDocumentCategory] = useState(CATEGORY_CONFIG[0].id);
  const [documentSubtype, setDocumentSubtype] = useState(CATEGORY_CONFIG[0].subtypes[0].id);
  
  const [stats, setStats] = useState({ pending_exports: 0, generated_today: 0, failed_exports: 0, total_value: 0 });
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState('all');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [generating, setGenerating] = useState(false);
  const [forceReexport, setForceReexport] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const addNotification = useNotificationStore(state => state.addNotification);

  const fetchStats = async () => {
    try {
      const res = await api.get(`/api/accounting/statistics?category=${documentCategory}&subtype=${documentSubtype}`);
      setStats(res.data);
    } catch (err) {
      console.error('Failed to fetch stats', err);
    }
  };

  const fetchDocuments = async (filterProfile) => {
    setLoading(true);
    try {
      const res = await api.get(`/api/accounting/documents?category=${documentCategory}&subtype=${documentSubtype}&profile=${filterProfile}`);
      setDocuments(res.data);
      setSelectedIds(new Set());
    } catch (err) {
      if (err.response?.status !== 400) {
        addNotification({ type: 'error', message: 'Failed to fetch documents' });
      } else {
        setDocuments([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchDocuments(profile);
  }, [profile, documentCategory, documentSubtype]);

  const handleCategoryChange = (catId) => {
    setDocumentCategory(catId);
    const cat = CATEGORY_CONFIG.find(c => c.id === catId);
    if (cat && cat.subtypes.length > 0) {
      setDocumentSubtype(cat.subtypes[0].id);
    }
    setSelectedIds(new Set()); // Reset selections on tab change
  };

  const handleSubtypeChange = (subId) => {
    setDocumentSubtype(subId);
    setSelectedIds(new Set());
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const allSelectable = documents.filter(i => i.export_status === 'Ready' || i.export_status === 'Failed').map(i => i.id);
      setSelectedIds(new Set(allSelectable));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectRow = (id) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleGenerate = async () => {
    if (selectedIds.size === 0) return;
    if (forceReexport && !forceReason.trim()) {
      addNotification({ type: 'error', message: 'Please provide a reason for force re-exporting.' });
      return;
    }
    setGenerating(true);
    try {
      const res = await api.post('/api/accounting/export/batch', {
        category: documentCategory,
        subtype: documentSubtype,
        document_ids: Array.from(selectedIds),
        force_reexport: forceReexport,
        reason: forceReason
      });
      addNotification({ type: 'success', message: `Export batch created successfully. Status: ${res.data.status}` });
      setForceReexport(false);
      setForceReason('');
      fetchStats();
      fetchDocuments(profile);
    } catch (err) {
      addNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to generate export batch' });
    } finally {
      setGenerating(false);
    }
  };

  const formatCurrency = (val) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);

  const currentCatObj = CATEGORY_CONFIG.find(c => c.id === documentCategory);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Export Center</h1>
      </header>

      {/* Primary Category Tabs */}
      <div style={{ display: 'flex', gap: '16px', borderBottom: '1px solid #e2e8f0', marginBottom: '16px', paddingBottom: '8px' }}>
        {CATEGORY_CONFIG.map(cat => (
          <button 
            key={cat.id}
            onClick={() => handleCategoryChange(cat.id)}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: 'none',
              fontSize: '16px',
              fontWeight: documentCategory === cat.id ? 600 : 400,
              color: documentCategory === cat.id ? '#2563eb' : '#64748b',
              borderBottom: documentCategory === cat.id ? '2px solid #2563eb' : 'none',
              cursor: 'pointer'
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Secondary Subtype Tabs */}
      {currentCatObj && currentCatObj.subtypes.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          {currentCatObj.subtypes.map(sub => (
            <button
              key={sub.id}
              onClick={() => handleSubtypeChange(sub.id)}
              style={{
                padding: '6px 12px',
                borderRadius: '999px',
                border: '1px solid',
                borderColor: documentSubtype === sub.id ? '#2563eb' : '#cbd5e1',
                background: documentSubtype === sub.id ? '#eff6ff' : '#fff',
                color: documentSubtype === sub.id ? '#1d4ed8' : '#475569',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}

      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiTitle}>Pending Exports</span>
          <span className={styles.kpiValue}>{stats.pending_exports}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiTitle}>Generated Today</span>
          <span className={styles.kpiValue}>{stats.generated_today}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiTitle}>Failed Exports</span>
          <span className={styles.kpiValue} style={{ color: stats.failed_exports > 0 ? '#b91c1c' : 'inherit' }}>
            {stats.failed_exports}
          </span>
        </div>
      </div>

      <div className={styles.contentWrapper}>
        <div className={styles.toolbar}>
          <div className={styles.filterGroup}>
            {['all', 'today', 'yesterday', 'pending', 'failed'].map(p => (
              <button
                key={p}
                className={`${styles.filterBtn} ${profile === p ? styles.active : ''}`}
                onClick={() => setProfile(p)}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>

          <div className={styles.actionGroup}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '16px' }}>
              <input 
                type="checkbox" 
                id="forceReexport"
                checked={forceReexport}
                onChange={(e) => setForceReexport(e.target.checked)}
              />
              <label htmlFor="forceReexport" style={{ fontSize: '14px' }}>Force Re-export</label>
            </div>
            
            {forceReexport && (
              <input 
                type="text" 
                placeholder="Reason for re-export (Mandatory)" 
                value={forceReason}
                onChange={(e) => setForceReason(e.target.value)}
                style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', marginRight: '16px', fontSize: '14px' }}
              />
            )}

            <button 
              className={styles.btnPrimary} 
              disabled={selectedIds.size === 0 || generating}
              onClick={handleGenerate}
            >
              <FiPlay />
              {generating ? 'Generating...' : `Generate XML (${selectedIds.size})`}
            </button>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: '40px' }}>
                  <input 
                    type="checkbox" 
                    onChange={handleSelectAll}
                    checked={documents.length > 0 && selectedIds.size === documents.filter(i => i.export_status === 'Ready' || i.export_status === 'Failed').length}
                  />
                </th>
                <th>Document No</th>
                <th>Date</th>
                <th>Party</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: '24px' }}>Loading...</td></tr>
              ) : documents.length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: '24px' }}>No documents found for this category.</td></tr>
              ) : (
                documents.map(doc => {
                  const isSelectable = doc.export_status === 'Ready' || doc.export_status === 'Failed';
                  const isSelected = selectedIds.has(doc.id);
                  return (
                    <tr key={doc.id} className={isSelected ? styles.selected : ''}>
                      <td>
                        {isSelectable && (
                          <input 
                            type="checkbox" 
                            checked={isSelected}
                            onChange={() => handleSelectRow(doc.id)}
                          />
                        )}
                      </td>
                      <td style={{ fontWeight: 500 }}>{doc.invoice_number}</td>
                      <td>{formatDate(doc.invoice_date)}</td>
                      <td>{doc.customer_name}</td>
                      <td>{formatCurrency(doc.grand_total)}</td>
                      <td>
                        <span className={`${styles.badge} ${styles[(doc.export_status || 'Ready').toLowerCase().replace(' ', '')] || ''}`}>
                          {doc.export_status || 'Ready'}
                        </span>
                        {doc.last_error && (
                          <span title={doc.last_error} style={{ marginLeft: 8, color: '#ef4444', cursor: 'help' }}>
                            <FiAlertCircle />
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ExportCenter;

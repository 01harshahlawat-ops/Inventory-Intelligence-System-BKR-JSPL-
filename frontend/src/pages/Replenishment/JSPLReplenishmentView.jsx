import React, { useState, useEffect, useMemo } from 'react';
import { useNotificationStore } from '../../stores/notificationStore';
import useCompanyStore from '../../stores/useCompanyStore';
import styles from './JSPLReplenishmentView.module.css';
import api from '../../services/api';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../../constants/routes';

const JSPLReplenishmentView = () => {
  const navigate = useNavigate();
  const addNotification = useNotificationStore(state => state.addNotification);
  const { companyId } = useCompanyStore();
  const [recommendations, setRecommendations] = useState([]);
  const [activeTransfers, setActiveTransfers] = useState([]);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [warehouses, setWarehouses] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [destWarehouseId, setDestWarehouseId] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [autoGenerateBill, setAutoGenerateBill] = useState(true);
  const [completedInvoice, setCompletedInvoice] = useState(null);
  const isCrossCompanyEnabled = import.meta.env.VITE_CROSS_COMPANY_TRANSFERS === 'true';

  useEffect(() => {
    if (warehouses.length > 0) {
      if (!sourceWarehouseId) {
        const bkrWh = warehouses.find(w => w.company_id === 2);
        if (bkrWh) setSourceWarehouseId(bkrWh.id.toString());
      }
      if (!destWarehouseId) {
        const jsplWh = warehouses.find(w => w.company_id === (companyId || 3)) || warehouses.find(w => w.company_id === 3);
        if (jsplWh) setDestWarehouseId(jsplWh.id.toString());
      }
    }
  }, [warehouses, companyId]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Fetch real recommendations data for current company
        const recRes = await api.get('/api/replenishment/recommendations');
        setRecommendations(recRes.data || []);

        const whRes = await api.get(`/api/warehouses/?all_companies=${isCrossCompanyEnabled}`);
        setWarehouses(whRes.data || []);

        // Fetch active transfers
        const transfersRes = await api.get('/api/transfers/?status=active');
        setActiveTransfers(transfersRes.data || []);
      } catch (error) {
        addNotification({ type: 'error', title: 'Error', message: 'Failed to load replenishment data' });
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [companyId]);

  const filteredRecommendations = useMemo(() => {
    if (!searchTerm.trim()) return recommendations;
    const term = searchTerm.toLowerCase();
    return recommendations.filter(
      r => r.sku?.toLowerCase().includes(term) || r.product?.toLowerCase().includes(term)
    );
  }, [recommendations, searchTerm]);

  const handleSelect = (id) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedItems(new Set(recommendations.map(r => r.id)));
    } else {
      setSelectedItems(new Set());
    }
  };

  const handleApproveClick = () => {
    if (selectedItems.size === 0) return;
    setShowModal(true);
  };

  const handleApprove = async () => {
    if (selectedItems.size === 0) return;
    setLoading(true);
    try {
      const itemsToApprove = recommendations
        .filter(r => selectedItems.has(r.id))
        .map(r => ({ product_id: r.id, requested_qty: r.requiredQty, sku: r.sku }));

      const destWh = warehouses.find(w => w.id === parseInt(destWarehouseId));
      const sourceWh = warehouses.find(w => w.id === parseInt(sourceWarehouseId));
      
      const payload = {
        source_company_id: sourceWh ? sourceWh.company_id : 2, 
        destination_company_id: destWh ? destWh.company_id : (companyId || 3),
        from_company_id: sourceWh ? sourceWh.company_id : 2, 
        to_company_id: destWh ? destWh.company_id : (companyId || 3),
        source_warehouse_id: sourceWarehouseId ? parseInt(sourceWarehouseId) : null,
        destination_warehouse_id: destWarehouseId ? parseInt(destWarehouseId) : null,
        auto_generate_bill: autoGenerateBill,
        invoice_prefix: 'GST',
        items: itemsToApprove.map(i => ({ product_id: i.product_id, requested_qty: i.requested_qty, product_sku: i.sku }))
      };

      const response = await api.post('/api/transfers/create', payload);

      if (response.status !== 200 && response.status !== 201) throw new Error('Failed to create transfer');

      if (response.data?.invoice_number) {
        setCompletedInvoice({
          id: response.data.invoice_id,
          invoiceNumber: response.data.invoice_number,
          grandTotal: response.data.grand_total,
          itemCount: itemsToApprove.length
        });
        addNotification({ 
          type: 'success', 
          title: 'Replenishment & Bill Generated', 
          message: `Official B2B Bill ${response.data.invoice_number} generated for ${itemsToApprove.length} items.` 
        });
      } else {
        addNotification({ type: 'success', title: 'Success', message: 'Replenishment request sent to BKR successfully' });
      }
      
      const newTransfer = {
        items: itemsToApprove.map(i => ({ sku: i.sku, requested_qty: i.requested_qty })),
        status: response.data?.invoice_number ? 'Completed' : 'Pending'
      };
      setActiveTransfers([...activeTransfers, newTransfer]);
      setSelectedItems(new Set());
      
      // Refetch recommendations
      const recRes = await api.get('/api/replenishment/recommendations');
      setRecommendations(recRes.data || []);
    } catch (error) {
      addNotification({ type: 'error', title: 'Error', message: error.message || 'Failed to approve replenishment' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Need Replenishment</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            className={styles.approveBtn} 
            onClick={() => navigate(`${ROUTES.LOGISTICS_BATCH_DISPATCH}?source=CENTRAL`)}
          >
            Create Internal Distribution
          </button>
          <button 
            className={styles.approveBtn} 
            onClick={handleApproveClick}
            disabled={selectedItems.size === 0 || loading}
          >
            {loading ? 'Processing...' : `Approve Replenishment (${selectedItems.size})`}
          </button>
        </div>
      </div>

      
      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: 'white', padding: '2rem', borderRadius: '8px', maxWidth: '500px', width: '100%' }}>
            <h2>Create Replenishment Request</h2>
            <div style={{ marginBottom: '1rem' }}>
              <label>Source Warehouse</label>
              <select value={sourceWarehouseId} onChange={e => setSourceWarehouseId(e.target.value)} style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}>
                <option value="">Select Source...</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name} {w.company_id !== 1 && isCrossCompanyEnabled ? `(Cross-Company: ${w.company?.code || w.company_id})` : ''}
                  </option>
                ))}
              </select>
              
              <label>Destination Warehouse</label>
              <select value={destWarehouseId} onChange={e => setDestWarehouseId(e.target.value)} style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}>
                <option value="">Select Destination...</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name} {w.company_id !== 1 && isCrossCompanyEnabled ? `(Cross-Company: ${w.company?.code || w.company_id})` : ''}
                  </option>
                ))}
              </select>
            </div>
            
            <div style={{ marginBottom: '1.25rem', padding: '0.85rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                <input 
                  type="checkbox" 
                  checked={autoGenerateBill} 
                  onChange={e => setAutoGenerateBill(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <span style={{ fontWeight: 600, color: '#166534', fontSize: '0.9rem' }}>
                  Generate B2B Tax Invoice & Dispatch immediately (GST Series)
                </span>
              </label>
              <p style={{ margin: '4px 0 0 26px', fontSize: '0.8rem', color: '#15803d' }}>
                Automatically generates official B2B bill from BKR to JSPL, deducts from BKR stock, and adds stock to JSPL in one click.
              </p>
            </div>

            {sourceWarehouseId && destWarehouseId && warehouses.find(w=>w.id===parseInt(sourceWarehouseId))?.company_id !== warehouses.find(w=>w.id===parseInt(destWarehouseId))?.company_id && (
              <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#fee2e2', borderRadius: '4px' }}>
                <h3 style={{ color: '#dc2626', margin: '0 0 0.5rem 0' }}>Warning: Cross-Company Transfer</h3>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>You are creating a cross-company replenishment.</p>
                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 'bold' }}>Type CONFIRM to proceed:</label>
                <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)} style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }} />
              </div>
            )}
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '0.5rem 1rem' }}>Cancel</button>
              <button 
                onClick={() => {
                  setShowModal(false);
                  handleApprove();
                }}
                disabled={!sourceWarehouseId || !destWarehouseId || (warehouses.find(w=>w.id===parseInt(sourceWarehouseId))?.company_id !== warehouses.find(w=>w.id===parseInt(destWarehouseId))?.company_id && confirmText !== 'CONFIRM')}
                style={{ padding: '0.5rem 1rem', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '4px' }}
              >
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUCCESS MODAL FOR GENERATED BILL */}
      {completedInvoice && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ backgroundColor: 'white', padding: '2rem', borderRadius: '12px', maxWidth: '480px', width: '90%', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#dcfce7', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', fontSize: '28px', fontWeight: 'bold' }}>
              ✓
            </div>
            <h2 style={{ margin: '0 0 0.5rem 0', color: '#111827', fontSize: '1.4rem' }}>
              Replenishment Bill Generated!
            </h2>
            <p style={{ color: '#4b5563', fontSize: '0.95rem', margin: '0 0 1.5rem 0' }}>
              Urgent items have been replenished and the official B2B Tax Invoice has been generated in BKR.
            </p>

            <div style={{ backgroundColor: '#f3f4f6', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>Invoice Number:</span>
                <span style={{ fontWeight: 700, color: '#111827', fontSize: '1rem' }}>{completedInvoice.invoiceNumber}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>Series:</span>
                <span style={{ fontWeight: 600, color: '#2563eb', fontSize: '0.875rem' }}>BKR Inter-Company (GST)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>Total Amount:</span>
                <span style={{ fontWeight: 700, color: '#059669', fontSize: '1rem' }}>
                  ₹{Number(completedInvoice.grandTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                onClick={() => setCompletedInvoice(null)}
                style={{
                  padding: '0.6rem 1.2rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  backgroundColor: '#ffffff',
                  color: '#374151',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Done
              </button>
              <button
                onClick={() => {
                  window.open(`/sales/${completedInvoice.id}/invoice`, '_blank');
                }}
                style={{
                  padding: '0.6rem 1.5rem',
                  border: 'none',
                  borderRadius: '6px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                🖨️ View & Print Bill
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <input
          type="text"
          placeholder="Search by SKU or Product name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            padding: '0.6rem 1rem',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '0.875rem',
            minWidth: '280px',
            backgroundColor: '#ffffff'
          }}
        />
        <div style={{ fontSize: '0.875rem', color: '#4b5563', fontWeight: 500 }}>
          Showing {filteredRecommendations.length} of {recommendations.length} items needing replenishment
        </div>
      </div>

      <div className={styles.card}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>
                <input 
                  type="checkbox" 
                  className={styles.checkbox}
                  checked={selectedItems.size === filteredRecommendations.length && filteredRecommendations.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedItems(new Set(filteredRecommendations.map(r => r.id)));
                    } else {
                      setSelectedItems(new Set());
                    }
                  }}
                />
              </th>
              <th>SKU</th>
              <th>Product</th>
              <th>Current Stock</th>
              <th>Required Qty</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecommendations.map(item => {
              const activeTransfer = activeTransfers.find(t => t.items?.some(i => i.sku === item.sku));
              const isPending = !!activeTransfer;
              return (
              <tr key={item.id}>
                <td>
                  <input 
                    type="checkbox" 
                    className={styles.checkbox}
                    checked={selectedItems.has(item.id)}
                    onChange={() => handleSelect(item.id)}
                    disabled={isPending}
                  />
                </td>
                <td style={{ fontWeight: 600 }}>{item.sku}</td>
                <td>{item.product}</td>
                <td>
                  {item.currentStock < 0 ? (
                    <span style={{ 
                      color: '#b91c1c', 
                      backgroundColor: '#fee2e2', 
                      padding: '3px 8px', 
                      borderRadius: '4px', 
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      {item.currentStock} (Deficit)
                    </span>
                  ) : item.currentStock === 0 ? (
                    <span style={{ 
                      color: '#b45309', 
                      backgroundColor: '#fef3c7', 
                      padding: '3px 8px', 
                      borderRadius: '4px', 
                      fontWeight: 600 
                    }}>
                      0 (Out of Stock)
                    </span>
                  ) : (
                    <span style={{ color: '#047857', fontWeight: 600 }}>
                      {item.currentStock} (Low Stock)
                    </span>
                  )}
                </td>
                <td style={{ fontWeight: 600, color: '#1d4ed8' }}>{item.requiredQty}</td>
                <td>
                  {isPending ? (
                    <span className={styles.badge}>{activeTransfer.status}</span>
                  ) : (
                    <span style={{ color: '#9ca3af' }}>Ready</span>
                  )}
                </td>
              </tr>
            )})}
            {filteredRecommendations.length === 0 && (
              <tr>
                <td colSpan="6" style={{textAlign: 'center', padding: '2rem', color: '#6b7280'}}>
                  {recommendations.length === 0 
                    ? 'No items currently need replenishment. All stocked items meet their levels.'
                    : 'No matching replenishment items found for your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default JSPLReplenishmentView;

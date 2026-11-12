import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useQueryClient } from '@tanstack/react-query';
import styles from './SalesReturnsPage.module.css';

export default function CreateReturnModal({ onClose, onSuccess }) {
  const queryClient = useQueryClient();
  const [sales, setSales] = useState([]);
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [saleDetails, setSaleDetails] = useState(null);
  
  const [returnItems, setReturnItems] = useState({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // 1. Fetch recent sales
  useEffect(() => {
    api.get('/api/pos/history?limit=50')
      .then(res => setSales(res.data?.items || []))
      .catch(err => console.error(err));
  }, []);

  // 2. Fetch sale details when a sale is selected
  useEffect(() => {
    if (selectedSaleId) {
      setSaleDetails(null);
      setReturnItems({});
      api.get(`/api/pos/sales/${selectedSaleId}`)
        .then(res => {
          if (res.data?.receipt) {
            setSaleDetails(res.data.receipt);
            
            // Initialize return items state
            const initialItems = {};
            res.data.receipt.items.forEach(item => {
              initialItems[item.id] = {
                returned_quantity: 0,
                return_reason: 'Customer Changed Mind',
                max_qty: item.quantity - (item.returned_quantity || 0)
              };
            });
            setReturnItems(initialItems);
          }
        })
        .catch(err => {
          console.error(err);
          setError('Failed to load invoice details');
        });
    }
  }, [selectedSaleId]);

  const handleQtyChange = (itemId, qty) => {
    setReturnItems(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        returned_quantity: Math.min(Math.max(0, parseInt(qty || 0)), prev[itemId].max_qty)
      }
    }));
  };

  const handleReasonChange = (itemId, reason) => {
    setReturnItems(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], return_reason: reason }
    }));
  };

  const handleSubmit = async () => {
    const itemsToReturn = Object.entries(returnItems)
      .map(([saleItemId, data]) => ({
        sale_item_id: parseInt(saleItemId),
        returned_quantity: data.returned_quantity,
        return_reason: data.return_reason
      }))
      .filter(i => i.returned_quantity > 0);

    if (itemsToReturn.length === 0) {
      setError('Please select at least one item to return with quantity > 0');
      return;
    }

    setCreating(true);
    setError('');

    try {
      await api.post('/api/sales-returns/draft', {
        sale_id: parseInt(selectedSaleId),
        items: itemsToReturn
      });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['salesReturns'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      onSuccess();
    } catch (err) {
      console.error(err);
      let errorMessage = 'Failed to create sales return';
      if (err.response?.data?.detail) {
        if (typeof err.response.data.detail === 'string') {
          errorMessage = err.response.data.detail;
        } else if (Array.isArray(err.response.data.detail)) {
          errorMessage = err.response.data.detail.map(e => `${e.loc?.slice(-1)?.[0] || 'Field'}: ${e.msg}`).join(', ');
        }
      }
      setError(errorMessage);
    } finally {
      setCreating(false);
    }
  };

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
          <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Create Sales Return</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        {error && <div style={{ color: 'red', marginBottom: '16px' }}>{error}</div>}

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Select Invoice</label>
          <select 
            value={selectedSaleId}
            onChange={(e) => setSelectedSaleId(e.target.value)}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
          >
            <option value="">-- Select an Invoice --</option>
            {sales.map(sale => (
              <option key={sale.id} value={sale.id}>
                {sale.bill_number} - {sale.customer_name} - ₹{Math.round(sale.grand_total || 0)}
              </option>
            ))}
          </select>
        </div>

        {saleDetails && (
          <div style={{ marginTop: '20px' }}>
            <h4 style={{ marginBottom: '12px' }}>Items to Return</h4>
            <table className={styles.table} style={{ border: '1px solid #eee' }}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Billed Qty</th>
                  <th>Return Qty</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {saleDetails.items.map(item => (
                  <tr key={item.id}>
                    <td>
                      <div><strong>{item.product_name}</strong></div>
                      <small style={{ color: '#666' }}>SKU: {item.sku}</small>
                    </td>
                    <td>{item.quantity}</td>
                    <td>
                      <input 
                        type="number"
                        min="0"
                        max={item.quantity}
                        value={returnItems[item.id]?.returned_quantity || 0}
                        onChange={(e) => handleQtyChange(item.id, e.target.value)}
                        style={{ width: '80px', padding: '6px', border: '1px solid #ccc', borderRadius: '4px' }}
                      />
                    </td>
                    <td>
                      <select 
                        value={returnItems[item.id]?.return_reason || ''}
                        onChange={(e) => handleReasonChange(item.id, e.target.value)}
                        style={{ width: '100%', padding: '6px', border: '1px solid #ccc', borderRadius: '4px' }}
                      >
                        <option value="Customer Changed Mind">Customer Changed Mind</option>
                        <option value="Defective / Damaged">Defective / Damaged</option>
                        <option value="Wrong Item Shipped">Wrong Item Shipped</option>
                        <option value="Quality Issue">Quality Issue</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <button 
            onClick={onClose}
            style={{ padding: '8px 16px', background: '#f3f4f6', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button 
            className={styles.primaryButton}
            onClick={handleSubmit}
            disabled={creating || !selectedSaleId}
          >
            {creating ? 'Saving...' : 'Create Return Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

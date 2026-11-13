import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { salesReturnsService } from '../../services/salesReturns';
import { useQueryClient } from '@tanstack/react-query';
import styles from './SalesReturnsPage.module.css';

export default function CreateReturnModal({ onClose, onSuccess }) {
  const queryClient = useQueryClient();
  const [returnType, setReturnType] = useState('OFFLINE'); // OFFLINE | AMAZON
  const [nextNumber, setNextNumber] = useState('');
  
  // Offline Return fields
  const [sales, setSales] = useState([]);
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [saleDetails, setSaleDetails] = useState(null);
  const [returnItems, setReturnItems] = useState({});

  // Amazon Return fields
  const [amazonOrderId, setAmazonOrderId] = useState('');
  const [amazonCustomerName, setAmazonCustomerName] = useState('Amazon Seller Portal Customer');
  const [amazonCustomerState, setAmazonCustomerState] = useState('Haryana');
  const [amazonSku, setAmazonSku] = useState('');
  const [amazonProductName, setAmazonProductName] = useState('');
  const [amazonQty, setAmazonQty] = useState(1);
  const [amazonUnitPrice, setAmazonUnitPrice] = useState('');
  const [amazonGstRate, setAmazonGstRate] = useState(18);
  const [amazonReason, setAmazonReason] = useState('Customer Return');

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // 1. Fetch next return number preview when returnType changes
  useEffect(() => {
    salesReturnsService.getNextNumber(returnType)
      .then(res => {
        if (res?.formatted_next_number) {
          setNextNumber(res.formatted_next_number);
        }
      })
      .catch(err => console.error('Failed to preview next return number', err));
  }, [returnType]);

  // 2. Fetch recent sales for Offline return
  useEffect(() => {
    if (returnType === 'OFFLINE') {
      api.get('/api/pos/history?limit=100')
        .then(res => setSales(res.data?.items || []))
        .catch(err => console.error(err));
    }
  }, [returnType]);

  // 3. Fetch sale details when an offline sale is selected
  useEffect(() => {
    if (selectedSaleId && returnType === 'OFFLINE') {
      setSaleDetails(null);
      setReturnItems({});
      api.get(`/api/pos/sales/${selectedSaleId}`)
        .then(res => {
          if (res.data?.receipt) {
            setSaleDetails(res.data.receipt);
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
  }, [selectedSaleId, returnType]);

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
    setCreating(true);
    setError('');

    try {
      if (returnType === 'OFFLINE') {
        if (!selectedSaleId) {
          setError('Please select an invoice to return against.');
          setCreating(false);
          return;
        }

        const itemsToReturn = Object.entries(returnItems)
          .map(([saleItemId, data]) => ({
            sale_item_id: parseInt(saleItemId),
            returned_quantity: data.returned_quantity,
            return_reason: data.return_reason
          }))
          .filter(i => i.returned_quantity > 0);

        if (itemsToReturn.length === 0) {
          setError('Please select at least one item to return with quantity > 0');
          setCreating(false);
          return;
        }

        await api.post('/api/sales-returns/draft', {
          sale_id: parseInt(selectedSaleId),
          return_type: 'OFFLINE',
          return_number: nextNumber || undefined,
          items: itemsToReturn
        });
      } else {
        // Amazon Return
        if (!amazonSku.trim()) {
          setError('Please enter product SKU for Amazon return.');
          setCreating(false);
          return;
        }
        if (!amazonQty || parseInt(amazonQty) <= 0) {
          setError('Please enter a valid return quantity > 0.');
          setCreating(false);
          return;
        }

        const price = Math.round(parseFloat(amazonUnitPrice) || 0);
        const gst = parseFloat(amazonGstRate) || 18;
        const taxable = Math.round(price * parseInt(amazonQty));
        const taxAmt = Math.round(taxable * (gst / 100));

        await api.post('/api/sales-returns/draft', {
          return_type: 'AMAZON',
          return_number: nextNumber || undefined,
          customer_name: `${amazonCustomerName} (${amazonCustomerState}) - Order: ${amazonOrderId || 'Direct'}`,
          total_taxable_amount: taxable,
          total_tax: taxAmt,
          grand_total: taxable + taxAmt,
          items: [{
            sku_snapshot: amazonSku.trim().toUpperCase(),
            product_name_snapshot: amazonProductName.trim() || amazonSku.trim().toUpperCase(),
            returned_quantity: parseInt(amazonQty),
            return_reason: `${amazonReason}${amazonOrderId ? ` (Order #${amazonOrderId})` : ''}`,
            unit_price: price,
            tax_rate: gst,
            tax_amount: taxAmt,
            total_price: taxable + taxAmt
          }]
        });
      }

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
      alignItems: 'center', justifyContent: 'center', zIndex: 1100
    }}>
      <div style={{
        background: '#fff', padding: '24px', borderRadius: '8px', 
        width: '90%', maxWidth: '820px', maxHeight: '90vh', overflowY: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Register Sales Return</h3>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              Series: <strong>{returnType === 'AMAZON' ? 'GGSR (Amazon Return)' : 'SR (Offline Return)'}</strong>
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        {/* Series & Preview Banner */}
        <div style={{
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px',
          padding: '10px 14px', marginBottom: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div>
            <span style={{ fontSize: '12px', color: '#1e40af' }}>Next Generated Number:</span>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#1e3a8a' }}>
              {nextNumber || 'Generating...'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setReturnType('OFFLINE')}
              style={{
                padding: '6px 14px', borderRadius: '4px', border: '1px solid #2563eb',
                background: returnType === 'OFFLINE' ? '#2563eb' : '#fff',
                color: returnType === 'OFFLINE' ? '#fff' : '#2563eb',
                fontWeight: 600, fontSize: '12px', cursor: 'pointer'
              }}
            >
              Offline Return (SR)
            </button>
            <button
              type="button"
              onClick={() => setReturnType('AMAZON')}
              style={{
                padding: '6px 14px', borderRadius: '4px', border: '1px solid #ea580c',
                background: returnType === 'AMAZON' ? '#ea580c' : '#fff',
                color: returnType === 'AMAZON' ? '#fff' : '#ea580c',
                fontWeight: 600, fontSize: '12px', cursor: 'pointer'
              }}
            >
              Amazon Return (GGSR)
            </button>
          </div>
        </div>

        {error && (
          <div style={{ color: '#dc2626', background: '#fee2e2', padding: '10px 12px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
            {error}
          </div>
        )}

        {returnType === 'OFFLINE' ? (
          <div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '13px' }}>
                Select Invoice to Return Against:
              </label>
              <select 
                value={selectedSaleId}
                onChange={(e) => setSelectedSaleId(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px' }}
              >
                <option value="">-- Select an Invoice / Bill --</option>
                {sales.map(sale => (
                  <option key={sale.id} value={sale.id}>
                    {sale.invoice_number || sale.bill_number} - {sale.customer_name || 'Walk-in'} - ₹{Math.round(sale.grand_total || 0)}
                  </option>
                ))}
              </select>
            </div>

            {saleDetails && (
              <div style={{ marginTop: '16px' }}>
                <h4 style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 600 }}>Items to Return:</h4>
                <table className={styles.table} style={{ border: '1px solid #e5e7eb' }}>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style={{ textAlign: 'center' }}>Billed Qty</th>
                      <th style={{ textAlign: 'center' }}>Return Qty</th>
                      <th>Return Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saleDetails.items.map(item => (
                      <tr key={item.id}>
                        <td>
                          <div><strong>{item.product_name}</strong></div>
                          <small style={{ color: '#6b7280' }}>SKU: {item.sku} | Price: ₹{Math.round(item.price || item.unit_price || 0)}</small>
                        </td>
                        <td style={{ textAlign: 'center' }}>{item.quantity}</td>
                        <td style={{ textAlign: 'center' }}>
                          <input 
                            type="number"
                            min="0"
                            max={item.quantity}
                            value={returnItems[item.id]?.returned_quantity || 0}
                            onChange={(e) => handleQtyChange(item.id, e.target.value)}
                            style={{ width: '70px', padding: '6px', border: '1px solid #d1d5db', borderRadius: '4px', textAlign: 'center' }}
                          />
                        </td>
                        <td>
                          <select 
                            value={returnItems[item.id]?.return_reason || ''}
                            onChange={(e) => handleReasonChange(item.id, e.target.value)}
                            style={{ width: '100%', padding: '6px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px' }}
                          >
                            <option value="Customer Changed Mind">Customer Changed Mind</option>
                            <option value="Defective / Damaged">Defective / Damaged</option>
                            <option value="Wrong Item Shipped">Wrong Item Shipped</option>
                            <option value="Quality Issue">Quality Issue</option>
                            <option value="Customer Return">Customer Return</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          /* Amazon Return Entry */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Amazon Order ID:</label>
                <input
                  type="text"
                  placeholder="e.g. 408-1234567-8901234"
                  value={amazonOrderId}
                  onChange={(e) => setAmazonOrderId(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '5px', border: '1px solid #d1d5db', fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Customer State / Place of Supply:</label>
                <input
                  type="text"
                  placeholder="e.g. Haryana / Chandigarh / Delhi"
                  value={amazonCustomerState}
                  onChange={(e) => setAmazonCustomerState(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '5px', border: '1px solid #d1d5db', fontSize: '13px' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>SKU *:</label>
                <input
                  type="text"
                  placeholder="e.g. LG0831"
                  value={amazonSku}
                  onChange={(e) => setAmazonSku(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '5px', border: '1px solid #d1d5db', fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Product Description / Name:</label>
                <input
                  type="text"
                  placeholder="Product Name"
                  value={amazonProductName}
                  onChange={(e) => setAmazonProductName(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '5px', border: '1px solid #d1d5db', fontSize: '13px' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Return Qty *:</label>
                <input
                  type="number"
                  min="1"
                  value={amazonQty}
                  onChange={(e) => setAmazonQty(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '5px', border: '1px solid #d1d5db', fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Unit Price (₹):</label>
                <input
                  type="number"
                  min="0"
                  placeholder="₹ Unit Price"
                  value={amazonUnitPrice}
                  onChange={(e) => setAmazonUnitPrice(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '5px', border: '1px solid #d1d5db', fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>GST Rate (%):</label>
                <select
                  value={amazonGstRate}
                  onChange={(e) => setAmazonGstRate(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '5px', border: '1px solid #d1d5db', fontSize: '13px' }}
                >
                  <option value="0">0%</option>
                  <option value="5">5%</option>
                  <option value="12">12%</option>
                  <option value="18">18%</option>
                  <option value="28">28%</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Return Reason / Remarks:</label>
              <select
                value={amazonReason}
                onChange={(e) => setAmazonReason(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '5px', border: '1px solid #d1d5db', fontSize: '13px' }}
              >
                <option value="Customer Return">Customer Return</option>
                <option value="Defective / Damaged in Transit">Defective / Damaged in Transit</option>
                <option value="Wrong Item Returned">Wrong Item Returned</option>
                <option value="Undeliverable / RTO">Undeliverable / RTO</option>
                <option value="Customer Rejected">Customer Rejected</option>
              </select>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <button 
            type="button"
            onClick={onClose}
            style={{ padding: '8px 18px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '5px', cursor: 'pointer', fontWeight: 600 }}
          >
            Cancel
          </button>
          <button 
            type="button"
            className={styles.primaryButton}
            onClick={handleSubmit}
            disabled={creating}
          >
            {creating ? 'Saving Return...' : `Create ${returnType === 'AMAZON' ? 'GGSR' : 'SR'} Return Draft`}
          </button>
        </div>
      </div>
    </div>
  );
}

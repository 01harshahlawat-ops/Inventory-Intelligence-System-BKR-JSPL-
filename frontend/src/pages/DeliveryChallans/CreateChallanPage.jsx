import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { deliveryChallanService } from '../../services/deliveryChallanService';
import useCompanyStore from '../../stores/useCompanyStore';
import api from '../../services/api';
import { formatDate } from '../../utils/dateUtils';
import styles from './DeliveryChallansPage.module.css';

export default function CreateChallanPage() {
  const navigate = useNavigate();
  const currentCompany = useCompanyStore(state => state.currentCompany);
  
  const [sales, setSales] = useState([]);
  const [selectedSaleId, setSelectedSaleId] = useState('');
  
  const [transport, setTransport] = useState({
    vehicle_number: '',
    transport_mode: '',
    eway_bill: '',
    remarks: ''
  });
  
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (currentCompany?.id) {
      setLoading(true);
      // Fetch recent sales to link to the challan
      api.get('/api/pos/history?limit=50')
        .then(res => setSales(res.data?.items || []))
        .catch(err => {
          console.error(err);
          setError('Failed to load recent sales.');
        })
        .finally(() => setLoading(false));
    }
  }, [currentCompany]);

  const handleCreate = async () => {
    if (!selectedSaleId) {
      setError('Please select an invoice to base the Delivery Challan on.');
      return;
    }
    
    setCreating(true);
    setError('');
    
    try {
      const payload = {
        sale_id: parseInt(selectedSaleId),
        ...transport
      };
      const response = await deliveryChallanService.createChallan(payload);
      const challanId = response.id;
      toast.success('Delivery Challan created successfully');
      navigate(`/delivery-challans/${challanId}`);
    } catch (err) {
      console.error(err);
      let errorMessage = 'Failed to create Delivery Challan';
      if (err.response?.data?.detail) {
        if (typeof err.response.data.detail === 'string') {
          errorMessage = err.response.data.detail;
        } else if (Array.isArray(err.response.data.detail)) {
          errorMessage = err.response.data.detail.map(e => `${e.loc?.slice(-1)?.[0] || 'Field'}: ${e.msg}`).join(', ');
        }
      }
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={styles.container} style={{ maxWidth: '600px', margin: '0 auto' }}>
      <div className={styles.header}>
        <h2>Create Delivery Challan</h2>
      </div>
      
      {loading && <div style={{ marginBottom: '16px', color: '#666' }}>Loading invoices...</div>}
      {error && <div className={styles.errorText} style={{ color: 'red', marginBottom: '16px' }}>{error}</div>}
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Select Invoice</label>
          <select 
            value={selectedSaleId}
            onChange={(e) => setSelectedSaleId(e.target.value)}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
            autoFocus
          >
            <option value="">-- Select an Invoice --</option>
            {sales.map(sale => (
              <option key={sale.id} value={sale.id}>
                {sale.bill_number} - {sale.customer_name} ({formatDate(sale.sale_date)})
              </option>
            ))}
          </select>
          <small style={{ color: '#666', marginTop: '4px', display: 'block' }}>
            The challan will automatically copy the products, quantities, and parties from the invoice.
          </small>
        </div>
        
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Vehicle Number (Optional)</label>
          <input 
            type="text" 
            value={transport.vehicle_number}
            onChange={(e) => setTransport({...transport, vehicle_number: e.target.value})}
            placeholder="e.g. MH 12 AB 1234"
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>
        
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Transport Mode (Optional)</label>
          <input 
            type="text" 
            value={transport.transport_mode}
            onChange={(e) => setTransport({...transport, transport_mode: e.target.value})}
            placeholder="e.g. Road, Air, Rail"
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>E-Way Bill (Optional)</label>
          <input 
            type="text" 
            value={transport.eway_bill}
            onChange={(e) => setTransport({...transport, eway_bill: e.target.value})}
            placeholder="E-Way Bill Number"
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Remarks</label>
          <textarea 
            value={transport.remarks}
            onChange={(e) => setTransport({...transport, remarks: e.target.value})}
            placeholder="Any additional remarks..."
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', minHeight: '80px' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <button 
            onClick={() => navigate('/delivery-challans')}
            style={{ padding: '10px 20px', background: '#f3f4f6', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', flex: 1, maxWidth: '120px' }}
            disabled={creating}
          >
            Cancel
          </button>
          <button 
            className={styles.primaryButton}
            onClick={handleCreate}
            disabled={creating}
            style={{ flex: 1, display: 'flex', justifyContent: 'center' }}
          >
            {creating ? 'Creating...' : 'Create Challan'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import useCompanyStore from '../../stores/useCompanyStore';
import api from '../../services/api';
import { PurchaseService } from '../../services/purchaseService';
import { productService } from '../../services/products';
import { FiArrowLeft, FiSave, FiCheckCircle, FiTrash2, FiPlus, FiAlertCircle } from 'react-icons/fi';

export default function EditPurchase() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { currentCompany } = useCompanyStore();
  const activeCompanyId = currentCompany?.id || 2;
  const [purchaseCompanyId, setPurchaseCompanyId] = useState(null);
  const effectiveCompanyId = purchaseCompanyId || activeCompanyId;
  
  const [vendorId, setVendorId] = useState(null);
  const [vendorName, setVendorName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentTerms, setPaymentTerms] = useState('');
  const [ewayBill, setEwayBill] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ product_sku: '', description: '', qty: 1, unit_cost: 0, gst_pct: 0, hsn: '' }]);
  const [warehouseId, setWarehouseId] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [purchaseStatus, setPurchaseStatus] = useState('DRAFT');
  
  // Payment Options
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [amountPaid, setAmountPaid] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('UNPAID');
  const [warehouses, setWarehouses] = useState([]);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [txnRef, setTxnRef] = useState('');

  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [draftIdempotency] = useState(crypto.randomUUID());
  const [allProducts, setAllProducts] = useState([]);

  useEffect(() => {
    const fetchPurchase = async () => {
      try {
        setInitialLoading(true);
        const res = await api.get(`/api/purchases/${id}`);
        const purchase = res.data;
        setPurchaseCompanyId(purchase.company_id || null);
        setVendorId(purchase.vendor_id || null);
        setVendorName(purchase.vendor_name || '');
        setInvoiceNumber(purchase.invoice_number || '');
        setBillDate(purchase.date ? purchase.date.split('T')[0] : (purchase.created_at ? purchase.created_at.split('T')[0] : ''));
        setPaymentTerms(purchase.payment_terms || '');
        setEwayBill(purchase.eway_bill || '');
        setVehicleNo(purchase.vehicle_number || '');
        setNotes(purchase.notes || '');
        setPurchaseStatus(purchase.status || 'DRAFT');
        setPaymentMethod(purchase.payment_method || 'Cash');
        setAmountPaid(purchase.amount_paid ? String(purchase.amount_paid) : '');
        if (purchase.warehouse_id) {
          setWarehouseId(String(purchase.warehouse_id));
        }
        
        const mappedItems = (purchase.items || []).map(i => ({
          product_sku: i.product_sku || '',
          description: i.description || '',
          qty: i.qty || 1,
          unit_cost: i.unit_cost || 0,
          gst_pct: i.gst_pct || 0,
          hsn: i.hsn || ''
        }));
        setItems(mappedItems.length > 0 ? mappedItems : [{ product_sku: '', description: '', qty: 1, unit_cost: 0, gst_pct: 0, hsn: '' }]);
      } catch (err) {
        console.error("Error loading purchase", err);
        alert("Failed to load purchase details: " + (err.response?.data?.detail || err.message));
      } finally {
        setInitialLoading(false);
      }
    };
    if (id) fetchPurchase();
  }, [id]);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const prods = await productService.getProducts();
        setAllProducts(prods);
      } catch (e) {
        console.error("Failed to load products", e);
      }
    };
    fetchProducts();
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors', effectiveCompanyId],
    queryFn: async () => {
      const res = await api.get('/api/vendors/', {
        headers: { 'X-Company-Id': effectiveCompanyId.toString() }
      });
      return res.data;
    },
    enabled: !!effectiveCompanyId
  });

  const { data: warehousesQuery = [] } = useQuery({
    queryKey: ['warehouses', effectiveCompanyId],
    queryFn: async () => {
      const res = await api.get('/api/warehouses/', {
        headers: { 'X-Company-Id': effectiveCompanyId.toString() }
      });
      return res.data;
    },
    enabled: !!effectiveCompanyId
  });

  useEffect(() => {
    if (warehousesQuery.length > 0) {
      setWarehouses(warehousesQuery);
      if (!warehouseId) {
        setWarehouseId(String(warehousesQuery[0].id));
      }
    }
  }, [warehousesQuery]);

  const handleVendorSelect = (value) => {
    setVendorName(value);
    const matched = vendors.find(v => v.name.toLowerCase() === value.toLowerCase());
    if (matched) {
      setVendorId(matched.id);
    }
  };

  const handleAddItem = () => setItems([...items, { product_sku: '', description: '', qty: 1, unit_cost: 0, gst_pct: 0, hsn: '' }]);

  const updateItem = (index, field, value) => {
    const newItems = [...items];
    newItems[index][field] = value;
    if (field === 'product_sku') {
      const match = allProducts.find(p => p.sku.toLowerCase() === value.toLowerCase());
      if (match) {
        newItems[index].description = match.name || '';
        newItems[index].hsn = match.hsn || '';
        newItems[index].unit_cost = match.item_rate || 0;
        newItems[index].gst_pct = match.default_gst_rate || 0;
      }
    }
    if (field === 'description') {
      const match = allProducts.find(p => p.name.toLowerCase() === value.toLowerCase());
      if (match) {
        newItems[index].product_sku = match.sku || '';
        newItems[index].hsn = match.hsn || '';
        newItems[index].unit_cost = match.item_rate || 0;
        newItems[index].gst_pct = match.default_gst_rate || 0;
      }
    }
    setItems(newItems);
  };

  const calculateTotal = () => {
    return items.reduce((sum, item) => sum + (parseFloat(item.qty || 0) * parseFloat(item.unit_cost || 0) * (1 + parseFloat(item.gst_pct || 0)/100)), 0);
  };

  const calculateGross = () => {
    return items.reduce((sum, item) => sum + (parseFloat(item.qty || 0) * parseFloat(item.unit_cost || 0)), 0);
  };

  const calculateTax = () => {
    return calculateTotal() - calculateGross();
  };

  const handleError = (e) => {
    const detail = e.response?.data?.detail;
    if (Array.isArray(detail)) {
      alert(detail.map(d => `${d.loc.join('.')}: ${d.msg}`).join('\n'));
    } else {
      alert(detail || e.message || "An error occurred");
    }
  };

  const handleUpdatePurchase = async () => {
    if (!vendorName.trim()) {
      alert("Please select or enter a Vendor Name.");
      return;
    }
    if (items.length === 0 || !items.some(i => i.product_sku.trim() && parseFloat(i.qty) > 0)) {
      alert("Please enter at least one valid line item with SKU and quantity.");
      return;
    }

    try {
      setLoading(true);
      const payload = {
        idempotency_key: draftIdempotency,
        company_id: effectiveCompanyId,
        vendor_id: vendorId || null,
        vendor_name: vendorName.trim(),
        invoice_number: invoiceNumber ? invoiceNumber.trim() : null,
        bill_date: billDate || null,
        payment_terms: paymentTerms || null,
        eway_bill: ewayBill || null,
        vehicle_number: vehicleNo || null,
        notes: notes || null,
        items: items.filter(i => i.product_sku.trim()).map(i => ({
          product_sku: i.product_sku.trim().toUpperCase(),
          description: i.description || null,
          qty: parseFloat(i.qty || 0),
          unit_cost: parseFloat(i.unit_cost || 0),
          gst_pct: parseFloat(i.gst_pct || 0),
          hsn: i.hsn || null
        })),
        warehouse_id: warehouseId ? parseInt(warehouseId) : null
      };

      await api.put(`/api/purchases/${id}`, payload, {
        headers: { 'X-Company-Id': effectiveCompanyId.toString() }
      });
      alert('Purchase bill updated successfully!');
      navigate('/purchases/list');
    } catch (e) {
      handleError(e);
    } finally {
      setLoading(false);
    }
  };

  const handleReceiveStock = async () => {
    try {
      if (!confirm(`Are you sure you want to receive stock for this purchase (${invoiceNumber || id})? This will update warehouse inventory.`)) {
        return;
      }
      setLoading(true);
      const recvRes = await PurchaseService.receivePurchase(id, {
        idempotency_key: `recv-${crypto.randomUUID()}`,
        warehouse_id: warehouseId ? parseInt(warehouseId) : null
      });
      alert(`Stock received successfully! Added ${recvRes.movements} inventory movements.`);
      navigate('/purchases/list');
    } catch (e) {
      handleError(e);
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
        <h3>Loading Purchase Bill #{id}...</h3>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1350px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button 
            onClick={() => navigate('/purchases/list')}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              padding: '8px 14px', 
              background: '#f1f5f9', 
              border: '1px solid #cbd5e1', 
              borderRadius: '6px', 
              cursor: 'pointer',
              fontWeight: 500,
              color: '#334155'
            }}
          >
            <FiArrowLeft /> Back to List
          </button>
          <div>
            <h2 style={{ margin: 0, color: '#0f172a', fontSize: '22px' }}>
              Edit Purchase Bill {invoiceNumber ? `(${invoiceNumber})` : `#${id}`}
            </h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
              <span style={{ 
                fontSize: '12px', 
                fontWeight: 'bold', 
                padding: '2px 8px', 
                borderRadius: '10px',
                background: purchaseStatus === 'RECEIVED' ? '#dcfce7' : '#fef3c7',
                color: purchaseStatus === 'RECEIVED' ? '#166534' : '#92400e'
              }}>
                STOCK: {purchaseStatus}
              </span>
              <span style={{ 
                fontSize: '12px', 
                fontWeight: 'bold', 
                padding: '2px 8px', 
                borderRadius: '10px',
                background: paymentStatus === 'PAID' ? '#dcfce7' : (paymentStatus === 'PARTIAL' ? '#fef3c7' : '#fee2e2'),
                color: paymentStatus === 'PAID' ? '#166534' : (paymentStatus === 'PARTIAL' ? '#92400e' : '#991b1b')
              }}>
                PAYMENT: {paymentStatus}
              </span>
            </div>
          </div>
        </div>

        {isOffline && (
          <span style={{ background: '#ef4444', color: 'white', padding: '6px 12px', borderRadius: '6px', fontWeight: 'bold' }}>
            OFFLINE MODE
          </span>
        )}
      </div>

      {/* Received Warning Alert */}
      {purchaseStatus === 'RECEIVED' && (
        <div style={{ 
          background: '#eff6ff', 
          border: '1px solid #bfdbfe', 
          borderRadius: '8px', 
          padding: '14px 18px', 
          marginBottom: '20px', 
          display: 'flex', 
          gap: '12px', 
          alignItems: 'center',
          color: '#1e40af',
          fontSize: '14px'
        }}>
          <FiAlertCircle size={22} style={{ flexShrink: 0 }} />
          <div>
            <strong>Notice: This purchase has already been received into stock.</strong>
            <div style={{ fontSize: '13px', marginTop: '2px', color: '#3b82f6' }}>
              Updating line items, quantities, or prices will automatically reverse previous inventory movements, update warehouse stock to the new counts, and adjust vendor payables.
            </div>
          </div>
        </div>
      )}

      <div style={{ background: '#fff', padding: '24px', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        
        {/* Receiving Warehouse Selection */}
        <div style={{ marginBottom: '20px', background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '8px' }}>
            Receiving Warehouse (Inventory Destination) *
          </label>
          <select 
            value={warehouseId} 
            onChange={e => setWarehouseId(e.target.value)} 
            style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none' }}
          >
            <option value="">-- Select Destination Warehouse --</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name} ({w.code || w.type})</option>
            ))}
          </select>
        </div>

        {/* Vendor and Invoice Details Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
          {/* Vendor Details */}
          <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#334155', fontSize: '14px', textTransform: 'uppercase' }}>Vendor Details</h4>
            
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500', color: '#475569' }}>Vendor Name *</label>
              <input 
                list="vendor-names" 
                value={vendorName} 
                onChange={e => handleVendorSelect(e.target.value)} 
                required 
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box', outline: 'none' }} 
                placeholder="Select or type Vendor Name..." 
              />
              <datalist id="vendor-names">
                {vendors.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
              </datalist>
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500', color: '#475569' }}>Payment Terms</label>
              <input 
                value={paymentTerms} 
                onChange={e => setPaymentTerms(e.target.value)} 
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box', outline: 'none' }} 
                placeholder="e.g. Net 30, Cash On Delivery" 
              />
            </div>
          </div>

          {/* Invoice Details */}
          <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#334155', fontSize: '14px', textTransform: 'uppercase' }}>Invoice & Dispatch Details</h4>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500', color: '#475569' }}>Vendor Invoice Number</label>
                <input 
                  value={invoiceNumber} 
                  onChange={e => setInvoiceNumber(e.target.value)} 
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box', outline: 'none' }} 
                  placeholder="e.g. INV-1001" 
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500', color: '#475569' }}>Bill Date</label>
                <input 
                  type="date" 
                  value={billDate} 
                  onChange={e => setBillDate(e.target.value)} 
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box', outline: 'none' }} 
                />
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500', color: '#475569' }}>E-Way Bill No.</label>
                <input 
                  value={ewayBill} 
                  onChange={e => setEwayBill(e.target.value)} 
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box', outline: 'none' }} 
                  placeholder="Optional" 
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500', color: '#475569' }}>Vehicle No.</label>
                <input 
                  value={vehicleNo} 
                  onChange={e => setVehicleNo(e.target.value)} 
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box', outline: 'none' }} 
                  placeholder="Optional" 
                />
              </div>
            </div>
          </div>
        </div>

        {/* LINE ITEMS */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, color: '#0f172a', fontSize: '18px' }}>Purchase Bill Line Items</h3>
          <span style={{ fontSize: '13px', color: '#64748b' }}>{items.length} item(s)</span>
        </div>

        <datalist id="sku-list">
          {allProducts.map(p => <option key={p.sku} value={p.sku}>{p.name}</option>)}
        </datalist>
        <datalist id="name-list">
          {allProducts.map(p => <option key={p.sku} value={p.name}>{p.sku}</option>)}
        </datalist>
        
        <div style={{ overflowX: 'auto', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '1px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px', fontSize: '13px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', width: '140px' }}>SKU *</th>
                <th style={{ padding: '12px', fontSize: '13px', color: '#475569', fontWeight: '600', textTransform: 'uppercase' }}>Product Name</th>
                <th style={{ padding: '12px', fontSize: '13px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', width: '120px' }}>HSN</th>
                <th style={{ padding: '12px', fontSize: '13px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', width: '90px' }}>Qty *</th>
                <th style={{ padding: '12px', fontSize: '13px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', width: '120px' }}>Unit Cost (₹)</th>
                <th style={{ padding: '12px', fontSize: '13px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', width: '90px' }}>GST %</th>
                <th style={{ padding: '12px', fontSize: '13px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', width: '110px', textAlign: 'right' }}>Tax Amt</th>
                <th style={{ padding: '12px', fontSize: '13px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', width: '130px', textAlign: 'right' }}>Line Total</th>
                <th style={{ padding: '12px', width: '40px' }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const qty = parseFloat(item.qty || 0);
                const cost = parseFloat(item.unit_cost || 0);
                const gst = parseFloat(item.gst_pct || 0);
                const baseVal = qty * cost;
                const taxAmt = baseVal * (gst / 100);
                const lineTotal = baseVal + taxAmt;

                return (
                  <tr key={index} style={{ borderBottom: index === items.length - 1 ? 'none' : '1px solid #e2e8f0', background: index % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <input 
                        placeholder="SKU" 
                        list="sku-list" 
                        value={item.product_sku} 
                        onChange={e => updateItem(index, 'product_sku', e.target.value)} 
                        style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '14px', fontWeight: '500' }} 
                      />
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <input 
                        placeholder="Product Name" 
                        list="name-list" 
                        value={item.description} 
                        onChange={e => updateItem(index, 'description', e.target.value)} 
                        style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '14px' }} 
                      />
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <input 
                        placeholder="HSN" 
                        value={item.hsn || ''} 
                        onChange={e => updateItem(index, 'hsn', e.target.value)} 
                        style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '14px' }} 
                      />
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <input 
                        placeholder="Qty" 
                        type="number" 
                        min="0.01" 
                        step="any"
                        value={item.qty} 
                        onChange={e => updateItem(index, 'qty', e.target.value)} 
                        style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '14px' }} 
                      />
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <input 
                        placeholder="Cost" 
                        type="number" 
                        min="0" 
                        step="any"
                        value={item.unit_cost} 
                        onChange={e => updateItem(index, 'unit_cost', e.target.value)} 
                        style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '14px' }} 
                      />
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <input 
                        placeholder="GST%" 
                        type="number" 
                        min="0" 
                        step="any"
                        value={item.gst_pct} 
                        onChange={e => updateItem(index, 'gst_pct', e.target.value)} 
                        style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', fontSize: '14px' }} 
                      />
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: '14px', textAlign: 'right', color: '#64748b' }}>
                      ₹ {taxAmt.toFixed(2)}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: '14px', textAlign: 'right', fontWeight: '600', color: '#0f172a' }}>
                      ₹ {lineTotal.toFixed(2)}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <button 
                        onClick={() => { const newItems = [...items]; newItems.splice(index, 1); setItems(newItems); }} 
                        style={{ background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '4px', cursor: 'pointer', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }} 
                        title="Remove Item"
                      >
                        <FiTrash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: '12px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
            <button 
              onClick={handleAddItem} 
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '10px 16px', background: 'white', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px', width: '100%' }}
            >
              <FiPlus /> Add New Line Item
            </button>
          </div>
        </div>

        {/* Bill Notes & Totals */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '30px', marginTop: '24px', alignItems: 'flex-start' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '6px' }}>Purchase Bill Notes / Remarks</label>
            <textarea 
              rows={4}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add any internal notes, supplier terms, or payment remarks..."
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box', outline: 'none', fontSize: '14px', resize: 'vertical' }}
            />
          </div>

          <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px', color: '#475569' }}>
              <span>Taxable Gross Amount:</span>
              <span style={{ fontWeight: 500 }}>₹ {calculateGross().toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px', color: '#475569' }}>
              <span>Total Tax (GST):</span>
              <span style={{ fontWeight: 500 }}>₹ {calculateTax().toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #cbd5e1', paddingTop: '10px', marginTop: '8px', fontSize: '18px', fontWeight: 'bold', color: '#0f172a' }}>
              <span>Grand Total:</span>
              <span>₹ {calculateTotal().toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '30px', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
          <button 
            type="button" 
            onClick={() => navigate('/purchases/list')} 
            style={{ padding: '12px 20px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
          >
            Cancel
          </button>

          {purchaseStatus === 'DRAFT' && (
            <button 
              type="button" 
              onClick={handleReceiveStock} 
              disabled={loading} 
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 22px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
            >
              <FiCheckCircle /> Receive Stock In Warehouse
            </button>
          )}

          <button 
            type="button" 
            onClick={handleUpdatePurchase} 
            disabled={loading} 
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 26px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
          >
            <FiSave /> {loading ? 'Saving Changes...' : 'Update Purchase Bill'}
          </button>
        </div>

      </div>
    </div>
  );
}

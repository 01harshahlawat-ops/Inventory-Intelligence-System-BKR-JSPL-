import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { 
  CheckCircle, ChevronRight, ArrowRight, Package, 
  MapPin, Truck, FileText, Check, AlertTriangle, Building2
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import styles from './BatchDispatchCreator.module.css';
import InvoiceRenderer from '../../components/invoice/InvoiceRenderer';
import DeliveryChallanRenderer from '../../components/delivery-challans/DeliveryChallanRenderer';
import useCompanyStore from '../../stores/useCompanyStore';

const BatchDispatchCreator = () => {
  const queryClient = useQueryClient();
  const { currentCompany } = useCompanyStore();
  const isBkr = currentCompany?.name?.toLowerCase().includes('bkr') || currentCompany?.code === 'BKR';
  
  const location = useLocation();
  const navigate = useNavigate();
  const queryParams = new URLSearchParams(location.search);
  const defaultSource = isBkr ? 'BKR' : 'CENTRAL';

  const idempotencyKeyRef = useRef(window.crypto.randomUUID());

  const loadDraft = () => {
    try {
      const draft = localStorage.getItem('jspl_wizard_draft');
      if (draft) return JSON.parse(draft);
    } catch(e) {}
    return null;
  };
  const draft = loadDraft();

  const [step, setStep] = useState(draft?.step || 1);
  const [submitting, setSubmitting] = useState(false);
  const [sourceWarehouseId, setSourceWarehouseId] = useState(draft?.sourceWarehouseId || '');
  const [dispatchType, setDispatchType] = useState(draft?.dispatchType || 'STANDARD');
  const [selectedHub, setSelectedHub] = useState(draft?.selectedHub || '');
  const [selectedFC, setSelectedFC] = useState(draft?.selectedFC || '');
  
  const [hubs, setHubs] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allowOtherCompanies, setAllowOtherCompanies] = useState(false);
  const [showCrossModal, setShowCrossModal] = useState(false);
  const [crossConfirmText, setCrossConfirmText] = useState('');
  const [crossConfirmed, setCrossConfirmed] = useState(false);

  const isCrossCompanyEnabled = import.meta.env.VITE_CROSS_COMPANY_TRANSFERS === 'true';

  // Products
  const [inventory, setInventory] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [products, setProducts] = useState(draft?.products || []); 
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [editedFields, setEditedFields] = useState(draft?.editedFields || {});
  const [topLevelEdits, setTopLevelEdits] = useState(draft?.topLevelEdits || { invoice_number: '', invoice_date: '', notes: '' });

  useEffect(() => {
    try {
      const draftState = {
        step, dispatchType, sourceWarehouseId, selectedHub, selectedFC, products, editedFields, topLevelEdits
      };
      localStorage.setItem('jspl_wizard_draft', JSON.stringify(draftState));
    } catch (e) {
      console.warn('Failed to save draft to localStorage', e);
    }
  }, [step, dispatchType, sourceWarehouseId, selectedHub, selectedFC, products, editedFields, topLevelEdits]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        let headers = {};

        const [hubsRes, whRes] = await Promise.all([
          api.get(`/api/state-hubs/?all_companies=${allowOtherCompanies}`, { headers }),
          api.get(`/api/warehouses/?all_companies=${allowOtherCompanies}`, { headers })
        ]);
        const loadedWhs = whRes.data || [];
        setHubs(hubsRes.data || []);
        setWarehouses(loadedWhs);
        if (!sourceWarehouseId && loadedWhs.length > 0) {
          const defaultCentral = loadedWhs.find(w => w.warehouse_type === 'CENTRAL' && w.company_id === currentCompany?.id)
            || loadedWhs.find(w => w.warehouse_type === 'CENTRAL')
            || loadedWhs.find(w => w.company_id === currentCompany?.id)
            || loadedWhs[0];
          if (defaultCentral) {
            setSourceWarehouseId(defaultCentral.id);
          }
        }
      } catch (err) {
        console.error('Failed to load destinations', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [allowOtherCompanies]);



  useEffect(() => {
    if (step === 4) {
      const fetchInventory = async () => {
        setLoadingInventory(true);
        try {
          // Determine correct source warehouse ID based on selection or fallback
          let resolvedSourceId = sourceWarehouseId;
          if (!resolvedSourceId) {
             let fallbackWh = warehouses.find(w => w.warehouse_type === 'CENTRAL' && w.company_id === currentCompany?.id)
                 || warehouses.find(w => w.warehouse_type === 'CENTRAL')
                 || warehouses.find(w => w.company_id === currentCompany?.id)
                 || warehouses[0];
             resolvedSourceId = fallbackWh?.id;
          }
          if (!resolvedSourceId) return;

          let headers = {};

          const res = await api.get(`/api/fc-dispatches/inventory?source_warehouse_id=${resolvedSourceId}`, { headers });
          const loadedInv = res.data.map(item => {
            const existing = products.find(p => p.id === item.id);
            return { ...item, transferQty: existing ? existing.transferQty : '' };
          });
          setInventory(loadedInv);
        } catch (err) {
          console.error('Failed to load inventory', err);
        } finally {
          setLoadingInventory(false);
        }
      };
      fetchInventory();
    }
  }, [step, sourceWarehouseId, warehouses, isBkr]);

  const handleQtyChange = (id, val) => {
    let numVal = val === '' ? '' : parseInt(val, 10);
    if (numVal !== '') numVal = Math.max(0, numVal);
    setInventory(prev => {
      const next = prev.map(item => {
        if (item.id === id) {
          return { ...item, transferQty: numVal > item.currentStock ? item.currentStock : numVal };
        }
        return item;
      });
      // Immediately update products state so draft auto-saves current selections on step 4
      const selected = next.filter(p => p.transferQty > 0);
      setProducts(selected);
      return next;
    });
  };

  const handleProceedToValidation = () => {
    const selected = inventory.filter(item => item.transferQty > 0);
    setProducts(selected);
    setStep(5);
  };

  const nextStep = () => setStep(s => s + 1);
  const prevStep = () => setStep(s => s - 1);

  // Helper to build mock snapshot data for Invoice/Challan rendering
  const buildMockInvoice = () => {
    const destFC = warehouses.find(w => w.id === selectedFC);
    const destHub = hubs.find(h => h.id === selectedHub) || destFC;
    
    // In actual implementation, backend generates these numbers
    const mockInvNo = `PI-${Math.floor(Math.random() * 10000)}`;
    const mockDate = new Date().toISOString();
    
    const seller = {
      name: currentCompany?.legal_name || currentCompany?.name || 'Seller Name (Configure in Settings)',
      gstin: currentCompany?.gstin || 'GSTIN Not Configured',
      address: currentCompany?.address || 'Address Not Configured',
      state: currentCompany?.state || 'State Not Configured',
      state_code: currentCompany?.state_code || ''
    };
    
    const buyer = {
      name: destHub?.hub_name || 'Destination Hub',
      gstin: destHub?.gstin || 'UNREGISTERED',
      address: destHub?.address || 'Billing Address',
      state: destHub?.state || 'Destination State',
      state_code: destHub?.state_code || '99',
      place_of_supply: destHub?.state || ''
    };

    const shipping = {
      name: destFC?.name || `FC ID: ${selectedFC}`,
      gstin: destHub?.gstin || 'UNREGISTERED', // Hub GSTIN
      address: destFC?.address || destHub?.address || 'Shipping Address',
      state: destFC?.state || destHub?.state || 'Destination State',
      state_code: destFC?.state_code || destHub?.state_code || '99'
    };

    let totalTaxable = 0;
    let totalTax = 0;
    const isInterState = seller.state !== buyer.state;

    const mockItems = products.map((p, i) => {
      const edited = editedFields[p.id] || {};
      const unit_price = edited.edited_selling_price !== undefined ? edited.edited_selling_price : (p.item_rate || 0);
      const tax_rate = edited.edited_gst_percent !== undefined ? edited.edited_gst_percent : (p.gst_rate || 18);
      
      const taxable = p.transferQty * unit_price;
      const tax_amount = taxable * (tax_rate / 100);
      const total = taxable + tax_amount;
      
      totalTaxable += taxable;
      totalTax += tax_amount;

      const hsn_value = edited.edited_hsn !== undefined ? edited.edited_hsn : (p.hsn || '');

      return {
        // Fields for DeliveryChallanRenderer
        product_name_snapshot: p.name + (edited.edited_notes ? ` (${edited.edited_notes})` : ''),
        sku_snapshot: p.sku,
        hsn_snapshot: hsn_value,
        unit_snapshot: 'PCS',
        quantity: p.transferQty,
        unit_price: unit_price,
        tax_rate: tax_rate,
        tax_amount: tax_amount,
        total_price: total,
        
        // Fields for InvoiceRenderer
        product_name: p.name + (edited.edited_notes ? ` (${edited.edited_notes})` : ''),
        sku: p.sku,
        hsn_sac: hsn_value,
        unit: 'PCS',
        gst_rate: tax_rate,
        rate: unit_price,
        taxable_value: taxable,
        igst: isInterState ? tax_amount : 0,
        cgst: isInterState ? 0 : tax_amount / 2,
        sgst: isInterState ? 0 : tax_amount / 2
      };
    });

    const mockInvoice = {
      invoice_number: topLevelEdits.invoice_number || mockInvNo,
      date: topLevelEdits.invoice_date || mockDate,
      delivery_note: topLevelEdits.notes,
      invoice_type: 'B2B',
      company: seller,
      customer: buyer,
      shipping: shipping,
      items: mockItems,
      totals: {
        taxable_amount: totalTaxable,
        total_tax: totalTax,
        grand_total: totalTaxable + totalTax,
        igst_total: isInterState ? totalTax : 0,
        cgst_total: isInterState ? 0 : totalTax / 2,
        sgst_total: isInterState ? 0 : totalTax / 2
      }
    };
    
    const mockChallan = {
      challan_number: `DC-${Math.floor(Math.random() * 10000)}`,
      challan_date: mockDate,
      seller_snapshot: seller,
      buyer_snapshot: buyer,
      shipping_snapshot: shipping,
      items: mockItems
    };
    
    return { mockInvoice, mockChallan };
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Resolve source warehouse
      let resolvedSourceId = sourceWarehouseId;
      if (!resolvedSourceId) {
         let fallbackWh = warehouses.find(w => w.warehouse_type === 'CENTRAL' && w.company_id === currentCompany?.id)
             || warehouses.find(w => w.warehouse_type === 'CENTRAL')
             || warehouses.find(w => w.company_id === currentCompany?.id)
             || warehouses[0];
         resolvedSourceId = fallbackWh?.id;
      }
      
      let headers = {};

      await api.post('/api/fc-dispatches/', {
        idempotency_key: idempotencyKeyRef.current,
        warehouse_ids: [selectedFC],
        hub_id: selectedHub ? parseInt(selectedHub, 10) : null,
        dispatch_type: dispatchType,
        source_warehouse_id: resolvedSourceId,
        items: (products || []).map(p => ({ 
          product_id: p.id, 
          quantity: p.transferQty,
          ...((editedFields && editedFields[p.id]) || {})
        })),
        edited_invoice_number: (topLevelEdits && topLevelEdits.invoice_number) || null,
        edited_invoice_date: (topLevelEdits && topLevelEdits.invoice_date) || null,
        edited_notes: (topLevelEdits && topLevelEdits.notes) || null
      }, { headers });
      
      // Reset idempotency key for the next operation
      idempotencyKeyRef.current = window.crypto.randomUUID();
      
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['dispatches'] });
      toast.success('Dispatch created successfully');
      try {
        localStorage.removeItem('jspl_wizard_draft');
      } catch (e) {}
      setStep(1);
      setProducts([]);
      setInventory([]);
      setSelectedHub('');
      setSelectedFC('');
    } catch (err) {
      console.error(err);
      let errorMsg = 'Error creating dispatch';
      if (err.response?.data?.detail) {
        if (typeof err.response.data.detail === 'string') {
          errorMsg = err.response.data.detail;
        } else if (err.response.data.detail.message) {
          errorMsg = err.response.data.detail.message;
        } else if (Array.isArray(err.response.data.detail)) {
          errorMsg = err.response.data.detail[0]?.msg || 'Validation error';
        } else {
          errorMsg = JSON.stringify(err.response.data.detail);
        }
      }
      toast.error(errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [
    { id: 1, name: 'Source' },
    { id: 2, name: 'State Hub' },
    { id: 3, name: 'Warehouse / FC' },
    { id: 4, name: 'Products' },
    { id: 5, name: 'Validation' },
    { id: 6, name: 'Invoice' },
    { id: 7, name: 'Challan' },
    { id: 8, name: 'Confirm' }
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '16px' }}>
          <h1 className={styles.title} style={{ margin: 0 }}>FC Dispatch Wizard</h1>
          {draft && (
             <button 
               onClick={() => {
                 if(window.confirm('Are you sure you want to clear your current draft and start over?')) {
                   try { localStorage.removeItem('jspl_wizard_draft'); } catch(e) {}
                   window.location.reload();
                 }
               }}
               style={{
                 padding: '8px 16px', backgroundColor: '#ef4444', color: 'white', border: 'none', 
                 borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '500'
               }}>
               Clear Draft
             </button>
          )}
        </div>
        
        {/* Progress Bar */}
        <div className={styles.progressContainer}>
          {/* Progress bar background line */}
          <div className={styles.progressLine} />
          {steps.map((s, i) => (
            <div key={s.id} className={styles.stepNode}>
              <div className={`${styles.stepIcon} ${
                step >= s.id ? styles.stepIconActive : styles.stepIconInactive
              } shadow-sm`}>
                {step > s.id ? <Check size={16} /> : s.id}
              </div>
              <span className={`${styles.stepLabel} ${step >= s.id ? styles.stepLabelActive : styles.stepLabelInactive}`}>
                {s.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.contentCard}>
        <div className={styles.contentInner}>
          
          {/* Step 1: Source */}
          {step === 1 && (
            <div>
              <h2 className={styles.stepTitle}><MapPin /> Select Source Warehouse</h2>
              <p className={styles.stepSubtitle}>Where is the stock coming from?</p>
              
              <div className={styles.sourceGrid}>
                {/* Dynamic Central Card */}
                {(() => {
                  const centralWh = warehouses.find(w => w.warehouse_type === 'CENTRAL' && w.company_id === currentCompany?.id)
                    || warehouses.find(w => w.warehouse_type === 'CENTRAL')
                    || warehouses[0];
                  const isCentralActive = centralWh && (!sourceWarehouseId || sourceWarehouseId === centralWh.id);
                  return (
                    <div 
                      className={`${styles.sourceCard} ${isCentralActive ? styles.sourceCardBkrActive : ''}`}
                      onClick={() => {
                          if (centralWh) setSourceWarehouseId(centralWh.id);
                      }}
                      style={{ opacity: dispatchType === 'EMERGENCY' ? 0.5 : 1, cursor: dispatchType === 'EMERGENCY' ? 'not-allowed' : 'pointer' }}
                    >
                      <div className={styles.sourceHeader}>
                        <div className={styles.sourceTitleGroup}>
                          <div className={`${styles.sourceIconBox} ${isCentralActive ? styles.sourceIconBoxBkrActive : ''}`}>
                            <Building2 />
                          </div>
                          <div>
                            <h3 className={`${styles.sourceTitle} ${isCentralActive ? styles.sourceTitleBkrActive : ''}`}>{currentCompany?.name || 'Main'} Central Warehouse</h3>
                            <p className={styles.sourceSubtitle}>Primary Distribution Hub</p>
                          </div>
                        </div>
                        {isCentralActive && (
                          <div className={`${styles.sourceCheck} ${styles.sourceCheckBkr}`}>
                            <Check size={16} strokeWidth={3} />
                          </div>
                        )}
                      </div>
                      
                      <div className={styles.sourceDesc}>
                        Use this option to dispatch fresh stock from your primary central hub to regional fulfillment centers.
                      </div>
                    </div>
                  );
                })()}
              </div>
              
              <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <h3 className={styles.stepTitle} style={{fontSize: '16px', marginBottom: '10px', color: '#374151'}}>Or select a specific source warehouse:</h3>
                <select 
                  className={styles.inputField}
                  value={sourceWarehouseId || ''}
                  onChange={(e) => setSourceWarehouseId(parseInt(e.target.value, 10))}
                  style={{ width: '100%', maxWidth: '400px' }}
                >
                  <option value="">-- Let system decide based on above --</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                  ))}
                </select>
              </div>
              <div style={{marginTop: '20px', marginBottom: '20px'}}>
                  <h3 className={styles.stepTitle} style={{fontSize: '16px', marginBottom: '10px'}}>Dispatch Type</h3>
                  <select 
                    value={dispatchType}
                    onChange={(e) => setDispatchType(e.target.value)}
                    style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', width: '100%', maxWidth: '300px' }}
                  >
                    <option value="STANDARD">STANDARD</option>
                    <option value="EMERGENCY">EMERGENCY (VSHB Only)</option>
                  </select>
              </div>

              <div className={styles.actionRow}>
                <button 
                  className={styles.btnPrimary}
                  onClick={() => setStep(2)}
                >
                  Continue to Destination
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Hub */}
          {step === 2 && (
            <div>
              <h2 className={styles.stepTitle}><Truck color="#2563eb" /> Select Destination State Hub</h2>
              {isCrossCompanyEnabled && (
                <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" id="crossCompanyToggle" checked={allowOtherCompanies} onChange={(e) => setAllowOtherCompanies(e.target.checked)} />
                  <label htmlFor="crossCompanyToggle" style={{ fontWeight: '500' }}>Allow other company warehouses (Cross-Company Transfers)</label>
                </div>
              )}

              <div className={styles.grid}>
                {hubs.map(hub => (
                  <div 
                    key={hub.id}
                    className={`${styles.card} ${selectedHub === hub.id ? styles.cardActive : ''}`}
                    onClick={() => {
                      setSelectedHub(hub.id);
                      setSelectedFC('');
                    }}
                  >
                    <h3 className={styles.cardTitle}>{hub.hub_name}</h3>
                    <p className={styles.cardSubtitle}>Code: <strong>{hub.hub_code}</strong></p>
                  </div>
                ))}
                {hubs.length === 0 && <p>No hubs available or still loading...</p>}
              </div>
              <div className={styles.actionRow}>
                <button className={styles.btnPrimary} onClick={() => setStep(1)} style={{marginRight: 'auto', backgroundColor: '#6b7280'}}>Back</button>
                <button 
                  className={styles.btnPrimary} 
                  onClick={() => {
                    const hubFCs = warehouses.filter(w => w.hub_id === selectedHub && w.status?.toUpperCase() === 'ACTIVE');
                    if (hubFCs.length === 0) {
                      alert('No active warehouse is available under this State Hub.');
                    } else if (hubFCs.length === 1) {
                      setSelectedFC(hubFCs[0].id);
                      setStep(4);
                    } else {
                      setStep(3);
                    }
                  }} 
                  disabled={!selectedHub}
                >
                  Next Step
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Warehouse / FC */}
          {step === 3 && (
            <div>
              <h2 className={styles.stepTitle}><Package color="#2563eb" /> Select Destination Warehouse / FC</h2>
              <div className={styles.grid}>
                {warehouses.filter(w => w.hub_id === selectedHub && w.status?.toUpperCase() === 'ACTIVE').map(fc => (
                  <div 
                    key={fc.id}
                    className={`${styles.card} ${selectedFC === fc.id ? styles.cardActive : ''}`}
                    onClick={() => setSelectedFC(fc.id)}
                  >
                    <h3 className={styles.cardTitle}>{fc.name}</h3>
                    <div className={styles.cardSubtitle}>
                      <p>Code: <strong>{fc.code}</strong></p>
                      <p>GSTIN: <strong>{fc.gstin || 'N/A'}</strong></p>
                    </div>
                    {fc.company_id !== currentCompany?.id && (
                      <span style={{ backgroundColor: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: '4px', fontSize: '12px', marginTop: '4px', display: 'inline-block' }}>
                        Cross-Company: {fc.company?.code || fc.company_id}
                      </span>
                    )}

                  </div>
                ))}
                {warehouses.filter(w => w.hub_id === selectedHub && w.status?.toUpperCase() === 'ACTIVE').length === 0 && (
                  <p>No active Warehouse/FC found for this hub.</p>
                )}
              </div>
              <div className={styles.actionRow}>
                <button className={styles.btnPrimary} onClick={() => setStep(2)} style={{marginRight: 'auto', backgroundColor: '#6b7280'}}>Back</button>
                <button className={styles.btnPrimary} onClick={() => setStep(4)} disabled={!selectedFC}>Next Step</button>
              </div>
            </div>
          )}

          {/* Step 4: Products */}
          {step === 4 && (
            <div>
              <h2 className={styles.stepTitle}><Package color="#2563eb" /> Select Products & Quantities</h2>
              
              <div style={{ marginBottom: '16px' }}>
                <input 
                  type="text" 
                  placeholder="Search products..." 
                  className={styles.inputField} 
                  style={{ width: '100%', maxWidth: '400px' }}
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>

              {loadingInventory ? (
                <p>Loading inventory...</p>
              ) : (
                <div className={styles.tableContainer}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Product Name</th>
                        <th style={{textAlign: 'center'}}>Current Stock</th>
                        <th style={{textAlign: 'center'}}>Recommended Qty</th>
                        <th>Transfer Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventory.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.sku.toLowerCase().includes(searchTerm.toLowerCase())).map((p) => (
                        <tr key={p.id}>
                          <td style={{fontWeight: '500'}}>{p.name} <br/><span style={{fontSize: '12px', color: '#6b7280'}}>{p.sku}</span></td>
                          <td style={{textAlign: 'center', fontFamily: 'monospace'}}>{p.currentStock}</td>
                          <td style={{textAlign: 'center', fontFamily: 'monospace', color: '#2563eb', fontWeight: 'bold'}}>{p.recommended}</td>
                          <td>
                            <input 
                              type="number" 
                              className={styles.inputField}
                              value={p.transferQty}
                              min="0"
                              max={p.currentStock}
                              onChange={(e) => handleQtyChange(p.id, e.target.value)}
                            />
                          </td>
                        </tr>
                      ))}
                      {inventory.length === 0 && (
                        <tr>
                          <td colSpan="4" style={{textAlign: 'center', padding: '24px'}}>No inventory available at selected source warehouse.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              
              <div className={styles.actionRow}>
                <button className={styles.btnPrimary} onClick={() => setStep(3)} style={{marginRight: 'auto', backgroundColor: '#6b7280'}}>Back</button>
                <button className={styles.btnPrimary} onClick={handleProceedToValidation} disabled={inventory.filter(i => i.transferQty > 0).length === 0}>Validate Stock</button>
              </div>
            </div>
          )}

          {/* Step 5: Validation */}
          {step === 5 && (
            <div>
              <h2 className={styles.stepTitle}><CheckCircle color="#10b981" /> Inventory Validation</h2>
              <div style={{backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', padding: '20px', borderRadius: '8px', display: 'flex', gap: '16px', alignItems: 'flex-start'}}>
                <CheckCircle color="#10b981" size={24} style={{marginTop: '2px'}} />
                <div>
                  <h3 style={{fontWeight: 'bold', color: '#065f46', margin: '0 0 4px 0'}}>All Stock Validated</h3>
                  <p style={{color: '#047857', margin: 0}}>Sufficient inventory is available for this dispatch request.</p>
                </div>
              </div>
              
              {/* Top-Level Edits */}
              <div style={{marginTop: '24px', backgroundColor: '#f9fafb', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb'}}>
                <h4 style={{margin: '0 0 12px 0', fontSize: '14px', fontWeight: 'bold'}}>Document Overrides (Optional)</h4>
                <div style={{display: 'flex', gap: '16px', flexWrap: 'wrap'}}>
                  <div style={{flex: '1 1 200px'}}>
                    <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>Custom Invoice Number</label>
                    <input 
                      type="text" 
                      className={styles.inputField} 
                      value={topLevelEdits.invoice_number} 
                      onChange={e => setTopLevelEdits({...topLevelEdits, invoice_number: e.target.value})} 
                      placeholder="Leave blank for auto-generation"
                    />
                  </div>
                  <div style={{flex: '1 1 200px'}}>
                    <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>Custom Invoice Date</label>
                    <input 
                      type="datetime-local" 
                      className={styles.inputField} 
                      value={topLevelEdits.invoice_date} 
                      onChange={e => setTopLevelEdits({...topLevelEdits, invoice_date: e.target.value})} 
                    />
                  </div>
                  <div style={{flex: '1 1 100%'}}>
                    <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>Delivery Notes</label>
                    <input 
                      type="text" 
                      className={styles.inputField} 
                      value={topLevelEdits.notes} 
                      onChange={e => setTopLevelEdits({...topLevelEdits, notes: e.target.value})} 
                      placeholder="Add any delivery notes..."
                    />
                  </div>
                </div>
              </div>

              <div style={{marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px'}}>
                <div style={{fontSize: '12px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px'}}>
                  <AlertTriangle size={14} color="#f59e0b" />
                  <span>Edited values will be used in Delivery Challan & Invoice instead of master defaults.</span>
                </div>
                {products.map(p => {
                  const edited = editedFields[p.id] || {};
                  const isEdited = Object.keys(edited).length > 0;
                  
                  return (
                    <div key={p.id} style={{padding: '16px', border: '1px solid', borderColor: isEdited ? '#3b82f6' : '#f3f4f6', borderRadius: '8px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', backgroundColor: isEdited ? '#eff6ff' : '#fff'}}>
                      <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '12px'}}>
                        <span style={{fontWeight: '500'}}>{p.name} {isEdited && <span style={{fontSize: '12px', color: '#2563eb', marginLeft: '8px'}}>(Edited)</span>}</span>
                        <span style={{fontFamily: 'monospace', backgroundColor: '#f3f4f6', padding: '4px 8px', borderRadius: '4px'}}>
                          Req: <strong style={{color: '#2563eb'}}>{p.transferQty}</strong> / Avail: {p.currentStock}
                        </span>
                      </div>
                      
                      <div style={{display: 'flex', gap: '16px', flexWrap: 'wrap'}}>
                        <div style={{flex: '1 1 150px'}}>
                          <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>Selling Price (₹)</label>
                          <input 
                            type="number" 
                            className={styles.inputField}
                            value={edited.edited_selling_price !== undefined ? edited.edited_selling_price : (p.item_rate || 0)}
                            onChange={e => setEditedFields(prev => ({...prev, [p.id]: {...prev[p.id], edited_selling_price: parseFloat(e.target.value)}}))}
                          />
                        </div>
                        <div style={{flex: '1 1 150px'}}>
                          <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>GST (%)</label>
                          <input 
                            type="number" 
                            className={styles.inputField}
                            value={edited.edited_gst_percent !== undefined ? edited.edited_gst_percent : (p.gst_rate || 18)}
                            onChange={e => setEditedFields(prev => ({...prev, [p.id]: {...prev[p.id], edited_gst_percent: parseFloat(e.target.value)}}))}
                          />
                        </div>
                        <div style={{flex: '1 1 150px'}}>
                          <label style={{display: 'block', fontSize: '12px', marginBottom: '4px'}}>HSN/SAC</label>
                          <input 
                            type="text" 
                            className={styles.inputField}
                            value={edited.edited_hsn !== undefined ? edited.edited_hsn : (p.hsn || '')}
                            onChange={e => setEditedFields(prev => ({...prev, [p.id]: {...prev[p.id], edited_hsn: e.target.value}}))}
                            placeholder={p.hsn || 'Enter HSN code'}
                          />
                        </div>
                        {isEdited && (
                          <div style={{display: 'flex', alignItems: 'flex-end'}}>
                            <button 
                              onClick={() => {
                                const next = {...editedFields};
                                delete next[p.id];
                                setEditedFields(next);
                              }}
                              style={{padding: '8px 12px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer'}}
                            >
                              Revert Edits
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={styles.actionRow} style={{marginTop: '24px'}}>
                <button className={styles.btnPrimary} onClick={() => setStep(4)} style={{marginRight: 'auto', backgroundColor: '#6b7280'}}>Back</button>
                <button className={styles.btnPrimary} onClick={() => setStep(6)}>Apply & View Invoice Preview</button>
              </div>
            </div>
          )}

          {/* Step 6: Invoice Preview */}
          {step === 6 && (
            <div>
              <h2 className={styles.stepTitle}><FileText color="#2563eb" /> Proforma Invoice Preview</h2>
              
              <div style={{ backgroundColor: '#f9fafb', padding: '20px', border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '24px', overflowX: 'auto' }}>
                <InvoiceRenderer invoice={buildMockInvoice().mockInvoice} />
              </div>

              <div className={styles.actionRow}>
                <button className={styles.btnPrimary} onClick={() => setStep(5)} style={{marginRight: 'auto', backgroundColor: '#6b7280'}}>Back</button>
                <button className={styles.btnPrimary} onClick={() => setStep(7)}>View Delivery Challan</button>
              </div>
            </div>
          )}

          {/* Step 7: Challan Preview */}
          {step === 7 && (
            <div>
              <h2 className={styles.stepTitle}><Truck color="#2563eb" /> Delivery Challan Preview</h2>
              
              <div style={{ backgroundColor: '#f9fafb', padding: '20px', border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '24px', overflowX: 'auto' }}>
                <DeliveryChallanRenderer challan={buildMockInvoice().mockChallan} />
              </div>

              <div className={styles.actionRow}>
                <button className={styles.btnPrimary} onClick={() => setStep(6)} style={{marginRight: 'auto', backgroundColor: '#6b7280'}}>Back</button>
                <button className={styles.btnPrimary} onClick={() => setStep(8)}>Proceed to Confirm</button>
              </div>
            </div>
          )}

          {/* Step 8: Confirm */}
          {step === 8 && (
            <div style={{maxWidth: '600px', margin: '32px auto 0', textAlign: 'center', padding: '48px 0'}}>
              <div style={{width: '80px', height: '80px', backgroundColor: '#eff6ff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', border: '1px solid #dbeafe', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'}}>
                <AlertTriangle color="#3b82f6" size={40} />
              </div>
              <h2 style={{fontSize: '30px', fontWeight: 'bold', color: '#1f2937', marginBottom: '16px'}}>Confirm Batch Dispatch</h2>
              <p style={{fontSize: '18px', color: '#4b5563', lineHeight: 1.6, marginBottom: '32px'}}>
                You are about to dispatch <strong style={{color: '#111827'}}>{products.reduce((acc, p) => acc + p.transferQty, 0)}</strong> items as <strong style={{color: '#111827'}}>{dispatchType}</strong> to FC <strong style={{color: '#111827'}}>{warehouses.find(w => w.id === selectedFC)?.name || `#${selectedFC}`}</strong>.
              </p>
              <div style={{backgroundColor: '#fefce8', color: '#854d0e', padding: '16px', borderRadius: '8px', border: '1px solid #fef08a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '32px', fontSize: '14px'}}>
                <CheckCircle size={16} /> All documents will be generated and logged automatically.
              </div>
              <div>
                <button 
                  style={{backgroundColor: '#2563eb', color: 'white', padding: '16px 32px', borderRadius: '12px', fontWeight: 'bold', fontSize: '18px', border: 'none', cursor: 'pointer', width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}}
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  <Package /> Generate Final Dispatch Documents
                </button>
              </div>
              <div className={styles.actionRow} style={{marginTop: '24px', justifyContent: 'center'}}>
                <button className={styles.btnPrimary} onClick={() => setStep(7)} style={{backgroundColor: '#6b7280'}}>Back to Preview</button>
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
};

export default BatchDispatchCreator;

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useJobCard, useServiceInvoice, useCreateServiceInvoice } from '../../hooks/useServices';
import useCompanyStore from '../../stores/useCompanyStore';
import InvoiceRenderer from '../../components/invoice/InvoiceRenderer';
import { formatDate } from '../../utils/dateUtils';
import styles from './Service.module.css';

const ServiceInvoicePreview = () => {
  const { id } = useParams(); // Job Card ID or Invoice ID based on route
  const location = useLocation();
  const navigate = useNavigate();
  const isViewingInvoice = location.pathname.includes('/invoices/');
  
  // If we are generating from job card, fetch job card. If viewing invoice, fetch invoice.
  const { data: jobCard, isLoading: isJobLoading } = useJobCard(isViewingInvoice ? null : id);
  const { data: invoice, isLoading: isInvLoading } = useServiceInvoice(isViewingInvoice ? id : null);
  
  const createMutation = useCreateServiceInvoice();
  
  const [items, setItems] = useState([]);
  
  // Pre-fill estimate items when Job Card loads
  useEffect(() => {
    if (jobCard && !isViewingInvoice && items.length === 0) {
      const initialItems = jobCard.items.map(item => ({
        ...item,
        hsn: '',
        gst_rate: 18.0, // Default 18% as requested, flexible per item
        amount: item.qty * item.rate
      }));
      setItems(initialItems);
    }
  }, [jobCard, isViewingInvoice]);

  const handleItemChange = (index, field, value) => {
    const newItems = [...items];
    newItems[index][field] = value;
    setItems(newItems);
  };

  const addRow = () => {
    setItems([...items, { item_name: '', description: '', hsn: '', gst_rate: 18.0, qty: 1, rate: 0, amount: 0, product_sku: '' }]);
  };

  const removeRow = (idx) => {
    const newItems = [...items];
    newItems.splice(idx, 1);
    setItems(newItems);
  };

  const calculateTotals = (currentItems) => {
    let totalBase = 0;
    let totalCgst = 0;
    let totalSgst = 0;

    currentItems.forEach(item => {
      const baseAmt = item.qty * item.rate;
      totalBase += baseAmt;
      const gstAmt = baseAmt * (item.gst_rate / 100);
      totalCgst += gstAmt / 2;
      totalSgst += gstAmt / 2;
    });

    return {
      total_amount: parseFloat(totalBase.toFixed(2)),
      cgst_amount: parseFloat(totalCgst.toFixed(2)),
      sgst_amount: parseFloat(totalSgst.toFixed(2)),
      grand_total: Math.round(totalBase + totalCgst + totalSgst)
    };
  };

  const handleGenerate = async () => {
    const totals = calculateTotals(items);
    
    const payload = {
      job_card_id: parseInt(id),
      total_amount: totals.total_amount,
      cgst_amount: totals.cgst_amount,
      sgst_amount: totals.sgst_amount,
      grand_total: totals.grand_total,
      items: items.map(item => ({
        description: item.item_name,
        product_sku: item.product_sku || null,
        hsn: item.hsn || null,
        gst_rate: parseFloat(item.gst_rate),
        qty: parseFloat(item.qty),
        rate: parseFloat(item.rate),
        amount: parseFloat(item.qty * item.rate)
      }))
    };

    try {
      const result = await createMutation.mutateAsync(payload);
      // Redirect to the newly created invoice view
      navigate(`/services/invoices/${result.id}`);
    } catch (e) {
      console.error(e);
    }
  };

  if (isJobLoading || isInvLoading) return <div className="p-4 text-center">Loading...</div>;
  
  if (!isViewingInvoice && !jobCard) return <div>Job Card not found</div>;
  if (isViewingInvoice && !invoice) return <div>Invoice not found</div>;

  const { currentCompany } = useCompanyStore();

  const formattedInvoice = useMemo(() => {
    if (!invoice) return null;

    const companySnapshot = {
      name: currentCompany?.name || 'JAGAN SHOPSMART PVT LTD',
      address: currentCompany?.address || 'Plot no: 150, Industrial & Business Park-2, Chandigarh (UT)- 160002',
      city: currentCompany?.city || 'CHANDIGARH',
      state: currentCompany?.state || 'CHANDIGARH',
      state_code: currentCompany?.state_code || '04',
      gstin: currentCompany?.gstin || '04AABCJ1234D1Z1',
      phone: currentCompany?.phone || '',
      email: currentCompany?.email || '',
      bank_name: currentCompany?.bank_name || '',
      account_number: currentCompany?.bank_account_no || '',
      ifsc: currentCompany?.bank_ifsc || '',
      branch: currentCompany?.bank_branch || '',
      pan: currentCompany?.pan_number || '',
      logo_url: currentCompany?.logo_url || '/logo.png',
      terms_and_conditions: currentCompany?.terms_and_conditions
    };

    const buyerGstin = invoice.job_card?.customer_gstin || '';
    const buyerStateCode = buyerGstin.length >= 2 ? buyerGstin.substring(0, 2) : (invoice.job_card?.state_code || '04');
    const isInterState = buyerStateCode !== companySnapshot.state_code;

    const formattedItems = (invoice.items || []).map((item, idx) => {
      const qty = parseFloat(item.qty || 1);
      const rate = parseFloat(item.rate || 0);
      const baseAmt = parseFloat(item.amount || (qty * rate));
      const gstRate = parseFloat(item.gst_rate || 18.0);
      const taxAmt = baseAmt * (gstRate / 100);

      return {
        id: item.id || idx,
        product_name: item.description || item.item_name || 'Service Item',
        sku: item.product_sku || '',
        pack_grade: 'SERVICE',
        hsn_sac: item.hsn || '9987',
        quantity: qty,
        remaining_quantity: qty,
        rate: rate,
        selling_price: rate,
        discount: 0,
        taxable_value: baseAmt,
        gst_rate: gstRate,
        cgst: isInterState ? 0 : taxAmt / 2,
        sgst: isInterState ? 0 : taxAmt / 2,
        igst: isInterState ? taxAmt : 0,
        line_total: baseAmt + taxAmt
      };
    });

    const totalTaxable = parseFloat(invoice.total_amount || 0);
    const totalCgst = parseFloat(invoice.cgst_amount || 0);
    const totalSgst = parseFloat(invoice.sgst_amount || 0);
    const grandTotal = parseFloat(invoice.grand_total || (totalTaxable + totalCgst + totalSgst));

    return {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      bill_number: invoice.invoice_number,
      date: invoice.created_at || invoice.date,
      sale_date: invoice.created_at || invoice.date,
      invoice_type: 'TAX INVOICE',
      company: companySnapshot,
      customer: {
        name: invoice.job_card?.customer_name || 'Valued Customer',
        phone: invoice.job_card?.customer_mobile || '',
        mobile: invoice.job_card?.customer_mobile || '',
        address: invoice.job_card?.address || '',
        gstin: buyerGstin,
        state: invoice.job_card?.state || 'CHANDIGARH',
        state_code: buyerStateCode
      },
      items: formattedItems,
      totals: {
        taxable: totalTaxable,
        total_taxable: totalTaxable,
        cgst: totalCgst,
        sgst: totalSgst,
        igst: isInterState ? (totalCgst + totalSgst) : 0,
        total_tax: totalCgst + totalSgst,
        round_off: (grandTotal - (totalTaxable + totalCgst + totalSgst)).toFixed(2),
        grand_total: grandTotal,
        net_amount: grandTotal
      },
      payment_method: 'CASH',
      dispatch_through: 'HAND DELIVERY',
      buyer_order_no: invoice.job_card?.job_card_number || ''
    };
  }, [invoice, currentCompany]);

  if (isViewingInvoice && formattedInvoice) {
    return (
      <div style={{ padding: '1.5rem', minHeight: '100vh', backgroundColor: '#f9fafb' }}>
        <div className="noPrint" style={{ maxWidth: '210mm', margin: '0 auto 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button 
            onClick={() => navigate(-1)} 
            style={{ backgroundColor: '#ffffff', color: '#374151', padding: '0.5rem 1rem', borderRadius: '0.375rem', fontWeight: 600, border: '1px solid #d1d5db', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            &larr; Back
          </button>
          <button 
            onClick={() => window.print()} 
            style={{ backgroundColor: '#111827', color: 'white', padding: '0.5rem 1.5rem', borderRadius: '0.375rem', fontWeight: 600, border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}
          >
            Print Invoice
          </button>
        </div>

        <div className="print-only" style={{ maxWidth: '210mm', margin: '0 auto', backgroundColor: '#ffffff', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
          <InvoiceRenderer invoice={formattedInvoice} />
        </div>
      </div>
    );
  }

  const totals = calculateTotals(items);
  const customerName = jobCard?.customer_name;
  const address = jobCard?.address;
  const invoiceNum = 'DRAFT';
  const date = formatDate(new Date());

  return (
    <div className={styles.container}>
      <div className="noPrint" style={{ marginBottom: '1rem', backgroundColor: '#eff6ff', padding: '1rem', borderRadius: '0.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #bfdbfe' }}>
        <div>
          <h3 style={{ fontWeight: 'bold', color: '#1e40af', margin: 0 }}>Finalize Service Invoice</h3>
          <p style={{ fontSize: '0.875rem', color: '#2563eb', margin: '0.25rem 0 0 0' }}>Review the estimate items below, adjust GST rates or HSN, and generate the final GST invoice.</p>
          {jobCard && jobCard.status !== 'COMPLETED' && (
            <p style={{ fontSize: '0.875rem', color: '#dc2626', margin: '0.5rem 0 0 0', fontWeight: 'bold' }}>
              ⚠️ The Job Card is currently {jobCard.status}. It must be marked as COMPLETED before you can generate the final invoice.
            </p>
          )}
        </div>
        <button 
          onClick={handleGenerate} 
          disabled={createMutation.isPending || (jobCard && jobCard.status !== 'COMPLETED')}
          style={{ 
            backgroundColor: (createMutation.isPending || (jobCard && jobCard.status !== 'COMPLETED')) ? '#9ca3af' : '#2563eb', 
            color: 'white', 
            padding: '0.5rem 1.5rem', 
            borderRadius: '0.25rem', 
            fontWeight: 'bold', 
            cursor: (createMutation.isPending || (jobCard && jobCard.status !== 'COMPLETED')) ? 'not-allowed' : 'pointer', 
            border: 'none' 
          }}
        >
          {createMutation.isPending ? 'Generating...' : 'Generate Invoice'}
        </button>
      </div>

      <div className={styles.printableArea}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem', borderBottom: '2px solid #1f2937', paddingBottom: '1rem', position: 'relative' }}>
          <img 
            src="/logo.png" 
            alt="Logo" 
            style={{ position: 'absolute', left: 0, top: 0, maxHeight: '60px', objectFit: 'contain' }} 
            onError={(e) => e.target.style.display = 'none'} 
          />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', textTransform: 'uppercase', margin: 0 }}>TAX INVOICE</h1>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginTop: '0.5rem', marginBottom: 0 }}>{currentCompany?.name || 'JAGAN SHOPSMART PVT LTD'}</h2>
          <p style={{ fontSize: '0.875rem', margin: '0.25rem 0 0 0' }}>{currentCompany?.address || 'Plot no: 150, Industrial & Business Park-2, Chandigarh (UT)- 160002'}</p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div style={{ width: '50%', paddingRight: '1rem', borderRight: '1px solid #1f2937' }}>
            <h3 style={{ fontWeight: 'bold', fontSize: '0.875rem', backgroundColor: '#f3f4f6', padding: '0.25rem', border: '1px solid #1f2937', margin: 0 }}>Billed To</h3>
            <div style={{ padding: '0.5rem', borderLeft: '1px solid #1f2937', borderRight: '1px solid #1f2937', borderBottom: '1px solid #1f2937', minHeight: '100px' }}>
              <p style={{ fontWeight: 'bold', margin: '0 0 0.25rem 0' }}>{customerName}</p>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{address}</p>
            </div>
          </div>
          <div style={{ width: '50%', paddingLeft: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.875rem' }}>
              <div style={{ fontWeight: 'bold' }}>Invoice No:</div><div>{invoiceNum}</div>
              <div style={{ fontWeight: 'bold' }}>Date:</div><div>{date}</div>
              <div style={{ fontWeight: 'bold' }}>Job Card No:</div>
              <div>{jobCard?.job_card_number}</div>
            </div>
          </div>
        </div>

        <table style={{ width: '100%', fontSize: '0.875rem', textAlign: 'left', border: '1px solid #1f2937', marginBottom: '1rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #1f2937' }}>
              <th style={{ padding: '0.5rem', borderRight: '1px solid #1f2937', width: '3rem', textAlign: 'center' }}>S.No</th>
              <th style={{ padding: '0.5rem', borderRight: '1px solid #1f2937', textAlign: 'left' }}>Description of Goods / Service</th>
              <th style={{ padding: '0.5rem', borderRight: '1px solid #1f2937', width: '5rem', textAlign: 'center' }}>HSN/SAC</th>
              <th style={{ padding: '0.5rem', borderRight: '1px solid #1f2937', width: '4rem', textAlign: 'center' }}>GST %</th>
              <th style={{ padding: '0.5rem', borderRight: '1px solid #1f2937', width: '4rem', textAlign: 'center' }}>Qty</th>
              <th style={{ padding: '0.5rem', borderRight: '1px solid #1f2937', width: '6rem', textAlign: 'center' }}>Rate</th>
              <th style={{ padding: '0.5rem', width: '7rem', textAlign: 'right' }}>Amount</th>
              <th style={{ padding: '0.5rem', width: '3rem', textAlign: 'center' }} className="noPrint">Act</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #1f2937' }}>
                <td style={{ padding: '0.5rem', borderRight: '1px solid #1f2937', textAlign: 'center' }}>{idx + 1}</td>
                <td style={{ padding: '0.5rem', borderRight: '1px solid #1f2937' }}>
                  <input type="text" style={{ width: '100%', border: '1px solid #d1d5db', padding: '0.25rem', boxSizing: 'border-box' }} value={item.item_name || item.description} onChange={(e) => handleItemChange(idx, 'item_name', e.target.value)} placeholder="Item Description" />
                </td>
                <td style={{ padding: '0.5rem', borderRight: '1px solid #1f2937', textAlign: 'center' }}>
                  <input type="text" style={{ width: '100%', textAlign: 'center', border: '1px solid #d1d5db', padding: '0.25rem', boxSizing: 'border-box' }} value={item.hsn} onChange={(e) => handleItemChange(idx, 'hsn', e.target.value)} placeholder="HSN" />
                </td>
                <td style={{ padding: '0.5rem', borderRight: '1px solid #1f2937', textAlign: 'center' }}>
                  <select style={{ width: '100%', border: '1px solid #d1d5db', padding: '0.25rem', textAlign: 'center', boxSizing: 'border-box' }} value={item.gst_rate} onChange={(e) => handleItemChange(idx, 'gst_rate', parseFloat(e.target.value))}>
                    <option value="0">0%</option>
                    <option value="5">5%</option>
                    <option value="12">12%</option>
                    <option value="18">18%</option>
                    <option value="28">28%</option>
                  </select>
                </td>
                <td style={{ padding: '0.5rem', borderRight: '1px solid #1f2937', textAlign: 'center' }}>
                  <input type="number" step="0.1" min="0.1" style={{ width: '100%', textAlign: 'center', border: '1px solid #d1d5db', padding: '0.25rem', boxSizing: 'border-box' }} value={item.qty} onChange={(e) => handleItemChange(idx, 'qty', parseFloat(e.target.value) || 0)} />
                </td>
                <td style={{ padding: '0.5rem', borderRight: '1px solid #1f2937', textAlign: 'right' }}>
                  <input type="number" step="0.01" min="0" style={{ width: '100%', textAlign: 'right', border: '1px solid #d1d5db', padding: '0.25rem', boxSizing: 'border-box' }} value={item.rate} onChange={(e) => handleItemChange(idx, 'rate', parseFloat(e.target.value) || 0)} />
                </td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{(item.qty * item.rate).toFixed(2)}</td>
                <td style={{ padding: '0.5rem', textAlign: 'center' }} className="noPrint">
                  <button type="button" onClick={() => removeRow(idx)} style={{ color: '#ef4444', border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.25rem' }}>
                    &times;
                  </button>
                </td>
              </tr>
            ))}
            
            <tr className="noPrint">
              <td colSpan="8" style={{ padding: '0.5rem', borderRight: '1px solid #1f2937', textAlign: 'left' }}>
                <button type="button" onClick={addRow} style={{ padding: '0.375rem 0.75rem', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}>
                  + Add Item / Part
                </button>
              </td>
            </tr>
            
            {/* Totals Rows */}
            <tr>
              <td colSpan="5" style={{ borderRight: '1px solid #1f2937', borderTop: '1px solid #1f2937' }}></td>
              <td style={{ padding: '0.5rem', fontWeight: 'bold', borderRight: '1px solid #1f2937', borderTop: '1px solid #1f2937', textAlign: 'right' }}>Taxable Amt</td>
              <td style={{ padding: '0.5rem', textAlign: 'right', borderTop: '1px solid #1f2937' }}>{totals.total_amount.toFixed(2)}</td>
              <td className="noPrint border-t border-gray-800" style={{ borderTop: '1px solid #1f2937' }}></td>
            </tr>
            <tr>
              <td colSpan="5" style={{ borderRight: '1px solid #1f2937' }}></td>
              <td style={{ padding: '0.5rem', fontWeight: 'bold', borderRight: '1px solid #1f2937', textAlign: 'right' }}>CGST</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{totals.cgst_amount.toFixed(2)}</td>
              <td className="noPrint"></td>
            </tr>
            <tr>
              <td colSpan="5" style={{ borderRight: '1px solid #1f2937' }}></td>
              <td style={{ padding: '0.5rem', fontWeight: 'bold', borderRight: '1px solid #1f2937', textAlign: 'right' }}>SGST</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{totals.sgst_amount.toFixed(2)}</td>
              <td className="noPrint"></td>
            </tr>
            <tr style={{ backgroundColor: '#f3f4f6', borderTop: '1px solid #1f2937' }}>
              <td colSpan="5" style={{ borderRight: '1px solid #1f2937' }}></td>
              <td style={{ padding: '0.5rem', fontWeight: 'bold', borderRight: '1px solid #1f2937', textAlign: 'right', fontSize: '1.125rem' }}>Grand Total</td>
              <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 'bold', fontSize: '1.125rem' }}>₹ {totals.grand_total.toFixed(2)}</td>
              <td className="noPrint"></td>
            </tr>
          </tbody>
        </table>
        
        <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid #9ca3af', display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '2rem', margin: 0 }}>Customer Signature</p>
            <div style={{ borderBottom: '1px solid #9ca3af', width: '12rem', marginTop: '3rem' }}></div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '2rem', margin: 0 }}>For {currentCompany?.name || 'JAGAN SHOPSMART PVT LTD'}</p>
            <div style={{ borderBottom: '1px solid #9ca3af', width: '12rem', marginLeft: 'auto', marginTop: '3rem' }}></div>
            <p style={{ fontSize: '0.75rem', marginTop: '0.25rem', margin: 0 }}>Authorized Signatory</p>
          </div>
        </div>
        
      </div>
    </div>
  );
};

export default ServiceInvoicePreview;

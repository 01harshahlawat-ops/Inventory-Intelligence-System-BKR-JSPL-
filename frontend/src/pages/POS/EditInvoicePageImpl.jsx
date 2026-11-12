import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posService } from '../../services/pos';
import { handleApiError } from '../../utils/errorHandler';
import api from '../../services/api';
import { warehouseService } from '../../services/warehouse';
import styles from './POSPage.module.css';
import ReceiptModal from './ReceiptModal';
import InvoicePreviewModal from './InvoicePreviewModal';
import useCompanyStore from '../../stores/useCompanyStore';
import { FiX, FiChevronDown, FiChevronUp, FiWifi, FiWifiOff, FiRefreshCw, FiSearch, FiTool, FiPlus, FiTrash2 } from 'react-icons/fi';

// ---------------------------------------------------------------------------
// GSTIN validation (basic format: 2-digit state + 10 PAN + 1 entity + 1 Z + 1 check)
// ---------------------------------------------------------------------------
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function validateGstin(gstin) {
  if (!gstin) return null;
  const cleaned = gstin.trim().toUpperCase();
  if (!GSTIN_REGEX.test(cleaned)) return 'Invalid GSTIN format';
  return null;
}

function gstinStateCode(gstin) {
  if (!gstin || gstin.length < 2) return '';
  return gstin.substring(0, 2);
}

// ---------------------------------------------------------------------------
// Indian States lookup for Place of Supply
// ---------------------------------------------------------------------------
const INDIAN_STATES = [
  { code: '01', name: 'Jammu & Kashmir' }, { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' }, { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' }, { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' }, { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' }, { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' }, { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' }, { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' }, { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' }, { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' }, { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' }, { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' }, { code: '24', name: 'Gujarat' },
  { code: '27', name: 'Maharashtra' }, { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' }, { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' }, { code: '34', name: 'Puducherry' },
  { code: '36', name: 'Telangana' }, { code: '37', name: 'Andhra Pradesh' },
];

// ---------------------------------------------------------------------------
// Collapsible Section component
// ---------------------------------------------------------------------------
const CollapsibleSection = ({ title, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={styles.collapsibleSection}>
      <button type="button" className={styles.collapsibleHeader} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        {open ? <FiChevronUp /> : <FiChevronDown />}
      </button>
      {open && <div className={styles.collapsibleBody}>{children}</div>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// POSPage Component
// ---------------------------------------------------------------------------
const EditInvoicePage = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [isLoadingSale, setIsLoadingSale] = useState(true);
  const [isLoaded, setIsLoaded] = React.useState(false);

  const location = useLocation();

  useEffect(() => {
    if (location.state?.tallyItems && location.state.tallyItems.length > 0) {
      const newItems = location.state.tallyItems.map((item, idx) => {
        const rate = item.rate || 0;
        const qty = item.quantity || 1;
        const gst = item.gst_rate || 0;
        const discount = 0;
        const taxable = (rate * qty) - discount;
        const tax = (taxable * gst) / 100;
        
        return {
          id: item.product_id || `temp-${idx}`,
          sku: item.matched_sku || '',
          name: item.product_name || item.description,
          hsn_sac: item.hsn_sac || '',
          quantity: qty,
          selling_price: rate,
          discount_percent: 0,
          discount: discount,
          gst_rate: gst,
          taxable_amount: taxable,
          cgst: tax / 2,
          sgst: tax / 2,
          igst: 0,
          product_name: item.product_name || item.description,
          unit: 'PCS',
          rate: rate
        };
      });
      setCart(prev => [...prev, ...newItems]);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const currentCompany = useCompanyStore(state => state.currentCompany);
  const companyName = currentCompany?.name || 'POS';
  const companyCode = useCompanyStore(state => state.companyCode) || '';
  const isBkr = (companyCode || '').toUpperCase() === 'BKR';
  const isJspl = (companyCode || '').toUpperCase() === 'JSPL';

  const validSeriesOptions = React.useMemo(() => {
    const base = ['GST', 'JGST', 'AFN', 'MFN'];
    if (!isBkr) base.push('SERVICE', 'SERV', 'JSPL');
    if (!isJspl) base.push('BKR');
    if (companyCode && !base.includes(companyCode)) base.push(companyCode);
    return base;
  }, [isJspl, isBkr, companyCode]);

  // Clean form state for editing
  const [searchTerm, setSearchTerm] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState(() => {
    const init = companyCode || 'GST';
    if (isJspl && init === 'BKR') return 'GST';
    if (isBkr && ['JSPL', 'SERVICE', 'SERV'].includes(init)) return 'GST';
    return init;
  });

  useEffect(() => {
    if (isJspl && invoicePrefix === 'BKR') {
      setInvoicePrefix('GST');
    } else if (isBkr && ['JSPL', 'SERVICE', 'SERV'].includes(invoicePrefix)) {
      setInvoicePrefix('GST');
    }
  }, [isJspl, isBkr, invoicePrefix]);

  const isServiceSeries = ['SERVICE', 'SERV'].includes((invoicePrefix || '').trim().toUpperCase());
  const [searchResults, setSearchResults] = useState([]);
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentRemarks, setPaymentRemarks] = useState('');
  const [error, setError] = useState('');
  const [completedReceipt, setCompletedReceipt] = useState(null);
  const [previewReceiptData, setPreviewReceiptData] = useState(null);

  const handleAddServiceCharge = async () => {
    try {
      const serviceItem = await posService.getServiceChargeItem();
      if (!serviceItem) {
        setError("Service Charge product not found. Please contact administrator.");
        return;
      }
      addToCart({
        ...serviceItem,
        available_stock: 999999,
        unit: 'SERV',
        pack_grade: 'SERV',
      });
    } catch (err) {
      console.error("Failed to load service charge item:", err);
      setError("Failed to add Service Charge. " + (err.response?.data?.detail || err.message));
    }
  };

  // Offline queue state
  const [pendingCount, setPendingCount] = useState(0);
  const [showPending, setShowPending] = useState(false);
  const [pendingItems, setPendingItems] = useState([]);
  const [syncing, setSyncing] = useState(false);

  const idempotencyKeyRef = useRef(window.crypto.randomUUID());

  const queryClient = useQueryClient();
  const { data: activeWarehouses = [] } = useQuery({
    queryKey: ['activeWarehouses', companyCode],
    queryFn: async () => {
      const all = await warehouseService.getWarehouses();
      return all.filter(w => w.status === 'ACTIVE' || w.status === 'Active');
    },
    staleTime: 5 * 60 * 1000,
  });

  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');

  const sortedWarehouses = useMemo(() => {
    const list = [...activeWarehouses];
    const isJspl = (companyCode || '').toUpperCase() === 'JSPL';
    return list.sort((a, b) => {
      const aIsVshb = isJspl && (a.code || '').toUpperCase() === 'VSHB';
      const bIsVshb = isJspl && (b.code || '').toUpperCase() === 'VSHB';
      if (aIsVshb && !bIsVshb) return -1;
      if (!aIsVshb && bIsVshb) return 1;

      const aIsCentral = (a.warehouse_type || '').toUpperCase() === 'CENTRAL';
      const bIsCentral = (b.warehouse_type || '').toUpperCase() === 'CENTRAL';
      if (aIsCentral && !bIsCentral) return -1;
      if (!aIsCentral && bIsCentral) return 1;

      return (a.name || '').localeCompare(b.name || '');
    });
  }, [activeWarehouses, companyCode]);

  // Default warehouse selection logic
  useEffect(() => {
    if (activeWarehouses.length > 0 && !selectedWarehouseId) {
      const isJspl = (companyCode || '').toUpperCase() === 'JSPL';
      const defaultWh = isJspl 
        ? (activeWarehouses.find(w => (w.code || '').toUpperCase() === 'VSHB') ||
           activeWarehouses.find(w => (w.warehouse_type || '').toUpperCase() === 'CENTRAL') ||
           activeWarehouses[0])
        : (activeWarehouses.find(w => (w.code || '').toUpperCase() === 'BKR_CENTRAL') ||
           activeWarehouses.find(w => (w.warehouse_type || '').toUpperCase() === 'CENTRAL') ||
           activeWarehouses.find(w => 
             (w.code || '').toUpperCase().includes('DEFAULT') || 
             (w.code || '').toUpperCase().includes('MAIN') ||
             (w.code || '').toUpperCase().includes('POS')
           ) ||
           activeWarehouses[0]);
      if (defaultWh) {
        setSelectedWarehouseId(defaultWh.id);
      }
    }
  }, [activeWarehouses, selectedWarehouseId, companyCode]);

  const { data: companySettings } = useQuery({
    queryKey: ['companySettings'],
    queryFn: async () => {
      const res = await api.get('/api/settings/');
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Load pending offline count on mount
  useEffect(() => {
    posService.getPending().then(items => {
      if (Array.isArray(items)) setPendingCount(items.length);
    }).catch(() => {});
  }, []);

  // Invoice Type
  const [invoiceType, setInvoiceType] = useState('B2C');

  // Extended Customer Info
  const [customerInfo, setCustomerInfo] = useState({
    name: '', mobile: '', gstin: '', address: '',
    state: '', state_code: '', place_of_supply: '',
    email: '', phone: '',
  });

  // Invoice Info
  const [invoiceInfo, setInvoiceInfo] = useState({
    buyer_order_no: '',
    buyer_order_date: '',
    payment_terms: '',
    delivery_note: '',
    delivery_note_date: '',
    dispatch_document_number: '',
    dispatch_through: '',
    destination: '',
    vehicle_number: '',
    lr_rr_number: '',
    terms_of_delivery: '',
    custom_invoice_number: '',
    custom_invoice_date: ''
  });

  // GSTIN validation state
  const [gstinError, setGstinError] = useState('');

  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const { data: searchData } = useQuery({
    queryKey: ['posSearch', debouncedSearchTerm, selectedWarehouseId],
    queryFn: () => posService.searchProducts(debouncedSearchTerm, selectedWarehouseId),
    enabled: debouncedSearchTerm.length >= 2,
  });

  useEffect(() => {
    if (debouncedSearchTerm.length >= 2 && searchData) {
      setSearchResults(searchData);
    } else {
      setSearchResults([]);
    }
  }, [searchData, debouncedSearchTerm]);

  // Determine if inter-state (IGST) or intra-state (CGST+SGST/UTGST)
  const selectedWh = activeWarehouses.find(w => String(w.id) === String(selectedWarehouseId));
  const sellerStateCode = (selectedWh && selectedWh.warehouse_type !== 'CENTRAL' && (selectedWh.hub?.state_code || (selectedWh.hub?.gstin ? selectedWh.hub.gstin.substring(0, 2) : null))) ||
    companySettings?.state_code || 
    (companySettings?.gstin ? companySettings.gstin.substring(0, 2) : '04');
  const buyerStateCode = customerInfo.state_code || (customerInfo.gstin ? customerInfo.gstin.substring(0, 2) : '') || (() => {
    const found = INDIAN_STATES.find(s => s.name === customerInfo.place_of_supply || s.name === customerInfo.state);
    return found ? found.code : '';
  })();
  const isInterState = Boolean(buyerStateCode && buyerStateCode !== sellerStateCode);
  const isUnionTerritory = ['04', '35', '38', '31', '26'].includes(sellerStateCode);

  // ---------------------------------------------------------------------------
  // GSTIN auto-fill state code when GSTIN changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (customerInfo.gstin && customerInfo.gstin.length >= 2) {
      const err = validateGstin(customerInfo.gstin);
      setGstinError(err || '');
      if (!err) {
        const sc = gstinStateCode(customerInfo.gstin);
        const state = INDIAN_STATES.find(s => s.code === sc);
        if (state) {
          setCustomerInfo(prev => ({
            ...prev,
            state_code: sc,
            state: state.name,
            place_of_supply: prev.place_of_supply || state.name,
          }));
        }
      }
    } else {
      setGstinError('');
    }
  }, [customerInfo.gstin]);

  // ---------------------------------------------------------------------------
  // Cart operations (preserved + extended with discount, HSN, unit, IGST)
  // ---------------------------------------------------------------------------
  const addToCart = (product) => {
    setSearchResults([]);
    setSearchTerm('');

    const existingIndex = cart.findIndex(item => item.product_id === product.id);
    if (existingIndex >= 0) {
      updateCartItem(existingIndex, 'quantity', cart[existingIndex].quantity + 1);
      return;
    }

    const isService = product.sku === 'SERVICE CHARGE' || (product.hsn_sac === '9987' && product.unit === 'SERV');
    const initialGst = product.default_gst_rate !== null && product.default_gst_rate !== undefined ? product.default_gst_rate : 18;
    const initialPrice = product.default_price || (isService ? 0 : 0);
    const taxable = initialPrice * 1;
    const gstAmount = taxable * (initialGst / 100);

    const newItem = {
      product_id: product.id,
      sku: product.sku,
      product_name: product.name,
      name: product.name,
      hsn_sac: product.hsn_sac || product.hsn || (isService ? '9987' : ''),
      gst_rate: initialGst,
      quantity: 1,
      selling_price: initialPrice,
      rate: initialPrice,
      discount_percent: 0,
      discount: 0,
      taxable_amount: taxable,
      cgst: isInterState ? 0 : gstAmount / 2,
      sgst: isInterState ? 0 : gstAmount / 2,
      igst: isInterState ? gstAmount : 0,
      line_total: taxable + gstAmount,
      available_stock: isService ? 999999 : product.available_stock,
      unit: product.unit || (isService ? 'SERV' : 'PCS'),
      pack_grade: product.pack_grade || (isService ? 'SERV' : ''),
      gst_needs_confirmation: false,
    };

    setCart(prev => [newItem, ...prev]);
  };

  const removeFromCart = (index) => {
    const newCart = [...cart];
    newCart.splice(index, 1);
    setCart(newCart);
  };

  const updateCartItem = (index, field, value) => {
    const newCart = [...cart];
    const item = { ...newCart[index] };

    if (field === 'quantity') {
      item.quantity = value === '' ? '' : (parseInt(value, 10) || 0);
      if (item.sku !== 'SERVICE CHARGE' && item.available_stock !== undefined && Number(item.quantity) > item.available_stock) {
        setError(`Notice: Billing quantity (${item.quantity}) exceeds recorded stock (${item.available_stock}) for ${item.sku}.`);
        setTimeout(() => setError(''), 4000);
      }
    }
    if (field === 'selling_price') item.selling_price = value === '' ? '' : (parseFloat(value) || 0);
    if (field === 'gst_rate') {
      item.gst_rate = value === '' ? '' : (parseFloat(value) || 0);
      item.gst_needs_confirmation = false;
    }
    if (field === 'hsn_sac') item.hsn_sac = value;

    const qty = Number(item.quantity) || 0;
    const price = Number(item.selling_price) || 0;
    const grossAmount = qty * price;

    if (field === 'discount_percent') {
      if (value === '') {
        item.discount_percent = '';
        item.discount = 0;
      } else {
        const pct = Math.min(100, Math.max(0, parseFloat(value) || 0));
        item.discount_percent = pct;
        item.discount = parseFloat(((grossAmount * pct) / 100).toFixed(2));
      }
    } else if (field === 'discount') {
      if (value === '') {
        item.discount = '';
        item.discount_percent = 0;
      } else {
        const disc = Math.min(grossAmount, Math.max(0, parseFloat(value) || 0));
        item.discount = disc;
        item.discount_percent = grossAmount > 0 ? parseFloat(((disc / grossAmount) * 100).toFixed(2)) : 0;
      }
    } else if (field === 'quantity' || field === 'selling_price') {
      if (item.discount_percent !== '' && Number(item.discount_percent) > 0) {
        const pct = Math.min(100, Number(item.discount_percent));
        item.discount = parseFloat(((grossAmount * pct) / 100).toFixed(2));
      } else if (Number(item.discount) > grossAmount) {
        item.discount = grossAmount;
        item.discount_percent = grossAmount > 0 ? 100 : 0;
      } else if (grossAmount > 0 && Number(item.discount) > 0) {
        item.discount_percent = parseFloat(((Number(item.discount) / grossAmount) * 100).toFixed(2));
      }
    }

    const discAmt = Number(item.discount) || 0;
    item.taxable_amount = Math.max(0, parseFloat((grossAmount - discAmt).toFixed(2)));
    const gstRate = Number(item.gst_rate) || 0;
    const gstAmount = parseFloat((item.taxable_amount * (gstRate / 100)).toFixed(2));
    item.cgst = isInterState ? 0 : parseFloat((gstAmount / 2).toFixed(2));
    item.sgst = isInterState ? 0 : parseFloat((gstAmount / 2).toFixed(2));
    item.igst = isInterState ? gstAmount : 0;
    item.line_total = parseFloat((item.taxable_amount + gstAmount).toFixed(2));

    newCart[index] = item;
    setCart(newCart);
  };

  // Recalculate all items when inter-state status changes
  useEffect(() => {
    if (cart.length === 0) return;
    setCart(prev => prev.map(item => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.selling_price) || 0;
      const grossAmount = qty * price;
      const discAmt = Number(item.discount) || 0;
      const taxable = Math.max(0, parseFloat((grossAmount - discAmt).toFixed(2)));
      const gstRate = Number(item.gst_rate) || 0;
      const gstAmount = parseFloat((taxable * (gstRate / 100)).toFixed(2));
      return {
        ...item,
        taxable_amount: taxable,
        cgst: isInterState ? 0 : parseFloat((gstAmount / 2).toFixed(2)),
        sgst: isInterState ? 0 : parseFloat((gstAmount / 2).toFixed(2)),
        igst: isInterState ? gstAmount : 0,
        line_total: parseFloat((taxable + gstAmount).toFixed(2)),
      };
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInterState]);

  // ---------------------------------------------------------------------------
  // Totals (extended with IGST)
  // ---------------------------------------------------------------------------
  const totals = (cart || []).reduce((acc, item) => {
    acc.taxable += item.taxable_amount || 0;
    acc.cgst += item.cgst || 0;
    acc.sgst += item.sgst || 0;
    acc.igst += item.igst || 0;
    acc.tax += (item.cgst || 0) + (item.sgst || 0) + (item.igst || 0);
    acc.grand += item.line_total || 0;
    return acc;
  }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, grand: 0 });

  const hasUnconfirmedGst = (cart || []).some(item => item.gst_needs_confirmation);

  // ---------------------------------------------------------------------------
  // Checkout Mutation
  // ---------------------------------------------------------------------------
  const checkoutMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await api.put(`/api/pos/sales/${id}`, payload);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['sale', id] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      
      navigate(`/sales/${id}/invoice`);
    },
    onError: (err) => {
      handleApiError(err, "Update failed");
    }
  });

  const handlePreview = () => {
    const formattedInvoiceNo = invoiceInfo.custom_invoice_number 
      ? (invoicePrefix && !invoiceInfo.custom_invoice_number.toUpperCase().startsWith(`${invoicePrefix}-`) 
          ? `${invoicePrefix}-${invoiceInfo.custom_invoice_number}` 
          : invoiceInfo.custom_invoice_number)
      : (invoicePrefix ? `${invoicePrefix}-PREVIEW` : 'PREVIEW');

    const selectedWh = activeWarehouses.find(w => String(w.id) === String(selectedWarehouseId));
    let sellerName = companySettings?.legal_name || currentCompany?.name || 'BKR';
    let sellerGstin = companySettings?.gstin || '';
    let sellerAddress = companySettings?.address || '';
    let sellerState = companySettings?.state || '';
    let sellerStateCode = companySettings?.state_code || '';
    let sellerPhone = selectedWh?.phone_number || selectedWh?.hub?.phone || companySettings?.phone;
    let sellerEmail = selectedWh?.email || selectedWh?.hub?.email || companySettings?.email;

    if (selectedWh) {
      if (selectedWh.warehouse_type !== 'CENTRAL' && selectedWh.hub) {
        if (selectedWh.hub.gstin) sellerGstin = selectedWh.hub.gstin;
        if (selectedWh.hub.state) sellerState = selectedWh.hub.state;
        if (selectedWh.hub.state_code) sellerStateCode = selectedWh.hub.state_code;
        if (selectedWh.hub.address) sellerAddress = selectedWh.hub.address;
      }
      if (selectedWh.address && selectedWh.address.trim()) {
        sellerAddress = selectedWh.address.trim();
      }
    }

    const mockInvoice = {
      company: {
        name: sellerName,
        gstin: sellerGstin,
        address: sellerAddress,
        state: sellerState,
        state_code: sellerStateCode,
        email: sellerEmail,
        phone: sellerPhone,
        logo_url: companySettings?.logo_url,
        bank_details: companySettings?.bank_details,
        code: currentCompany?.code
      },
      invoice_type: invoiceType || 'B2C',
      invoice_prefix: invoicePrefix,
      invoice_number: formattedInvoiceNo,
      date: invoiceInfo.custom_invoice_date || new Date().toISOString(),
      customer: customerInfo ? { 
        name: customerInfo.name || customerInfo.phone || customerInfo.mobile || 'Cash Customer',
        address: customerInfo.address,
        gstin: customerInfo.gstin,
        state: customerInfo.state,
        state_code: customerInfo.state_code
      } : null,
      buyer_order_no: invoiceInfo.buyer_order_no,
      buyer_order_date: invoiceInfo.buyer_order_date,
      payment_terms: invoiceInfo.payment_terms,
      delivery_note: invoiceInfo.delivery_note,
      delivery_note_date: invoiceInfo.delivery_note_date,
      dispatch_document_number: invoiceInfo.dispatch_document_number,
      dispatch_through: invoiceInfo.dispatch_through,
      destination: invoiceInfo.destination,
      vehicle_number: invoiceInfo.vehicle_number,
      lr_rr_number: invoiceInfo.lr_rr_number,
      terms_of_delivery: invoiceInfo.terms_of_delivery,
      items: cart.map(i => ({
        sku: i.product_sku || i.sku || i.name,
        product_name: i.product_name || i.name,
        hsn_sac: i.hsn_sac,
        quantity: Number(i.quantity) || 1,
        rate: Number(i.selling_price) || 0,
        discount: Number(i.discount) || 0,
        taxable_value: Number(i.taxable_amount) || 0,
        gst_rate: Number(i.gst_rate) || 0,
        cgst: Number(i.cgst) || 0,
        sgst: Number(i.sgst) || 0,
        igst: Number(i.igst) || 0,
        unit: i.unit || (i.sku === 'SERVICE CHARGE' ? 'SERV' : 'PCS'),
        pack_grade: i.pack_grade || (i.sku === 'SERVICE CHARGE' || i.hsn_sac === '9987' ? 'SERV' : '')
      })),
      totals: {
        taxable_amount: totals.taxable,
        total_tax: isInterState ? totals.igst : (totals.cgst + totals.sgst),
        grand_total: totals.grand
      },
      payment_method: paymentMethod,
      payment_reference: paymentReference,
      payment_remarks: paymentRemarks
    };
    setPreviewReceiptData(mockInvoice);
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;
    if (hasUnconfirmedGst) {
      setError("Please confirm the 0% GST rate for highlighted items.");
      return;
    }
    const hasServiceCharge = cart.some(i => i.sku === 'SERVICE CHARGE');
    if (hasServiceCharge && !isServiceSeries) {
      setError("SERVICE CHARGE can only be billed under SERVICE series (e.g. SERV- or SERVICE-). Please change Bill Series or remove the service charge.");
      return;
    }
    if (customerInfo.mobile && customerInfo.mobile.length !== 10) {
      setError("Mobile number must be exactly 10 digits.");
      return;
    }
    if (customerInfo.phone && customerInfo.phone.length !== 10) {
      setError("Phone number must be exactly 10 digits.");
      return;
    }

    // B2B validation: GSTIN is required
    if (invoiceType === 'B2B') {
      if (!customerInfo.gstin) {
        setError("GSTIN is required for B2B invoices.");
        return;
      }
      const gstErr = validateGstin(customerInfo.gstin);
      if (gstErr) {
        setError(`GSTIN Error: ${gstErr}`);
        return;
      }
      if (!customerInfo.name) {
        setError("Customer name is required for B2B invoices.");
        return;
      }
      if (!customerInfo.state || !customerInfo.place_of_supply) {
        setError("State and Place of Supply are required for B2B invoices.");
        return;
      }
    }

    setError('');

    const payload = {
      idempotency_key: idempotencyKeyRef.current,
      invoice_type: invoiceType,
      invoice_prefix: invoicePrefix,
      customer_name: customerInfo.name || null,
      customer_mobile: customerInfo.mobile || null,
      customer_gstin: customerInfo.gstin || null,
      customer_address: customerInfo.address || null,
      customer_state: customerInfo.state || null,
      customer_state_code: customerInfo.state_code || null,
      place_of_supply: customerInfo.place_of_supply || null,
      customer_email: customerInfo.email || null,
      customer_phone: customerInfo.phone || null,

      custom_invoice_number: invoiceInfo.custom_invoice_number || null,
      custom_invoice_date: invoiceInfo.custom_invoice_date || null,

      buyer_order_no: invoiceInfo.buyer_order_no || null,
      buyer_order_date: invoiceInfo.buyer_order_date || null,

      payment_terms: invoiceInfo.payment_terms || null,
      delivery_note: invoiceInfo.delivery_note || null,
      delivery_note_date: invoiceInfo.delivery_note_date || null,
      dispatch_document_number: invoiceInfo.dispatch_document_number || null,
      dispatch_through: invoiceInfo.dispatch_through || null,
      destination: invoiceInfo.destination || null,
      vehicle_number: invoiceInfo.vehicle_number || null,
      lr_rr_number: invoiceInfo.lr_rr_number || null,
      terms_of_delivery: invoiceInfo.terms_of_delivery || null,

      payment_method: paymentMethod,
      payment_reference: paymentReference || null,
      payment_remarks: paymentRemarks || null,
      origin_warehouse_id: selectedWarehouseId || null,
      total_taxable_amount: totals.taxable,
      total_tax: totals.tax,
      grand_total: totals.grand,
      items: cart.map(item => ({
        product_id: item.product_id,
        sku: item.sku,
        product_name: item.product_name || item.name,
        hsn_sac: item.hsn_sac || null,
        unit: item.unit || (item.sku === 'SERVICE CHARGE' ? 'SERV' : null),
        pack_grade: item.pack_grade || (item.sku === 'SERVICE CHARGE' ? 'SERV' : null),
        quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
        selling_price: Number(item.selling_price) || 0,
        discount: Number(item.discount) || 0,
        gst_rate: Number(item.gst_rate) || 0,
        taxable_amount: Number(item.taxable_amount) || 0,
        cgst: Number(item.cgst) || 0,
        sgst: Number(item.sgst) || 0,
        igst: Number(item.igst) || 0,
        line_total: Number(item.line_total) || 0,
      })),
    };

    checkoutMutation.mutate(payload);
  };



  // Load existing invoice data
  useEffect(() => {
    if (!id) return;
    let isMounted = true;
    setIsLoadingSale(true);
    api.get(`/api/pos/sales/${id}`)
      .then(res => {
        if (!isMounted) return;
        const sale = res.data.receipt || res.data;
        if (sale.status === 'Cancelled') {
          setError('Cannot edit a cancelled invoice.');
        }

        setInvoiceType(sale.invoice_type || 'B2C');
        if (sale.payment_method) setPaymentMethod(sale.payment_method);
        if (sale.payment_reference) setPaymentReference(sale.payment_reference);
        if (sale.payment_remarks) setPaymentRemarks(sale.payment_remarks);
        if (sale.origin_warehouse_id) setSelectedWarehouseId(sale.origin_warehouse_id);

        if (sale.invoice_number && sale.invoice_number.includes('-')) {
          setInvoicePrefix(sale.invoice_number.split('-')[0]);
        }

        if (sale.customer) {
          setCustomerInfo({
            name: sale.customer.name || '',
            mobile: sale.customer.mobile || sale.customer.phone || '',
            gstin: sale.customer.gstin || '',
            address: sale.customer.address || '',
            state: sale.customer.state || '',
            state_code: sale.customer.state_code || '',
            place_of_supply: sale.customer.place_of_supply || '',
            email: sale.customer.email || '',
            phone: sale.customer.phone || ''
          });
        }

        const cleanDate = (d) => {
          if (!d) return '';
          return d.includes('T') ? d.split('T')[0] : d;
        };

        setInvoiceInfo({
          custom_invoice_number: sale.invoice_number || '',
          custom_invoice_date: cleanDate(sale.sale_date),
          buyer_order_no: sale.buyer_order_no || '',
          buyer_order_date: cleanDate(sale.buyer_order_date),
          payment_terms: sale.payment_terms || '',
          delivery_note: sale.delivery_note || '',
          delivery_note_date: cleanDate(sale.delivery_note_date),
          dispatch_document_number: sale.dispatch_document_number || '',
          dispatch_through: sale.dispatch_through || '',
          destination: sale.destination || '',
          vehicle_number: sale.vehicle_number || '',
          lr_rr_number: sale.lr_rr_number || '',
          terms_of_delivery: sale.terms_of_delivery || ''
        });

        const mappedCart = (sale.items || []).map(item => {
          const isService = item.sku === 'SERVICE CHARGE' || item.hsn_sac === '9987';
          const qty = item.quantity || 1;
          const rate = item.rate !== undefined ? item.rate : (item.selling_price || 0);
          const discount = item.discount || 0;
          const gross = qty * rate;
          const discount_percent = gross > 0 && discount > 0 ? parseFloat(((discount / gross) * 100).toFixed(2)) : 0;
          const gst = item.gst_rate !== undefined ? item.gst_rate : (item.gst_percent || 0);
          const taxable = item.taxable_value !== undefined ? item.taxable_value : ((rate * qty) - discount);
          const cgst = item.cgst !== undefined ? item.cgst : (taxable * gst) / 200;
          const sgst = item.sgst !== undefined ? item.sgst : (taxable * gst) / 200;
          const igst = item.igst !== undefined ? item.igst : 0;
          const lineTotal = item.line_total !== undefined ? item.line_total : (taxable + cgst + sgst + igst);

          return {
            product_id: item.product_id,
            sku: item.sku,
            product_name: item.product_name || item.name,
            name: item.product_name || item.name,
            hsn_sac: item.hsn_sac || (isService ? '9987' : ''),
            selling_price: rate,
            gst_rate: gst,
            quantity: qty,
            discount_percent: discount_percent,
            discount: discount,
            taxable_amount: taxable,
            cgst: cgst,
            sgst: sgst,
            igst: igst,
            line_total: lineTotal,
            available_stock: isService ? 999999 : (item.available_stock || 999999),
            unit: item.unit || (isService ? 'SERV' : 'PCS'),
            pack_grade: item.pack_grade || (isService ? 'SERV' : '')
          };
        });

        setCart(mappedCart);
        setIsLoaded(true);
      })
      .catch(err => {
        if (!isMounted) return;
        console.error("Error loading sale:", err);
        setError("Error: " + (err.response?.data?.detail || err.message || String(err)));
      })
      .finally(() => {
        if (isMounted) setIsLoadingSale(false);
      });

    return () => { isMounted = false; };
  }, [id]);

  // Helper to update nested state
  const updateCustomer = (field, value) => setCustomerInfo(prev => ({ ...prev, [field]: value }));
  const updateInvoice = (field, value) => setInvoiceInfo(prev => ({ ...prev, [field]: value }));

  if (isLoadingSale) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', flexDirection: 'column', gap: '16px' }}>
        <div style={{ fontSize: '18px', fontWeight: 600, color: '#334155' }}>Loading Invoice #{id}...</div>
      </div>
    );
  }

  return (
    <div className={styles.posContainer}>
      <div className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button 
            type="button" 
            onClick={() => navigate(`/sales/${id}/invoice`)}
            style={{ 
              background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', 
              borderRadius: '6px', padding: '6px 14px', cursor: 'pointer', 
              fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' 
            }}
          >
            ← Cancel & Back to Bill
          </button>
          <h1 style={{ margin: 0 }}>Edit Bill #{invoiceInfo.custom_invoice_number || id}</h1>
        </div>
        {/* Invoice Type Selector */}
        <div className={styles.invoiceTypeSelector}>
          <label>Invoice Type</label>
          <div className={styles.invoiceTypeBtns}>
            <button
              type="button"
              className={`${styles.typeBtn} ${invoiceType === 'B2C' ? styles.typeBtnActive : ''}`}
              onClick={() => setInvoiceType('B2C')}
            >
              B2C
            </button>
            <button
              type="button"
              className={`${styles.typeBtn} ${invoiceType === 'B2B' ? styles.typeBtnActive : ''}`}
              onClick={() => setInvoiceType('B2B')}
            >
              B2B
            </button>
          </div>
        </div>

        {activeWarehouses.length > 0 && (
          <div className={styles.invoiceTypeSelector} style={{ marginLeft: '1rem', flex: 1 }}>
            <label>Billing Warehouse</label>
            <select 
              value={selectedWarehouseId} 
              onChange={e => setSelectedWarehouseId(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #d1d5db', marginTop: '0.25rem' }}
            >
              {(sortedWarehouses.length > 0 ? sortedWarehouses : activeWarehouses).map(w => (
                <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && <div className={styles.errorMsg}>{error}</div>}

      <div className={styles.layout}>
        <div className={styles.mainPanel}>
          {/* Customer Details - expanded for B2B */}
          <div className={styles.sectionBlock}>
            <h2 className={styles.sectionTitle}>Customer Details{invoiceType === 'B2B' ? ' (Required for B2B)' : ' (Optional)'}</h2>
            <div className={styles.formGrid}>
              <div className={styles.inputGroup}>
                <label>Customer Name {invoiceType === 'B2B' && <span className={styles.required}>*</span>}</label>
                <input value={customerInfo.name} onChange={e => updateCustomer('name', e.target.value)} placeholder="Enter name" />
              </div>
              <div className={styles.inputGroup}>
                <label>Mobile Number</label>
                <input 
                  value={customerInfo.mobile} 
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                    updateCustomer('mobile', val);
                  }} 
                  placeholder="10 digit mobile" 
                  pattern="\d{10}"
                  maxLength={10}
                />
              </div>
              {invoiceType === 'B2B' && (
                <div className={styles.inputGroup}>
                  <label>GSTIN <span className={styles.required}>*</span></label>
                  <input
                    value={customerInfo.gstin}
                    onChange={e => updateCustomer('gstin', e.target.value.toUpperCase())}
                    placeholder="e.g. 27AAAAA0000A1Z5"
                    className={gstinError ? styles.inputError : ''}
                    maxLength={15}
                  />
                  {gstinError && <span className={styles.fieldError}>{gstinError}</span>}
                </div>
              )}
              <div className={styles.inputGroup}>
                <label>Email</label>
                <input value={customerInfo.email} onChange={e => updateCustomer('email', e.target.value)} placeholder="Email" type="email" />
              </div>
              <div className={`${styles.inputGroup} ${styles.fullWidth}`}>
                <label>Address</label>
                <input value={customerInfo.address} onChange={e => updateCustomer('address', e.target.value)} placeholder="Full address" />
              </div>
              <div className={styles.inputGroup}>
                <label>State</label>
                <select value={customerInfo.state} onChange={e => {
                  const st = INDIAN_STATES.find(s => s.name === e.target.value);
                  updateCustomer('state', e.target.value);
                  if (st) updateCustomer('state_code', st.code);
                }}>
                  <option value="">Select State</option>
                  {INDIAN_STATES.map(s => <option key={s.code} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div className={styles.inputGroup}>
                <label>State Code</label>
                <input value={customerInfo.state_code} onChange={e => updateCustomer('state_code', e.target.value)} placeholder="e.g. 27" readOnly={!!customerInfo.state} />
              </div>
              <div className={styles.inputGroup}>
                <label>Place of Supply</label>
                <select value={customerInfo.place_of_supply} onChange={e => updateCustomer('place_of_supply', e.target.value)}>
                  <option value="">Select Place of Supply</option>
                  {INDIAN_STATES.map(s => <option key={s.code} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div className={styles.inputGroup}>
                <label>Phone</label>
                <input 
                  value={customerInfo.phone} 
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                    updateCustomer('phone', val);
                  }} 
                  placeholder="10 digit phone" 
                  pattern="\d{10}"
                  maxLength={10}
                />
              </div>
            </div>
          </div>

          {/* Invoice & Transport Details */}
          <CollapsibleSection title="Invoice & Transport Details">
            <div className={styles.formGrid}>
              <div className={styles.inputGroup}>
                <label>Payment Terms</label>
                <input value={invoiceInfo.payment_terms} onChange={e => updateInvoice('payment_terms', e.target.value)} placeholder="e.g. Net 30" />
              </div>
              <div className={styles.inputGroup}>
                <label>Delivery Note</label>
                <input value={invoiceInfo.delivery_note} onChange={e => updateInvoice('delivery_note', e.target.value)} placeholder="Delivery note" />
              </div>
              <div className={styles.inputGroup}>
                <label>Delivery Note Date</label>
                <input type="date" value={invoiceInfo.delivery_note_date} onChange={e => updateInvoice('delivery_note_date', e.target.value)} />
              </div>
              <div className={styles.inputGroup}>
                <label>Dispatch Doc No.</label>
                <input value={invoiceInfo.dispatch_document_number} onChange={e => updateInvoice('dispatch_document_number', e.target.value)} placeholder="Document number" />
              </div>
              <div className={styles.inputGroup}>
                <label>Dispatch Through</label>
                <input value={invoiceInfo.dispatch_through} onChange={e => updateInvoice('dispatch_through', e.target.value)} placeholder="e.g. Courier" />
              </div>
              <div className={styles.inputGroup}>
                <label>Destination</label>
                <input value={invoiceInfo.destination} onChange={e => updateInvoice('destination', e.target.value)} placeholder="Destination city" />
              </div>
              <div className={styles.inputGroup}>
                <label>Vehicle Number</label>
                <input value={invoiceInfo.vehicle_number} onChange={e => updateInvoice('vehicle_number', e.target.value)} placeholder="e.g. MH01AB1234" />
              </div>
              <div className={styles.inputGroup}>
                <label>LR/RR Number</label>
                <input value={invoiceInfo.lr_rr_number} onChange={e => updateInvoice('lr_rr_number', e.target.value)} placeholder="LR/RR number" />
              </div>
              <div className={styles.inputGroup}>
                <label>Terms of Delivery</label>
                <input value={invoiceInfo.terms_of_delivery} onChange={e => updateInvoice('terms_of_delivery', e.target.value)} placeholder="e.g. FOB" />
              </div>
            </div>
          </CollapsibleSection>

          {/* Service Series Banner & Action */}
          {isServiceSeries && (
            <div className={styles.serviceBanner} style={{ marginTop: '16px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className={styles.serviceBannerIcon}>🔧</span>
                <span>
                  <strong>Service Series Active:</strong> You can charge labour/repair fees using the <strong>+ Add Service Charge</strong> button. Service charges do not deduct physical warehouse stock.
                </span>
              </div>
              <button
                type="button"
                onClick={handleAddServiceCharge}
                className={styles.addServiceChargeBtn}
                title="Add Service Charge item (SERV- / SERVICE series only)"
              >
                <FiTool size={14} /> + Add Service Charge
              </button>
            </div>
          )}

          {/* Prominent Search Bar */}
          <div className={styles.searchSection}>
            <div className={styles.searchBarWrapper}>
              <FiSearch className={styles.searchIcon} size={18} />
              <input
                className={styles.searchInput}
                placeholder="Scan Barcode or Search by SKU / Product Name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
              />
            </div>

            {/* Floating Dropdown Results */}
            {searchResults.length > 0 && (
              <div className={styles.searchResults}>
                {searchResults.map(result => (
                  <div key={result.id} className={styles.searchItem} onClick={() => addToCart(result)}>
                    <div className={styles.searchItemLeft}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={styles.searchSkuBadge}>{result.sku}</span>
                        <span className={styles.searchItemName}>{result.name}</span>
                      </div>
                      <div className={styles.searchItemMeta}>
                        {(result.hsn_sac || result.hsn) && <span>HSN: <strong>{result.hsn_sac || result.hsn}</strong></span>}
                        {result.brand && <span>Brand: <strong>{result.brand}</strong></span>}
                      </div>
                    </div>
                    <div className={styles.searchItemRight}>
                      <span className={styles.searchItemPrice}>₹{Number(result.default_price || 0).toFixed(2)}</span>
                      <span className={`${styles.searchStockBadge} ${result.available_stock < 5 ? styles.low : ''}`}>
                        Stock: {result.available_stock}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Enhanced Cart Table */}
          <div className={styles.cartTableContainer}>
            <table className={styles.cartTable}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>HSN</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Rate (₹)</th>
                  <th>Disc %</th>
                  <th>Disc (₹)</th>
                  <th>GST %</th>
                  <th>Taxable</th>
                  {isInterState ? <th>IGST</th> : <><th>CGST</th><th>SGST</th></>}
                  <th>Total (₹)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(cart || []).map((item, index) => (
                  <tr key={`${item.sku}-${index}`}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className={styles.itemName}>{item.sku}</span>
                        {item.sku === 'SERVICE CHARGE' && (
                          <span className={styles.serviceBadge}>SERVICE</span>
                        )}
                      </div>
                      <div className={styles.itemMeta}>{item.product_name || item.name}</div>
                    </td>
                    <td className={styles.hsnCell}>
                      <input
                        type="text"
                        value={item.hsn_sac || ''}
                        placeholder="Write HSN"
                        onChange={(e) => updateCartItem(index, 'hsn_sac', e.target.value)}
                        style={{
                          width: '95px',
                          padding: '4px',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          fontSize: '0.85rem'
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className={styles.qtyInput}
                        value={item.quantity}
                        onChange={(e) => updateCartItem(index, 'quantity', e.target.value)}
                        min="1"
                      />
                    </td>
                    <td className={styles.unitCell}>{item.unit || 'PCS'}</td>
                    <td>
                      <input
                        type="number"
                        className={styles.priceInput}
                        value={item.selling_price}
                        onChange={(e) => updateCartItem(index, 'selling_price', e.target.value)}
                        step="0.01"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className={styles.discPctInput}
                        value={item.discount_percent ?? ''}
                        onChange={(e) => updateCartItem(index, 'discount_percent', e.target.value)}
                        placeholder="0"
                        step="0.1"
                        min="0"
                        max="100"
                        title="Discount %"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className={styles.discInput}
                        value={item.discount ?? ''}
                        onChange={(e) => updateCartItem(index, 'discount', e.target.value)}
                        placeholder="0"
                        step="0.01"
                        min="0"
                        max={(Number(item.quantity) || 0) * (Number(item.selling_price) || 0)}
                        title="Discount Amount (₹)"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className={`${styles.gstInput} ${item.gst_needs_confirmation ? styles.gstWarning : ''}`}
                        value={item.gst_rate}
                        onChange={(e) => updateCartItem(index, 'gst_rate', e.target.value)}
                        step="0.1"
                      />
                    </td>
                    <td>₹{(item.taxable_amount || 0).toFixed(2)}</td>
                    {isInterState ? (
                      <td>₹{(item.igst || 0).toFixed(2)}</td>
                    ) : (
                      <>
                        <td>₹{(item.cgst || 0).toFixed(2)}</td>
                        <td>₹{(item.sgst || 0).toFixed(2)}</td>
                      </>
                    )}
                    <td className={styles.lineTotalCell}>₹{(item.line_total || 0).toFixed(2)}</td>
                    <td>
                      <button className={styles.removeBtn} onClick={() => removeFromCart(index)}>
                        <FiX />
                      </button>
                    </td>
                  </tr>
                ))}
                {cart.length === 0 && (
                  <tr>
                    <td colSpan={isInterState ? 12 : 13} style={{textAlign: 'center', padding: '24px', color: '#666'}}>
                      Cart is empty. Search products to add.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Summary Panel */}
        <div className={styles.summaryPanel}>
          <h2 className={styles.sectionTitle}>Bill Summary</h2>

          <div className={styles.inputGroup} style={{marginBottom: '16px'}}>
            <label>Payment Method</label>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Card">Card / POS</option>
              <option value="Bank Transfer">Bank Transfer (NEFT/RTGS)</option>
              <option value="COD">COD (Cash on Delivery)</option>
              <option value="Mix / Split">Mix / Split Payment</option>
              <option value="Cheque">Cheque</option>
              <option value="Credit">Credit / Pay Later</option>
            </select>
          </div>

          {paymentMethod !== 'Cash' && paymentMethod !== 'COD' && (
            <div className={styles.inputGroup} style={{marginBottom: '16px'}}>
              <label>{paymentMethod === 'UPI' ? 'UPI UTR / Reference No.' : paymentMethod === 'Cheque' ? 'Cheque Number' : paymentMethod === 'Mix / Split' ? 'Payment Reference' : 'Transaction Reference'}</label>
              <input
                value={paymentReference}
                onChange={e => setPaymentReference(e.target.value)}
                placeholder={paymentMethod === 'UPI' ? 'Enter 12-digit UPI UTR' : paymentMethod === 'Cheque' ? 'Enter Cheque No.' : 'Transaction Reference'}
              />
            </div>
          )}

          <div className={styles.inputGroup} style={{marginBottom: '16px'}}>
            <label>Payment Remarks (Mix / Split Details)</label>
            <input
              value={paymentRemarks}
              onChange={e => setPaymentRemarks(e.target.value)}
              placeholder="e.g. ₹500 Cash + ₹1200 UPI Ref #9872"
            />
          </div>

          <div className={styles.summaryRow}>
            <span>Taxable Amount</span>
            <span>₹{totals.taxable.toFixed(2)}</span>
          </div>
          {isInterState ? (
            <div className={styles.summaryRow}>
              <span>IGST</span>
              <span>₹{totals.igst.toFixed(2)}</span>
            </div>
          ) : (
            <>
              <div className={styles.summaryRow}>
                <span>CGST</span>
                <span>₹{totals.cgst.toFixed(2)}</span>
              </div>
              <div className={styles.summaryRow}>
                <span>SGST</span>
                <span>₹{totals.sgst.toFixed(2)}</span>
              </div>
            </>
          )}
          <div className={`${styles.summaryRow} ${styles.total}`}>
            <span>Grand Total</span>
            <span>₹{totals.grand.toFixed(2)}</span>
          </div>

          {/* Invoice Series Dropdown */}
          <div className={styles.formGroup} style={{ marginTop: '16px' }}>
            <label>Invoice Series (Prefix)</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select 
                value={validSeriesOptions.includes(invoicePrefix) ? invoicePrefix : 'CUSTOM'}
                onChange={e => {
                  if (e.target.value !== 'CUSTOM') {
                    setInvoicePrefix(e.target.value);
                  } else {
                    setInvoicePrefix('');
                  }
                }}
                className={styles.inputField}
                style={{ width: '120px' }}
              >
                <option value="GST">GST-</option>
                <option value="JGST">{isBkr ? 'JGST- (BKR)' : 'JGST- (JSPL)'}</option>
                <option value="AFN">AFN-</option>
                <option value="MFN">MFN-</option>
                {!isBkr && <option value="SERVICE">SERVICE-</option>}
                {!isBkr && <option value="SERV">SERV-</option>}
                {!isJspl && <option value="BKR">BKR-</option>}
                {!isBkr && <option value="JSPL">JSPL-</option>}
                {companyCode && !validSeriesOptions.includes(companyCode) && (
                  <option value={companyCode}>{companyCode}-</option>
                )}
                <option value="CUSTOM">Custom</option>
              </select>
              {!validSeriesOptions.includes(invoicePrefix) && (
                <input 
                  type="text" 
                  value={invoicePrefix} 
                  onChange={e => setInvoicePrefix(e.target.value.toUpperCase())}
                  placeholder="Custom Prefix"
                  className={styles.inputField}
                  style={{ flex: 1 }}
                />
              )}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
              Current series: <strong>{invoicePrefix || 'Default'}</strong>
            </div>
          </div>
          
          <div className={styles.formGroup} style={{ marginTop: '16px' }}>
             <label>Invoice Number</label>
             <input
               type="text"
               value={invoiceInfo.custom_invoice_number}
               onChange={e => updateInvoice('custom_invoice_number', e.target.value)}
               placeholder="Invoice No."
               className={styles.inputField}
             />
             <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
               Keep original number or enter updated invoice number
             </div>
          </div>

          <div className={styles.formGroup} style={{ marginTop: '12px' }}>
             <label>Manual Bill Date (Optional)</label>
             <input
               type="date"
               value={invoiceInfo.custom_invoice_date}
               onChange={e => updateInvoice('custom_invoice_date', e.target.value)}
               className={styles.inputField}
             />
          </div>

          <div className={styles.formGroup} style={{ marginTop: '16px' }}>
             <label>Buyer Order No. / PO No.</label>
             <input
               type="text"
               value={invoiceInfo.buyer_order_no || ''}
               onChange={e => updateInvoice('buyer_order_no', e.target.value)}
               placeholder="Order No. / PO No."
               className={styles.inputField}
             />
          </div>

          <div className={styles.formGroup} style={{ marginTop: '12px' }}>
             <label>Buyer Order Date</label>
             <input
               type="date"
               value={invoiceInfo.buyer_order_date || ''}
               onChange={e => updateInvoice('buyer_order_date', e.target.value)}
               className={styles.inputField}
             />
          </div>
          {invoiceType === 'B2B' && (
            <div className={styles.b2bNotice}>
              B2B Invoice — will attempt Tally sync if enabled
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className={styles.checkoutBtn}
              style={{ flex: 1, background: '#17a2b8' }}
              disabled={cart.length === 0 || hasUnconfirmedGst}
              onClick={handlePreview}
            >
              Preview Bill
            </button>
            <button
              className={styles.checkoutBtn}
              style={{ flex: 1 }}
              disabled={cart.length === 0 || hasUnconfirmedGst || checkoutMutation.isPending}
              onClick={handleCheckout}
            >
              {checkoutMutation.isPending ? 'Processing…' : hasUnconfirmedGst ? "Confirm GST Rates" : `Save Changes`}
            </button>
          </div>
        </div>
      </div>
      {previewReceiptData && (
        <InvoicePreviewModal 
          invoice={previewReceiptData} 
          onClose={() => setPreviewReceiptData(null)}
          isPending={checkoutMutation.isPending}
          onComplete={() => {
            handleCheckout();
            setPreviewReceiptData(null);
          }}
        />
      )}
      {completedReceipt && (
        <ReceiptModal 
          receipt={completedReceipt} 
          onClose={() => setCompletedReceipt(null)} 
        />
      )}
    </div>
  );
};

export default EditInvoicePage;

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posService } from '../../services/pos';
import { handleApiError } from '../../utils/errorHandler';
import api from '../../services/api';
import { warehouseService } from '../../services/warehouse';
import styles from './POSPage.module.css';
import ReceiptModal from './ReceiptModal';
import InvoicePreviewModal from './InvoicePreviewModal';
import useCompanyStore from '../../stores/useCompanyStore';
import { FiX, FiChevronDown, FiChevronUp, FiWifi, FiWifiOff, FiRefreshCw, FiSearch, FiShoppingBag, FiFileText, FiTrash2, FiEye, FiCheckCircle, FiUser, FiTool, FiPlus } from 'react-icons/fi';

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
const POSPage = () => {
  const POS_STORAGE_KEY = 'pos_draft_state_v1';
  const getSavedState = () => {
    try {
      const saved = localStorage.getItem(POS_STORAGE_KEY);
      if (!saved) return {};
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      return {};
    } catch(e) { return {}; }
  };
  const savedState = getSavedState() || {};
  const navigate = useNavigate();

  const location = useLocation();

  useEffect(() => {
    if (location.state?.tallyItems && location.state.tallyItems.length > 0) {
      const newItems = location.state.tallyItems.map((item, idx) => {
        // Find existing index logic if needed, but we can just append
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
      setCart(prev => [...newItems, ...prev]);
      // clear state so it doesn't run again on reload
      window.history.replaceState({}, document.title)
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

  // Existing state
  const [searchTerm, setSearchTerm] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState(() => {
    const init = savedState.invoicePrefix || companyCode || 'GST';
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

  const handleAddServiceCharge = async () => {
    try {
      const svcProduct = await posService.getServiceChargeItem();
      if (svcProduct) {
        addToCart(svcProduct);
      }
    } catch (err) {
      console.error("Failed to load service charge item", err);
      addToCart({
        id: 3810,
        sku: 'SERVICE CHARGE',
        name: 'SERVICE CHARGE',
        product_name: 'SERVICE CHARGE',
        pack_grade: 'SERV',
        category: 'SERV',
        hsn: '9987',
        hsn_sac: '9987',
        unit: 'SERV',
        available_stock: 999999,
        default_price: 0,
        default_gst_rate: 18.0
      });
    }
  };
  const [cart, setCart] = useState(() => {
    const rawCart = Array.isArray(savedState.cart) ? savedState.cart.filter(i => i && typeof i === 'object') : [];
    return rawCart.map(item => {
      const gross = (Number(item.quantity) || 0) * (Number(item.selling_price) || 0);
      const disc = Number(item.discount) || 0;
      const pct = item.discount_percent !== undefined
        ? item.discount_percent
        : (gross > 0 && disc > 0 ? parseFloat(((disc / gross) * 100).toFixed(2)) : 0);
      return {
        ...item,
        discount: disc,
        discount_percent: pct,
      };
    });
  });
  const [paymentMethod, setPaymentMethod] = useState(savedState.paymentMethod || 'Cash');
  const [paymentReference, setPaymentReference] = useState(savedState.paymentReference || '');
  const [paymentRemarks, setPaymentRemarks] = useState(savedState.paymentRemarks || '');
  const [error, setError] = useState('');
  const [completedReceipt, setCompletedReceipt] = useState(null);
  const [previewReceiptData, setPreviewReceiptData] = useState(null);

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

  const { data: nextInvData } = useQuery({
    queryKey: ['nextInvoiceNumber', currentCompany?.id, invoicePrefix],
    queryFn: () => posService.getNextInvoiceNumber(invoicePrefix),
    enabled: !!invoicePrefix,
  });
  const autoBillNumber = nextInvData?.formatted_next_number || '';

  const [selectedWarehouseId, setSelectedWarehouseId] = useState(savedState.selectedWarehouseId || '');

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
    if (activeWarehouses.length > 0) {
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

      const currentWh = activeWarehouses.find(w => String(w.id) === String(selectedWarehouseId));
      if (!currentWh || (isJspl && currentWh.warehouse_type !== 'CENTRAL' && defaultWh)) {
        setSelectedWarehouseId(defaultWh.id);
      }
    }
  }, [activeWarehouses, companyCode]);

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
  // New: Invoice Type
  const [invoiceType, setInvoiceType] = useState(savedState.invoiceType || 'B2C');

  // New: Extended Customer Info
  const [customerInfo, setCustomerInfo] = useState((savedState.customerInfo && typeof savedState.customerInfo === 'object') ? savedState.customerInfo : {
    name: '', mobile: '', gstin: '', address: '',
    state: '', state_code: '', place_of_supply: '',
    email: '', phone: '',
  });

  // New: Invoice Info
  const [invoiceInfo, setInvoiceInfo] = useState((savedState.invoiceInfo && typeof savedState.invoiceInfo === 'object') ? savedState.invoiceInfo : {
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

    const initialGst = product.default_gst_rate !== null && product.default_gst_rate !== undefined ? product.default_gst_rate : 0;
    const initialPrice = product.default_price || product.item_rate || product.selling_price || 0;
    const taxable = initialPrice * 1;
    const gstAmount = taxable * (initialGst / 100);

    const isService = product.sku === 'SERVICE CHARGE' || product.category === 'SERV';

    const newItem = {
      product_id: product.id,
      sku: product.sku,
      product_name: product.name,
      name: product.name,
      hsn_sac: product.hsn_sac || product.hsn || (isService ? '9987' : ''),
      unit: product.unit || (isService ? 'SERV' : 'PCS'),
      pack_grade: product.pack_grade || (isService ? 'SERV' : (product.category || '')),
      available_stock: isService ? 999999 : (product.available_stock !== undefined ? product.available_stock : 999999),
      quantity: 1,
      selling_price: initialPrice,
      discount_percent: 0,
      discount: 0,
      gst_rate: initialGst,
      gst_needs_confirmation: product.default_gst_rate === null,
      taxable_amount: taxable,
      cgst: isInterState ? 0 : gstAmount / 2,
      sgst: isInterState ? 0 : gstAmount / 2,
      igst: isInterState ? gstAmount : 0,
      line_total: taxable + gstAmount,
    };

    setCart([newItem, ...cart]);
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
  const totals = cart.reduce((acc, item) => {
    acc.taxable += item.taxable_amount || 0;
    acc.cgst += item.cgst || 0;
    acc.sgst += item.sgst || 0;
    acc.igst += item.igst || 0;
    acc.tax += (item.cgst || 0) + (item.sgst || 0) + (item.igst || 0);
    acc.grand += item.line_total || 0;
    return acc;
  }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, grand: 0 });

  // Round off grand total to nearest integer
  totals.grand = Math.round(totals.grand);

  const hasUnconfirmedGst = cart.some(item => item.gst_needs_confirmation);

  // ---------------------------------------------------------------------------
  // Checkout Mutation
  // ---------------------------------------------------------------------------
  const checkoutMutation = useMutation({
    mutationFn: posService.checkout,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      
      const receipt = data.receipt;
      const saleId = receipt?.id;

      // Reset form
      setCart([]);
      setCustomerInfo({ name: '', mobile: '', gstin: '', address: '', state: '', state_code: '', place_of_supply: '', email: '', phone: '' });
      setInvoiceInfo({ payment_terms: '', delivery_note: '', delivery_note_date: '', dispatch_document_number: '', dispatch_through: '', destination: '', vehicle_number: '', lr_rr_number: '', terms_of_delivery: '', custom_invoice_number: '', custom_invoice_date: '' });
      setPaymentReference('');
      setPaymentRemarks('');
      setSearchTerm('');
      localStorage.removeItem(POS_STORAGE_KEY);
      
      // Regenerate idempotency key for the next operation
      idempotencyKeyRef.current = window.crypto.randomUUID();
      // Invalidate next invoice number query so the next bill number refreshes immediately
      queryClient.invalidateQueries({ queryKey: ['nextInvoiceNumber'] });

      if (!receipt?.id) return;

      if (saleId) {
        navigate(`/sales/${saleId}/invoice`, { state: { receipt } });
      }
    },
    onError: (err) => {
      handleApiError(err, "Checkout failed");
    }
  });

  
  const handlePreview = () => {
    // Generate a mock invoice object matching InvoiceRenderer structure
    const formattedInvoiceNo = invoiceInfo.custom_invoice_number 
      ? (invoicePrefix && !invoiceInfo.custom_invoice_number.toUpperCase().startsWith(`${invoicePrefix}-`) 
          ? `${invoicePrefix}-${invoiceInfo.custom_invoice_number}` 
          : invoiceInfo.custom_invoice_number)
      : (autoBillNumber || (invoicePrefix ? `${invoicePrefix}-PREVIEW` : 'PREVIEW'));

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
        pack_grade: i.pack_grade || (i.sku === 'SERVICE CHARGE' || i.hsn_sac === '9987' ? 'SERV' : (i.category || '')),
        hsn_sac: i.hsn_sac,
        quantity: Number(i.quantity) || 1,
        rate: Number(i.selling_price) || 0,
        discount: Number(i.discount) || 0,
        taxable_value: Number(i.taxable_amount) || 0,
        gst_rate: Number(i.gst_rate) || 0,
        cgst: Number(i.cgst) || 0,
        sgst: Number(i.sgst) || 0,
        igst: Number(i.igst) || 0,
        unit: i.unit || 'PCS'
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
    if (!isServiceSeries && cart.some(i => i.sku === 'SERVICE CHARGE' || i.hsn_sac === '9987')) {
      setError("Service Charge can only be charged on Service series bills (SERVICE- or SERV-). Please change Bill Series or remove Service Charge.");
      return;
    }
    if (hasUnconfirmedGst) {
      setError("Please confirm the 0% GST rate for highlighted items.");
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

    
      // Also save the customer silently in background
      if (customerInfo.name || customerInfo.mobile) {
        api.post('/api/customers/', {
          name: customerInfo.name || "Unknown",
          mobile: customerInfo.mobile || null,
          phone: customerInfo.phone || null,
          email: customerInfo.email || null,
          gstin: customerInfo.gstin || null,
          address: customerInfo.address || null,
          state: customerInfo.state || null,
          state_code: customerInfo.state_code || null,
          place_of_supply: customerInfo.place_of_supply || null
        }).catch(err => console.error("Failed to save customer", err));
      }
      
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
        unit: item.unit || null,
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


  // Auto-save state to localStorage
  useEffect(() => {
    const stateToSave = {
      cart, customerInfo, invoiceInfo, paymentMethod, paymentReference, paymentRemarks, invoicePrefix, invoiceType, selectedWarehouseId
    };
    localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(stateToSave));
  }, [cart, customerInfo, invoiceInfo, paymentMethod, paymentReference, paymentRemarks, invoicePrefix, invoiceType, selectedWarehouseId]);

  
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const res = await api.get('/api/customers/');
      return res.data;
    }
  });

  const handleCustomerSelect = (value, field) => {
    updateCustomer(field, value);
    // Find if it matches an existing customer exactly
    let matched = null;
    if (field === 'mobile' && value.length === 10) {
      matched = customers.find(c => c.mobile === value);
    } else if (field === 'name') {
      matched = customers.find(c => c.name === value);
    }
    
    if (matched) {
      if (matched.name && field !== 'name') updateCustomer('name', matched.name);
      if (matched.mobile && field !== 'mobile') updateCustomer('mobile', matched.mobile);
      if (matched.gstin) updateCustomer('gstin', matched.gstin);
      if (matched.email) updateCustomer('email', matched.email);
      if (matched.address) updateCustomer('address', matched.address);
      if (matched.state) updateCustomer('state', matched.state);
      if (matched.state_code) updateCustomer('state_code', matched.state_code);
      if (matched.place_of_supply) updateCustomer('place_of_supply', matched.place_of_supply);
      if (matched.phone) updateCustomer('phone', matched.phone);
    }
  };

  const handleClearCart = () => {
    if (window.confirm("Are you sure you want to clear the entire cart and customer details?")) {
      setCart([]);
      setCustomerInfo({ name: '', mobile: '', gstin: '', address: '', state: '', state_code: '', place_of_supply: '', email: '', phone: '' });
      setInvoiceInfo({ 
        buyer_order_no: '', buyer_order_date: '',
        payment_terms: '', delivery_note: '', delivery_note_date: '', 
        dispatch_document_number: '', dispatch_through: '', destination: '', 
        vehicle_number: '', lr_rr_number: '', terms_of_delivery: '', 
        custom_invoice_number: '', custom_invoice_date: '' 
      });
      setPaymentMethod('Cash');
      setPaymentReference('');
      setPaymentRemarks('');
      localStorage.removeItem(POS_STORAGE_KEY);
    }
  };

  // Helper to update nested state
  const updateCustomer = (field, value) => setCustomerInfo(prev => ({ ...prev, [field]: value }));
  const updateInvoice = (field, value) => setInvoiceInfo(prev => ({ ...prev, [field]: value }));

  return (
    <div className={styles.posContainer}>
      {/* Top Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.headerTitle}>
            <FiShoppingBag /> Offline POS & Billing
          </h1>
          <span className={styles.companyBadge}>{companyName}</span>
          <span style={{ 
            display: 'inline-flex', alignItems: 'center', gap: '5px', 
            fontSize: '12px', padding: '3px 10px', borderRadius: '12px',
            background: navigator.onLine ? '#ecfdf5' : '#fef2f2',
            color: navigator.onLine ? '#059669' : '#dc2626',
            fontWeight: 600, border: `1px solid ${navigator.onLine ? '#a7f3d0' : '#fecaca'}`
          }}>
            {navigator.onLine ? <FiWifi size={12} /> : <FiWifiOff size={12} />}
            {navigator.onLine ? 'Online' : 'Offline Queue Active'}
          </span>
        </div>

        <div className={styles.headerActions}>
          {pendingCount > 0 && (
            <button 
              className={styles.syncBtn}
              onClick={async () => {
                setSyncing(true);
                try {
                  const result = await posService.syncOffline();
                  setPendingCount(0);
                  alert(`Sync complete: ${result.synced || 0} synced, ${result.failed || 0} failed`);
                } catch (e) { 
                  alert('Sync failed. Try again later.'); 
                } finally { 
                  setSyncing(false); 
                }
              }}
              disabled={syncing}
            >
              <FiRefreshCw size={14} className={syncing ? 'spin' : ''} />
              {syncing ? 'Syncing...' : `Sync ${pendingCount} Pending Bills`}
            </button>
          )}

          <button onClick={handleClearCart} className={styles.clearBtn} title="Clear cart and customer details">
            <FiRefreshCw size={13} /> Clear / New Bill
          </button>
        </div>
      </div>

      {error && <div className={styles.errorMsg}>{error}</div>}

      <div className={styles.layout}>
        {/* Main Left Workspace */}
        <div className={styles.mainPanel}>
          
          {/* Card 1: Bill & Order Details */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>
                <FiFileText size={16} /> Bill & Order Details
              </h2>
              <div className={styles.typeSelector}>
                <button
                  type="button"
                  className={`${styles.typeBtn} ${invoiceType === 'B2C' ? styles.typeBtnActive : ''}`}
                  onClick={() => setInvoiceType('B2C')}
                >
                  B2C Retail
                </button>
                <button
                  type="button"
                  className={`${styles.typeBtn} ${invoiceType === 'B2B' ? styles.typeBtnActive : ''}`}
                  onClick={() => setInvoiceType('B2B')}
                >
                  B2B Tax Invoice
                </button>
              </div>
            </div>

            <div className={styles.orderMetaGrid}>
              {/* Billing Warehouse */}
              {activeWarehouses.length > 0 && (
                <div className={styles.inputGroup}>
                  <label>Dispatch Warehouse</label>
                  <select 
                    value={selectedWarehouseId} 
                    onChange={e => setSelectedWarehouseId(e.target.value)}
                    className={styles.inputField}
                  >
                    {(sortedWarehouses.length > 0 ? sortedWarehouses : activeWarehouses).map(w => (
                      <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Invoice Series */}
              <div className={styles.inputGroup}>
                <label>Bill Series</label>
                <div style={{ display: 'flex', gap: '6px' }}>
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
                    style={{ width: '110px' }}
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
                      placeholder="Prefix"
                      className={styles.inputField}
                      style={{ flex: 1 }}
                    />
                  )}
                </div>
                {invoicePrefix && (
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                    Next auto bill: <strong style={{ color: '#0f172a' }}>{autoBillNumber || `${invoicePrefix}-...`}</strong>
                  </div>
                )}
              </div>

              {/* Buyer Order No */}
              <div className={styles.inputGroup}>
                <label>Order No. / PO Ref. No.</label>
                <input
                  type="text"
                  value={invoiceInfo.buyer_order_no || ''}
                  onChange={e => updateInvoice('buyer_order_no', e.target.value)}
                  placeholder="e.g. PO-9842"
                  className={`${styles.inputField} ${styles.highlightField}`}
                />
              </div>

              {/* Order Date */}
              <div className={styles.inputGroup}>
                <label>Order Date</label>
                <input
                  type="date"
                  value={invoiceInfo.buyer_order_date || ''}
                  onChange={e => updateInvoice('buyer_order_date', e.target.value)}
                  className={styles.inputField}
                />
              </div>

              {/* Manual Bill Date */}
              <div className={styles.inputGroup}>
                <label>Bill Date (Optional)</label>
                <input
                  type="date"
                  value={invoiceInfo.custom_invoice_date || ''}
                  onChange={e => updateInvoice('custom_invoice_date', e.target.value)}
                  className={styles.inputField}
                />
              </div>

              {/* Custom Bill No */}
              <div className={styles.inputGroup}>
                <label>Custom Bill No. (Optional)</label>
                <input
                  type="text"
                  value={invoiceInfo.custom_invoice_number || ''}
                  onChange={e => updateInvoice('custom_invoice_number', e.target.value)}
                  placeholder={autoBillNumber ? `Auto: ${autoBillNumber}` : "Auto-generated if blank"}
                  className={styles.inputField}
                />
              </div>
            </div>
          </div>

          {/* Card 2: Customer Details */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>
                <FiUser size={16} /> Customer Information {invoiceType === 'B2B' && <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: 500 }}>(Required for B2B)</span>}
              </h2>
            </div>
            
            <div className={styles.formGrid}>
              <div className={styles.inputGroup}>
                <label>Customer Name {invoiceType === 'B2B' && <span className={styles.required}>*</span>}</label>
                <input 
                  list="customer-names" 
                  value={customerInfo.name} 
                  onChange={e => handleCustomerSelect(e.target.value, 'name')} 
                  placeholder="Enter name or select existing" 
                  className={styles.inputField}
                />
                <datalist id="customer-names">
                  {customers.map(c => <option key={c.id} value={c.name}>{c.mobile ? `${c.name} - ${c.mobile}` : c.name}</option>)}
                </datalist>
              </div>

              <div className={styles.inputGroup}>
                <label>Mobile Number</label>
                <input 
                  list="customer-mobiles" 
                  value={customerInfo.mobile} 
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                    handleCustomerSelect(val, 'mobile');
                  }} 
                  placeholder="10-digit mobile" 
                  pattern="\d{10}"
                  maxLength={10}
                  className={styles.inputField}
                />
                <datalist id="customer-mobiles">
                  {customers.filter(c => c.mobile).map(c => <option key={c.id} value={c.mobile}>{c.name}</option>)}
                </datalist>
              </div>

              {invoiceType === 'B2B' && (
                <div className={styles.inputGroup}>
                  <label>GSTIN <span className={styles.required}>*</span></label>
                  <input
                    value={customerInfo.gstin}
                    onChange={e => updateCustomer('gstin', e.target.value.toUpperCase())}
                    placeholder="e.g. 27AAAAA0000A1Z5"
                    className={`${styles.inputField} ${gstinError ? styles.inputError : ''}`}
                    maxLength={15}
                  />
                  {gstinError && <span className={styles.fieldError}>{gstinError}</span>}
                </div>
              )}

              <div className={styles.inputGroup}>
                <label>State</label>
                <select 
                  value={customerInfo.state} 
                  onChange={e => {
                    const st = INDIAN_STATES.find(s => s.name === e.target.value);
                    updateCustomer('state', e.target.value);
                    if (st) updateCustomer('state_code', st.code);
                  }}
                  className={styles.inputField}
                >
                  <option value="">Select State</option>
                  {INDIAN_STATES.map(s => <option key={s.code} value={s.name}>{s.name}</option>)}
                </select>
              </div>

              <div className={styles.inputGroup}>
                <label>State Code</label>
                <input 
                  value={customerInfo.state_code} 
                  onChange={e => updateCustomer('state_code', e.target.value)} 
                  placeholder="e.g. 27" 
                  readOnly={!!customerInfo.state}
                  className={styles.inputField} 
                />
              </div>

              <div className={styles.inputGroup}>
                <label>Place of Supply</label>
                <select 
                  value={customerInfo.place_of_supply} 
                  onChange={e => updateCustomer('place_of_supply', e.target.value)}
                  className={styles.inputField}
                >
                  <option value="">Select Place of Supply</option>
                  {INDIAN_STATES.map(s => <option key={s.code} value={s.name}>{s.name}</option>)}
                </select>
              </div>

              <div className={styles.inputGroup}>
                <label>Phone / Alt Contact</label>
                <input 
                  value={customerInfo.phone} 
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                    updateCustomer('phone', val);
                  }} 
                  placeholder="Landline / Alt Phone" 
                  className={styles.inputField}
                />
              </div>

              <div className={styles.inputGroup}>
                <label>Email Address</label>
                <input 
                  value={customerInfo.email} 
                  onChange={e => updateCustomer('email', e.target.value)} 
                  placeholder="customer@domain.com" 
                  type="email" 
                  className={styles.inputField}
                />
              </div>

              <div className={`${styles.inputGroup} ${styles.fullWidth}`}>
                <label>Full Address</label>
                <input 
                  value={customerInfo.address} 
                  onChange={e => updateCustomer('address', e.target.value)} 
                  placeholder="Shop / House No, Street, City, Pincode" 
                  className={styles.inputField}
                />
              </div>
            </div>

            {/* Collapsible Transport Details */}
            <div style={{ marginTop: '16px' }}>
              <CollapsibleSection title="Transport, Vehicle & Delivery Details">
                <div className={styles.formGrid}>
                  <div className={styles.inputGroup}>
                    <label>Payment Terms</label>
                    <input value={invoiceInfo.payment_terms} onChange={e => updateInvoice('payment_terms', e.target.value)} placeholder="e.g. Immediate / Net 30" className={styles.inputField} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Vehicle Number</label>
                    <input value={invoiceInfo.vehicle_number} onChange={e => updateInvoice('vehicle_number', e.target.value)} placeholder="e.g. CH01AB1234" className={styles.inputField} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Delivery Note</label>
                    <input value={invoiceInfo.delivery_note} onChange={e => updateInvoice('delivery_note', e.target.value)} placeholder="Delivery note reference" className={styles.inputField} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Delivery Note Date</label>
                    <input type="date" value={invoiceInfo.delivery_note_date} onChange={e => updateInvoice('delivery_note_date', e.target.value)} className={styles.inputField} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Dispatch Doc No.</label>
                    <input value={invoiceInfo.dispatch_document_number} onChange={e => updateInvoice('dispatch_document_number', e.target.value)} placeholder="Doc number" className={styles.inputField} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Dispatch Through</label>
                    <input value={invoiceInfo.dispatch_through} onChange={e => updateInvoice('dispatch_through', e.target.value)} placeholder="Transport / Courier" className={styles.inputField} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Destination City</label>
                    <input value={invoiceInfo.destination} onChange={e => updateInvoice('destination', e.target.value)} placeholder="Destination city" className={styles.inputField} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>LR / RR Number</label>
                    <input value={invoiceInfo.lr_rr_number} onChange={e => updateInvoice('lr_rr_number', e.target.value)} placeholder="LR/RR No." className={styles.inputField} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Terms of Delivery</label>
                    <input value={invoiceInfo.terms_of_delivery} onChange={e => updateInvoice('terms_of_delivery', e.target.value)} placeholder="e.g. Ex-Godown" className={styles.inputField} />
                  </div>
                </div>
              </CollapsibleSection>
            </div>
          </div>

          {/* Card 3: Add Products & Bill Items (Redesigned & Spacious) */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>
                <FiShoppingBag size={16} /> Products & Bill Items 
                <span style={{ fontSize: '12px', background: '#e2e8f0', color: '#1e293b', padding: '3px 10px', borderRadius: '12px', fontWeight: 700, marginLeft: '6px' }}>
                  {cart.length} {cart.length === 1 ? 'item' : 'items'}
                </span>
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isServiceSeries && (
                  <button 
                    type="button"
                    onClick={handleAddServiceCharge} 
                    className={styles.addServiceChargeBtn}
                    title="Add Service Charge item (SERV- / SERVICE series only)"
                  >
                    <FiTool size={14} /> + Add Service Charge
                  </button>
                )}
                {cart.length > 0 && (
                  <button 
                    onClick={() => setCart([])} 
                    style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: '13px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <FiTrash2 size={13} /> Clear Table
                  </button>
                )}
              </div>
            </div>

            {/* Service Series Banner */}
            {isServiceSeries && (
              <div className={styles.serviceBanner}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className={styles.serviceBannerIcon}>🔧</span>
                  <span>
                    <strong>Service Series Active:</strong> You can charge labour/repair fees using the <strong>+ Add Service Charge</strong> button. Service charges are tracked separately without deducting physical warehouse inventory.
                  </span>
                </div>
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
                          {result.hsn_sac && <span>HSN: <strong>{result.hsn_sac}</strong></span>}
                          {result.brand && <span>Brand: {result.brand}</span>}
                          {result.category && <span>Category: {result.category}</span>}
                        </div>
                      </div>
                      <div className={styles.searchItemRight}>
                        <span className={styles.searchItemPrice}>₹{Math.round(result.item_rate || result.selling_price || 0).toLocaleString('en-IN')}</span>
                        <span className={`${styles.searchStockBadge} ${result.available_stock < 5 ? styles.low : ''}`}>
                          {result.available_stock > 0 ? `✓ Stock: ${result.available_stock}` : 'Out of Stock'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Spacious Cart Table */}
            <div className={styles.cartTableContainer}>
              <table className={styles.cartTable}>
                <thead>
                  <tr>
                    <th style={{ minWidth: '150px' }}>Product Details</th>
                    <th style={{ width: '95px', textAlign: 'center' }}>HSN</th>
                    <th style={{ width: '45px', textAlign: 'center' }}>Qty</th>
                    <th style={{ width: '35px', textAlign: 'center' }}>Unit</th>
                    <th style={{ width: '100px', textAlign: 'right' }}>Rate (₹)</th>
                    <th style={{ width: '55px', textAlign: 'right' }}>Disc %</th>
                    <th style={{ width: '65px', textAlign: 'right' }}>Disc (₹)</th>
                    <th style={{ width: '50px', textAlign: 'center' }}>GST %</th>
                    <th style={{ width: '70px', textAlign: 'right' }}>Taxable</th>
                    <th style={{ width: '65px', textAlign: 'right' }}>{isInterState ? 'IGST (₹)' : 'Taxes (₹)'}</th>
                    <th style={{ width: '75px', textAlign: 'right' }}>Total (₹)</th>
                    <th style={{ width: '30px', textAlign: 'center' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item, index) => {
                    const totalTax = isInterState ? (item.igst || 0) : ((item.cgst || 0) + (item.sgst || 0));
                    return (
                      <tr key={`${item.sku}-${index}`} className={styles.cartRow}>
                        <td className={styles.productCell}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div className={styles.skuBadge}>{item.sku}</div>
                            {item.sku === 'SERVICE CHARGE' && (
                              <span className={styles.serviceBadge}>SERVICE</span>
                            )}
                          </div>
                          <div className={styles.productTitle}>{item.product_name || item.name}</div>
                        </td>
                        <td>
                          <input
                            type="text"
                            value={item.hsn_sac || ''}
                            placeholder="HSN"
                            onChange={(e) => updateCartItem(index, 'hsn_sac', e.target.value)}
                            className={`${styles.tableInput} ${styles.hsnInput}`}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="number"
                            className={`${styles.tableInput} ${styles.qtyInput}`}
                            value={item.quantity}
                            onChange={(e) => updateCartItem(index, 'quantity', e.target.value)}
                            min="1"
                          />
                        </td>
                        <td className={styles.unitCell}>{item.unit || 'PCS'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            className={`${styles.tableInput} ${styles.priceInput}`}
                            value={item.selling_price}
                            onChange={(e) => updateCartItem(index, 'selling_price', e.target.value)}
                            step="0.01"
                          />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            className={`${styles.tableInput} ${styles.discPctInput}`}
                            value={item.discount_percent ?? ''}
                            onChange={(e) => updateCartItem(index, 'discount_percent', e.target.value)}
                            placeholder="0"
                            step="0.1"
                            min="0"
                            max="100"
                            title="Discount %"
                          />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            className={`${styles.tableInput} ${styles.discInput}`}
                            value={item.discount ?? ''}
                            onChange={(e) => updateCartItem(index, 'discount', e.target.value)}
                            placeholder="0"
                            step="0.01"
                            min="0"
                            max={(Number(item.quantity) || 0) * (Number(item.selling_price) || 0)}
                            title="Discount Amount (₹)"
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="number"
                            className={`${styles.tableInput} ${styles.gstInput} ${item.gst_needs_confirmation ? styles.gstWarning : ''}`}
                            value={item.gst_rate}
                            onChange={(e) => updateCartItem(index, 'gst_rate', e.target.value)}
                            step="0.1"
                          />
                        </td>
                        <td className={styles.amountCell}>₹{Math.round(item.taxable_amount || 0).toLocaleString('en-IN')}</td>
                        <td className={styles.amountCell}>₹{Math.round(totalTax).toLocaleString('en-IN')}</td>
                        <td className={styles.totalCell}>₹{Math.round(item.line_total || 0).toLocaleString('en-IN')}</td>
                        <td>
                          <button className={styles.removeBtn} onClick={() => removeFromCart(index)} title="Remove Item">
                            <FiTrash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {cart.length === 0 && (
                    <tr>
                      <td colSpan={12}>
                        <div className={styles.emptyCart}>
                          <FiShoppingBag size={40} style={{ opacity: 0.4 }} />
                          <div className={styles.emptyCartTitle}>No products added yet</div>
                          <div className={styles.emptyCartSub}>Type in the search box above to quickly find and add items to this bill</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {cart.length > 0 && (
                <div className={styles.cartFooterBar}>
                  <span>Total Line Items: <strong>{cart.length}</strong></span>
                  <span>Total Units: <strong>{Math.round(cart.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0))}</strong></span>
                  <span>Amounts are calculated inclusive of item GST</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Sticky Summary & Checkout Panel */}
        <div className={styles.summaryPanel}>
          <h2 className={styles.summaryTitle}>Billing Summary</h2>

          <div className={styles.summaryRow}>
            <span>Taxable Amount</span>
            <span>₹{Math.round(totals.taxable).toLocaleString('en-IN')}</span>
          </div>

          {isInterState ? (
            <div className={styles.summaryRow}>
              <span>IGST</span>
              <span>₹{Math.round(totals.igst).toLocaleString('en-IN')}</span>
            </div>
          ) : (
            <>
              <div className={styles.summaryRow}>
                <span>CGST</span>
                <span>₹{Math.round(totals.cgst).toLocaleString('en-IN')}</span>
              </div>
              <div className={styles.summaryRow}>
                <span>SGST</span>
                <span>₹{Math.round(totals.sgst).toLocaleString('en-IN')}</span>
              </div>
            </>
          )}

          <div className={styles.summaryRow}>
            <span>Total Taxes</span>
            <span>₹{Math.round(totals.tax).toLocaleString('en-IN')}</span>
          </div>

          {/* Grand Total Banner with whole rounded Rupees */}
          <div className={styles.grandTotalBanner}>
            <span className={styles.grandTotalLabel}>Grand Total (Round Off)</span>
            <span className={styles.grandTotalAmount}>
              ₹ {Math.round(totals.grand).toLocaleString('en-IN')}
            </span>
          </div>

          {/* Payment Section */}
          <div className={styles.paymentSection}>
            <div className={styles.inputGroup}>
              <label>Payment Method</label>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={styles.inputField}>
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
              <div className={styles.inputGroup}>
                <label>{paymentMethod === 'UPI' ? 'UPI UTR / Reference No.' : paymentMethod === 'Cheque' ? 'Cheque Number' : paymentMethod === 'Mix / Split' ? 'Payment Reference' : 'Transaction Reference'}</label>
                <input
                  value={paymentReference}
                  onChange={e => setPaymentReference(e.target.value)}
                  placeholder={paymentMethod === 'UPI' ? 'Enter 12-digit UPI UTR' : paymentMethod === 'Cheque' ? 'Enter Cheque No.' : 'Transaction Reference'}
                  className={styles.inputField}
                />
              </div>
            )}

            <div className={styles.inputGroup} style={{ marginTop: '10px' }}>
              <label>Payment Remarks (Mix / Split Details)</label>
              <input
                value={paymentRemarks}
                onChange={e => setPaymentRemarks(e.target.value)}
                placeholder="e.g. ₹500 Cash + ₹1200 UPI Ref #9872"
                className={styles.inputField}
              />
            </div>
          </div>

          {invoiceType === 'B2B' && (
            <div className={styles.b2bNotice}>
              ✓ B2B Tax Invoice — GSTIN validated and eligible for Tally sync
            </div>
          )}

          {/* Actions */}
          <div className={styles.checkoutActions}>
            <button
              className={styles.previewBtn}
              disabled={cart.length === 0 || hasUnconfirmedGst}
              onClick={handlePreview}
            >
              <FiEye size={16} /> Preview Bill (A4)
            </button>
            <button
              className={styles.checkoutBtn}
              disabled={cart.length === 0 || hasUnconfirmedGst || checkoutMutation.isPending}
              onClick={handleCheckout}
            >
              <FiCheckCircle size={18} />
              {checkoutMutation.isPending ? 'Processing Sale...' : hasUnconfirmedGst ? "Confirm Highlighted GST" : `Complete Sale`}
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

export default POSPage;

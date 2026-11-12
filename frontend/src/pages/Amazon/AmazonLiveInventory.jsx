import React, { useState, useRef, useMemo, useCallback } from 'react';
import PageContainer from '../../components/layout/PageContainer';
import { Card } from '../../components/Card/Card';
import Button from '../../components/forms/Button';
import { SearchBar } from '../../components/forms/SearchBar';
import { DataTable } from '../../components/DataTable/DataTable';
import useCompanyStore from '../../stores/useCompanyStore';
import { 
  FiRefreshCw, 
  FiCloudLightning, 
  FiAlertTriangle, 
  FiCheckCircle, 
  FiClock, 
  FiBox, 
  FiShield,
  FiTruck,
  FiUploadCloud,
  FiFileText,
  FiCheck,
  FiFilter,
  FiBookOpen,
  FiChevronDown,
  FiChevronUp,
  FiInfo,
  FiHelpCircle
} from 'react-icons/fi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { amazonService } from '../../services/amazonService';
import styles from './Amazon.module.css';

const DEFAULT_PAGE_SIZE = 25;

const AmazonLiveInventory = () => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const { companyId } = useCompanyStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [networkFilter, setNetworkFilter] = useState('ALL');
  const [stockFilter, setStockFilter] = useState('ALL');
  const [activeTab, setActiveTab] = useState('allocations');
  const [showGuide, setShowGuide] = useState(false);
  const [backfillMode, setBackfillMode] = useState(false);
  const [reportDaysBack, setReportDaysBack] = useState(7);
  const [selectedFile, setSelectedFile] = useState(null);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Pagination states
  const [allocationsPage, setAllocationsPage] = useState(1);
  const [fcPage, setFcPage] = useState(1);
  const [dlqPage, setDlqPage] = useState(1);

  // Memoized search handler to prevent resetting pagination on render
  const handleSearch = useCallback((val) => {
    setSearchTerm(val);
    setAllocationsPage(1);
  }, []);

  // 1. Fetch Sync Telemetry & Health Status
  const { 
    data: syncStatus, 
    isLoading: loadingStatus,
    refetch: refetchStatus 
  } = useQuery({
    queryKey: ['amazon', 'sync-status', companyId],
    queryFn: amazonService.getSyncStatus,
    refetchInterval: (query) => {
      return query?.state?.data?.status === 'IN_PROGRESS' ? 10000 : 120000;
    },
    refetchIntervalInBackground: false,
  });

  const isSyncInProgress = syncStatus?.status === 'IN_PROGRESS';

  // 2. Fetch Live Soft Allocations
  const { 
    data: rawAllocations = [], 
    isLoading: loadingAllocations, 
    error: allocationsError,
    refetch: refetchAllocations
  } = useQuery({
    queryKey: ['amazon', 'live-inventory', companyId],
    queryFn: amazonService.getLiveInventory,
    refetchInterval: isSyncInProgress ? 15000 : false,
    refetchIntervalInBackground: false,
  });

  // 3. Fetch DLQ / Quarantined SKUs
  const {
    data: dlqRecords = [],
    isLoading: loadingDlq,
    refetch: refetchDlq
  } = useQuery({
    queryKey: ['amazon', 'dlq', companyId],
    queryFn: () => amazonService.getDlqRecords(100),
    refetchInterval: isSyncInProgress ? 15000 : false,
    refetchIntervalInBackground: false,
  });

  // 4. Fetch FC Inventory Summary
  const {
    data: fcSummaries = [],
    isLoading: loadingFcSummary,
    refetch: refetchFcSummary
  } = useQuery({
    queryKey: ['amazon', 'fc-summary', companyId],
    queryFn: amazonService.getFcInventorySummary,
  });

  // 5. Trigger Orders Sync Mutation
  const syncMutation = useMutation({
    mutationFn: (options) => amazonService.triggerSync(options),
    onSuccess: (data) => {
      toast.success(data?.message || 'Amazon sync initiated!');
      queryClient.invalidateQueries({ queryKey: ['amazon', 'sync-status'] });
      queryClient.invalidateQueries({ queryKey: ['amazon', 'live-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['amazon', 'dlq'] });
    },
    onError: (err) => {
      toast.error(err?.response?.data?.detail || 'Failed to trigger Amazon sync');
    }
  });

  // 6. Request FC Shipment Report Mutation (SP-API)
  const requestShipmentsMutation = useMutation({
    mutationFn: (params) => amazonService.requestFcShipments(params),
    onSuccess: (data) => {
      toast.success(data?.message || 'Amazon shipment report requested!');
      queryClient.invalidateQueries({ queryKey: ['amazon', 'fc-summary'] });
      queryClient.invalidateQueries({ queryKey: ['amazon', 'live-inventory'] });
    },
    onError: (err) => {
      toast.error(err?.response?.data?.detail || 'Failed to request Amazon shipment report');
    }
  });

  // 7. Upload FC Shipment Report Mutation
  const uploadShipmentsMutation = useMutation({
    mutationFn: (formData) => amazonService.uploadFcShipments(formData),
    onSuccess: (data) => {
      const details = data?.details || {};
      const breakdown = details.fc_breakdown || {};
      const breakdownStr = Object.entries(breakdown).map(([fc, qty]) => `${fc}: ${qty}`).join(', ');
      toast.success(`Deducted ${details.units_deducted || 0} units across FCs (${breakdownStr || 'None'})!`);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      queryClient.invalidateQueries({ queryKey: ['amazon', 'fc-summary'] });
      queryClient.invalidateQueries({ queryKey: ['amazon', 'live-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['amazon', 'dlq'] });
    },
    onError: (err) => {
      toast.error(err?.response?.data?.detail || 'Failed processing uploaded shipment report');
    }
  });

  const handleSyncClick = () => {
    syncMutation.mutate({
      backfill: backfillMode,
      async_mode: true
    });
  };

  const handleRequestShipmentsClick = () => {
    requestShipmentsMutation.mutate({
      days_back: reportDaysBack,
      async_mode: true
    });
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleProcessUploadedFile = () => {
    if (!selectedFile) return;
    const formData = new FormData();
    formData.append('file', selectedFile);
    uploadShipmentsMutation.mutate(formData);
  };

  const handleRefreshAll = () => {
    refetchStatus();
    refetchAllocations();
    refetchDlq();
    refetchFcSummary();
    toast.success('Amazon telemetry refreshed');
  };

  // Filter allocations
  const allocations = Array.isArray(rawAllocations) ? rawAllocations : [];
  
  const deficitCount = useMemo(() => allocations.filter(a => (a.available_stock || 0) < 0).length, [allocations]);
  const outOfStockCount = useMemo(() => allocations.filter(a => (a.available_stock || 0) === 0).length, [allocations]);
  const inStockCount = useMemo(() => allocations.filter(a => (a.available_stock || 0) > 0).length, [allocations]);
  const unsuppliedCount = deficitCount + outOfStockCount;

  const filteredAllocations = useMemo(() => {
    return allocations.filter((item) => {
      const matchesSearch = !searchTerm || item.sku.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesNetwork = networkFilter === 'ALL' || item.network === networkFilter;
      const stock = item.available_stock ?? 0;
      let matchesStock = true;
      if (stockFilter === 'UNSUPPLIED') matchesStock = stock <= 0;
      else if (stockFilter === 'DEFICIT') matchesStock = stock < 0;
      else if (stockFilter === 'OUT_OF_STOCK') matchesStock = stock === 0;
      else if (stockFilter === 'IN_STOCK') matchesStock = stock > 0;
      return matchesSearch && matchesNetwork && matchesStock;
    });
  }, [allocations, searchTerm, networkFilter, stockFilter]);

  // Calculate totals
  const totalSoftReserved = useMemo(() => {
    return allocations.reduce((acc, curr) => acc + (curr.pending_qty || 0), 0);
  }, [allocations]);

  // Paginated allocations
  const paginatedAllocations = useMemo(() => {
    const start = (allocationsPage - 1) * pageSize;
    return filteredAllocations.slice(start, start + pageSize);
  }, [filteredAllocations, allocationsPage, pageSize]);

  const totalAllocationPages = Math.ceil(filteredAllocations.length / pageSize) || 1;

  // Paginated FC Summaries
  const safeFcSummaries = Array.isArray(fcSummaries) ? fcSummaries : [];
  const paginatedFc = useMemo(() => {
    const start = (fcPage - 1) * pageSize;
    return safeFcSummaries.slice(start, start + pageSize);
  }, [safeFcSummaries, fcPage, pageSize]);

  const totalFcPages = Math.ceil(safeFcSummaries.length / pageSize) || 1;

  // Paginated DLQ
  const safeDlqRecords = Array.isArray(dlqRecords) ? dlqRecords : [];
  const paginatedDlq = useMemo(() => {
    const start = (dlqPage - 1) * pageSize;
    return safeDlqRecords.slice(start, start + pageSize);
  }, [safeDlqRecords, dlqPage, pageSize]);

  const totalDlqPages = Math.ceil(safeDlqRecords.length / pageSize) || 1;

  const formatDateTime = (isoStr) => {
    if (!isoStr) return 'Never';
    try {
      const dt = new Date(isoStr);
      return dt.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return isoStr;
    }
  };

  // Column definitions for DataTable
  const allocationColumns = [
    { 
      key: 'sku', 
      label: 'Product SKU', 
      render: (val) => <span className={styles.skuCode}>{val}</span> 
    },
    { 
      key: 'network', 
      label: 'Shipping Route', 
      render: (val) => (
        <span 
          className={`${styles.badge} ${val === 'MFN' ? styles.badgeMfn : styles.badgeAfn}`}
          title={val === 'MFN' ? 'Local Godown: Pack and dispatch from your own warehouse' : 'Amazon FBA: Stored in Amazon godowns and shipped by Amazon'}
        >
          {val === 'MFN' ? 'MFN (Local Godown)' : 'AFN (Amazon FBA)'}
        </span>
      )
    },
    { 
      key: 'allocated_qty', 
      label: 'Total Ordered', 
      render: (val) => <span style={{ fontWeight: 600, color: 'var(--color-neutral-800)' }}>{val}</span> 
    },
    { 
      key: 'reconciled_qty', 
      label: 'Already Shipped', 
      render: (val) => (
        <span style={{ 
          color: val > 0 ? '#059669' : 'var(--color-neutral-400)', 
          fontWeight: val > 0 ? 700 : 500 
        }}>
          {val}
        </span>
      )
    },
    { 
      key: 'pending_qty', 
      label: 'Pending To Pack (Reserved)', 
      render: (val) => <span className={styles.softReservedNumber}>{val}</span>
    },
    { 
      key: 'available_stock', 
      label: 'Godown Stock (Available)', 
      render: (val) => {
        const stock = typeof val === 'number' ? val : 0;
        if (stock < 0) {
          return (
            <span 
              style={{ 
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: '#fee2e2', 
                color: '#b91c1c', 
                fontWeight: 700, 
                padding: '3px 8px', 
                borderRadius: '6px',
                fontSize: '0.82rem',
                border: '1px solid #fca5a5'
              }}
              title="Shortage! You sold more than you have in godown. Restock urgently!"
            >
              🔴 {stock} (Shortage / Deficit)
            </span>
          );
        }
        if (stock === 0) {
          return (
            <span 
              style={{ 
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: '#fef3c7', 
                color: '#b45309', 
                fontWeight: 600, 
                padding: '3px 8px', 
                borderRadius: '6px',
                fontSize: '0.82rem',
                border: '1px solid #fcd34d'
              }}
              title="Godown stock is 0! Customer ordered on Amazon, but shelf has 0 pieces in system. Restock needed."
            >
              ⚠️ 0 (Out of Stock)
            </span>
          );
        }
        return (
          <span 
            style={{ 
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              backgroundColor: '#dcfce7', 
              color: '#15803d', 
              fontWeight: 600, 
              padding: '3px 8px', 
              borderRadius: '6px',
              fontSize: '0.82rem',
              border: '1px solid #bbf7d0'
            }}
            title="Sufficient stock available in godown."
          >
            🟢 {stock} In Stock
          </span>
        );
      }
    },
    { 
      key: 'active_orders', 
      label: 'Amazon Orders', 
      render: (val) => (
        <span style={{ color: 'var(--color-neutral-600)', fontSize: '0.85rem' }}>
          {val} {val === 1 ? 'order' : 'orders'}
        </span>
      )
    },
  ];

  const fcColumns = [
    { 
      key: 'fc_code', 
      label: 'FC Warehouse', 
      render: (val) => <span className={styles.badgeFcCode}>{val}</span> 
    },
    { 
      key: 'name', 
      label: 'Facility Name', 
      render: (val) => <span style={{ fontWeight: 600, color: 'var(--color-neutral-900)' }}>{val}</span> 
    },
    { 
      key: 'total_skus', 
      label: 'Active SKUs', 
      render: (val) => <span>{val} SKUs</span> 
    },
    { 
      key: 'physical_units', 
      label: 'Physical On-Hand', 
      render: (val) => (
        <span style={{ fontWeight: 700, color: val < 0 ? '#dc2626' : 'var(--color-neutral-900)' }}>
          {val} units
        </span>
      )
    },
    { 
      key: 'active_allocations', 
      label: 'AFN Soft Reserved', 
      render: (val) => (
        <span style={{ color: '#d97706', fontWeight: 600 }}>{val} units</span>
      )
    },
    { 
      key: 'available_units', 
      label: 'Net Available Units', 
      render: (val) => (
        <span style={{ 
          fontWeight: 700, 
          color: val < 0 ? '#dc2626' : '#059669',
          backgroundColor: val < 0 ? '#fef2f2' : '#ecfdf5',
          padding: '0.2rem 0.6rem',
          borderRadius: '4px',
          border: `1px solid ${val < 0 ? '#fecaca' : '#a7f3d0'}`
        }}>
          {val} units
        </span>
      )
    },
  ];

  const dlqColumns = [
    { 
      key: 'order_id', 
      label: 'Amazon Order ID', 
      render: (val, row) => (
        <div>
          <span style={{ fontWeight: 700, color: 'var(--color-neutral-900)' }}>{val}</span>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-neutral-500)', marginTop: '2px' }}>
            Channel: {row.payload?.channel || 'Unknown'} {row.payload?.fc ? `(FC: ${row.payload.fc})` : ''}
          </div>
        </div>
      ) 
    },
    { 
      key: 'sku_details', 
      label: 'Quarantined SKU & Title', 
      render: (_, row) => {
        const item = row.payload?.item || row.payload || {};
        return (
          <div>
            <span className={styles.dlqBadge}>{item.sku || 'N/A'}</span>
            <div style={{ 
              fontSize: '0.75rem', 
              color: 'var(--color-neutral-600)', 
              marginTop: '4px', 
              maxWidth: '350px', 
              whiteSpace: 'nowrap', 
              overflow: 'hidden', 
              textOverflow: 'ellipsis' 
            }}>
              {item.title || 'No product title'} (Qty: {item.quantity || 1})
            </div>
          </div>
        );
      }
    },
    { 
      key: 'error_message', 
      label: 'Quarantine Reason', 
      render: (val) => (
        <span style={{ color: '#dc2626', fontSize: '0.8125rem', fontWeight: 500 }}>
          {val}
        </span>
      )
    },
    { 
      key: 'created_at', 
      label: 'Detected At', 
      render: (val) => (
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-neutral-500)' }}>
          {formatDateTime(val)}
        </span>
      )
    },
  ];

  // Actions for PageContainer
  const headerActions = (
    <div className={styles.headerActions}>
      <label className={styles.backfillToggle} title="Fetch all historical orders starting August 1, 2026">
        <input 
          type="checkbox" 
          className={styles.backfillCheckbox}
          checked={backfillMode} 
          onChange={(e) => setBackfillMode(e.target.checked)} 
          disabled={isSyncInProgress || syncMutation.isPending}
        />
        <span>Full Backfill (Aug 1 - Now)</span>
      </label>

      <Button
        variant="primary"
        onClick={handleSyncClick}
        isLoading={isSyncInProgress || syncMutation.isPending}
        disabled={isSyncInProgress || syncMutation.isPending}
      >
        <FiCloudLightning style={{ marginRight: '0.5rem' }} />
        {isSyncInProgress ? 'Syncing SP-API...' : 'Sync Amazon Orders'}
      </Button>

      <Button
        variant="secondary"
        onClick={handleRefreshAll}
        title="Refresh Dashboard"
      >
        <FiRefreshCw />
      </Button>
    </div>
  );

  return (
    <PageContainer 
      title="Amazon Live Inventory & Order Sync"
      actions={headerActions}
    >
      <div className={styles.container}>
        <p className={styles.headerSubtitle}>
          Real-time Amazon customer order sync, godown stock locking, and automated shipment deduction.
        </p>

        {/* 1. Telemetry & Metrics Cards */}
        <div className={styles.metricsGrid}>
          {/* Metric 1: Sync Status */}
          <div className={styles.metricCard}>
            <div className={styles.metricHeader}>
              <span className={styles.metricTitle}>Amazon Sync Status</span>
              <div className={`
                ${styles.iconCircle}
                ${syncStatus?.status === 'SUCCESS' ? styles.iconCircleSuccess : ''}
                ${syncStatus?.status === 'IN_PROGRESS' ? styles.iconCirclePrimary : ''}
                ${syncStatus?.status === 'FAILED' ? styles.iconCircleDanger : ''}
                ${!syncStatus?.status || syncStatus?.status === 'NEVER_RUN' ? styles.iconCircleNeutral : ''}
              `}>
                {syncStatus?.status === 'SUCCESS' && <FiCheckCircle />}
                {syncStatus?.status === 'IN_PROGRESS' && <FiClock />}
                {syncStatus?.status === 'FAILED' && <FiAlertTriangle />}
                {(!syncStatus?.status || syncStatus?.status === 'NEVER_RUN') && <FiCloudLightning />}
              </div>
            </div>
            <div className={styles.metricBody}>
              <span className={`
                ${styles.badge} 
                ${syncStatus?.status === 'SUCCESS' ? styles.badgeSuccess : ''}
                ${syncStatus?.status === 'IN_PROGRESS' ? styles.badgeProgress : ''}
                ${syncStatus?.status === 'FAILED' ? styles.badgeFailed : ''}
                ${!syncStatus?.status || syncStatus?.status === 'NEVER_RUN' ? styles.badgeNeutral : ''}
              `}>
                {syncStatus?.status || 'IDLE'}
              </span>
            </div>
            <div className={styles.metricFooter}>
              <FiClock size={12} />
              <span>Last sync: {formatDateTime(syncStatus?.last_sync_end || syncStatus?.last_sync_start)}</span>
            </div>
          </div>

          {/* Metric 2: Soft Reservations */}
          <div className={styles.metricCard}>
            <div className={styles.metricHeader}>
              <span className={styles.metricTitle}>Reserved Units (Pending Dispatch)</span>
              <div className={`${styles.iconCircle} ${styles.iconCirclePrimary}`}>
                <FiShield />
              </div>
            </div>
            <div className={styles.metricBody}>
              <span className={styles.metricNumber}>{totalSoftReserved.toLocaleString()}</span>
              <span className={styles.metricUnit}>units</span>
            </div>
            <div className={styles.metricFooter}>
              <span>Across {syncStatus?.active_orders_count ?? 0} open Amazon orders</span>
            </div>
          </div>

          {/* Metric 3: FC Warehouses */}
          <div className={styles.metricCard}>
            <div className={styles.metricHeader}>
              <span className={styles.metricTitle}>Amazon FBA Godowns</span>
              <div className={`${styles.iconCircle} ${styles.iconCircleNeutral}`}>
                <FiTruck />
              </div>
            </div>
            <div className={styles.metricBody}>
              <span className={styles.metricNumber}>{fcSummaries.length}</span>
              <span className={styles.metricUnit}>FBA godowns</span>
            </div>
            <div className={styles.metricFooter}>
              <span>BLR8, BOM7, MAA4, DEL4 & more</span>
            </div>
          </div>

          {/* Metric 4: Quarantined SKUs (DLQ) */}
          <div className={styles.metricCard}>
            <div className={styles.metricHeader}>
              <span className={styles.metricTitle}>Unknown / Unmapped SKUs</span>
              <div className={`
                ${styles.iconCircle} 
                ${(syncStatus?.dlq_count > 0 || dlqRecords.length > 0) ? styles.iconCircleWarning : styles.iconCircleSuccess}
              `}>
                <FiAlertTriangle />
              </div>
            </div>
            <div className={styles.metricBody}>
              <span className={styles.metricNumber}>{syncStatus?.dlq_count ?? dlqRecords.length}</span>
              <span className={styles.metricUnit}>items</span>
            </div>
            <div className={styles.metricFooter}>
              <span>{(syncStatus?.dlq_count > 0 || dlqRecords.length > 0) ? 'Requires SKU mapping' : 'All SKUs recognized in catalog'}</span>
            </div>
          </div>
        </div>

        {/* OPERATOR QUICK GUIDE BANNER (TOGGLEABLE) */}
        <div style={{ marginBottom: '1.25rem' }}>
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 18px',
              borderRadius: '8px',
              border: '1px solid #3b82f6',
              backgroundColor: showGuide ? '#2563eb' : '#eff6ff',
              color: showGuide ? '#ffffff' : '#1d4ed8',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
            }}
          >
            <FiBookOpen size={18} />
            <span>{showGuide ? 'Hide Operator Guide' : '📖 Operator Guide: How to Understand & Use This Page (Click to View)'}</span>
            {showGuide ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
          </button>

          {showGuide && (
            <div style={{ 
              marginTop: '12px', 
              padding: '1.5rem', 
              backgroundColor: '#ffffff', 
              border: '1px solid #bfdbfe', 
              borderRadius: '10px', 
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
            }}>
              <h3 style={{ margin: '0 0 1rem 0', color: '#1e3a8a', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FiHelpCircle color="#2563eb" /> Simple Guide for Warehouse & Billing Operators
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                
                {/* Guide Box 1: Stock Status Colors */}
                <div style={{ backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '0.95rem' }}>
                    1. What do the Colors in Godown Stock mean?
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.875rem', color: '#334155', lineHeight: '1.6' }}>
                    <li>
                      <strong style={{ color: '#b91c1c' }}>🔴 Shortage / Deficit (e.g. -2, -3):</strong> Amazon sold more units than your physical godown had! You are in negative debt. <em>Action: Restock or transfer immediately.</em>
                    </li>
                    <li>
                      <strong style={{ color: '#b45309' }}>⚠️ 0 (Out of Stock):</strong> A buyer placed an order on Amazon, but your system godown has <strong>0 pieces</strong>. <em>Action: Send stock from BKR or supplier so the parcel can be packed.</em>
                    </li>
                    <li>
                      <strong style={{ color: '#15803d' }}>🟢 In Stock:</strong> Units are ready in your godown. Safe to fulfill!
                    </li>
                  </ul>
                </div>

                {/* Guide Box 2: AFN vs MFN */}
                <div style={{ backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '0.95rem' }}>
                    2. What is AFN vs MFN? (Who Ships It?)
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.875rem', color: '#334155', lineHeight: '1.6' }}>
                    <li>
                      <strong style={{ color: '#d97706' }}>AFN (Amazon FBA):</strong> Stock is stored in Amazon's own godowns (BLR8, DEL4, BOM7). Amazon's staff packs and delivers it to the customer.
                    </li>
                    <li>
                      <strong style={{ color: '#2563eb' }}>MFN (Local Godown / Merchant):</strong> Stock is stored in your own local warehouse. Your own dispatch team must pack and ship it.
                    </li>
                  </ul>
                </div>

                {/* Guide Box 3: What do the numbers mean? */}
                <div style={{ backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '0.95rem' }}>
                    3. What do the Table Columns mean?
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.875rem', color: '#334155', lineHeight: '1.6' }}>
                    <li><strong>Total Ordered:</strong> Total units purchased by Amazon customers.</li>
                    <li><strong>Pending To Pack:</strong> Active orders waiting to be packed and dispatched. These units are locked so shop counters don't oversell them.</li>
                    <li><strong>Already Shipped:</strong> Units dispatched and deducted from godown stock.</li>
                  </ul>
                </div>

                {/* Guide Box 4: Operator Daily Routine */}
                <div style={{ backgroundColor: '#eff6ff', padding: '1rem', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', color: '#1e40af', fontSize: '0.95rem' }}>
                    4. Operator Daily 3-Step Routine
                  </h4>
                  <ol style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.875rem', color: '#1e3a8a', lineHeight: '1.6' }}>
                    <li>Click <strong>"Sync Amazon Orders"</strong> at the top to download today's latest orders.</li>
                    <li>Click the <strong>"⚠️ Sold But Out of Stock (40)"</strong> filter button to see all items that need urgent restocking.</li>
                    <li>Go to <strong>Need Replenishment</strong>, select those urgent items, and click <strong>Approve</strong> — it will auto-generate the BKR bill and transfer stock to JSPL!</li>
                  </ol>
                </div>

              </div>
            </div>
          )}
        </div>

        {/* 2. How Orders & Stock Protection Work */}
        <div className={styles.architectureCard}>
          <div className={styles.architectureIcon}>
            <FiShield />
          </div>
          <div className={styles.architectureContent}>
            <div className={styles.architectureTitle}>
              <span>How Amazon Orders & Godown Stock Sync Together</span>
              <span className={styles.stepPill}>Active Stock Protection</span>
            </div>
            <div className={styles.architectureSteps}>
              <div className={styles.stepBox}>
                <strong>Step 1: Orders Automatically Lock Stock (Soft Reservation)</strong>
                When a customer orders on Amazon, the units are immediately locked in our system so your local showroom/counter doesn't accidentally sell them.
              </div>
              <div className={styles.stepBox}>
                <strong>Step 2: Physical Stock Deduction (Shipment Deduction)</strong>
                When Amazon or your dispatch team ships the parcel (e.g. from <code>BLR8</code>, <code>Chandigarh</code>), physical stock is permanently cut from that godown's ledger.
              </div>
            </div>
          </div>
        </div>

        {/* 3. Main Data Card with Modern Tabs */}
        <Card noPadding>
          <div className={styles.tabsContainer}>
            <button
              className={`${styles.tabBtn} ${activeTab === 'allocations' ? styles.tabBtnActive : ''}`}
              onClick={() => { setActiveTab('allocations'); setAllocationsPage(1); }}
            >
              <FiBox />
              <span>Live Customer Orders</span>
              <span className={styles.tabCountPill}>{allocations.length}</span>
            </button>

            <button
              className={`${styles.tabBtn} ${activeTab === 'fc_reconciliation' ? styles.tabBtnActive : ''}`}
              onClick={() => { setActiveTab('fc_reconciliation'); setFcPage(1); }}
            >
              <FiTruck />
              <span>Amazon FBA Godowns Stock</span>
              <span className={styles.tabCountPill}>{fcSummaries.length}</span>
            </button>

            <button
              className={`${styles.tabBtn} ${activeTab === 'dlq' ? styles.tabBtnActive : ''}`}
              onClick={() => { setActiveTab('dlq'); setDlqPage(1); }}
            >
              <FiAlertTriangle />
              <span>Unknown / Unmapped Items</span>
              <span className={styles.tabCountPill}>{dlqRecords.length}</span>
            </button>
          </div>

          {/* TAB 1: ALLOCATIONS */}
          {activeTab === 'allocations' && (
            <div>
              {/* Stock Status Filter Pills */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-neutral-700)' }}>
                  Stock Health:
                </span>

                <button
                  type="button"
                  onClick={() => { setStockFilter('ALL'); setAllocationsPage(1); }}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '20px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    border: '1px solid',
                    borderColor: stockFilter === 'ALL' ? '#334155' : '#cbd5e1',
                    backgroundColor: stockFilter === 'ALL' ? '#1e293b' : '#ffffff',
                    color: stockFilter === 'ALL' ? '#ffffff' : '#475569',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  All Orders ({allocations.length})
                </button>

                <button
                  type="button"
                  onClick={() => { setStockFilter('UNSUPPLIED'); setAllocationsPage(1); }}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '20px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    border: '1px solid',
                    borderColor: stockFilter === 'UNSUPPLIED' ? '#dc2626' : '#fecaca',
                    backgroundColor: stockFilter === 'UNSUPPLIED' ? '#dc2626' : '#fef2f2',
                    color: stockFilter === 'UNSUPPLIED' ? '#ffffff' : '#b91c1c',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  ⚠️ Sold But Out of Stock ({unsuppliedCount})
                </button>

                <button
                  type="button"
                  onClick={() => { setStockFilter('DEFICIT'); setAllocationsPage(1); }}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '20px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    border: '1px solid',
                    borderColor: stockFilter === 'DEFICIT' ? '#b91c1c' : '#fca5a5',
                    backgroundColor: stockFilter === 'DEFICIT' ? '#b91c1c' : '#ffffff',
                    color: stockFilter === 'DEFICIT' ? '#ffffff' : '#dc2626',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  🔴 In Deficit ({deficitCount})
                </button>

                <button
                  type="button"
                  onClick={() => { setStockFilter('IN_STOCK'); setAllocationsPage(1); }}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '20px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    border: '1px solid',
                    borderColor: stockFilter === 'IN_STOCK' ? '#16a34a' : '#bbf7d0',
                    backgroundColor: stockFilter === 'IN_STOCK' ? '#16a34a' : '#f0fdf4',
                    color: stockFilter === 'IN_STOCK' ? '#ffffff' : '#15803d',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  🟢 In Stock ({inStockCount})
                </button>
              </div>
              {/* Filter & Search Toolbar */}
              <div className={styles.toolbar}>
                <div className={styles.searchWrapper}>
                  <SearchBar
                    placeholder="Search SKU (e.g. LG0831)..."
                    value={searchTerm}
                    onSearch={handleSearch}
                  />
                </div>

                <div className={styles.filterControls}>
                  <span className={styles.filterLabel}>
                    <FiFilter style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                    Network:
                  </span>
                  <select
                    value={networkFilter}
                    onChange={(e) => {
                      setNetworkFilter(e.target.value);
                      setAllocationsPage(1);
                    }}
                    className={styles.filterSelect}
                  >
                    <option value="ALL">All Networks</option>
                    <option value="MFN">MFN (Local Warehouse)</option>
                    <option value="AFN">AFN (Amazon FCs)</option>
                  </select>

                  <span className={styles.filterLabel}>Rows:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setAllocationsPage(1);
                    }}
                    className={styles.filterSelect}
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>

                  <span className={styles.chipCount}>
                    Showing {filteredAllocations.length === 0 ? 0 : (allocationsPage - 1) * pageSize + 1} - {Math.min(allocationsPage * pageSize, filteredAllocations.length)} of {filteredAllocations.length} SKUs (Page {allocationsPage} of {totalAllocationPages})
                  </span>
                </div>
              </div>

              {/* DataTable */}
              <DataTable
                columns={allocationColumns}
                data={paginatedAllocations}
                isLoading={loadingAllocations}
                isError={!!allocationsError}
                errorMessage={allocationsError?.message || 'Failed to load live allocations'}
                emptyMessage="No live allocations found. Trigger a sync above to pull open orders."
                noResultsMessage="No allocations match your search or network filter."
                hasActiveFilters={!!searchTerm || networkFilter !== 'ALL'}
                pagination={{
                  currentPage: allocationsPage,
                  totalPages: totalAllocationPages,
                  onPageChange: (newPage) => setAllocationsPage(newPage)
                }}
              />
            </div>
          )}

          {/* TAB 2: FC RECONCILIATION */}
          {activeTab === 'fc_reconciliation' && (
            <div>
              {/* Action Cards for Automated Pull & File Upload */}
              <div className={styles.actionGrid}>
                {/* Action 1: Automated SP-API Pull */}
                <div className={styles.actionCard}>
                  <div>
                    <div className={styles.actionCardHeader}>
                      <div className={`${styles.iconCircle} ${styles.iconCirclePrimary}`} style={{ width: '32px', height: '32px', fontSize: '1rem' }}>
                        <FiCloudLightning />
                      </div>
                      <h4 className={styles.actionCardTitle}>Auto-Request Amazon Shipment Report</h4>
                    </div>
                    <p className={styles.actionCardDesc}>
                      Calls Amazon SP-API Reports to fetch the <code>GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL</code> file, 
                      identifies physical FCs (<code>BLR8</code>, <code>BOM7</code>, etc.), and permanently deducts inventory.
                    </p>
                  </div>

                  <div className={styles.actionCardControls}>
                    <select
                      value={reportDaysBack}
                      onChange={(e) => setReportDaysBack(Number(e.target.value))}
                      className={styles.filterSelect}
                      style={{ flex: 1 }}
                    >
                      <option value={7}>Past 7 Days</option>
                      <option value={14}>Past 14 Days</option>
                      <option value={30}>Past 30 Days</option>
                      <option value={60}>Past 60 Days</option>
                    </select>

                    <Button
                      variant="primary"
                      onClick={handleRequestShipmentsClick}
                      isLoading={requestShipmentsMutation.isPending}
                      disabled={requestShipmentsMutation.isPending}
                    >
                      Request & Deduct
                    </Button>
                  </div>
                </div>

                {/* Action 2: Manual File Upload */}
                <div className={styles.actionCard}>
                  <div>
                    <div className={styles.actionCardHeader}>
                      <div className={`${styles.iconCircle} ${styles.iconCircleSuccess}`} style={{ width: '32px', height: '32px', fontSize: '1rem' }}>
                        <FiUploadCloud />
                      </div>
                      <h4 className={styles.actionCardTitle}>Upload Amazon Report File (.csv / .tsv / .xlsx)</h4>
                    </div>
                    <p className={styles.actionCardDesc}>
                      Already downloaded an Amazon Fulfilled Shipments or Settlement Report from Seller Central? 
                      Upload it here for instant FC-wise deduction.
                    </p>
                  </div>

                  <div className={styles.actionCardControls}>
                    <div className={styles.customFileInputWrapper}>
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileUpload} 
                        accept=".csv,.tsv,.txt,.xlsx,.xls"
                        className={styles.customFileInput}
                      />
                      <div className={styles.fileSelectButton}>
                        <FiFileText />
                        <span>{selectedFile ? selectedFile.name : 'Choose report file...'}</span>
                      </div>
                    </div>

                    <Button
                      variant="secondary"
                      onClick={handleProcessUploadedFile}
                      disabled={!selectedFile || uploadShipmentsMutation.isPending}
                      isLoading={uploadShipmentsMutation.isPending}
                    >
                      Process File
                    </Button>
                  </div>
                </div>
              </div>

              {/* FC Warehouses Live Stock Table */}
              <div style={{ padding: '1rem 1.25rem 0.5rem' }}>
                <h4 style={{ margin: 0, color: 'var(--color-neutral-800)', fontSize: '0.9375rem', fontWeight: 600 }}>
                  Registered Amazon Fulfillment Centers (Physical Inventory Ledgers)
                </h4>
              </div>

              <DataTable
                columns={fcColumns}
                data={paginatedFc}
                isLoading={loadingFcSummary}
                emptyMessage="No Amazon FC warehouses mapped yet."
                pagination={{
                  currentPage: fcPage,
                  totalPages: totalFcPages,
                  onPageChange: (newPage) => setFcPage(newPage)
                }}
              />
            </div>
          )}

          {/* TAB 3: DLQ */}
          {activeTab === 'dlq' && (
            <div>
              {/* Isolation Rule Notice */}
              <div className={styles.dlqBanner}>
                <FiAlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong style={{ display: 'block', marginBottom: '0.25rem', color: '#78350f' }}>
                    Strict SKU Variant Isolation Guard:
                  </strong>
                  Per system rules, SKU variants with suffixes (e.g., <code>LG1151-1</code> or <code>LG0637-1</code>) 
                  are <strong>never</strong> merged into base SKUs (<code>LG1151</code>). Any order referencing an unmapped variant is 
                  safely quarantined here so it can be verified before updating inventory.
                </div>
              </div>

              {/* DLQ Table */}
              <DataTable
                columns={dlqColumns}
                data={paginatedDlq}
                isLoading={loadingDlq}
                emptyMessage="No quarantined items! All Amazon order SKUs are valid and mapped."
                pagination={{
                  currentPage: dlqPage,
                  totalPages: totalDlqPages,
                  onPageChange: (newPage) => setDlqPage(newPage)
                }}
              />
            </div>
          )}
        </Card>
      </div>
    </PageContainer>
  );
};

export default AmazonLiveInventory;

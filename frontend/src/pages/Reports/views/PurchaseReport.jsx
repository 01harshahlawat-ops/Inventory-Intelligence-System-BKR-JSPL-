import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import useCompanyStore from '../../../stores/useCompanyStore';
import { reportsService } from '../../../services/reports';
import { saveDownloadMetadata } from '../../../hooks/useDownloadHistory';
import { DataTable } from '../../../components/DataTable';
import { formatDate } from '../../../utils/dateUtils';
import { FiDownload, FiFileText, FiRefreshCw, FiShoppingBag } from 'react-icons/fi';

export const PurchaseReport = () => {
  const { currentCompany, companyId } = useCompanyStore();
  const companyCode = (currentCompany?.code || currentCompany?.name || '').toUpperCase();

  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['purchaseRegisterReport', { search, dateFrom, dateTo, companyId }],
    queryFn: async () => {
      return reportsService.getPurchasesReport({ company_id: companyId });
    }
  });

  const rawItems = Array.isArray(data) ? data : (data?.data || data?.items || []);
  
  // Filter client-side by search and date range
  const items = rawItems.filter(item => {
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      const matchInv = (item.invoice_number || '').toLowerCase().includes(q);
      const matchVen = (item.vendor_name || '').toLowerCase().includes(q);
      const matchWh = (item.warehouse_name || '').toLowerCase().includes(q);
      if (!matchInv && !matchVen && !matchWh) return false;
    }
    const itemDate = item.date || item.created_at;
    if (dateFrom && itemDate) {
      if (itemDate.slice(0, 10) < dateFrom) return false;
    }
    if (dateTo && itemDate) {
      if (itemDate.slice(0, 10) > dateTo) return false;
    }
    return true;
  });

  const totalBills = items.length;
  const totalAmount = items.reduce((sum, it) => sum + (Number(it.total_amount) || 0), 0);

  const handleExport = async (format = 'excel') => {
    setIsExporting(true);
    try {
      const response = await reportsService.downloadPurchasesReport({
        dateFrom,
        dateTo,
        format
      });

      const blob = new Blob([response.data], {
        type: format === 'excel'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv;charset=utf-8;'
      });
      const filename = `Purchase_Register_${companyCode || 'JSPL'}_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xlsx' : 'csv'}`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);

      saveDownloadMetadata({
        reportType: 'PURCHASE_REGISTER',
        filename,
        rowCount: response.headers['x-row-count'] ? parseInt(response.headers['x-row-count'], 10) : totalBills,
        fileFormat: format.toUpperCase(),
        status: 'Completed'
      });
    } catch (err) {
      console.error('Purchase register export failed:', err);
      let errorMsg = err.message;
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          errorMsg = parsed.detail || parsed.message || text;
        } catch {
          // ignore
        }
      } else if (err.response?.data?.detail) {
        errorMsg = err.response.data.detail;
      }
      alert('Failed to export purchase register: ' + errorMsg);
    } finally {
      setIsExporting(false);
    }
  };

  const columns = [
    {
      key: 'id',
      label: 'ID',
      render: (val) => <span style={{ color: '#64748b', fontSize: '12px' }}>#{val}</span>
    },
    {
      key: 'date',
      label: 'Bill Date',
      render: (val, row) => {
        const dt = val || row.created_at;
        return formatDate(dt);
      }
    },
    {
      key: 'invoice_number',
      label: 'Invoice # / Bill No.',
      render: (val) => <strong style={{ color: '#0f172a' }}>{val || '-'}</strong>
    },
    {
      key: 'vendor_name',
      label: 'Vendor / Party Name',
      render: (val) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <FiShoppingBag size={14} color="#6366f1" />
          <span style={{ fontWeight: 500, color: '#1e293b' }}>{val || 'General Vendor'}</span>
        </div>
      )
    },
    {
      key: 'warehouse_name',
      label: 'Warehouse',
      render: (val) => val || '-'
    },
    {
      key: 'status',
      label: 'Status',
      render: (val) => {
        const s = (val || '').toUpperCase();
        let bg = '#f1f5f9';
        let color = '#475569';
        if (s === 'RECEIVED' || s === 'COMPLETED') {
          bg = '#dcfce7';
          color = '#15803d';
        } else if (s === 'PENDING' || s === 'DRAFT') {
          bg = '#fef9c3';
          color = '#a16207';
        }
        return (
          <span style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 600,
            backgroundColor: bg,
            color
          }}>
            {val || 'Draft'}
          </span>
        );
      }
    },
    {
      key: 'total_amount',
      label: 'Net Amount (₹)',
      render: (val) => (
        <strong style={{ color: '#059669', fontSize: '13px' }}>
          ₹{Math.round(Number(val || 0)).toLocaleString('en-IN')}
        </strong>
      )
    }
  ];

  return (
    <div style={{ padding: '16px' }}>
      {/* Metric Cards Banner */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        <div style={{ padding: '14px 18px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Total Invoices</div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a', marginTop: '4px' }}>{totalBills}</div>
        </div>
        <div style={{ padding: '14px 18px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Total Purchases (₹)</div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#059669', marginTop: '4px' }}>
            ₹{Math.round(totalAmount).toLocaleString('en-IN')}
          </div>
        </div>
      </div>

      {/* Filter and Export Toolbar */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '12px 16px',
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          <input
            type="text"
            placeholder="Search by Bill #, Vendor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              width: '220px'
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: '#64748b' }}>From:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{
                padding: '5px 8px',
                fontSize: '13px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1'
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: '#64748b' }}>To:</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{
                padding: '5px 8px',
                fontSize: '13px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1'
              }}
            />
          </div>
          {(search || dateFrom || dateTo) && (
            <button
              onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); }}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                color: '#64748b',
                background: '#f1f5f9',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Clear Filters
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              fontSize: '13px',
              color: '#475569',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            <FiRefreshCw size={14} className={isFetching ? 'spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => handleExport('excel')}
            disabled={isExporting}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#ffffff',
              backgroundColor: '#059669',
              border: 'none',
              borderRadius: '6px',
              cursor: isExporting ? 'not-allowed' : 'pointer',
              opacity: isExporting ? 0.7 : 1
            }}
          >
            <FiDownload size={14} />
            {isExporting ? 'Exporting...' : 'Export Excel (16 Cols)'}
          </button>
          <button
            onClick={() => handleExport('csv')}
            disabled={isExporting}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#ffffff',
              backgroundColor: '#2563eb',
              border: 'none',
              borderRadius: '6px',
              cursor: isExporting ? 'not-allowed' : 'pointer',
              opacity: isExporting ? 0.7 : 1
            }}
          >
            <FiFileText size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Main Table */}
      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error?.message}
        emptyMessage="No purchase records found matching your filters."
      />
    </div>
  );
};

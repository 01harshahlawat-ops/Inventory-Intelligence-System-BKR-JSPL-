import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import useCompanyStore from '../../../stores/useCompanyStore';
import { reportsService } from '../../../services/reports';
import { saveDownloadMetadata } from '../../../hooks/useDownloadHistory';
import { DataTable } from '../../../components/DataTable';
import { ReportToolbar } from '../../../components/Reporting/ReportToolbar';
import { formatDate } from '../../../utils/dateUtils';
import { FiDownload, FiFileText, FiRotateCcw, FiEye, FiX } from 'react-icons/fi';

export const SalesReturnReport = () => {
  const { currentCompany, companyId } = useCompanyStore();
  const companyCode = (currentCompany?.code || '').toUpperCase();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState('ALL');
  const [isExporting, setIsExporting] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState(null);
  const limit = 20;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['salesReturnsReport', { page, search, dateFrom, dateTo, status, companyId }],
    queryFn: async () => {
      const params = { page, limit };
      if (search?.trim()) params.search = search.trim();
      if (dateFrom?.trim()) params.date_from = dateFrom.trim();
      if (dateTo?.trim()) params.date_to = dateTo.trim();
      if (status && status !== 'ALL') params.status = status;

      return reportsService.getSalesReturnsReport(params);
    }
  });

  const items = data?.items || data?.data || (Array.isArray(data) ? data : []);
  const total = data?.total_records ?? data?.total ?? items.length;
  const totalPages = data?.total_pages || Math.ceil(total / limit) || 1;
  const summary = data?.summary || {
    total_returns: total,
    total_qty: 0,
    total_taxable: 0,
    total_tax: 0,
    grand_total: 0
  };

  const handleExport = async (format = 'csv') => {
    setIsExporting(true);
    try {
      const response = await reportsService.downloadSalesReturnsReport({
        dateFrom,
        dateTo,
        format
      });

      const blob = new Blob([response.data], {
        type: format === 'excel'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv;charset=utf-8;'
      });
      const filename = `Sales_Returns_${companyCode || 'All'}_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xlsx' : 'csv'}`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);

      saveDownloadMetadata({
        reportType: 'SALES_RETURNS',
        filename,
        rowCount: response.headers['x-row-count'] ? parseInt(response.headers['x-row-count'], 10) : undefined,
        fileFormat: format.toUpperCase(),
        status: 'Completed'
      });
    } catch (err) {
      console.error('Sales Returns export failed:', err);
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
      alert('Failed to export sales returns report: ' + errorMsg);
    } finally {
      setIsExporting(false);
    }
  };

  const columns = [
    {
      key: 'return_date',
      label: 'Return Date',
      render: (val, row) => {
        const dt = val || row.created_at;
        return formatDate(dt);
      }
    },
    {
      key: 'return_number',
      label: 'Return # (Credit Note)',
      render: (val) => <strong style={{ color: '#0f172a' }}>{val || '-'}</strong>
    },
    {
      key: 'bill_number',
      label: 'Original Bill #',
      render: (val) => val ? <span style={{ color: '#2563eb', fontWeight: 600 }}>{val}</span> : <span style={{ color: '#94a3b8' }}>-</span>
    },
    {
      key: 'customer_name',
      label: 'Customer Name',
      render: (val) => val || 'Retail Customer'
    },
    {
      key: 'total_qty',
      label: 'Items (Qty)',
      render: (val, row) => `${row.items_count || 1} items (${val || 1} units)`
    },
    {
      key: 'total_taxable_amount',
      label: 'Taxable (₹)',
      render: (val) => val != null ? `₹${Number(val).toFixed(2)}` : '-'
    },
    {
      key: 'total_tax',
      label: 'GST (₹)',
      render: (val) => val != null ? `₹${Number(val).toFixed(2)}` : '-'
    },
    {
      key: 'grand_total',
      label: 'Grand Total (₹)',
      render: (val) => <strong style={{ color: '#dc2626' }}>₹{Number(val || 0).toFixed(2)}</strong>
    },
    {
      key: 'status',
      label: 'Status',
      render: (val) => {
        const s = (val || 'Completed').toUpperCase();
        let bg = '#f1f5f9';
        let color = '#475569';
        if (s === 'COMPLETED') {
          bg = '#ecfdf5';
          color = '#059669';
        } else if (s === 'DRAFT') {
          bg = '#fffbeb';
          color = '#d97706';
        } else if (s === 'CANCELLED') {
          bg = '#fef2f2';
          color = '#dc2626';
        }
        return (
          <span style={{
            display: 'inline-block',
            padding: '3px 8px',
            borderRadius: '9999px',
            fontSize: '11px',
            fontWeight: 600,
            backgroundColor: bg,
            color: color
          }}>
            {val || 'Completed'}
          </span>
        );
      }
    },
    {
      key: 'actions',
      label: 'Details',
      render: (_, row) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedReturn(row);
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 600,
            color: '#2563eb',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          <FiEye size={12} /> View Items
        </button>
      )
    }
  ];

  return (
    <div>
      {/* Metric Cards Banner */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '12px',
        marginBottom: '16px'
      }}>
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Total Returns</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', marginTop: '4px' }}>
            {summary.total_returns || 0}
          </div>
        </div>
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Units Returned</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#0284c7', marginTop: '4px' }}>
            {summary.total_qty || 0}
          </div>
        </div>
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Taxable Value</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#475569', marginTop: '4px' }}>
            ₹{Number(summary.total_taxable || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>GST Amount</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#d97706', marginTop: '4px' }}>
            ₹{Number(summary.total_tax || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Total Refund Amount</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#dc2626', marginTop: '4px' }}>
            ₹{Number(summary.grand_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      <ReportToolbar
        searchPlaceholder="Search return #, bill #, customer, SKU..."
        searchValue={search}
        onSearchChange={(val) => { setSearch(val); setPage(1); }}
        startDate={dateFrom}
        endDate={dateTo}
        onStartDateChange={(val) => { setDateFrom(val); setPage(1); }}
        onEndDateChange={(val) => { setDateTo(val); setPage(1); }}
        customFilters={[
          {
            label: 'Status',
            value: status,
            onChange: (val) => { setStatus(val); setPage(1); },
            options: [
              { value: 'ALL', label: 'All Statuses' },
              { value: 'Completed', label: 'Completed' },
              { value: 'Draft', label: 'Draft' },
              { value: 'Cancelled', label: 'Cancelled' }
            ]
          }
        ]}
        onRefresh={() => refetch()}
        isRefreshing={isFetching}
        exportEndpoint="/api/business-reports/sales-returns/export"
        exportParams={{ date_from: dateFrom, date_to: dateTo, format: 'csv' }}
        exportFileName={`Sales_Returns_${companyCode || 'Register'}.csv`}
        onPrint={() => window.print()}
      />

      {/* Export Action Strip */}
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: '8px',
        padding: '0 0 12px 0'
      }}>
        <button
          type="button"
          onClick={() => handleExport('csv')}
          disabled={isExporting}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 600,
            borderRadius: '6px',
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
            color: '#334155',
            cursor: isExporting ? 'not-allowed' : 'pointer'
          }}
        >
          <FiDownload size={13} /> {isExporting ? 'Exporting...' : 'Export 47-Col CSV'}
        </button>
        <button
          type="button"
          onClick={() => handleExport('excel')}
          disabled={isExporting}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 600,
            borderRadius: '6px',
            backgroundColor: '#10b981',
            border: 'none',
            color: '#ffffff',
            cursor: isExporting ? 'not-allowed' : 'pointer'
          }}
        >
          <FiFileText size={13} /> {isExporting ? 'Exporting...' : 'Export Excel (.xlsx)'}
        </button>
      </div>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error?.message || 'Failed to load sales returns report'}
        hasActiveFilters={!!(search || dateFrom || dateTo || (status && status !== 'ALL'))}
        pagination={{
          currentPage: page,
          totalPages: totalPages || 1,
          onPageChange: setPage
        }}
        onRowClick={(row) => setSelectedReturn(row)}
      />

      {/* Modal for Line Items */}
      {selectedReturn && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}
          onClick={() => setSelectedReturn(null)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              maxWidth: '750px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '85vh'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                  Return Details: {selectedReturn.return_number}
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                  Original Bill: {selectedReturn.bill_number || 'None'} | Customer: {selectedReturn.customer_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReturn(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '4px'
                }}
              >
                <FiX size={20} />
              </button>
            </div>

            {/* Modal Content - Table of items */}
            <div style={{ padding: '16px 20px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #cbd5e1' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>SKU</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Product Name</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>Qty</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>Rate (₹)</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>Tax</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>Total (₹)</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedReturn.items || []).map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: '#0f172a' }}>{it.sku}</td>
                      <td style={{ padding: '8px 10px', color: '#334155' }}>{it.product_name}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{it.quantity}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>₹{Number(it.unit_price || 0).toFixed(2)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#64748b' }}>{it.tax_rate}%</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>
                        ₹{Number(it.total_price || 0).toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#64748b', fontSize: '12px' }}>{it.reason || 'Customer Return'}</td>
                    </tr>
                  ))}
                  {(!selectedReturn.items || selectedReturn.items.length === 0) && (
                    <tr>
                      <td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
                        No item breakdown available for this return.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px',
              borderTop: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc'
            }}>
              <div style={{ fontSize: '13px', color: '#475569' }}>
                Total Refund: <strong style={{ color: '#dc2626', fontSize: '15px' }}>₹{Number(selectedReturn.grand_total || 0).toFixed(2)}</strong>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReturn(null)}
                style={{
                  padding: '6px 16px',
                  borderRadius: '6px',
                  backgroundColor: '#3b82f6',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

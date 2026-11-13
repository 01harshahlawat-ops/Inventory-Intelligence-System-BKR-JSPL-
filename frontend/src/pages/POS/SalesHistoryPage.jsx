import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posService } from '../../services/pos';
import { einvoiceService } from '../../services/einvoice';
import { handleApiError } from '../../utils/errorHandler';
import { DataTable, TableHeader, TableRow, TablePagination } from '../../components/DataTable';
import Button from '../../components/forms/Button';
import styles from './SalesHistoryPage.module.css';
import { formatDate } from '../../utils/dateUtils';
import useCompanyStore from '../../stores/useCompanyStore';
import { FiEye, FiRefreshCw, FiCheck, FiX, FiClock, FiEdit, FiXCircle, FiDownload, FiUpload } from 'react-icons/fi';

const SalesHistoryPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentCompany = useCompanyStore(state => state.currentCompany);
  const companyCode = currentCompany?.code || 'BKR';
  
  // Filters
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [invoiceType, setInvoiceType] = useState('');
  const [returnStatus, setReturnStatus] = useState('');
  const [tallyStatus, setTallyStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  const [skip, setSkip] = useState(0);
  const limit = 20;

  const [retryingId, setRetryingId] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [generatingIrnId, setGeneratingIrnId] = useState(null);
  const [exportingBulkJson, setExportingBulkJson] = useState(false);
  const [importingResponse, setImportingResponse] = useState(false);
  const fileInputRef = React.useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sales', currentCompany?.id, skip, limit, search, status, invoiceType, returnStatus, tallyStatus, startDate, endDate],
    queryFn: () => posService.getSalesHistory({
      skip, limit,
      company_id: currentCompany?.id,
      search: search || undefined,
      status: status || undefined,
      invoice_type: invoiceType || undefined,
      return_status: returnStatus || undefined,
      tally_status: tallyStatus || undefined,
      date_from: startDate || undefined,
      date_to: endDate || undefined,
    }),
  });

  const sales = data?.items || [];
  const total = data?.total || 0;
  const summary = data?.summary || {
    total_sales_amount: 0,
    total_invoices_count: 0,
    total_sold_units: 0,
    total_returned_units: 0
  };

  const retryTallyMutation = useMutation({
    mutationFn: posService.retryTallySync,
    onMutate: (saleId) => setRetryingId(saleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
    onError: (err) => {
      handleApiError(err, "Failed to retry Tally sync");
    },
    onSettled: () => setRetryingId(null)
  });

  const handleRetryTally = (saleId) => {
    retryTallyMutation.mutate(saleId);
  };

  const renderTallyStatus = (sale) => {
    if (sale.invoice_type !== 'B2B') return <span className={styles.tallyBadgeNA}>N/A</span>;
    
    switch (sale.tally_sync_status) {
      case 'SUCCESS':
        return <span className={`${styles.tallyBadge} ${styles.tallySuccess}`} title={sale.tally_reference}><FiCheck /> Success</span>;
      case 'FAILED':
        return <span className={`${styles.tallyBadge} ${styles.tallyFailed}`} title={sale.tally_error_message}><FiX /> Failed</span>;
      case 'PENDING':
        return <span className={`${styles.tallyBadge} ${styles.tallyPending}`}><FiClock /> Pending</span>;
      default:
        return <span className={styles.tallyBadgeNA}>{sale.tally_sync_status}</span>;
    }
  };

  const renderEInvoiceStatus = (sale) => {
    if (sale.invoice_type !== 'B2B') return <span className={styles.tallyBadgeNA}>N/A (B2C)</span>;

    const status = sale.einvoice_status || 'NOT_GENERATED';
    if (status === 'GENERATED') {
      return (
        <span 
          className={`${styles.einvoiceBadge} ${styles.einvoiceGenerated}`} 
          title={`IRN: ${sale.einvoice_irn || ''}\nAck No: ${sale.einvoice_ack_no || ''}`}
        >
          <FiCheck /> IRN Active
        </span>
      );
    }
    if (status === 'CANCELLED') {
      return (
        <span className={`${styles.einvoiceBadge} ${styles.einvoiceCancelled}`} title="Cancelled on IRP">
          <FiX /> Cancelled
        </span>
      );
    }
    if (status === 'FAILED') {
      return (
        <span className={`${styles.einvoiceBadge} ${styles.einvoiceFailed}`} title={sale.einvoice_error_message || 'Failed'}>
          <FiX /> Failed
        </span>
      );
    }
    return <span className={styles.einvoiceNotGenerated}>Not Generated</span>;
  };

  const handleGenerateEInvoice = async (sale) => {
    const isRetry = sale.einvoice_status === 'FAILED';
    try {
      setGeneratingIrnId(sale.id);
      const res = await einvoiceService.generateIRN(sale.id, isRetry);
      const irnText = res?.irn ? (String(res.irn).length > 16 ? `${String(res.irn).substring(0, 16)}...` : String(res.irn)) : 'Generated';
      alert(`E-Invoice IRN Generated Successfully!\nIRN: ${irnText}\nAck No: ${res?.ack_no || '-'}`);
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    } catch (err) {
      handleApiError(err, 'Failed to generate E-Invoice IRN');
    } finally {
      setGeneratingIrnId(null);
    }
  };

  const handleDownloadSingleJson = async (sale) => {
    try {
      const response = await einvoiceService.downloadSingleJson(sale.id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      const invNo = (sale.invoice_number || sale.bill_number || `Bill_${sale.id}`).replace(/[\/\\]/g, '_');
      link.setAttribute('download', `EInvoice_${invNo}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      handleApiError(err, 'Failed to download E-Invoice JSON');
    }
  };

  const handleDownloadBulkJson = async () => {
    try {
      setExportingBulkJson(true);
      const response = await einvoiceService.downloadBulkJson({
        date_from: startDate || undefined,
        date_to: endDate || undefined
      });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `EInvoice_Bulk_Upload_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      handleApiError(err, 'Failed to export Bulk E-Invoice JSON');
    } finally {
      setExportingBulkJson(false);
    }
  };

  const handleFileImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImportingResponse(true);
      const res = await einvoiceService.importResponse(file);
      alert(res.message || 'Government E-Invoice response imported successfully!');
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    } catch (err) {
      handleApiError(err, 'Failed to import Government E-Invoice response');
    } finally {
      setImportingResponse(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const renderReturnStatus = (status) => {
    if (status === 'Fully Returned') {
      return <span className={`${styles.returnBadge} ${styles.returnFull}`}>Fully Returned</span>;
    }
    if (status === 'Partially Returned') {
      return <span className={`${styles.returnBadge} ${styles.returnPartial}`}>Partially Returned</span>;
    }
    return <span className={`${styles.returnBadge} ${styles.returnNone}`}>None</span>;
  };

  const handleCancelSale = async (sale) => {
    const billRef = sale.invoice_number || sale.bill_number;
    if (!window.confirm(`Are you sure you want to cancel bill ${billRef}? This will permanently void the sale and revert stock back to inventory.`)) {
      return;
    }
    setCancellingId(sale.id);
    try {
      await posService.cancelSale(sale.id);
      alert(`Sale ${billRef} cancelled successfully and inventory restored.`);
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
    } catch (err) {
      handleApiError(err, `Failed to cancel sale ${billRef}`);
    } finally {
      setCancellingId(null);
    }
  };

  const columns = [
    { key: 'sale_date', label: 'Date', render: (val) => formatDate(val) },
    { 
      key: 'bill_number', 
      label: 'Bill / Invoice No.', 
      render: (_, sale) => (
        <>
          <div className={styles.billNumber}>{sale.bill_number}</div>
          {sale.invoice_number && <div className={styles.invoiceNumber}>{sale.invoice_number}</div>}
          {sale.status === 'Cancelled' && (
            <span style={{ display: 'inline-block', fontSize: '11px', fontWeight: 'bold', color: '#dc2626', background: '#fee2e2', padding: '1px 6px', borderRadius: '4px', marginTop: '2px' }}>
              Cancelled
            </span>
          )}
        </>
      )
    },
    { key: 'invoice_type', label: 'Type', render: (val) => <span className={styles.typeBadge}>{val || 'B2C'}</span> },
    {
      key: 'customer',
      label: 'Customer',
      render: (_, sale) => (
        <>
          <div className={styles.customerName}>{sale.customer_name || 'Walk-in'}</div>
          {sale.customer_gstin && <div className={styles.customerGstin}>{sale.customer_gstin}</div>}
        </>
      )
    },
    { key: 'grand_total', label: 'Total (₹)', render: (val) => <span style={{fontWeight: '600'}}>₹{Math.round(val || 0)}</span> },
    {
      key: 'quantities',
      label: 'Sold/Ret/Net Qty',
      render: (_, sale) => (
        <div style={{ fontSize: '13px' }}>
          <span title="Total Sold">{sale.total_sold || 0}</span> / <span title="Total Returned" style={{ color: sale.returned_quantity > 0 ? '#c2410c' : 'inherit' }}>{sale.returned_quantity || 0}</span> / <span title="Net Quantity" style={{ fontWeight: 'bold' }}>{sale.remaining_quantity || 0}</span>
        </div>
      )
    },
    { key: 'return_status', label: 'Return Status', render: (val) => renderReturnStatus(val) },
    { key: 'tally_sync_status', label: 'Tally Sync', render: (_, sale) => renderTallyStatus(sale) },
    { key: 'einvoice_status', label: 'E-Invoice', render: (_, sale) => renderEInvoiceStatus(sale) },
    {
      key: 'actions',
      label: 'Actions',
      render: (_, sale) => (
        <div className={styles.actionsCell}>
          <button 
            className={styles.actionBtn} 
            title="View Invoice"
            onClick={() => navigate(`/sales/${sale.id}/invoice`)}
          >
            <FiEye /> View
          </button>
          {sale.status !== 'Cancelled' && (!sale.linked_sales_return_ids || sale.linked_sales_return_ids.length === 0) && (
            <button 
              className={styles.actionBtn} 
              title="Edit Invoice"
              onClick={() => navigate(`/sales/${sale.id}/edit`)}
            >
              <FiEdit /> Edit
            </button>
          )}
          {sale.status !== 'Cancelled' && (!sale.linked_sales_return_ids || sale.linked_sales_return_ids.length === 0) && (
            <button 
              className={styles.actionBtn} 
              style={{ color: '#dc2626', borderColor: '#fca5a5' }}
              title="Cancel Bill"
              onClick={() => handleCancelSale(sale)}
              disabled={cancellingId === sale.id}
            >
              <FiXCircle className={cancellingId === sale.id ? styles.spinning : ''} />
              {cancellingId === sale.id ? ' Cancelling...' : ' Cancel'}
            </button>
          )}
          {sale.linked_sales_return_ids?.length > 0 && (
            <button 
              className={styles.actionBtn} 
              title="View Returns"
              onClick={() => navigate(`/sales-returns/${sale.linked_sales_return_ids[0]}`)}
            >
              <FiRefreshCw /> Returns
            </button>
          )}
          {sale.invoice_type === 'B2B' && (sale.tally_sync_status === 'FAILED' || sale.tally_sync_status === 'PENDING') && (
            <button 
              className={`${styles.actionBtn} ${styles.retryBtn}`} 
              title="Retry Tally Sync"
              onClick={() => handleRetryTally(sale.id)}
              disabled={retryingId === sale.id}
            >
              <FiRefreshCw className={retryingId === sale.id ? styles.spinning : ''} /> Retry
            </button>
          )}
          {sale.invoice_type === 'B2B' && sale.status !== 'Cancelled' && sale.einvoice_status !== 'GENERATED' && (
            <button 
              className={`${styles.actionBtn} ${styles.retryBtn}`} 
              title={sale.einvoice_status === 'FAILED' ? "Retry E-Invoice IRN" : "Generate E-Invoice IRN & QR"}
              onClick={() => handleGenerateEInvoice(sale)}
              disabled={generatingIrnId === sale.id}
            >
              <FiRefreshCw className={generatingIrnId === sale.id ? styles.spinning : ''} />
              {generatingIrnId === sale.id ? ' Generating...' : (sale.einvoice_status === 'FAILED' ? ' Retry IRN' : ' Gen IRN')}
            </button>
          )}
          {sale.invoice_type === 'B2B' && sale.status !== 'Cancelled' && (
            <button 
              className={`${styles.actionBtn} ${styles.jsonBtn}`} 
              title="Download Government E-Invoice JSON (INV-01)"
              onClick={() => handleDownloadSingleJson(sale)}
            >
              <FiDownload /> JSON
            </button>
          )}
        </div>
      )
    }
  ];

  return (
    <div className={styles.historyContainer}>
      <div className={styles.header}>
        <div>
          <h1 style={{ margin: 0 }}>Sales History</h1>
          <span style={{ fontSize: '13px', color: '#64748b' }}>
            Company: <strong>{companyCode}</strong> ({currentCompany?.name || companyCode})
          </span>
        </div>
      </div>

      {/* KPI Cards: Total Sale View in Round Off */}
      <div className={styles.kpiGrid}>
        <div className={`${styles.kpiCard} ${styles.kpiCardSales}`}>
          <span className={styles.kpiLabel}>Total Sales ({companyCode})</span>
          <span className={styles.kpiValue}>
            ₹{Math.round(summary.total_sales_amount || 0).toLocaleString('en-IN')}
          </span>
          <span className={styles.kpiSub}>Total Non-Cancelled Sales (Round Off)</span>
        </div>

        <div className={`${styles.kpiCard} ${styles.kpiCardInvoices}`}>
          <span className={styles.kpiLabel}>Total Invoices</span>
          <span className={styles.kpiValue}>
            {summary.total_invoices_count || total}
          </span>
          <span className={styles.kpiSub}>Matching Current Filters</span>
        </div>

        <div className={`${styles.kpiCard} ${styles.kpiCardSold}`}>
          <span className={styles.kpiLabel}>Units Sold</span>
          <span className={styles.kpiValue}>
            {summary.total_sold_units || 0}
          </span>
          <span className={styles.kpiSub}>Gross Items Sold</span>
        </div>

        <div className={`${styles.kpiCard} ${styles.kpiCardReturned}`}>
          <span className={styles.kpiLabel}>Units Returned</span>
          <span className={styles.kpiValue} style={{ color: summary.total_returned_units > 0 ? '#c2410c' : 'inherit' }}>
            {summary.total_returned_units || 0}
          </span>
          <span className={styles.kpiSub}>Customer Sales Returns</span>
        </div>
      </div>

      <div className={styles.filtersWrapper}>
        <div className={styles.filtersRow}>
          <input 
            className={styles.searchInput}
            placeholder="Search Bill No, Invoice No, or Customer..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSkip(0);
            }}
            autoFocus
          />
          <div className={styles.dateFilters}>
            <input 
              type="date"
              className={styles.dateInput}
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setSkip(0); }}
              title="Start Date"
            />
            <span className={styles.dateSeparator}>to</span>
            <input 
              type="date"
              className={styles.dateInput}
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setSkip(0); }}
              title="End Date"
            />
          </div>
        </div>
        <div className={styles.filtersRow}>
          <select 
            className={styles.filterSelect}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setSkip(0);
            }}
          >
            <option value="">All Sale Statuses</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
          <select 
            className={styles.filterSelect}
            value={invoiceType}
            onChange={(e) => {
              setInvoiceType(e.target.value);
              setSkip(0);
            }}
          >
            <option value="">All Invoice Types</option>
            <option value="B2C">B2C</option>
            <option value="B2B">B2B</option>
          </select>
          <select 
            className={styles.filterSelect}
            value={returnStatus}
            onChange={(e) => {
              setReturnStatus(e.target.value);
              setSkip(0);
            }}
          >
            <option value="">All Return Statuses</option>
            <option value="Active Sales">Active Sales</option>
            <option value="None">None</option>
            <option value="Partially Returned">Partially Returned</option>
            <option value="Fully Returned">Fully Returned</option>
          </select>
          <select 
            className={styles.filterSelect}
            value={tallyStatus}
            onChange={(e) => {
              setTallyStatus(e.target.value);
              setSkip(0);
            }}
          >
            <option value="">All Tally Statuses</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILED">Failed</option>
            <option value="PENDING">Pending</option>
            <option value="NOT_APPLICABLE">Not Applicable</option>
          </select>
          
          <button className={styles.clearBtn} onClick={() => {
            setSearch(''); setStatus(''); setInvoiceType(''); setReturnStatus(''); setTallyStatus(''); setStartDate(''); setEndDate(''); setSkip(0);
          }}>Clear Filters</button>

          <button 
            className={styles.bulkExportBtn} 
            onClick={handleDownloadBulkJson}
            disabled={exportingBulkJson}
            title="Download Government-compliant Bulk JSON (INV-01) for einvoice1.gst.gov.in"
          >
            <FiDownload /> {exportingBulkJson ? 'Exporting JSON...' : 'Export E-Invoice JSON'}
          </button>

          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            accept=".json"
            onChange={handleFileImport}
          />

          <button 
            className={styles.importBtn} 
            onClick={() => fileInputRef.current?.click()}
            disabled={importingResponse}
            title="Upload official Government response JSON downloaded from portal"
          >
            <FiUpload /> {importingResponse ? 'Importing...' : 'Import Govt Response'}
          </button>
        </div>
      </div>

      <div className={styles.tableContainer}>
        <DataTable>
          <TableHeader columns={columns} />
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} style={{textAlign: 'center', padding: '2rem'}}>Loading...</td>
              </tr>
            ) : sales.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{textAlign: 'center', padding: '2rem'}}>No sales found matching your filters.</td>
              </tr>
            ) : (
              sales.map((sale) => (
                <TableRow key={sale.id} row={sale} columns={columns} />
              ))
            )}
          </tbody>
        </DataTable>
        
        {total > limit && (
          <TablePagination 
            currentPage={Math.floor(skip / limit) + 1} 
            totalPages={Math.ceil(total / limit)} 
            onPageChange={(p) => setSkip((p - 1) * limit)} 
          />
        )}
      </div>
    </div>
  );
};

export default SalesHistoryPage;

import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import useCompanyStore from '../../../stores/useCompanyStore';
import { reportsService } from '../../../services/reports';
import { saveDownloadMetadata } from '../../../hooks/useDownloadHistory';
import { DataTable } from '../../../components/DataTable';
import { ReportToolbar } from '../../../components/Reporting/ReportToolbar';
import { formatDate } from '../../../utils/dateUtils';
import { FiDownload, FiFileText, FiShoppingBag } from 'react-icons/fi';

export const SalesReport = () => {
  const navigate = useNavigate();
  const { currentCompany, companyId } = useCompanyStore();
  const companyCode = (currentCompany?.code || '').toUpperCase();
  const isBkr = companyCode === 'BKR' || companyId === 2;
  const isJspl = companyCode === 'JSPL' || companyId === 3;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedSeries, setSelectedSeries] = useState('GST');
  const [isExporting, setIsExporting] = useState(false);
  const limit = 20;

  const { data: detectedSeriesData } = useQuery({
    queryKey: ['seriesList', companyId],
    queryFn: () => reportsService.getSeriesList(),
    staleTime: 60000
  });

  const seriesOptions = useMemo(() => {
    const list = detectedSeriesData?.data || (Array.isArray(detectedSeriesData) ? detectedSeriesData : []);
    if (list.length > 0) {
      return list.map(item => ({
        value: item.id || item.value,
        label: item.label || item.name || item.id
      }));
    }
    if (isJspl) {
      return [
        { value: 'GST', label: 'GST Series (GST-)' },
        { value: 'JGST', label: 'JSPL Series (JGST-)' },
        { value: 'IN', label: 'IN Series (JSPL IN / MFN)' },
        { value: 'VSHB', label: 'VSHB Series (JSPL Central / VSHB)' },
        { value: 'KWZ2', label: 'KWZ2 Series (JSPL KWZ2 FC)' },
        { value: 'BLR4', label: 'BLR4 Series (JSPL BLR4 FC)' },
        { value: 'BLR8', label: 'BLR8 Series (JSPL BLR8 FC)' },
        { value: 'BOM5', label: 'BOM5 Series (JSPL BOM5 FC)' },
        { value: 'PNQ3', label: 'PNQ3 Series (JSPL PNQ3 FC)' },
        { value: 'LKO1', label: 'LKO1 Series (JSPL LKO1 FC)' },
        { value: 'AMD2', label: 'AMD2 Series (JSPL AMD2 FC)' },
        { value: 'SERVICE', label: 'Service Series (SERVICE-)' },
        { value: 'ALL', label: 'All Series (GST, JGST, SERVICE)' },
        { value: 'AMAZON', label: 'Amazon All (AFN & MFN)' },
        { value: 'MFN', label: 'Amazon MFN (Merchant Orders)' },
        { value: 'AFN', label: 'Amazon AFN (FBA Orders)' }
      ];
    }
    if (isBkr) {
      return [
        { value: 'GST', label: 'GST Series (GST- / BKR-GST-)' },
        { value: 'JGST', label: 'BKR Series (JGST-)' },
        { value: 'BKR', label: 'BKR Retail Series (BKR-)' },
        { value: 'KARNATAKA', label: 'Karnataka Series' },
        { value: 'BKR_CENTRAL', label: 'Central Series' },
        { value: 'ALL', label: 'All Series (GST & JGST Combined)' },
        { value: 'AMAZON', label: 'Amazon All (AFN & MFN)' },
        { value: 'MFN', label: 'Amazon MFN (Merchant Orders)' },
        { value: 'AFN', label: 'Amazon AFN (FBA Orders)' }
      ];
    }
    return [
      { value: 'GST', label: 'GST Series (GST-)' },
      { value: 'JGST', label: 'JGST Series (JGST-)' },
      { value: 'AMAZON', label: 'Amazon All (AFN & MFN)' },
      { value: 'MFN', label: 'Amazon MFN (Merchant Orders)' },
      { value: 'AFN', label: 'Amazon AFN (FBA Orders)' },
      { value: 'ALL', label: 'All Series (Excl. Amazon)' }
    ];
  }, [detectedSeriesData, isJspl, isBkr]);

  const isAmazonOrWarehouseSeries = useMemo(() => {
    const s = (selectedSeries || '').toUpperCase();
    if (!s) return false;
    if (['GST', 'JGST', 'BKR', 'SERVICE', 'SERV', 'ALL'].includes(s)) return false;
    return true;
  }, [selectedSeries]);

  useEffect(() => {
    if (isJspl && selectedSeries === 'BKR') {
      setSelectedSeries('GST');
    } else if (isBkr && selectedSeries === 'SERVICE') {
      setSelectedSeries('GST');
    }
  }, [isJspl, isBkr, selectedSeries]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['salesReport', { page, search, dateFrom, dateTo, selectedSeries, companyId }],
    queryFn: async () => {
      const params = { page, limit };
      if (search?.trim()) params.search = search.trim();
      if (dateFrom?.trim()) params.date_from = dateFrom.trim();
      if (dateTo?.trim()) params.date_to = dateTo.trim();
      if (selectedSeries) params.series = selectedSeries;
      
      return reportsService.getSalesReport(params);
    }
  });

  const handleExportAccountantReport = async (format) => {
    setIsExporting(true);
    try {
      const response = await reportsService.downloadSeriesReport({
        series: selectedSeries,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        format
      });

      const contentDisposition = response.headers['content-disposition'] || '';
      let filename = `Accountant_Sales_${selectedSeries}_${format === 'excel' ? 'xlsx' : 'csv'}`;
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }

      const blob = new Blob([response.data], {
        type: format === 'excel'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv;charset=utf-8;'
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);

      saveDownloadMetadata({
        reportType: `ACCOUNTANT_SALES_${selectedSeries}`,
        filename,
        rowCount: response.headers['x-row-count'] ? parseInt(response.headers['x-row-count']) : undefined,
        fileFormat: format.toUpperCase(),
        status: 'Completed'
      });
    } catch (err) {
      console.error('Accountant report export failed:', err);
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
      alert('Failed to export report: ' + errorMsg);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportAmazonMtrReport = async (format = 'excel') => {
    setIsExporting(true);
    try {
      const response = await reportsService.downloadAmazonMtrReport({
        warehouseCode: selectedSeries,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        format
      });

      const contentDisposition = response.headers['content-disposition'] || '';
      let filename = `Amazon_MTR_${selectedSeries}_${format === 'excel' ? 'xlsx' : 'csv'}`;
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }

      const blob = new Blob([response.data], {
        type: format === 'excel'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv;charset=utf-8;'
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);

      saveDownloadMetadata({
        reportType: `AMAZON_MTR_${selectedSeries}`,
        filename,
        rowCount: response.headers['x-row-count'] ? parseInt(response.headers['x-row-count']) : undefined,
        fileFormat: format.toUpperCase(),
        status: 'Completed'
      });
    } catch (err) {
      console.error('Amazon MTR export failed:', err);
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
      alert('Failed to export Amazon MTR report: ' + errorMsg);
    } finally {
      setIsExporting(false);
    }
  };

  // Handle backend formats flexibly
  const items = data?.items || data?.data || (Array.isArray(data) ? data : []);
  const total = data?.total_records ?? data?.total ?? items.length;
  const totalPages = data?.total_pages || Math.ceil(total / limit) || 1;

  const columns = [
    { key: 'period', label: 'Period / Date', render: (val) => formatDate(val, val || '-') },
    { key: 'total_orders', label: 'Total Orders' },
    { key: 'total_items_sold', label: 'Items Sold', render: (val) => val != null ? Math.round(Number(val || 0)) : '-' },
    { key: 'total_taxable_amount', label: 'Taxable Amount', render: (val) => val != null ? `₹${Math.round(Number(val || 0))}` : '-' },
    { key: 'total_tax', label: 'Total GST', render: (val) => val != null ? `₹${Math.round(Number(val || 0))}` : '-' },
    { key: 'total_revenue', label: 'Total Revenue', render: (val) => `₹${Math.round(Number(val || 0))}` }
  ];

  return (
    <div>
      <ReportToolbar 
        searchPlaceholder="Search invoices..."
        searchValue={search}
        onSearchChange={(val) => { setSearch(val); setPage(1); }}
        startDate={dateFrom}
        endDate={dateTo}
        onStartDateChange={(val) => { setDateFrom(val); setPage(1); }}
        onEndDateChange={(val) => { setDateTo(val); setPage(1); }}
        customFilters={[
          {
            label: 'Series',
            value: selectedSeries,
            onChange: (val) => { setSelectedSeries(val); setPage(1); },
            options: seriesOptions
          }
        ]}
        onRefresh={() => refetch()}
        isRefreshing={isFetching}
        exportEndpoint="/api/reports/series-wise/export"
        exportParams={{ series: selectedSeries, format: 'csv' }}
        exportFileName={`Accountant_Sales_${selectedSeries}.csv`}
        onPrint={() => window.print()}
      />

      {/* Quick Series Navigation Pills */}
      <div style={{ display: 'flex', gap: '8px', padding: '0 16px 10px 16px', overflowX: 'auto', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' }}>Quick Select:</span>
        {(isJspl ? [
          { id: 'GST', label: 'GST' },
          { id: 'JGST', label: 'JSPL (JGST)' },
          { id: 'IN', label: 'IN (MFN)' },
          { id: 'VSHB', label: 'VSHB (Central)' },
          { id: 'KWZ2', label: 'KWZ2' },
          { id: 'BLR4', label: 'BLR4' },
          { id: 'BLR8', label: 'BLR8' },
          { id: 'AMAZON', label: 'Amazon All' },
          { id: 'MFN', label: 'MFN' },
          { id: 'AFN', label: 'AFN' },
          { id: 'SERVICE', label: 'Service' },
          { id: 'ALL', label: 'All Series' }
        ] : isBkr ? [
          { id: 'GST', label: 'GST Series' },
          { id: 'JGST', label: 'BKR (JGST)' },
          { id: 'BKR', label: 'BKR Retail' },
          { id: 'KARNATAKA', label: 'Karnataka' },
          { id: 'BKR_CENTRAL', label: 'Central' },
          { id: 'AMAZON', label: 'Amazon All' },
          { id: 'MFN', label: 'MFN' },
          { id: 'AFN', label: 'AFN' },
          { id: 'ALL', label: 'All Series' }
        ] : [
          { id: 'GST', label: 'GST Series' },
          { id: 'JGST', label: 'JGST Series' },
          { id: 'AMAZON', label: 'Amazon All' },
          { id: 'MFN', label: 'MFN' },
          { id: 'AFN', label: 'AFN' },
          { id: 'ALL', label: 'All Series' }
        ]).map((pill) => (
          <button
            key={pill.id}
            type="button"
            onClick={() => { setSelectedSeries(pill.id); setPage(1); }}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              fontWeight: selectedSeries === pill.id ? 600 : 500,
              borderRadius: '16px',
              border: selectedSeries === pill.id ? '1px solid #2563eb' : '1px solid #cbd5e1',
              backgroundColor: selectedSeries === pill.id ? '#eff6ff' : '#ffffff',
              color: selectedSeries === pill.id ? '#1d4ed8' : '#475569',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              boxShadow: selectedSeries === pill.id ? '0 1px 2px rgba(37, 99, 235, 0.1)' : 'none',
              transition: 'all 0.15s'
            }}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* Series Accountant Report Download Banner */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', margin: '12px 16px', padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FiFileText style={{ color: '#2563eb', fontSize: '18px' }} />
          <div>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
              Accountant 47-Column Report ({selectedSeries} Series)
            </span>
            <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>
              Matches government return & accounting format with itemized taxes and bill subtotals.
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => handleExportAccountantReport('csv')}
            disabled={isExporting}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 14px', background: '#059669', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: isExporting ? 0.7 : 1 }}
          >
            <FiDownload /> {isExporting ? 'Exporting...' : 'Download CSV'}
          </button>
          <button
            type="button"
            onClick={() => handleExportAccountantReport('excel')}
            disabled={isExporting}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: isExporting ? 0.7 : 1 }}
          >
            <FiFileText /> {isExporting ? 'Exporting...' : 'Download Excel (.xlsx)'}
          </button>
        </div>
      </div>

      {/* Amazon MTR 86-Column Report Banner when viewing Amazon or Warehouse series */}
      {isAmazonOrWarehouseSeries && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', margin: '-4px 16px 12px 16px', padding: '10px 14px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiShoppingBag style={{ color: '#16a34a', fontSize: '18px' }} />
            <div>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#14532d' }}>
                Amazon Merchant Tax Report (86-Column Logic ERP Format - {selectedSeries})
              </span>
              <span style={{ display: 'block', fontSize: '11px', color: '#15803d' }}>
                Matches official Amazon MTR format with 86 itemized tax, state hub, and account code columns.
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => handleExportAmazonMtrReport('csv')}
              disabled={isExporting}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 14px', background: '#334155', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: isExporting ? 0.7 : 1 }}
            >
              <FiDownload /> {isExporting ? 'Exporting...' : 'Download MTR CSV'}
            </button>
            <button
              type="button"
              onClick={() => handleExportAmazonMtrReport('excel')}
              disabled={isExporting}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: isExporting ? 0.7 : 1 }}
            >
              <FiFileText /> {isExporting ? 'Exporting...' : 'Download MTR Excel (.xlsx)'}
            </button>
          </div>
        </div>
      )}

      <DataTable 
        columns={columns}
        data={items}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error?.message || "Failed to load sales report"}
        hasActiveFilters={!!(search || dateFrom || dateTo)}
        pagination={{
          currentPage: page,
          totalPages: totalPages || 1,
          onPageChange: setPage
        }}
        onRowClick={(row) => {
          if (row.id) navigate(`/sales/${row.id}/invoice`);
        }}
      />
    </div>
  );
};

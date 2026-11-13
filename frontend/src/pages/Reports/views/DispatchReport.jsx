import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { reportsService } from '../../../services/reports';
import { DataTable } from '../../../components/DataTable';
import { ReportToolbar } from '../../../components/Reporting/ReportToolbar';
import { formatDate } from '../../../utils/dateUtils';

export const DispatchReport = () => {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const limit = 20;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['dispatchReport', { page, search, dateFrom, dateTo }],
    queryFn: async () => {
      const params = { page, limit };
      if (search?.trim()) params.search = search.trim();
      if (dateFrom?.trim()) params.date_from = dateFrom.trim();
      if (dateTo?.trim()) params.date_to = dateTo.trim();
      
      return reportsService.getDispatchReport(params);
    }
  });

  const items = data?.items || data?.data || (Array.isArray(data) ? data : []);
  const total = data?.total_records ?? data?.total ?? items.length;
  const totalPages = data?.total_pages || Math.ceil(total / limit) || 1;

  const columns = [
    { key: 'created_at', label: 'Date', render: (val) => formatDate(val) },
    { key: 'dispatch_number', label: 'Dispatch No.' },
    { key: 'warehouse_name', label: 'Origin Warehouse' },
    { key: 'dispatch_status', label: 'Status' },
    { key: 'total_items', label: 'Total Items' }
  ];

  return (
    <div>
      <ReportToolbar 
        searchPlaceholder="Search dispatches..."
        searchValue={search}
        onSearchChange={(val) => { setSearch(val); setPage(1); }}
        startDate={dateFrom}
        endDate={dateTo}
        onStartDateChange={(val) => { setDateFrom(val); setPage(1); }}
        onEndDateChange={(val) => { setDateTo(val); setPage(1); }}
        onRefresh={() => refetch()}
        isRefreshing={isFetching}
        exportEndpoint="/api/business-reports/dispatches/export"
        exportFileName="dispatch_report.csv"
        onPrint={() => window.print()}
      />
      <DataTable 
        columns={columns}
        data={items}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error?.message || "Failed to load dispatch report"}
        hasActiveFilters={!!(search || dateFrom || dateTo)}
        pagination={{
          currentPage: page,
          totalPages: totalPages || 1,
          onPageChange: setPage
        }}
        onRowClick={(row) => {
          if (row.id) navigate(`/logistics/dispatches/${row.id}`);
        }}
      />
    </div>
  );
};

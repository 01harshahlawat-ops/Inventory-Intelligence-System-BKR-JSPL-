import api from './api';
import { API_ROUTES } from '../constants/apiRoutes';
import { normalizeResponse } from '../utils/normalizeResponse';

export const reportsService = {
  generateLowStock: async (format = 'excel') => {
    const response = await api.post(`${API_ROUTES.REPORTS.LOW_STOCK}?format=${format}`);
    return normalizeResponse(response.data);
  },
  generateNegativeStock: async (format = 'excel') => {
    const response = await api.post(`${API_ROUTES.REPORTS.NEGATIVE_STOCK}?format=${format}`);
    return normalizeResponse(response.data);
  },
  generateReplenishment: async (format = 'excel') => {
    const response = await api.post(`${API_ROUTES.REPORTS.REPLENISHMENT}?format=${format}`);
    return normalizeResponse(response.data);
  },
  getHistory: async (reportType) => {
    const params = reportType ? { report_type: reportType } : {};
    const response = await api.get(API_ROUTES.REPORTS.HISTORY, { params });
    return normalizeResponse(response.data);
  },
  getInventoryReport: async (params) => {
    const response = await api.get('/api/business-reports/inventory', { params });
    return normalizeResponse(response.data);
  },
  getAmazonReturns: async () => {
    const response = await api.get('/api/reports/returns/amazon-returns');
    return normalizeResponse(response.data);
  },
  getDefectiveInventory: async () => {
    const response = await api.get('/api/reports/returns/defective-inventory');
    return normalizeResponse(response.data);
  },
  getSalesReport: async (params) => {
    const response = await api.get('/api/business-reports/sales', { params });
    return normalizeResponse(response.data);
  },
  getDispatchReport: async (params) => {
    const response = await api.get('/api/business-reports/dispatches', { params });
    return normalizeResponse(response.data);
  },
  getFCReturnsReport: async (params) => {
    const response = await api.get('/api/business-reports/returns', { params });
    return normalizeResponse(response.data);
  },
  getDefectiveReport: async (params) => {
    const response = await api.get('/api/business-reports/defective', { params });
    return normalizeResponse(response.data);
  },
  getReturnsMetrics: async () => {
    const response = await api.get('/api/reports/returns/metrics');
    return normalizeResponse(response.data);
  },
  downloadReport: (endpoint) => {
    window.open(endpoint, '_blank');
  },
  getSeriesList: async () => {
    const response = await api.get('/api/reports/series-wise/list');
    return normalizeResponse(response.data);
  },
  downloadSeriesReport: async ({ reportType = 'sales', series = 'GST', vendorId, dateFrom, dateTo, format = 'csv' }) => {
    const params = {
      report_type: reportType,
      series,
      format,
      ...(vendorId ? { vendor_id: vendorId } : {}),
      ...(dateFrom ? { date_from: dateFrom } : {}),
      ...(dateTo ? { date_to: dateTo } : {})
    };
    const response = await api.get('/api/reports/series-wise/export', {
      params,
      responseType: 'blob'
    });
    return response;
  },
  downloadAmazonMtrReport: async ({ warehouseCode, dateFrom, dateTo, format = 'excel' }) => {
    const params = {
      ...(warehouseCode ? { warehouse_code: warehouseCode } : {}),
      ...(dateFrom ? { date_from: dateFrom } : {}),
      ...(dateTo ? { date_to: dateTo } : {}),
      format
    };
    const response = await api.get('/api/reports/amazon-mtr/export', {
      params,
      responseType: 'blob'
    });
    return response;
  },
  getSalesReturnsReport: async (params) => {
    const response = await api.get('/api/business-reports/sales-returns', { params });
    return normalizeResponse(response.data);
  },
  downloadSalesReturnsReport: async ({ dateFrom, dateTo, format = 'csv' }) => {
    const params = {
      ...(dateFrom ? { date_from: dateFrom } : {}),
      ...(dateTo ? { date_to: dateTo } : {}),
      format
    };
    const response = await api.get('/api/business-reports/sales-returns/export', {
      params,
      responseType: 'blob'
    });
    return response;
  },
  getAmazonMtrWarehouses: async () => {
    const response = await api.get('/api/reports/amazon-mtr/warehouses');
    return normalizeResponse(response.data);
  },
  uploadAmazonMtrReport: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/api/reports/amazon-mtr/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return normalizeResponse(response.data);
  },
  downloadPurchasesReport: async ({ vendorId, dateFrom, dateTo, format = 'excel' }) => {
    const params = {
      ...(vendorId ? { vendor_id: vendorId } : {}),
      ...(dateFrom ? { date_from: dateFrom } : {}),
      ...(dateTo ? { date_to: dateTo } : {}),
      format
    };
    const response = await api.get('/api/reports/purchases/export', {
      params,
      responseType: 'blob'
    });
    return response;
  },
  getPurchasesReport: async (params) => {
    const response = await api.get('/api/purchases', { params });
    return normalizeResponse(response.data);
  }
};

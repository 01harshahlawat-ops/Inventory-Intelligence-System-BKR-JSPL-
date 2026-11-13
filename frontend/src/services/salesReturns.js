import api from './api';
import { normalizeResponse } from '../utils/normalizeResponse';

export const salesReturnsService = {
  getReturns: async () => {
    const response = await api.get('/api/sales-returns/');
    return normalizeResponse(response.data);
  },
  getReturnDetail: async (id) => {
    const response = await api.get(`/api/sales-returns/${id}`);
    return normalizeResponse(response.data);
  },
  getNextNumber: async (returnType = 'OFFLINE') => {
    const response = await api.get(`/api/sales-returns/next-number?return_type=${encodeURIComponent(returnType)}`);
    return response.data;
  },
  createDraft: async (data) => {
    const response = await api.post('/api/sales-returns/draft', data);
    return normalizeResponse(response.data);
  },
  completeReturn: async (id, warehouseId = null) => {
    const payload = warehouseId ? { warehouse_id: warehouseId } : {};
    const response = await api.post(`/api/sales-returns/${id}/complete`, payload);
    return normalizeResponse(response.data);
  },
  cancelReturn: async (id) => {
    const response = await api.post(`/api/sales-returns/${id}/cancel`);
    return normalizeResponse(response.data);
  }
};

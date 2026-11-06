import api from './api';

export const halteOrdersService = {
  getStats: async () => {
    const res = await api.get('/api/halte-orders/stats');
    return res.data;
  },

  getOrders: async (params = {}) => {
    const res = await api.get('/api/halte-orders', { params });
    return res.data;
  },

  syncOrders: async (options = { lookback_days: 30, auto_deduct_paid: false }) => {
    const res = await api.post('/api/halte-orders/sync', options);
    return res.data;
  },

  deductOrder: async (orderId) => {
    const res = await api.post(`/api/halte-orders/${orderId}/deduct`);
    return res.data;
  },

  batchDeduct: async (orderIds = null) => {
    const res = await api.post('/api/halte-orders/batch-deduct', { order_ids: orderIds });
    return res.data;
  },

  skipOrder: async (orderId) => {
    const res = await api.post(`/api/halte-orders/${orderId}/skip`);
    return res.data;
  }
};

export default halteOrdersService;

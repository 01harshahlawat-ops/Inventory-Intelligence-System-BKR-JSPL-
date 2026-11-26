import api from './api';
import { normalizeResponse } from '../utils/normalizeResponse';

const POS_OFFLINE_KEY = 'offlineSalesQueue';

export const posService = {
  // Local offline queue helpers
  getLocalQueue: () => {
    try {
      return JSON.parse(localStorage.getItem(POS_OFFLINE_KEY) || '[]');
    } catch {
      return [];
    }
  },

  saveLocalQueue: (queue) => {
    try {
      localStorage.setItem(POS_OFFLINE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error('Failed to save offline queue to localStorage', e);
    }
  },

  enqueueOfflineSale: (payload, idempotencyKey) => {
    const queue = posService.getLocalQueue();
    const item = {
      payload,
      idempotencyKey: idempotencyKey || payload.idempotency_key || window.crypto.randomUUID(),
      timestamp: new Date().toISOString()
    };
    queue.push(item);
    posService.saveLocalQueue(queue);
    return item;
  },

  cancelSale: async (saleId) => {
    const response = await api.post(`/api/pos/sales/${saleId}/cancel`);
    return response.data;
  },

  searchProducts: async (query, warehouseId) => {
    if (!query || query.length < 2) return [];
    let url = `/api/pos/products/search?q=${encodeURIComponent(query)}`;
    if (warehouseId) url += `&warehouse_id=${warehouseId}`;
    const res = await api.get(url);
    return normalizeResponse(res.data);
  },

  checkout: async (payload) => {
    if (!navigator.onLine) {
      posService.enqueueOfflineSale(payload, payload.idempotency_key);
      return {
        is_offline: true,
        message: 'Network is offline. Sale saved to offline queue! You can sync when back online.',
        receipt: null
      };
    }

    try {
      const res = await api.post('/api/pos/sale', payload);
      return normalizeResponse(res.data);
    } catch (err) {
      // If network error (server unreachable, connection dropped, CORS, timeout)
      if (!err.response || err.message === 'Network Error' || err.code === 'ERR_NETWORK') {
        posService.enqueueOfflineSale(payload, payload.idempotency_key);
        return {
          is_offline: true,
          message: 'Server connection interrupted. Sale saved safely to offline queue!',
          receipt: null
        };
      }
      throw err;
    }
  },

  getNextInvoiceNumber: async (prefix) => {
    const res = await api.get('/api/pos/next-invoice-number', { params: { prefix } });
    return normalizeResponse(res.data);
  },

  getServiceChargeItem: async () => {
    const res = await api.get('/api/pos/service-charge-item');
    return normalizeResponse(res.data);
  },

  getSalesHistory: async (params) => {
    const res = await api.get('/api/pos/history', { params });
    return normalizeResponse(res.data);
  },

  getSaleById: async (saleId) => {
    const res = await api.get(`/api/pos/sales/${saleId}`);
    return normalizeResponse(res.data);
  },

  retryTallySync: async (saleId) => {
    const res = await api.post(`/api/pos/sales/${saleId}/retry-tally`);
    return normalizeResponse(res.data);
  },

  getTallyPayload: async (saleId) => {
    const res = await api.get(`/api/pos/sales/${saleId}/tally-payload`);
    return normalizeResponse(res.data);
  },

  emailInvoice: async ({ saleId, formData }) => {
    const res = await api.post(`/api/documents/invoice/${saleId}/email`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return normalizeResponse(res.data);
  },

  // --- Offline POS Queue ---
  submitOffline: async (payload, idempotencyKey) => {
    const res = await api.post('/api/pos/offline/submit', {
      idempotency_key: idempotencyKey,
      payload
    });
    return normalizeResponse(res.data);
  },

  getPending: async () => {
    const local = posService.getLocalQueue();
    try {
      const res = await api.get('/api/pos/offline/pending');
      const serverItems = normalizeResponse(res.data) || [];
      return [...local, ...serverItems];
    } catch {
      return local;
    }
  },

  syncOffline: async () => {
    const local = posService.getLocalQueue();
    // 1. Push local items to server queue
    for (const item of local) {
      try {
        await api.post('/api/pos/offline/submit', {
          idempotency_key: item.idempotencyKey,
          payload: item.payload
        });
      } catch (e) {
        console.warn('Failed to submit local offline item to server', e);
      }
    }
    // 2. Call server sync
    const res = await api.post('/api/pos/offline/sync');
    posService.saveLocalQueue([]);
    return normalizeResponse(res.data);
  }
};

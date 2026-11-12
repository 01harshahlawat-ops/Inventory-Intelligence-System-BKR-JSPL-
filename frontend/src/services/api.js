import axios from 'axios';
import { useAuthStore } from '../stores/authStore';
import useCompanyStore from '../stores/useCompanyStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useApprovalStore } from '../stores/useApprovalStore';

const NETWORK_ERROR_COOLDOWN_MS = 10000;
let lastNetworkErrorAt = 0;

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  timeout: 120000, // 120 seconds generous timeout for large batch dispatches and remote database connections
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  const companyId = useCompanyStore.getState().companyId;
  if (companyId !== null && companyId !== undefined && !config.headers['X-Company-Id']) {
    config.headers['X-Company-Id'] = companyId.toString();
  }
  
  return config;
});

api.interceptors.response.use(
    (response) => {
    // Automatically convert backend naive datetimes to UTC so browsers render local time (e.g., IST)
    const appendZ = (obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === 'string') {
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(obj)) {
          return obj + 'Z';
        }
        return obj;
      }
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          obj[i] = appendZ(obj[i]);
        }
      } else if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          obj[key] = appendZ(obj[key]);
        }
      }
      return obj;
    };
    
    if (response.data && !(response.data instanceof Blob) && !(response.data instanceof ArrayBuffer)) {
      appendZ(response.data);
    }
    return response;
  },
  (error) => {
    if (!error.response) {
      const now = Date.now();
      if (now - lastNetworkErrorAt >= NETWORK_ERROR_COOLDOWN_MS) {
        lastNetworkErrorAt = now;
        useNotificationStore.getState().addNotification({
          type: 'error',
          title: 'Network Error',
          message: 'Unable to connect to the server. Please check your internet connection.'
        });
      }
      return Promise.reject(error);
    }
    
    const { status, data, config } = error.response;
    
    switch (status) {
      case 401:
        useAuthStore.getState().logout();
        window.location.href = '/login';
        break;
      case 403:
        // Intercept Admin access block and trigger Approval Modal
        if (data && data.detail && data.detail.toLowerCase().includes('admin access required') && config.data) {
           try {
             const payload = JSON.parse(config.data);
             // Strip the dummy admin password so it doesn't show in the diff
             if (payload.admin_password) delete payload.admin_password;

             // Inject company_id from the company store if missing
             const companyId = useCompanyStore.getState().companyId;
             if (!payload.company_id && companyId) {
               payload.company_id = companyId;
             }

             // Map URL/Method to Executor request types
             let reqType = "UNKNOWN_OPERATION";
             const url = config.url.toLowerCase();
             const method = config.method ? config.method.toLowerCase() : '';
             
             if (url.includes('/products')) {
                 if (method === 'put' || method === 'patch') reqType = "UPDATE_PRODUCT";
                 if (method === 'post') reqType = "CREATE_PRODUCT";
                 if (method === 'delete') reqType = "DELETE_PRODUCT";
             } else if (url.includes('/warehouses')) {
                 if (method === 'put' || method === 'patch') reqType = "UPDATE_WAREHOUSE";
                 if (method === 'post') reqType = "CREATE_WAREHOUSE";
                 if (method === 'delete') reqType = "DELETE_WAREHOUSE";
             } else if (url.includes('/inventory/adjust')) {
                 reqType = "INVENTORY_ADJUSTMENT";
             }
             
             useApprovalStore.getState().openModal(reqType, payload);
             window.dispatchEvent(new Event('approval-modal-opened'));
             // Reject with a flagged error so React Query settles (onSettled fires, buttons unfreeze)
             // but components can check this flag to avoid showing duplicate error toasts
             const escalatedError = new Error('Escalated to admin approval');
             escalatedError.isApprovalEscalation = true;
             return Promise.reject(escalatedError);
           } catch(e) {
             console.error("Failed to parse request for escalation", e);
           }
        }
        
        useNotificationStore.getState().addNotification({
          type: 'error',
          title: 'Access Denied',
          message: data.detail || 'You do not have permission to perform this action.'
        });
        break;
      case 400:
      case 422:
      case 409: {
        let msg = 'Please check your inputs and try again.';
        if (data && data.detail) {
          if (typeof data.detail === 'string') {
            msg = data.detail;
          } else if (data.detail.message) {
            msg = data.detail.message;
          } else if (Array.isArray(data.detail)) {
            msg = data.detail[0]?.msg || 'Validation error';
          } else {
            msg = JSON.stringify(data.detail);
          }
        }
        useNotificationStore.getState().addNotification({
          type: 'warning',
          title: 'Validation Error',
          message: msg
        });
        break;
      }
      case 500:
        console.error('System Error:', error);
        useNotificationStore.getState().addNotification({
          type: 'error',
          title: 'System Error',
          message: 'An unexpected error occurred. Our team has been notified.'
        });
        break;
      default:
        break;
    }
    return Promise.reject(error);
  }
);

export default api;

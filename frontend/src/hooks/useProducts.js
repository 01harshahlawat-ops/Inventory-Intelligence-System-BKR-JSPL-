import useCompanyStore from '../stores/useCompanyStore';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productService } from '../services/products';
import { useNotificationStore } from '../stores/notificationStore';
import { useMemo } from 'react';
import api from '../services/api';

const EMPTY_ARRAY = [];

export const useProducts = ({ search = '', category = '', brand = '', status = '', page = 1, limit = 50, enabled = true } = {}) => {
  const companyId = useCompanyStore((state) => state.companyId);
  const query = useQuery({
    queryKey: ['products', companyId],
    queryFn: () => productService.getProducts(),
    enabled: Boolean(companyId) && enabled,
  });

  const products = query.data ?? EMPTY_ARRAY;

  // Client-side processing
  const processedData = useMemo(() => {
    let filtered = products;

    // Search (SKU, Name, Brand, Barcode)
    if (search) {
      const lowerSearch = search.toLowerCase();
      filtered = filtered.filter(p => 
        (p.sku?.toLowerCase() || '').includes(lowerSearch) ||
        (p.name?.toLowerCase() || '').includes(lowerSearch) ||
        (p.brand?.toLowerCase() || '').includes(lowerSearch) ||
        (p.barcode?.toLowerCase() || '').includes(lowerSearch)
      );
    }

    // Filter Category
    if (category) {
      filtered = filtered.filter(p => p.category === category);
    }

    // Filter Brand
    if (brand) {
      filtered = filtered.filter(p => p.brand === brand);
    }

    // Filter Status
    if (status) {
      filtered = filtered.filter(p => p.status === status);
    }

    // Pagination
    const startIndex = (page - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    return {
      data: paginated,
      totalCount: filtered.length,
      totalPages: Math.ceil(filtered.length / limit)
    };
  }, [products, search, category, brand, status, page, limit]);

  return {
    ...query,
    ...processedData,
    allProducts: products,
  };
};

export const useProductFilters = () => {
  const companyId = useCompanyStore((state) => state.companyId);
  return useQuery({
    queryKey: ['products', 'filters', companyId],
    queryFn: () => productService.getProductFilters(),
  });
};

export const useCreateProduct = () => {
  const companyId = useCompanyStore((state) => state.companyId);
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore.getState();

  return useMutation({
    mutationFn: async ({ data, adminPassword }) => {
      const response = await api.post('/api/products', { ...data, admin_password: adminPassword });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', companyId] });
      addNotification({ type: 'success', title: 'Product Created', message: 'The product was successfully added.' });
    },
    onError: (error) => {
      const detail = error.response?.data?.detail;
      const msg = Array.isArray(detail) ? detail.map(d => d.msg).join(', ') : (detail || 'An error occurred');
      addNotification({ type: 'error', title: 'Failed to Create', message: msg });
    }
  });
};

export const useUpdateProduct = () => {
  const companyId = useCompanyStore((state) => state.companyId);
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore.getState();

  return useMutation({
    mutationFn: async ({ sku, data, adminPassword }) => {
      const response = await api.put(`/api/products/${encodeURIComponent(sku)}`, { ...data, admin_password: adminPassword });
      return response.data;
    },
    onMutate: async ({ sku, data }) => {
      await queryClient.cancelQueries({ queryKey: ['products', companyId] });
      const previousProducts = queryClient.getQueryData(['products', companyId]);
      queryClient.setQueryData(['products', companyId], old => 
        (old || []).map(p => p.sku === sku ? { ...p, ...data } : p)
      );
      return { previousProducts };
    },
    onError: (err, variables, context) => {
      queryClient.setQueryData(['products', companyId], context.previousProducts);
      if (err.isApprovalEscalation) return; // Silently handled by approval modal
      const detail = err.response?.data?.detail;
      const msg = Array.isArray(detail) ? detail.map(d => d.msg).join(', ') : (detail || 'An error occurred');
      addNotification({ type: 'error', title: 'Update Failed', message: msg });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['products', companyId] });
    },
    onSuccess: () => {
      addNotification({ type: 'success', title: 'Product Updated', message: 'Product changes saved successfully.' });
    }
  });
};

export const useDeleteProduct = () => {
  const companyId = useCompanyStore((state) => state.companyId);
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore.getState();

  return useMutation({
    mutationFn: async ({ sku, adminPassword }) => {
      const response = await api.delete(`/api/products/${encodeURIComponent(sku)}`, {
        data: { admin_password: adminPassword }
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', companyId] });
      addNotification({ type: 'success', title: 'Product Deleted', message: 'The product was permanently deleted.' });
    },
    onError: (error) => {
      const detail = error.response?.data?.detail;
      const msg = Array.isArray(detail) ? detail.map(d => d.msg).join(', ') : (detail || 'An error occurred');
      addNotification({ type: 'error', title: 'Failed to Delete', message: msg });
    }
  });
};

export const useBulkUpdateProducts = () => {
  const companyId = useCompanyStore((state) => state.companyId);
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore.getState();

  return useMutation({
    mutationFn: async ({ skus, data, products, adminPassword }) => {
      const updates = skus.map(sku => {
        const prod = products.find(p => p.sku === sku);
        if (!prod) return Promise.resolve();
        const updatedData = { ...prod, ...data, admin_password: adminPassword };
        return api.put(`/api/products/${encodeURIComponent(sku)}`, updatedData);
      });
      return Promise.all(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', companyId] });
      addNotification({ type: 'success', title: 'Bulk Update Success', message: 'Selected products have been updated.' });
    },
    onError: () => {
      addNotification({ type: 'error', title: 'Bulk Update Failed', message: 'Could not update all selected products.' });
    }
  });
};

export const useBulkImportProducts = () => {
  const companyId = useCompanyStore((state) => state.companyId);
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore.getState();

  return useMutation({
    mutationFn: async ({ file, dryRun = false, updateExisting = false, initStock = true }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('dry_run', dryRun ? 'true' : 'false');
      formData.append('update_existing', updateExisting ? 'true' : 'false');
      formData.append('init_stock', initStock ? 'true' : 'false');

      return await productService.bulkImport(formData);
    },
    onSuccess: (data, variables) => {
      if (!variables.dryRun) {
        queryClient.invalidateQueries({ queryKey: ['products', companyId] });
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        addNotification({
          type: 'success',
          title: 'Bulk Import Completed',
          message: `Created ${data.inserted || 0} products, updated ${data.updated || 0}.`
        });
      }
    },
    onError: (error) => {
      const detail = error.response?.data?.detail;
      const msg = Array.isArray(detail) ? detail.map(d => d.msg).join(', ') : (detail || error.message || 'An error occurred during import.');
      addNotification({ type: 'error', title: 'Import Failed', message: msg });
    }
  });
};


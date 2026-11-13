import React from 'react';
import { useQuery } from '@tanstack/react-query';
import PageContainer from '../../components/layout/PageContainer';
import { Card } from '../../components/Card/Card';
import styles from './Warehouse.module.css';
import { inventoryService } from '../../services/inventory';
import { handleApiError } from '../../utils/errorHandler';

const WarehouseDashboard = () => {
  const { data = [], isLoading: loading, error: dashboardError } = useQuery({
    queryKey: ['inventory', {}], // Empty filter object for global dashboard
    queryFn: () => inventoryService.getInventory(),
  });

  if (dashboardError) {
    handleApiError(dashboardError, 'Failed to load inventory for dashboard metrics');
  }

  const metrics = {
    totalProducts: data.length || 0,
    inventoryValue: data.reduce((acc, item) => {
      const qty = item.current_qty || item.quantity || 0;
      const price = item.product?.item_rate || item.price || 0;
      return acc + (price * qty);
    }, 0),
    lowStock: data.filter(item => {
      const qty = item.current_qty || item.quantity || 0;
      const minLevel = item.product?.min_stock_level || item.min_stock_level || 10;
      return qty > 0 && qty < minLevel;
    }).length || 0
  };

  return (
    <PageContainer title="Warehouse Dashboard">
      {loading ? (
        <p>Loading metrics...</p>
      ) : (
        <div className={styles.grid}>
          <Card>
            <h3 style={{ color: '#6b7280', fontSize: '0.875rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Total Products</h3>
            <p className={styles.metric}>{metrics.totalProducts}</p>
          </Card>
          <Card>
            <h3 style={{ color: '#6b7280', fontSize: '0.875rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Inventory Value</h3>
            <p className={styles.metric}>₹{metrics.inventoryValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </Card>
          <Card>
            <h3 style={{ color: '#6b7280', fontSize: '0.875rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Low Stock Items</h3>
            <p className={styles.metric}>{metrics.lowStock}</p>
          </Card>
        </div>
      )}
    </PageContainer>
  );
};

export default WarehouseDashboard;

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reportsService } from '../../services/reports';
import { handleApiError } from '../../utils/errorHandler';
import PageContainer from '../../components/layout/PageContainer';
import { Card } from '../../components/Card/Card';
import styles from './Reports.module.css';

// Import the new modular views
import { SalesReport } from './views/SalesReport';
import { SalesReturnReport } from './views/SalesReturnReport';
import { PurchaseReport } from './views/PurchaseReport';
import { InventoryReport } from './views/InventoryReport';
import { DispatchReport } from './views/DispatchReport';
import { FCReturnReport } from './views/FCReturnReport';
import { DefectiveReport } from './views/DefectiveReport';

const Reports = () => {
  const [activeTab, setActiveTab] = useState('sales');

  const tabs = [
    { id: 'sales', label: 'Sales Report' },
    { id: 'sales-returns', label: 'Sales Returns' },
    { id: 'purchases', label: 'Purchase Register' },
    { id: 'inventory', label: 'Inventory Status' },
    { id: 'dispatches', label: 'Dispatch Report' },
    { id: 'returns', label: 'Amazon Returns' },
    { id: 'defective', label: 'Defective Inventory' },
  ];

  const queryClient = useQueryClient();

  const generateLowStockMutation = useMutation({
    mutationFn: () => reportsService.generateLowStock('excel'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventoryReport'] }); // invalidate report views
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      alert('Low Stock Report Generated Successfully');
    },
    onError: handleApiError
  });

  const generateReplenishmentMutation = useMutation({
    mutationFn: () => reportsService.generateReplenishment('excel'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventoryReport'] }); // invalidate report views
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      alert('Replenishment Report Generated Successfully');
    },
    onError: handleApiError
  });

  return (
    <PageContainer 
      title="Operational Reports" 
      action={
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            className={styles.primaryBtn} 
            style={{ padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
            onClick={() => generateLowStockMutation.mutate()} 
            disabled={generateLowStockMutation.isPending}
          >
            {generateLowStockMutation.isPending ? 'Generating...' : 'Generate Low Stock'}
          </button>
          <button 
            className={styles.primaryBtn} 
            style={{ padding: '8px 16px', backgroundColor: '#10b981', color: 'white', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
            onClick={() => generateReplenishmentMutation.mutate()} 
            disabled={generateReplenishmentMutation.isPending}
          >
            {generateReplenishmentMutation.isPending ? 'Generating...' : 'Generate Replenishment'}
          </button>
        </div>
      }
    >
      <Card noPadding>
        {/* Tab Navigation */}
        <div className={styles.tabHeader}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`${styles.tabBtn} ${activeTab === tab.id ? styles.activeTab : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        
        {/* View Container */}
        <div className={styles.reportContainer}>
          {activeTab === 'sales' && <SalesReport />}
          {activeTab === 'sales-returns' && <SalesReturnReport />}
          {activeTab === 'purchases' && <PurchaseReport />}
          {activeTab === 'inventory' && <InventoryReport />}
          {activeTab === 'dispatches' && <DispatchReport />}
          {activeTab === 'returns' && <FCReturnReport />}
          {activeTab === 'defective' && <DefectiveReport />}
        </div>
      </Card>
    </PageContainer>
  );
};

export default Reports;

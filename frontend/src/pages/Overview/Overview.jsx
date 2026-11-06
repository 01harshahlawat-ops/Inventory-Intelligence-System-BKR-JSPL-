import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../components/layout/PageContainer';
import Button from '../../components/forms/Button';
import { MetricCard } from '../../components/MetricCard/MetricCard';
import { SystemHealthCard } from './components/SystemHealthCard';
import { RecentActivity } from './components/RecentActivity';
import { AlertsPanel } from './components/AlertsPanel';
import { WarehouseHierarchy } from './components/WarehouseHierarchy';
import { ROUTES } from '../../constants/routes';
import { useDashboardMetrics, useDashboardActivity, useDashboardAlerts, useReturnMetrics } from '../../hooks/useDashboard';
import useCompanyStore from '../../stores/useCompanyStore';
import { 
  FiBox, FiLayers, FiDatabase, FiAlertCircle, FiTrendingDown, 
  FiBell, FiRefreshCw, FiShoppingCart, FiDollarSign, FiRefreshCcw, 
  FiClock, FiCheckCircle, FiXCircle, FiFileText, FiTruck, FiPlus,
  FiFile, FiTool, FiActivity, FiList, FiGlobe
} from 'react-icons/fi';
import styles from './Overview.module.css';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import halteOrdersService from '../../services/halteOrdersService';
import halteServiceBookingService from '../../services/halteServiceBookingService';

const DashboardSkeleton = () => (
  <div className={styles.skeletonContainer}>
    <div className={styles.kpiGrid}>
      {[...Array(6)].map((_, i) => <div key={i} className={styles.skeletonCard} />)}
    </div>
    <div className={styles.row2}>
      <div className={styles.skeletonCard} style={{ height: '300px' }} />
      <div className={styles.skeletonCard} style={{ height: '300px' }} />
    </div>
  </div>
);

const Overview = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { currentCompany } = useCompanyStore();
  const isBkr = currentCompany?.code === 'BKR';
  
  const { data: metricsData, isPending: metricsPending, error: metricsError } = useDashboardMetrics();
  const { data: returnData, isPending: returnPending } = useReturnMetrics();
  const { data: activityData, isPending: activityPending, error: activityError } = useDashboardActivity();
  const { data: alertsData, isPending: alertsPending, error: alertsError } = useDashboardAlerts();

  const { data: halteOrderStats } = useQuery({
    queryKey: ['halte-orders-stats'],
    queryFn: () => halteOrdersService.getStats().catch(() => null),
    staleTime: 60000
  });

  const { data: halteServiceStats } = useQuery({
    queryKey: ['halte-service-stats'],
    queryFn: () => halteServiceBookingService.getStats().catch(() => null),
    staleTime: 60000
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['halte-orders-stats'] });
    queryClient.invalidateQueries({ queryKey: ['halte-service-stats'] });
  };

  if (metricsPending || activityPending || alertsPending || returnPending) {
    return (
      <PageContainer title="Overview Dashboard">
        <DashboardSkeleton />
      </PageContainer>
    );
  }

  if (metricsError || activityError || alertsError) {
    return (
      <PageContainer
        title="Overview Dashboard"
        actions={
          <Button variant="secondary" onClick={handleRefresh}>
            <FiRefreshCw style={{ marginRight: '8px' }} /> Refresh
          </Button>
        }
      >
        <div className={styles.skeletonContainer}>
          <div className={styles.skeletonCard} style={{ height: 'auto', padding: '24px' }}>
            Dashboard data could not be loaded. Please refresh the page or try again after restarting the backend.
          </div>
        </div>
      </PageContainer>
    );
  }

  const kpis = metricsData?.kpis;
  const health = metricsData?.health;
  const recentActivity = activityData?.recent_activity;
  const recentAlerts = alertsData?.recent_alerts;

  // Calculate some derived KPIs
  const pendingReturns = (kpis?.pending_sales_returns ?? 0) + (returnData?.awaiting_inspection ?? 0);
  const defectiveInventory = returnData?.defective ?? 0;

  return (
    <PageContainer 
      title="Operational Dashboard"
      actions={
        <Button variant="secondary" onClick={handleRefresh}>
          <FiRefreshCw style={{ marginRight: '8px' }} /> Refresh
        </Button>
      }
    >
      <div className={styles.dashboardLayout}>
        {/* Left Column: KPIs and Activity */}
        <div className={styles.mainContent}>
          
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Priority Operations</h2>
            <div className={styles.priorityGrid}>
              <MetricCard 
                title="Halte Web Repairs" 
                value={(halteServiceStats?.summary?.ongoing ?? 0) + (halteServiceStats?.summary?.assigned ?? 0)} 
                icon={FiTool} 
                color="primary"
                navigateTo="/service?tab=halte"
              />
              <MetricCard 
                title="Halte Web Orders" 
                value={halteOrderStats?.pending_deduction ?? 0} 
                icon={FiGlobe} 
                color="warning"
                navigateTo={ROUTES.HALTE_ORDERS}
              />
              <MetricCard 
                title="Pending Dispatches" 
                value={kpis?.pending_dispatches ?? 0} 
                icon={FiTruck} 
                color="warning"
                navigateTo={ROUTES.LOGISTICS_DISPATCH_DASHBOARD}
              />
              <MetricCard 
                title="Pending Returns" 
                value={pendingReturns} 
                icon={FiClock} 
                color="warning"
                navigateTo={ROUTES.AMAZON_RETURNS}
              />
              <MetricCard 
                title="Low Stock" 
                value={kpis?.low_stock_products ?? 0} 
                icon={FiTrendingDown} 
                color="danger"
                navigateTo={ROUTES.REPORTS}
              />
              <MetricCard 
                title="Damaged / Defective" 
                value={defectiveInventory} 
                icon={FiXCircle} 
                color="danger"
                navigateTo={ROUTES.DEFECTIVE_INVENTORY}
              />
              <MetricCard 
                title="Failed Syncs" 
                value={kpis?.failed_amazon_syncs ?? 0} 
                icon={FiAlertCircle} 
                color="danger"
              />
              {isBkr && (
                <MetricCard 
                  title="Accounting Pending" 
                  value={kpis?.pending_accounting_exports ?? 0}
                  icon={FiFileText} 
                  color="warning"
                  navigateTo={ROUTES.ACCOUNTING_EXPORT_CENTER}
                />
              )}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>General Metrics</h2>
            <div className={styles.kpiGrid}>
              <MetricCard title="Total Products" value={kpis?.total_products ?? 0} icon={FiBox} color="primary" navigateTo={ROUTES.PRODUCTS} />
              <MetricCard title="Total Inventory Qty" value={kpis?.total_inventory ?? 0} icon={FiDatabase} color="primary" navigateTo={ROUTES.INVENTORY} />
              <MetricCard title="Negative Stock" value={kpis?.negative_stock_products ?? 0} icon={FiAlertCircle} color="danger" navigateTo={ROUTES.INVENTORY} />
              
              {isBkr && (
                <>
                  <MetricCard title="Products Sold" value={kpis?.pos_products_sold_today ?? 0} icon={FiBox} color="primary" navigateTo={ROUTES.POS_HISTORY} />
                  <MetricCard title="Sales Returns" value={kpis?.sales_returns_today ?? 0} icon={FiRefreshCcw} color="warning" navigateTo={ROUTES.SALES_RETURNS} />
                  <MetricCard title="Challans Today" value={kpis?.challans_today ?? 0} icon={FiFileText} color="primary" navigateTo={ROUTES.DELIVERY_CHALLANS} />
                </>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <WarehouseHierarchy />
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Recent Activity</h2>
            <RecentActivity activities={recentActivity} />
          </section>
        </div>

        {/* Right Column: Actions, Alerts, Health */}
        <div className={styles.sideContent}>
          
          <div className={styles.quickActionsCard}>
            <h3 className={styles.quickActionsTitle}>Quick Actions</h3>
            <div className={styles.actionGrid}>
              <button className={styles.actionBtn} onClick={() => navigate(ROUTES.LOGISTICS_DISPATCH_DASHBOARD)}>
                <FiTruck className={styles.actionIcon} />
                <span>Create Dispatch</span>
              </button>
              <button className={styles.actionBtn} onClick={() => navigate(ROUTES.AMAZON_RETURNS)}>
                <FiRefreshCcw className={styles.actionIcon} />
                <span>New Return</span>
              </button>
              <button className={styles.actionBtn} onClick={() => navigate(ROUTES.SERVICE_CREATE)}>
                <FiTool className={styles.actionIcon} />
                <span>New Service</span>
              </button>
              {isBkr && (
                <button className={styles.actionBtn} onClick={() => navigate(ROUTES.ACCOUNTING_EXPORT_CENTER)}>
                  <FiFile className={styles.actionIcon} />
                  <span>Export XML</span>
                </button>
              )}
            </div>
          </div>

          <div className={styles.alertsCol}>
            <AlertsPanel alerts={recentAlerts} />
          </div>

          <div className={styles.healthCol}>
            <SystemHealthCard health={health} />
          </div>
          
        </div>
      </div>
      
      {/* Bottom Row: Reports Gateway */}
      <div className={styles.dashboardLayout} style={{ marginTop: '24px' }}>
        <div className={styles.mainContent} style={{ flex: '1' }}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Operational Reports</h2>
            <div className={styles.priorityGrid}>
              <MetricCard title="Sales Report" value="View" icon={FiDollarSign} color="primary" navigateTo={ROUTES.REPORTS} />
              <MetricCard title="Inventory Report" value="View" icon={FiDatabase} color="primary" navigateTo={ROUTES.REPORTS} />
              <MetricCard title="Dispatch Report" value="View" icon={FiTruck} color="primary" navigateTo={ROUTES.REPORTS} />
              <MetricCard title="Returns Report" value="View" icon={FiRefreshCcw} color="primary" navigateTo={ROUTES.REPORTS} />
              <MetricCard title="Defective Report" value="View" icon={FiAlertCircle} color="primary" navigateTo={ROUTES.REPORTS} />
            </div>
          </section>
        </div>
      </div>
    </PageContainer>
  );
};

export default Overview;

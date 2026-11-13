import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ROUTES } from './constants/routes';
import MainLayout from './components/layout/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import NotificationManager from './components/Notification/NotificationManager';
import LoadingOverlay from "./components/LoadingOverlay/LoadingOverlay";
import OperatorApprovalModal from "./components/Admin/OperatorApprovalModal";
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';

// Core primary pages loaded eagerly for instant, zero-lag navigation
import Overview from './pages/Overview/Overview';
import Products from './pages/Products/Products';
import Inventory from './pages/Inventory/Inventory';
import Reports from './pages/Reports/Reports';
import POSPage from './pages/POS/POSPage';
import PurchasesList from './pages/Purchases/PurchasesList';

const AmazonReturns = lazy(() => import('./pages/Amazon/Returns'));
const DefectiveInventory = lazy(() => import('./pages/Inventory/DefectiveInventory'));
const InventoryHistory = lazy(() => import('./pages/InventoryHistory/InventoryHistory'));
const DownloadCentre = lazy(() => import('./pages/DownloadCentre/DownloadCentre'));
const Login = lazy(() => import('./pages/Login/Login'));
const Settings = lazy(() => import('./pages/Settings/SettingsPage'));
const SalesHistoryPage = lazy(() => import('./pages/POS/SalesHistoryPage'));
const InvoicePreviewPage = lazy(() => import('./pages/POS/InvoicePreviewPage'));
const EditInvoicePage = lazy(() => import('./pages/POS/EditInvoicePage'));

const JSPLReplenishmentView = lazy(() => import('./pages/Replenishment/JSPLReplenishmentView'));
const BKRRequirementsView = lazy(() => import('./pages/Replenishment/BKRRequirementsView'));
const BKRInvoiceGenerator = lazy(() => import('./pages/Replenishment/BKRInvoiceGenerator'));
const InterCompanyHistory = lazy(() => import('./pages/Replenishment/InterCompanyHistory'));

const ExportCenter = lazy(() => import('./pages/Accounting/ExportCenter'));
const MasterSync = lazy(() => import('./pages/Accounting/MasterSync'));
const ExportHistory = lazy(() => import('./pages/Accounting/ExportHistory'));
const Mapping = lazy(() => import('./pages/Accounting/Mapping'));
const Configuration = lazy(() => import('./pages/Accounting/Configuration'));

const SalesReturnsPage = lazy(() => import('./pages/SalesReturns/SalesReturnsPage'));
const DeliveryChallansPage = lazy(() => import('./pages/DeliveryChallans/DeliveryChallansPage'));
const CreateChallanPage = lazy(() => import('./pages/DeliveryChallans/CreateChallanPage'));

// Service Management
const ServiceDashboard = lazy(() => import('./pages/Service/ServiceDashboard'));
const ServiceRecordsPage = lazy(() => import('./pages/Service/ServiceRecordsPage'));
const ServiceHistoryPage = lazy(() => import('./pages/Service/ServiceHistoryPage'));
const ServiceRemindersPage = lazy(() => import('./pages/Service/ServiceRemindersPage'));
const CreateServicePage = lazy(() => import('./pages/Service/CreateServicePage'));
const ServiceDetailPage = lazy(() => import('./pages/Service/ServiceDetailPage'));

const DeliveryChallanPreviewPage = lazy(() => import('./pages/DeliveryChallans/DeliveryChallanPreviewPage'));

// BKR Service Module
const JobCardList = lazy(() => import('./pages/Service/JobCardList'));
const JobCardPrintView = lazy(() => import('./pages/Service/JobCardPrintView'));
const ServiceInvoicePreview = lazy(() => import('./pages/Service/ServiceInvoicePreview'));

// Warehouse Phase 8 Routes
const ApprovalDashboard = lazy(() => import("./pages/Admin/ApprovalDashboard"));
const WarehouseDashboard = lazy(() => import('./pages/Warehouse/WarehouseDashboard'));
const StateHubsPage = lazy(() => import('./pages/Warehouse/StateHubsPage'));
const AmazonLiveInventory = lazy(() => import('./pages/Amazon/AmazonLiveInventory'));
const WarehouseMasterList = lazy(() => import('./pages/Warehouse/WarehouseMasterList'));
const WarehouseDetailPage = lazy(() => import('./pages/Warehouse/WarehouseDetailPage'));
const WarehouseInventoryPage = lazy(() => import('./pages/Warehouse/WarehouseInventoryPage'));
const WarehouseUsers = lazy(() => import('./pages/Warehouse/WarehouseUsers'));

// Warehouse Logistics Routes
const DispatchDashboard = lazy(() => import('./pages/WarehouseLogistics/DispatchDashboard'));
const BatchDispatchCreator = lazy(() => import('./pages/WarehouseLogistics/BatchDispatchCreator'));
const FCReturnsView = lazy(() => import('./pages/WarehouseLogistics/FCReturnsView'));
const DamageClaimManager = lazy(() => import('./pages/WarehouseLogistics/DamageClaimManager'));
const ReturnRecommendations = lazy(() => import('./pages/WarehouseLogistics/ReturnRecommendations'));

const UserManualPage = lazy(() => import('./pages/Help/UserManualPage'));

const CreatePurchase = lazy(() => import('./pages/Purchases/CreatePurchase'));
const EditPurchase = lazy(() => import('./pages/Purchases/EditPurchase'));
const VendorsPage = lazy(() => import('./pages/Vendors/VendorsPage'));
const HalteOrdersSync = lazy(() => import('./pages/HalteOrders/HalteOrdersSync'));


const App = () => {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center' }}>Loading Application...</div>}>
          <NotificationManager />
          <OperatorApprovalModal />
          <LoadingOverlay />
          <Routes>
            {/* Public Routes */}
            <Route path={ROUTES.LOGIN} element={<Login />} />
            
            <Route element={<ProtectedRoute />}>
              <Route element={<MainLayout />}>
                <Route path={ROUTES.OVERVIEW} element={<Overview />} />
                <Route path={ROUTES.PRODUCTS} element={<Products />} />
                <Route path={ROUTES.INVENTORY} element={<Inventory />} />
                <Route path={ROUTES.DEFECTIVE_INVENTORY} element={<DefectiveInventory />} />
                <Route path={ROUTES.AMAZON_RETURNS} element={<AmazonReturns />} />
                <Route path={ROUTES.INVENTORY_HISTORY} element={<InventoryHistory />} />
                <Route path={ROUTES.REPORTS} element={<Reports />} />
                <Route path={ROUTES.DOWNLOAD_CENTRE} element={<DownloadCentre />} />
                <Route path="/purchases/create" element={<CreatePurchase />} />
                <Route path="/purchases/list" element={<PurchasesList />} />
                <Route path="/purchases/:id/edit" element={<EditPurchase />} />
                <Route path="/vendors" element={<VendorsPage />} />
                <Route path={ROUTES.SETTINGS} element={<Settings />} />
                <Route path={ROUTES.HELP} element={<UserManualPage />} />
                <Route path={ROUTES.ADMIN_APPROVALS} element={<ApprovalDashboard />} />
                <Route path={ROUTES.POS} element={<POSPage />} />
                <Route path={ROUTES.POS_HISTORY} element={<SalesHistoryPage />} />
                <Route path={ROUTES.POS_INVOICE} element={<InvoicePreviewPage />} />
                <Route path="/sales/:id/edit" element={<EditInvoicePage />} />
                <Route path={ROUTES.HALTE_ORDERS} element={<HalteOrdersSync />} />
                <Route path={ROUTES.REPLENISHMENT_JSPL} element={<JSPLReplenishmentView />} />
                <Route path={ROUTES.REPLENISHMENT_BKR} element={<BKRRequirementsView />} />
                <Route path={ROUTES.REPLENISHMENT_BKR_INVOICE} element={<BKRInvoiceGenerator />} />
                <Route path={ROUTES.INTER_COMPANY_HISTORY} element={<InterCompanyHistory />} />
                
                {/* Accounting Routes */}
                <Route path={ROUTES.ACCOUNTING_EXPORT_CENTER} element={<ExportCenter />} />
                <Route path={ROUTES.ACCOUNTING_MASTER_SYNC} element={<MasterSync />} />
                <Route path={ROUTES.ACCOUNTING_HISTORY} element={<ExportHistory />} />
                <Route path={ROUTES.ACCOUNTING_MAPPING} element={<Mapping />} />
                <Route path={ROUTES.ACCOUNTING_CONFIG} element={<Configuration />} />

                {/* Phase 6 Routes */}
                <Route path={ROUTES.SALES_RETURNS} element={<SalesReturnsPage />} />
                <Route path="/sales-returns/:returnId" element={<SalesReturnsPage />} />
                <Route path={ROUTES.DELIVERY_CHALLANS} element={<DeliveryChallansPage />} />
                <Route path={ROUTES.DELIVERY_CHALLAN_CREATE} element={<CreateChallanPage />} />
                
                {/* Service Routes */}
                <Route path={ROUTES.SERVICE_DASHBOARD} element={<ServiceDashboard />} />
                <Route path={ROUTES.SERVICE_RECORDS} element={<ServiceRecordsPage />} />
                <Route path={ROUTES.SERVICE_HISTORY} element={<ServiceHistoryPage />} />
                <Route path={ROUTES.SERVICE_REMINDERS} element={<ServiceRemindersPage />} />
                <Route path={ROUTES.SERVICE_CREATE} element={<CreateServicePage />} />
                <Route path={ROUTES.SERVICE_DETAIL} element={<ServiceDetailPage />} />

                <Route path={ROUTES.DELIVERY_CHALLAN_PREVIEW} element={<DeliveryChallanPreviewPage />} />

                {/* BKR Service Module Routes */}
                <Route path={ROUTES.BKR_JOB_CARDS} element={<JobCardList />} />
                <Route path={ROUTES.BKR_JOB_CARD_CREATE} element={<CreateServicePage />} />
                <Route path={ROUTES.BKR_JOB_CARD_DETAIL} element={<ServiceInvoicePreview />} />
                <Route path={ROUTES.BKR_JOB_CARD_PRINT} element={<JobCardPrintView />} />
                <Route path={ROUTES.BKR_SERVICE_INVOICE} element={<ServiceInvoicePreview />} />

                {/* Warehouse Phase 8 Routes */}
                <Route path={ROUTES.WAREHOUSE_DASHBOARD} element={<WarehouseDashboard />} />
                <Route path={ROUTES.WAREHOUSE_STATE_HUBS} element={<StateHubsPage />} />
                <Route path="/amazon/live-inventory" element={<AmazonLiveInventory />} />
                <Route path={ROUTES.WAREHOUSE_MASTER_LIST} element={<WarehouseMasterList />} />
                <Route path={ROUTES.WAREHOUSE_INVENTORY} element={<WarehouseInventoryPage />} />
                <Route path={ROUTES.WAREHOUSE_USERS} element={<WarehouseUsers />} />
                <Route path={ROUTES.WAREHOUSE_DETAIL} element={<WarehouseDetailPage />} />

                {/* Warehouse Logistics Routes */}
                <Route path={ROUTES.LOGISTICS_DISPATCH_DASHBOARD} element={<DispatchDashboard />} />
                <Route path={ROUTES.LOGISTICS_BATCH_DISPATCH} element={<BatchDispatchCreator />} />
                <Route path={ROUTES.LOGISTICS_RETURNS} element={<FCReturnsView />} />
                <Route path={ROUTES.LOGISTICS_DAMAGE_CLAIMS} element={<DamageClaimManager />} />
                <Route path={ROUTES.LOGISTICS_RETURN_RECOMMENDATIONS} element={<ReturnRecommendations />} />
              </Route>
            </Route>
            
            <Route path="*" element={<Navigate to={ROUTES.OVERVIEW} replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;

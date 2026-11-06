import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { ROUTES } from '../../constants/routes';
import usePendingCount from "../../hooks/usePendingCount";
import { useUIStore } from '../../stores/uiStore';
import useCompanyStore from '../../stores/useCompanyStore';
import { 
  FiHome, FiBox, FiLayers, FiList, FiClock, FiFileText, FiDownload, 
  FiSettings, FiShoppingCart, FiUsers, FiDollarSign, FiRefreshCw, FiRepeat,
  FiChevronDown, FiChevronRight, FiBriefcase, FiTool, FiPieChart, FiTruck, FiGlobe
} from 'react-icons/fi';
import { FaAmazon } from 'react-icons/fa';
import styles from './Sidebar.module.css';

const Sidebar = () => {
  const pendingCount = usePendingCount();
  const { isSidebarOpen } = useUIStore();
  const { currentCompany } = useCompanyStore();
  
  const isBkr = currentCompany?.code === 'BKR';
  const isPosEnabledForCompany = true; // Always show Sales tab on frontend, backend handles auth

  const [openSections, setOpenSections] = useState(() => {
    const saved = localStorage.getItem('sidebar_sections');
    return saved ? JSON.parse(saved) : { dashboard: true };
  });

  useEffect(() => {
    localStorage.setItem('sidebar_sections', JSON.stringify(openSections));
  }, [openSections]);

  const toggleSection = (section) => {
    if (!isSidebarOpen) return;
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const menuConfig = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: FiHome,
      items: [
        { path: ROUTES.OVERVIEW, label: 'Overview', icon: FiPieChart },
        { path: ROUTES.DOWNLOAD_CENTRE, label: 'Download Centre', icon: FiDownload },
      ]
    },
    ...(isPosEnabledForCompany ? [{
      id: 'sales',
      label: 'Sales',
      icon: FiShoppingCart,
      items: [
        { path: ROUTES.POS, label: 'Offline Sales', icon: FiShoppingCart },
        { path: ROUTES.POS_HISTORY, label: 'Sales History', icon: FiDollarSign },
        { path: ROUTES.HALTE_ORDERS, label: 'Halte Orders Sync', icon: FiGlobe },
        { path: ROUTES.SALES_RETURNS, label: 'Sales Returns', icon: FiRefreshCw },
        { path: ROUTES.DELIVERY_CHALLANS, label: 'Delivery Challans', icon: FiFileText },
      ]
    }] : []),
    {
      id: 'purchases',
      label: 'Purchases',
      icon: FiShoppingCart,
      items: [
        { path: '/purchases/create', label: 'Create Purchase', icon: FiShoppingCart },
        { path: '/purchases/list', label: 'Vendor Payables', icon: FiDollarSign },
        { path: '/vendors', label: 'Vendor CRM', icon: FiUsers },
      ]
    },
    {
      id: 'inventory',
      label: 'Inventory',
      icon: FiList,
      items: [
        { path: ROUTES.PRODUCTS, label: 'Products', icon: FiBox },
        { path: ROUTES.INVENTORY, label: 'Inventory', icon: FiList },
        { path: ROUTES.DEFECTIVE_INVENTORY, label: 'Defective Inventory', icon: FiBox },
        { path: ROUTES.INVENTORY_HISTORY, label: 'Inventory History', icon: FiClock },
        { path: ROUTES.INTER_COMPANY_HISTORY, label: 'Inter-Company History', icon: FiRepeat },
        { path: !isBkr ? ROUTES.REPLENISHMENT_JSPL : ROUTES.REPLENISHMENT_BKR, label: !isBkr ? 'Need Replenishment' : 'JSPL Requirements', icon: FiRefreshCw },
      ]
    },
    {
      id: 'warehouse',
      label: 'Warehouse Management',
      icon: FiLayers,
      items: [
        { path: ROUTES.WAREHOUSE_STATE_HUBS, label: 'State Hubs Hierarchy', icon: FiLayers },
        { path: ROUTES.WAREHOUSE_MASTER_LIST, label: 'Warehouse List', icon: FiList },
        { path: ROUTES.WAREHOUSE_INVENTORY, label: 'Warehouse Inventory', icon: FiBox },
        { path: ROUTES.LOGISTICS_DISPATCH_DASHBOARD, label: 'Dispatches', icon: FiTruck },
        { path: ROUTES.LOGISTICS_RETURNS, label: 'Returns', icon: FiRefreshCw },
        { path: ROUTES.LOGISTICS_DAMAGE_CLAIMS, label: 'Damage Claims', icon: FiFileText },
        { path: ROUTES.LOGISTICS_RETURN_RECOMMENDATIONS, label: '45-Day Recommendations', icon: FiClock },
        { path: ROUTES.WAREHOUSE_DASHBOARD, label: 'Warehouse Dashboard', icon: FiPieChart },
      ]
    },
    ...(!isBkr ? [{
      id: 'amazon',
      label: 'Amazon',
      icon: FaAmazon,
      items: [
        { path: ROUTES.AMAZON_RETURNS, label: 'Amazon Returns', icon: FiRefreshCw },
        { path: '/amazon/live-inventory', label: 'Live Inventory (SP-API)', icon: FiLayers },
      ]
    }] : []),
    ...(isBkr ? [{
      id: 'accounting',
      label: 'Accounting',
      icon: FiBriefcase,
      items: [
        { path: ROUTES.ACCOUNTING_EXPORT_CENTER, label: 'Export Center', icon: FiFileText },
        { path: ROUTES.ACCOUNTING_MASTER_SYNC, label: 'Master Sync', icon: FiRefreshCw },
        { path: ROUTES.ACCOUNTING_HISTORY, label: 'Export History', icon: FiClock },
        { path: ROUTES.ACCOUNTING_MAPPING, label: 'Mapping', icon: FiLayers },
        { path: ROUTES.ACCOUNTING_CONFIG, label: 'Configuration', icon: FiSettings },
      ]
    }] : []),
    {
      id: 'service',
      label: 'Service',
      icon: FiTool,
      items: [
        { path: ROUTES.SERVICE_DASHBOARD, label: 'Service Dashboard', icon: FiPieChart },
        { path: ROUTES.BKR_JOB_CARDS, label: 'BKR Job Cards', icon: FiFileText },
        { path: ROUTES.SERVICE_CREATE, label: 'New Service', icon: FiFileText },
        { path: ROUTES.SERVICE_RECORDS, label: 'Service Records', icon: FiList },
        { path: ROUTES.SERVICE_HISTORY, label: 'Service History', icon: FiClock },
        { path: ROUTES.SERVICE_REMINDERS, label: 'Service Reminders', icon: FiClock },
      ]
    },
    {
      id: 'reports',
      label: 'Reports',
      icon: FiFileText,
      items: [
        { path: ROUTES.REPORTS, label: 'Reports', icon: FiFileText },
      ]
    },
    {
      id: 'administration',
      label: 'Administration',
      icon: FiSettings,
      items: [
        { path: ROUTES.SETTINGS, label: 'Settings', icon: FiSettings },
        { path: ROUTES.ADMIN_APPROVALS, label: 'Approvals', icon: FiList, badge: pendingCount > 0 },
      ]
    },
    {
      id: 'help',
      label: 'Help & Support',
      icon: FiFileText,
      items: [
        { path: ROUTES.HELP, label: 'User Manual', icon: FiFileText },
      ]
    },
  ];

  return (
    <aside className={`${styles.sidebar} ${isSidebarOpen ? styles.open : styles.closed}`}>
      <div className={styles.header}>
        <h1 className={styles.logo}>{currentCompany ? currentCompany.name : 'Inventory'}</h1>
      </div>
      
      <div className={styles.navContainer}>
        <nav className={styles.nav}>
          {menuConfig.map((section) => (
            <div key={section.id} className={styles.section}>
              <div 
                className={`${styles.sectionHeader} ${openSections[section.id] ? styles.sectionHeaderOpen : ''}`} 
                onClick={() => toggleSection(section.id)}
                title={!isSidebarOpen ? section.label : ''}
              >
                <div className={styles.sectionHeaderInner}>
                  <section.icon className={styles.sectionIcon} />
                  {isSidebarOpen && <span className={styles.sectionTitle}>{section.label}</span>}
                </div>
                {isSidebarOpen && (
                  openSections[section.id] ? <FiChevronDown className={styles.chevron} /> : <FiChevronRight className={styles.chevron} />
                )}
              </div>
              
              {(!isSidebarOpen || openSections[section.id]) && (
                <div className={`${styles.sectionContent} ${!isSidebarOpen ? styles.closedSectionContent : ''}`}>
                  {section.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
                      title={!isSidebarOpen ? item.label : ''}
                    >
                      <item.icon className={styles.icon} />
                      <span className={styles.label}>{item.label}</span>{item.badge && <span className="w-2 h-2 rounded-full bg-red-500 ml-auto mr-2"></span>}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
};

export default Sidebar;

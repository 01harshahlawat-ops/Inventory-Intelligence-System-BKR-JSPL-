import React, { useState, useEffect, useCallback } from 'react';
import halteOrdersService from '../../services/halteOrdersService';
import { useNotificationStore } from '../../stores/notificationStore';
import { 
  FiRefreshCw, FiGlobe, FiSearch, FiCheckCircle, FiAlertCircle, 
  FiClock, FiBox, FiX, FiEye, FiDownload, FiCheck 
} from 'react-icons/fi';
import styles from './HalteOrdersSync.module.css';

const HalteOrdersSync = () => {
  const { addNotification } = useNotificationStore();

  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);

  // Filters & Pagination
  const [lookbackDays, setLookbackDays] = useState(30);
  const [autoDeductPaid, setAutoDeductPaid] = useState(false);
  const [search, setSearch] = useState('');
  const [inventoryStatus, setInventoryStatus] = useState('');
  const [orderState, setOrderState] = useState('');
  const [page, setPage] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const limit = 50;

  // Selected Order for Details Modal
  const [selectedOrder, setSelectedOrder] = useState(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await halteOrdersService.getStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load Halte order stats:', err);
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await halteOrdersService.getOrders({
        page,
        limit,
        inventory_status: inventoryStatus || undefined,
        order_state: orderState || undefined,
        search: search.trim() || undefined
      });
      setOrders(res.orders || []);
      setTotalOrders(res.total || 0);
    } catch (err) {
      console.error('Failed to fetch Halte orders:', err);
      addNotification({
        type: 'error',
        message: 'Failed to load website orders from database.'
      });
    } finally {
      setLoading(false);
    }
  }, [page, inventoryStatus, orderState, search, addNotification]);

  useEffect(() => {
    fetchStats();
    fetchOrders();
  }, [fetchStats, fetchOrders]);

  const handleSyncFromHalte = async () => {
    setSyncing(true);
    try {
      const isAll = lookbackDays === 'all';
      const res = await halteOrdersService.syncOrders({
        lookback_days: isAll ? 365 : Number(lookbackDays),
        sync_all: isAll,
        auto_deduct_paid: autoDeductPaid
      });
      addNotification({
        type: 'success',
        message: res.message || 'Halte.in orders successfully synced!'
      });
      await fetchStats();
      await fetchOrders();
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Failed to sync with Halte.in API';
      addNotification({
        type: 'error',
        message: `Sync Error: ${msg}`
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleDeductOrder = async (orderId) => {
    setActionLoadingId(orderId);
    try {
      const res = await halteOrdersService.deductOrder(orderId);
      addNotification({
        type: 'success',
        message: res.message || `Order #${orderId} deducted from JSPL VSHB inventory.`
      });
      await fetchStats();
      await fetchOrders();
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Failed to deduct order';
      addNotification({
        type: 'error',
        message: `Deduction Failed: ${msg}`
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleBatchDeduct = async () => {
    if (!window.confirm('Are you sure you want to deduct all pending PAID & Shipped orders from JSPL (VSHB) inventory?')) {
      return;
    }
    setLoading(true);
    try {
      const res = await halteOrdersService.batchDeduct();
      addNotification({
        type: 'success',
        message: `Batch deduction completed! Processed ${res.processed_count} orders (${res.successful_ids?.length || 0} successful).`
      });
      await fetchStats();
      await fetchOrders();
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Failed during batch deduction';
      addNotification({
        type: 'error',
        message: `Batch Deduction Failed: ${msg}`
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSkipOrder = async (orderId) => {
    try {
      await halteOrdersService.skipOrder(orderId);
      addNotification({
        type: 'info',
        message: `Order #${orderId} marked as SKIPPED.`
      });
      await fetchStats();
      await fetchOrders();
    } catch (err) {
      addNotification({
        type: 'error',
        message: 'Failed to update order status.'
      });
    }
  };

  const formatCurrency = (amt) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amt || 0);
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return isoStr;
    }
  };

  const totalPages = Math.ceil(totalOrders / limit) || 1;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h1>
            <FiGlobe style={{ color: '#2563eb' }} />
            Halte Orders Sync (Website Orders)
          </h1>
          <p>Live order synchronization from Halte.in web store. Orders are mapped and deducted from JSPL Central warehouse.</p>
          <div className={styles.warehouseBadge}>
            <FiBox /> Deduction Target: JSPL - Central (VSHB)
          </div>
        </div>

        <div className={styles.actionControls}>
          <select 
            className={styles.lookbackSelect}
            value={lookbackDays} 
            onChange={(e) => setLookbackDays(e.target.value)}
          >
            <option value="7">Last 7 Days</option>
            <option value="15">Last 15 Days</option>
            <option value="30">Last 30 Days</option>
            <option value="60">Last 60 Days</option>
            <option value="90">Last 90 Days</option>
            <option value="all">All Time (Complete History)</option>
          </select>

          <label className={styles.autoSyncToggle} title="If enabled, newly fetched paid/shipped orders will automatically deduct from JSPL inventory">
            <input 
              type="checkbox" 
              checked={autoDeductPaid} 
              onChange={(e) => setAutoDeductPaid(e.target.checked)} 
            />
            Auto-Deduct Paid
          </label>

          <button 
            className={styles.syncBtn} 
            onClick={handleSyncFromHalte} 
            disabled={syncing}
          >
            <FiRefreshCw className={syncing ? 'spin-icon' : ''} />
            {syncing ? 'Syncing Halte.in...' : 'Sync Latest Orders'}
          </button>

          {stats?.pending_deduction > 0 && (
            <button 
              className={styles.batchDeductBtn}
              onClick={handleBatchDeduct}
              disabled={loading || syncing}
            >
              <FiCheck />
              Deduct All Pending Paid ({stats.pending_deduction})
            </button>
          )}
        </div>
      </div>

      {/* Metrics Summary */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Total Website Orders</div>
          <div className={styles.metricValue}>{stats?.total_orders ?? 0}</div>
          <div className={styles.metricSub}>Recorded from Halte.in</div>
        </div>

        <div className={`${styles.metricCard} ${styles.revenueCard}`}>
          <div className={styles.metricLabel}>Total Website GMV</div>
          <div className={styles.metricValue}>{formatCurrency(stats?.total_revenue)}</div>
          <div className={styles.metricSub}>Combined order value</div>
        </div>

        <div className={`${styles.metricCard} ${styles.pendingCard}`}>
          <div className={styles.metricLabel}>Pending JSPL Deduction</div>
          <div className={styles.metricValue} style={{ color: stats?.pending_deduction > 0 ? '#d97706' : '#111827' }}>
            {stats?.pending_deduction ?? 0}
          </div>
          <div className={styles.metricSub}>Paid orders awaiting stock deduction</div>
        </div>

        <div className={`${styles.metricCard} ${styles.deductedCard}`}>
          <div className={styles.metricLabel}>Deducted From JSPL</div>
          <div className={styles.metricValue} style={{ color: '#059669' }}>
            {stats?.deducted_count ?? 0}
          </div>
          <div className={styles.metricSub}>Stock balance updated in VSHB</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className={styles.filterCard}>
        <div className={styles.searchBox}>
          <FiSearch className={styles.searchIcon} />
          <input 
            type="text"
            className={styles.searchInput}
            placeholder="Search by Order ID (#10376), customer name, phone, city..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <select 
          className={styles.filterSelect}
          value={inventoryStatus}
          onChange={(e) => {
            setInventoryStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All Inventory Statuses</option>
          <option value="PENDING">Pending Deduction</option>
          <option value="DEDUCTED">Deducted from JSPL</option>
          <option value="SKIPPED">Skipped</option>
        </select>

        <select 
          className={styles.filterSelect}
          value={orderState}
          onChange={(e) => {
            setOrderState(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All Order States</option>
          <option value="PAID">PAID</option>
          <option value="Shipped">Shipped</option>
          <option value="UNPAID">UNPAID / COD</option>
          <option value="Delivered">Delivered</option>
          <option value="Cancelled">Cancelled</option>
        </select>
      </div>

      {/* Orders Table */}
      <div className={styles.tableCard}>
        <div className={styles.tableResponsive}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Order Date</th>
                <th>Customer Details</th>
                <th>Destination</th>
                <th>Items (SKU & Qty)</th>
                <th>Order Total</th>
                <th>Payment Status</th>
                <th>JSPL Inventory Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '36px' }}>
                    Loading website orders...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan="9">
                    <div className={styles.emptyState}>
                      <FiGlobe style={{ fontSize: '32px', marginBottom: '8px', color: '#9ca3af' }} />
                      <p>No website orders found matching the filter criteria.</p>
                      <button className={styles.syncBtn} onClick={handleSyncFromHalte} style={{ marginTop: '8px' }}>
                        Sync Now from Halte.in
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                orders.map((ord) => {
                  const stateLower = (ord.order_state || '').toLowerCase();
                  const isPaid = stateLower === 'paid' || stateLower === 'shipped' || stateLower === 'delivered';
                  const isDeducted = ord.inventory_status === 'DEDUCTED';
                  const isSkipped = ord.inventory_status === 'SKIPPED';

                  return (
                    <tr key={ord.order_id}>
                      <td>
                        <span 
                          className={styles.orderId}
                          onClick={() => setSelectedOrder(ord)}
                          title="Click to view order details"
                        >
                          #{ord.order_id}
                        </span>
                      </td>

                      <td style={{ fontSize: '13px', color: '#4b5563', whiteSpace: 'nowrap' }}>
                        {formatDate(ord.order_time)}
                      </td>

                      <td>
                        <div className={styles.customerInfo}>
                          <span className={styles.customerName}>{ord.customer_name || 'Walk-in Customer'}</span>
                          <span className={styles.customerMeta}>{ord.customer_phone || ord.customer_email || '-'}</span>
                        </div>
                      </td>

                      <td>
                        <div className={styles.customerMeta}>
                          {ord.ship_city ? `${ord.ship_city}, ${ord.ship_state || ''}` : '-'}
                          {ord.ship_postal_code && ` (${ord.ship_postal_code})`}
                        </div>
                      </td>

                      <td>
                        <div className={styles.itemsSummary}>
                          {ord.items?.map((item, idx) => (
                            <div key={idx} className={styles.itemLine}>
                              <span className={styles.itemSku}>{item.sku}</span>
                              <span className={styles.itemQty}>x {item.quantity}</span>
                              <span style={{ fontSize: '12px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {item.product_title || ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>

                      <td className={styles.amount}>
                        {formatCurrency(ord.total_amount)}
                      </td>

                      <td>
                        <span className={`
                          ${styles.badge} 
                          ${isPaid ? (stateLower === 'shipped' ? styles.badgeShipped : styles.badgePaid) : styles.badgeUnpaid}
                        `}>
                          {ord.order_state}
                        </span>
                      </td>

                      <td>
                        {isDeducted ? (
                          <span className={`${styles.badge} ${styles.badgeDeducted}`} title={`Deducted at ${formatDate(ord.deducted_at)}`}>
                            <FiCheckCircle /> Deducted (VSHB)
                          </span>
                        ) : isSkipped ? (
                          <span className={`${styles.badge} ${styles.badgeSkipped}`}>
                            Skipped
                          </span>
                        ) : (
                          <span className={`${styles.badge} ${styles.badgePending}`}>
                            <FiAlertCircle /> Pending Deduction
                          </span>
                        )}
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        <div className={styles.actionBtnGroup} style={{ justifyContent: 'flex-end' }}>
                          {!isDeducted && !isSkipped && (
                            <>
                              <button 
                                className={styles.actionDeductBtn}
                                onClick={() => handleDeductOrder(ord.order_id)}
                                disabled={actionLoadingId === ord.order_id}
                                title="Deduct items from JSPL VSHB stock"
                              >
                                {actionLoadingId === ord.order_id ? 'Deducting...' : 'Deduct JSPL'}
                              </button>
                              <button 
                                className={styles.actionSkipBtn}
                                onClick={() => handleSkipOrder(ord.order_id)}
                                title="Skip inventory deduction"
                              >
                                Skip
                              </button>
                            </>
                          )}
                          <button 
                            className={styles.actionViewBtn}
                            onClick={() => setSelectedOrder(ord)}
                            title="View Full Order Details"
                          >
                            <FiEye />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalOrders > limit && (
          <div className={styles.pagination}>
            <div>
              Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, totalOrders)} of {totalOrders} orders
            </div>
            <div className={styles.pageControls}>
              <button 
                className={styles.pageBtn} 
                disabled={page <= 1} 
                onClick={() => setPage(p => p - 1)}
              >
                Previous
              </button>
              <span style={{ padding: '6px 12px' }}>Page {page} of {totalPages}</span>
              <button 
                className={styles.pageBtn} 
                disabled={page >= totalPages} 
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Order Details Modal */}
      {selectedOrder && (
        <div className={styles.modalBackdrop} onClick={() => setSelectedOrder(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 style={{ margin: 0 }}>Halte.in Order #{selectedOrder.order_id} Details</h3>
              <button className={styles.modalClose} onClick={() => setSelectedOrder(null)}>
                <FiX />
              </button>
            </div>

            <div className={styles.modalGrid}>
              <div className={styles.modalSection}>
                <h4>Customer Information</h4>
                <div><strong>Name:</strong> {selectedOrder.customer_name || 'N/A'}</div>
                <div><strong>Phone:</strong> {selectedOrder.customer_phone || 'N/A'}</div>
                <div><strong>Email:</strong> {selectedOrder.customer_email || 'N/A'}</div>
                {selectedOrder.gst_no && <div><strong>GSTIN:</strong> {selectedOrder.gst_no}</div>}
                {selectedOrder.company_name && <div><strong>Company:</strong> {selectedOrder.company_name}</div>}
              </div>

              <div className={styles.modalSection}>
                <h4>Order Summary</h4>
                <div><strong>Order Date:</strong> {formatDate(selectedOrder.order_time)}</div>
                <div><strong>Status:</strong> {selectedOrder.order_state}</div>
                <div><strong>Total Amount:</strong> {formatCurrency(selectedOrder.total_amount)}</div>
                <div><strong>JSPL Inventory Status:</strong> {selectedOrder.inventory_status}</div>
                {selectedOrder.deducted_at && (
                  <div><strong>Deducted At:</strong> {formatDate(selectedOrder.deducted_at)}</div>
                )}
              </div>
            </div>

            {selectedOrder.shipping_address && (
              <div className={styles.modalSection} style={{ marginBottom: '16px' }}>
                <h4>Shipping Address</h4>
                <div>{selectedOrder.shipping_address.address_line_1 || selectedOrder.shipping_address.line1}</div>
                {(selectedOrder.shipping_address.address_line_2 || selectedOrder.shipping_address.line2) && (
                  <div>{selectedOrder.shipping_address.address_line_2 || selectedOrder.shipping_address.line2}</div>
                )}
                <div>
                  {selectedOrder.shipping_address.city}, {selectedOrder.shipping_address.state} - {selectedOrder.shipping_address.zip_code}
                </div>
              </div>
            )}

            <h4>Order Items ({selectedOrder.items?.length || 0})</h4>
            <table className={styles.modalItemsTable}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Product Title</th>
                  <th>Quantity</th>
                  <th>Price at Purchase</th>
                  <th>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {selectedOrder.items?.map((it, idx) => (
                  <tr key={idx}>
                    <td><code>{it.sku}</code></td>
                    <td>{it.product_title || it.sku}</td>
                    <td>{it.quantity}</td>
                    <td>{formatCurrency(it.price_at_purchase)}</td>
                    <td>{formatCurrency((it.quantity || 1) * (it.price_at_purchase || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              {selectedOrder.inventory_status !== 'DEDUCTED' && selectedOrder.inventory_status !== 'SKIPPED' && (
                <button 
                  className={styles.actionDeductBtn} 
                  style={{ padding: '8px 16px', fontSize: '13px' }}
                  onClick={() => {
                    handleDeductOrder(selectedOrder.order_id);
                    setSelectedOrder(null);
                  }}
                >
                  Deduct from JSPL Inventory (VSHB)
                </button>
              )}
              <button 
                className={styles.actionSkipBtn} 
                style={{ padding: '8px 16px' }} 
                onClick={() => setSelectedOrder(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HalteOrdersSync;

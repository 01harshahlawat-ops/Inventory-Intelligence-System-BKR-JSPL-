import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import halteServiceBookingService from '../../services/halteServiceBookingService';
import { useNotificationStore } from '../../stores/notificationStore';
import useCompanyStore from '../../stores/useCompanyStore';
import { 
  FiTool, FiGlobe, FiClock, FiCheckCircle, FiSearch, 
  FiRefreshCw, FiEye, FiX, FiPlus, FiAlertCircle 
} from 'react-icons/fi';
import styles from './ServiceDashboard.module.css';

export default function ServiceDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { addNotification } = useNotificationStore();
  const currentCompany = useCompanyStore(state => state.currentCompany);

  // Tab: 'halte' (default) or 'offline'
  const initialTab = searchParams.get('tab') || 'halte';
  const [activeTab, setActiveTab] = useState(initialTab);

  // Offline service stats
  const [offlineStats, setOfflineStats] = useState({
    pending: 0,
    completed: 0,
    replacements: 0,
    upcomingReminders: 0
  });
  const [offlineLoading, setOfflineLoading] = useState(false);

  // Halte Service Portal state
  const [halteBookings, setHalteBookings] = useState([]);
  const [halteSummary, setHalteSummary] = useState({
    total: 0, pending: 0, assigned: 0, ongoing: 0, completed: 0, returned: 0, cancelled: 0, paid: 0
  });
  const [halteLoading, setHalteLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [updatingId, setUpdatingId] = useState(null);

  // Selected Booking Modal
  const [selectedBooking, setSelectedBooking] = useState(null);

  const switchTab = (tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // Fetch Offline Service Data
  const fetchOfflineData = useCallback(async () => {
    if (!currentCompany?.id) return;
    try {
      setOfflineLoading(true);
      const [activeRes, historyRes, remindersRes] = await Promise.all([
        api.get('/api/services/?status=active').catch(() => ({ data: [] })),
        api.get('/api/services/?status=history').catch(() => ({ data: [] })),
        api.get('/api/service-reminders').catch(() => ({ data: [] }))
      ]);

      const activeServices = activeRes.data?.items || activeRes.data || [];
      const historyServices = historyRes.data?.items || historyRes.data || [];
      const reminders = remindersRes.data?.items || remindersRes.data || [];

      const pending = activeServices.filter(s => s.status === 'Pending').length;
      const completed = historyServices.filter(s => s.status === 'Completed').length;
      const upcomingReminders = reminders.filter(r => r.status === 'Pending').length;

      setOfflineStats({ pending, completed, replacements: 0, upcomingReminders });
    } catch (err) {
      console.error('Error fetching offline service data:', err);
    } finally {
      setOfflineLoading(false);
    }
  }, [currentCompany]);

  // Fetch Halte Service Portal Bookings
  const fetchHalteData = useCallback(async () => {
    try {
      setHalteLoading(true);
      const res = await halteServiceBookingService.getBookings({
        search: searchTerm.trim() || undefined,
        booking_status: statusFilter || undefined,
        limit: 150
      });
      setHalteBookings(res.bookings || []);
      if (res.summary) {
        setHalteSummary(res.summary);
      }
    } catch (err) {
      console.error('Error fetching Halte service bookings:', err);
      addNotification({
        type: 'error',
        message: 'Could not load service bookings from Halte.in portal.'
      });
    } finally {
      setHalteLoading(false);
    }
  }, [searchTerm, statusFilter, addNotification]);

  useEffect(() => {
    fetchHalteData();
    fetchOfflineData();
  }, [fetchHalteData, fetchOfflineData]);

  // Handle Quick Status Update on Halte.in
  const handleStatusUpdate = async (bookingId, newStatus) => {
    setUpdatingId(bookingId);
    try {
      await halteServiceBookingService.updateStatus(bookingId, newStatus);
      addNotification({
        type: 'success',
        message: `Booking #${bookingId} updated to ${newStatus} on Halte.in`
      });
      await fetchHalteData();
      if (selectedBooking && selectedBooking.booking_id === bookingId) {
        setSelectedBooking(prev => ({ ...prev, booking_status: newStatus }));
      }
    } catch (err) {
      addNotification({
        type: 'error',
        message: `Status update failed: ${err.message || 'Error connecting to Halte.in'}`
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h1>
            <FiTool style={{ color: '#2563eb' }} />
            Service Management & Halte Portal
          </h1>
          <p>Unified service operations across Halte.in web customer bookings and offline BKR workshop job cards.</p>

          <div className={styles.tabNav}>
            <button 
              className={`${styles.tabBtn} ${activeTab === 'halte' ? styles.tabBtnActive : ''}`}
              onClick={() => switchTab('halte')}
            >
              <FiGlobe />
              Halte.in Web Bookings (Portal)
              <span className={styles.tabBadge}>{halteSummary.total}</span>
            </button>
            <button 
              className={`${styles.tabBtn} ${activeTab === 'offline' ? styles.tabBtnActive : ''}`}
              onClick={() => switchTab('offline')}
            >
              <FiTool />
              Offline Service Records (BKR)
            </button>
          </div>
        </div>

        <div>
          {activeTab === 'halte' ? (
            <button 
              className={styles.btnSecondary}
              onClick={fetchHalteData}
              disabled={halteLoading}
            >
              <FiRefreshCw className={halteLoading ? 'spin-icon' : ''} />
              Refresh Portal
            </button>
          ) : (
            <button 
              className={styles.btnPrimary}
              onClick={() => navigate('/service/create')}
            >
              <FiPlus />
              + New Service Record
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: HALTE SERVICE PORTAL */}
      {activeTab === 'halte' && (
        <>
          {/* Halte Metrics */}
          <div className={styles.metricsGrid}>
            <div className={styles.metricCard} onClick={() => setStatusFilter('')}>
              <div className={styles.metricLabel}>Total Web Requests</div>
              <div className={styles.metricValue}>{halteSummary.total}</div>
            </div>

            <div className={`${styles.metricCard} ${styles.cardOngoing}`} onClick={() => setStatusFilter('ONGOING')}>
              <div className={styles.metricLabel}>Ongoing Repairs</div>
              <div className={styles.metricValue} style={{ color: '#2563eb' }}>{halteSummary.ongoing}</div>
            </div>

            <div className={`${styles.metricCard} ${styles.cardAssigned}`} onClick={() => setStatusFilter('ASSIGNED')}>
              <div className={styles.metricLabel}>Assigned to Tech</div>
              <div className={styles.metricValue} style={{ color: '#d97706' }}>{halteSummary.assigned}</div>
            </div>

            <div className={`${styles.metricCard} ${styles.cardCompleted}`} onClick={() => setStatusFilter('COMPLETED')}>
              <div className={styles.metricLabel}>Completed Repairs</div>
              <div className={styles.metricValue} style={{ color: '#059669' }}>{halteSummary.completed}</div>
            </div>

            <div className={`${styles.metricCard} ${styles.cardPaid}`} onClick={() => setStatusFilter('')}>
              <div className={styles.metricLabel}>Paid Bookings</div>
              <div className={styles.metricValue} style={{ color: '#4f46e5' }}>{halteSummary.paid}</div>
            </div>
          </div>

          {/* Filters */}
          <div className={styles.filterCard}>
            <div className={styles.searchBox}>
              <FiSearch className={styles.searchIcon} />
              <input 
                type="text"
                className={styles.searchInput}
                placeholder="Search by Booking ID (SB-0131), customer, phone, brand, model..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select 
              className={styles.filterSelect}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses ({halteSummary.total})</option>
              <option value="ASSIGNED">Assigned ({halteSummary.assigned})</option>
              <option value="ONGOING">Ongoing ({halteSummary.ongoing})</option>
              <option value="COMPLETED">Completed ({halteSummary.completed})</option>
              <option value="RETURNED">Returned ({halteSummary.returned})</option>
              <option value="CANCELLED">Cancelled ({halteSummary.cancelled})</option>
              <option value="PENDING">Pending Action ({halteSummary.pending})</option>
            </select>
          </div>

          {/* Bookings Table */}
          <div className={styles.tableCard}>
            <div className={styles.tableResponsive}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Booking ID</th>
                    <th>Booking Date</th>
                    <th>Customer Name & Phone</th>
                    <th>Tool / Brand</th>
                    <th>Reported Issue</th>
                    <th>Service Type</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {halteLoading ? (
                    <tr>
                      <td colSpan="9" style={{ textAlign: 'center', padding: '36px' }}>
                        Loading Halte.in service portal bookings...
                      </td>
                    </tr>
                  ) : halteBookings.length === 0 ? (
                    <tr>
                      <td colSpan="9" style={{ textAlign: 'center', padding: '36px', color: '#6b7280' }}>
                        No service bookings found matching current filters.
                      </td>
                    </tr>
                  ) : (
                    halteBookings.map((b) => {
                      const st = (b.booking_status || 'PENDING').toUpperCase();
                      const pay = (b.payment_status || 'PENDING').toUpperCase();

                      return (
                        <tr key={b.booking_id}>
                          <td>
                            <span 
                              className={styles.bookingId}
                              onClick={() => setSelectedBooking(b)}
                              title="Click to view full booking details"
                            >
                              {b.booking_id}
                            </span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>{formatDate(b.created_at || b.booking_date)}</td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{b.customer_name || 'Customer'}</div>
                            <div style={{ fontSize: '12px', color: '#6b7280' }}>{b.customer_phone}</div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{b.brand || '-'}</div>
                            <div style={{ fontSize: '12px', color: '#6b7280' }}>{b.category || b.model_no || ''}</div>
                          </td>
                          <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.problem || b.issue_description || 'General Service'}
                          </td>
                          <td style={{ fontSize: '12px', color: '#4b5563' }}>
                            {b.service || b.service_type || 'Repair'}
                          </td>
                          <td>
                            <span className={`
                              ${styles.badge}
                              ${st === 'COMPLETED' ? styles.badgeCompleted : ''}
                              ${st === 'ONGOING' ? styles.badgeOngoing : ''}
                              ${st === 'ASSIGNED' ? styles.badgeAssigned : ''}
                              ${st === 'CANCELLED' ? styles.badgeCancelled : ''}
                              ${st === 'RETURNED' ? styles.badgeReturned : ''}
                              ${st === 'PENDING' ? styles.badgePending : ''}
                            `}>
                              {st}
                            </span>
                          </td>
                          <td>
                            <span className={`
                              ${styles.badge}
                              ${pay === 'PAID' ? styles.badgePaid : styles.badgeUnpaid}
                            `}>
                              {pay}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div className={styles.actionBtnGroup} style={{ justifyContent: 'flex-end' }}>
                              <select 
                                className={styles.statusSelect}
                                value={st}
                                disabled={updatingId === b.booking_id}
                                onChange={(e) => handleStatusUpdate(b.booking_id, e.target.value)}
                              >
                                <option value="ASSIGNED">Assigned</option>
                                <option value="ONGOING">Ongoing</option>
                                <option value="COMPLETED">Completed</option>
                                <option value="RETURNED">Returned</option>
                                <option value="CANCELLED">Cancelled</option>
                              </select>

                              <button 
                                className={styles.btnSecondary}
                                style={{ padding: '4px 8px' }}
                                onClick={() => setSelectedBooking(b)}
                                title="View Details"
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
          </div>
        </>
      )}

      {/* TAB 2: OFFLINE SERVICE RECORDS */}
      {activeTab === 'offline' && (
        <div className={styles.metricsGrid}>
          <div className={styles.metricCard} onClick={() => navigate('/service/records')}>
            <div className={styles.metricLabel}>Active / Pending Offline</div>
            <div className={styles.metricValue}>{offlineStats.pending}</div>
          </div>
          
          <div className={styles.metricCard} onClick={() => navigate('/service/history')}>
            <div className={styles.metricLabel}>Completed Services</div>
            <div className={styles.metricValue}>{offlineStats.completed}</div>
          </div>
          
          <div className={styles.metricCard} onClick={() => navigate('/service/reminders')}>
            <div className={styles.metricLabel}>Upcoming Reminders</div>
            <div className={styles.metricValue}>{offlineStats.upcomingReminders}</div>
          </div>
        </div>
      )}

      {/* Selected Booking Modal */}
      {selectedBooking && (
        <div className={styles.modalBackdrop} onClick={() => setSelectedBooking(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 style={{ margin: 0 }}>Halte.in Web Service Booking: {selectedBooking.booking_id}</h3>
              <button className={styles.modalClose} onClick={() => setSelectedBooking(null)}>
                <FiX />
              </button>
            </div>

            <div className={styles.modalGrid}>
              <div className={styles.modalSection}>
                <h4>Customer Details</h4>
                <div><strong>Name:</strong> {selectedBooking.customer_name || 'N/A'}</div>
                <div><strong>Phone:</strong> {selectedBooking.customer_phone || 'N/A'}</div>
                <div><strong>Email:</strong> {selectedBooking.customer_email || 'N/A'}</div>
                <div><strong>Address:</strong> {selectedBooking.address_line1 || selectedBooking.address || '-'}</div>
                <div><strong>City / State:</strong> {selectedBooking.city}, {selectedBooking.state} - {selectedBooking.pincode}</div>
              </div>

              <div className={styles.modalSection}>
                <h4>Machine & Problem</h4>
                <div><strong>Brand:</strong> {selectedBooking.brand || 'N/A'}</div>
                <div><strong>Category:</strong> {selectedBooking.category || 'N/A'}</div>
                <div><strong>Model / Power:</strong> {selectedBooking.model_no || selectedBooking.power_type || 'N/A'}</div>
                <div><strong>Serial No:</strong> {selectedBooking.serial_no || 'N/A'}</div>
                <div><strong>Issue:</strong> {selectedBooking.problem || selectedBooking.issue_description || 'General Service'}</div>
              </div>
            </div>

            <div className={styles.modalSection} style={{ marginBottom: '16px' }}>
              <h4>Service & Technician Details</h4>
              <div><strong>Service Type:</strong> {selectedBooking.service || selectedBooking.service_type || 'Insite / Workshop'}</div>
              <div><strong>Workshop / Location:</strong> {selectedBooking.location_range || 'HALTE Workshop'}</div>
              <div><strong>Technician ID:</strong> {selectedBooking.technician_id || 'Not assigned'}</div>
              <div><strong>Current Status:</strong> <strong>{selectedBooking.booking_status}</strong></div>
              <div><strong>Payment Status:</strong> <strong>{selectedBooking.payment_status}</strong></div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>Change Status:</span>
                <select 
                  className={styles.statusSelect}
                  value={selectedBooking.booking_status || 'PENDING'}
                  onChange={(e) => handleStatusUpdate(selectedBooking.booking_id, e.target.value)}
                >
                  <option value="ASSIGNED">Assigned</option>
                  <option value="ONGOING">Ongoing</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="RETURNED">Returned</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>

              <button 
                className={styles.btnSecondary} 
                onClick={() => setSelectedBooking(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import api from './api';

export const halteServiceBookingService = {
  getStats: async () => {
    const res = await api.get('/api/halte-service/stats');
    return res.data;
  },

  getBookings: async (params = {}) => {
    const res = await api.get('/api/halte-service/bookings', { params });
    return res.data;
  },

  updateStatus: async (bookingId, bookingStatus, remarks = null, technicianId = null) => {
    const res = await api.patch(`/api/halte-service/bookings/${bookingId}/status`, {
      booking_status: bookingStatus,
      remarks,
      technician_id: technicianId
    });
    return res.data;
  }
};

export default halteServiceBookingService;

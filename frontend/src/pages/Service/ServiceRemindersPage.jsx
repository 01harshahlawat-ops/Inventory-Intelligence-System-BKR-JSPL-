import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { formatDate } from '../../utils/dateUtils';
import useCompanyStore from '../../stores/useCompanyStore';

export default function ServiceRemindersPage() {
  const currentCompany = useCompanyStore(state => state.currentCompany);
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchReminders = () => {
    setLoading(true);
    api.get('/api/service-reminders')
      .then(res => setReminders(res.data?.items || res.data || []))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (currentCompany?.id) {
      fetchReminders();
    }
  }, [currentCompany]);

  const updateStatus = async (id, status) => {
    try {
      await api.post(`/api/service-reminders/${id}/status`, { status });
      fetchReminders();
    } catch (err) {
      console.error('Failed to update status', err);
      alert('Failed to update reminder status');
    }
  };

  const thStyle = { textAlign: 'left', padding: '12px', borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb', color: '#374151' };
  const tdStyle = { padding: '12px', borderBottom: '1px solid #e5e7eb' };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2>Service Reminders</h2>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>Loading...</div>
        ) : reminders.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>No reminders found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Note</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reminders.map(rem => (
                <tr key={rem.id}>
                  <td style={tdStyle}>{formatDate(rem.reminder_date)}</td>
                  <td style={tdStyle}>{rem.customer_name || 'N/A'}</td>
                  <td style={tdStyle}>{rem.note}</td>
                  <td style={tdStyle}>
                    <span style={{ padding: '4px 8px', backgroundColor: rem.status === 'Pending' ? '#fef3c7' : '#dcfce7', color: rem.status === 'Pending' ? '#92400e' : '#166534', borderRadius: '9999px', fontSize: '12px', fontWeight: '500' }}>
                      {rem.status}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {rem.status === 'Pending' && (
                      <button 
                        onClick={() => updateStatus(rem.id, 'Completed')}
                        style={{ padding: '6px 12px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '500' }}
                      >
                        Mark Completed
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

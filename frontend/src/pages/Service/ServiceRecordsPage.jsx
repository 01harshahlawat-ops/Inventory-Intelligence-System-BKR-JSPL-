import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { formatDate } from '../../utils/dateUtils';
import useCompanyStore from '../../stores/useCompanyStore';

export default function ServiceRecordsPage() {
  const navigate = useNavigate();
  const currentCompany = useCompanyStore(state => state.currentCompany);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentCompany?.id) {
      setLoading(true);
      api.get('/api/services/?status=active')
        .then(res => setServices(res.data?.items || res.data || []))
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    }
  }, [currentCompany]);

  const thStyle = { textAlign: 'left', padding: '12px', borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb', color: '#374151' };
  const tdStyle = { padding: '12px', borderBottom: '1px solid #e5e7eb' };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2>Active Service Records</h2>
        <button 
          onClick={() => navigate('/service/create')}
          style={{ padding: '10px 20px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' }}
        >
          + New Service
        </button>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>Loading...</div>
        ) : services.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>No active service records found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.map(srv => (
                <tr key={srv.id} style={{ transition: 'background-color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <td style={tdStyle}>#{srv.id}</td>
                  <td style={tdStyle}>{formatDate(srv.created_at || srv.date)}</td>
                  <td style={tdStyle}>{srv.customer_name || 'N/A'}</td>
                  <td style={tdStyle}>{srv.service_type}</td>
                  <td style={tdStyle}>
                    <span style={{ padding: '4px 8px', backgroundColor: '#dbeafe', color: '#1e40af', borderRadius: '9999px', fontSize: '12px', fontWeight: '500' }}>
                      {srv.status}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <button 
                      onClick={() => navigate(`/service/${srv.id}`)}
                      style={{ padding: '6px 12px', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      View Details
                    </button>
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

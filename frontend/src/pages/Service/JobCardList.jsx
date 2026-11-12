import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useJobCards } from '../../hooks/useServices';
import Button from '../../components/forms/Button';
import PageContainer from '../../components/layout/PageContainer';
import { Card } from '../../components/Card/Card';
import { DataTable, TableHeader } from '../../components/DataTable';
import { formatDate } from '../../utils/dateUtils';
import { FiPlus, FiEye, FiPrinter, FiFileText } from 'react-icons/fi';

const JobCardList = () => {
  const navigate = useNavigate();
  const { data: jobCards, isLoading, error } = useJobCards();

  if (isLoading) return <PageContainer title="Job Cards"><div className="p-4 text-center">Loading Job Cards...</div></PageContainer>;
  if (error) return <PageContainer title="Job Cards"><div className="text-red-500">Error loading Job Cards: {error.message}</div></PageContainer>;

  const cards = jobCards ?? [];

  const columns = [
    { key: 'service_number', label: 'Job Card No' },
    { key: 'service_date', label: 'Date' },
    { key: 'customer_name_snapshot', label: 'Customer' },
    { key: 'machine', label: 'Machine' },
    { key: 'status', label: 'Status' },
    { key: 'actions', label: 'Actions' }
  ];

  return (
    <PageContainer 
      title="Job Cards"
      actions={
        <Button onClick={() => navigate('/services/job-cards/new')} icon={<FiPlus />}>
          New Job Card
        </Button>
      }
    >
      <Card noPadding>
        <div style={{ overflowX: 'auto' }}>
          <DataTable>
            <TableHeader columns={columns} />
            <tbody>
              {cards.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '1rem', color: 'var(--color-neutral-500)' }}>
                    No Job Cards found.
                  </td>
                </tr>
              ) : (
                cards.map((card) => (
                  <tr key={card.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td>{card.service_number}</td>
                    <td>{formatDate(card.service_date)}</td>
                    <td>{card.customer_name_snapshot}</td>
                    <td>{card.machine_type} {card.brand ? `(${card.brand})` : ''}</td>
                    <td>
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        card.status === 'COMPLETED' ? 'bg-green-100 text-green-800' : 
                        card.status === 'IN_PROGRESS' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {card.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => navigate(`/services/job-cards/${card.id}`)} style={{ color: 'var(--color-primary-600)' }} title="View Job Card">
                          <FiEye />
                        </button>
                        <button onClick={() => navigate(`/services/job-cards/${card.id}/print`)} style={{ color: '#4b5563' }} title="Print Job Card">
                          <FiPrinter />
                        </button>
                        {card.status === 'COMPLETED' && (
                          <button onClick={() => navigate(`/services/invoices/${card.id}`)} style={{ color: 'var(--color-success-600)' }} title="Generate Invoice">
                            <FiFileText />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </div>
      </Card>
    </PageContainer>
  );
};

export default JobCardList;

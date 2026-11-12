import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import PageContainer from '../../components/layout/PageContainer';
import { Card } from '../../components/Card/Card';
import { DataTable, TableHeader, TableRow } from '../../components/DataTable';
import { formatDate } from '../../utils/dateUtils';
import styles from './DefectiveInventory.module.css';

const DefectiveInventory = () => {
    const [statusFilter, setStatusFilter] = useState('');
    const [search, setSearch] = useState('');

    const { data: defectives = [], isLoading } = useQuery({
        queryKey: ['defectiveInventory', statusFilter, search],
        queryFn: async () => {
            const params = {};
            if (statusFilter) params.status = statusFilter;
            if (search) params.sku = search;
            const res = await api.get('/api/defective-inventory/', { params });
            return res.data;
        }
    });

    return (
        <PageContainer title="Defective Inventory" subtitle="Manage unsellable products from returns and inspections.">

            <div className={styles.filters}>
                <input 
                    type="text" 
                    placeholder="Search SKU..." 
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className={styles.searchInput}
                />
                <select 
                    value={statusFilter} 
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className={styles.selectInput}
                >
                    <option value="">All Statuses</option>
                    <option value="NEW">New</option>
                    <option value="UNDER_REVIEW">Under Review</option>
                    <option value="REPAIR">Repair</option>
                    <option value="RETURN_VENDOR">Return to Vendor</option>
                    <option value="SCRAPPED">Scrapped</option>
                    <option value="DISPOSED">Disposed</option>
                </select>
            </div>

            <Card noPadding>
                <div className={styles.tableContainer}>
                    <DataTable>
                        <TableHeader columns={[
                            { key: 'sku', label: 'SKU' },
                            { key: 'product', label: 'Product' },
                            { key: 'returnId', label: 'Return ID' },
                            { key: 'qty', label: 'Quantity' },
                            { key: 'reason', label: 'Return Reason' },
                            { key: 'remarks', label: 'Remarks' },
                            { key: 'status', label: 'Current Status' },
                            { key: 'date', label: 'Inspection Date' }
                        ]} />
                        <tbody>
                            {isLoading ? (
                                <tr>
                                    <td colSpan="8" style={{ textAlign: 'center', padding: '2rem' }}>Loading defective inventory...</td>
                                </tr>
                            ) : defectives.length === 0 ? (
                                <tr>
                                    <td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                                        <div style={{ fontSize: '1.125rem', fontWeight: '500', marginBottom: '0.25rem' }}>No defective items</div>
                                        <div style={{ fontSize: '0.875rem' }}>No defective inventory matches your criteria.</div>
                                    </td>
                                </tr>
                            ) : (
                                defectives.map(item => (
                                    <TableRow 
                                        key={item.id}
                                        row={{
                                            sku: item.sku_snapshot,
                                            product: item.product_name_snapshot,
                                            returnId: item.amazon_return_id,
                                            qty: Math.round(item.quantity || 0),
                                            reason: item.return_reason,
                                            remarks: item.inspection_notes || '-',
                                            status: (
                                                <span className={`${styles.badge} ${styles[item.status]}`}>
                                                    {item.status.replace('_', ' ')}
                                                </span>
                                            ),
                                            date: formatDate(item.inspection_date)
                                        }}
                                        columns={[
                                            { key: 'sku', label: 'SKU' },
                                            { key: 'product', label: 'Product' },
                                            { key: 'returnId', label: 'Return ID' },
                                            { key: 'qty', label: 'Quantity' },
                                            { key: 'reason', label: 'Return Reason' },
                                            { key: 'remarks', label: 'Remarks' },
                                            { key: 'status', label: 'Current Status' },
                                            { key: 'date', label: 'Inspection Date' }
                                        ]}
                                    />
                                ))
                            )}
                        </tbody>
                    </DataTable>
                </div>
            </Card>
        </PageContainer>
    );
};

export default DefectiveInventory;

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { amazonReturnsService } from '../../services/amazonReturnsService';
import { warehouseService } from '../../services/warehouse';
import { useNotificationStore } from '../../stores/notificationStore';
import { DataTable, TableHeader, TableRow } from '../../components/DataTable';
import Button from '../../components/forms/Button';
import { formatDate } from '../../utils/dateUtils';
import styles from './Returns.module.css';

const AmazonReturns = () => {
    const [statusFilter, setStatusFilter] = useState('');
    const [verificationFilter, setVerificationFilter] = useState('ALL');
    const [search, setSearch] = useState('');
    const [inspectingReturn, setInspectingReturn] = useState(null);
    const [inspectionDecision, setInspectionDecision] = useState('RESTOCK');
    const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
    const [inspectionNotes, setInspectionNotes] = useState('');
    
    const queryClient = useQueryClient();
    const addNotification = useNotificationStore(state => state.addNotification);

    // Fetch active warehouses
    const { data: warehouses = [] } = useQuery({
        queryKey: ['warehouses'],
        queryFn: async () => {
            const data = await warehouseService.getWarehouses();
            return Array.isArray(data) ? data : (data?.items || []);
        }
    });

    const { data: returns = [], isLoading } = useQuery({
        queryKey: ['amazonReturns', statusFilter, verificationFilter, search],
        queryFn: async () => {
            const params = {};
            if (statusFilter) params.status = statusFilter;
            if (verificationFilter && verificationFilter !== 'ALL') {
                params.inspection_status = verificationFilter;
            }
            if (search) params.search = search;
            const data = await amazonReturnsService.getReturns(params);
            return data;
        }
    });

    const { data: syncStatus } = useQuery({
        queryKey: ['amazonReturnsSyncStatus'],
        queryFn: async () => {
            const data = await amazonReturnsService.getSyncStatus();
            return data;
        },
        refetchInterval: (query) => (query?.state?.data?.status === 'Running' ? 15000 : 120000),
        refetchIntervalInBackground: false
    });

    const manualSyncMutation = useMutation({
        mutationFn: async () => {
            const data = await amazonReturnsService.triggerSync();
            return data;
        },
        onSuccess: () => {
            addNotification('Amazon Returns sync completed successfully', 'success');
            queryClient.invalidateQueries(['amazonReturns']);
            queryClient.invalidateQueries(['amazonReturnsSyncStatus']);
        },
        onError: (err) => {
            addNotification(err.response?.data?.detail || 'Failed to sync Amazon returns', 'error');
        }
    });

    const handleSync = () => {
        manualSyncMutation.mutate();
    };

    const inspectMutation = useMutation({
        mutationFn: async ({ returnId, data }) => {
            const responseData = await amazonReturnsService.inspectReturn(returnId, data);
            return responseData;
        },
        onSuccess: (data) => {
            addNotification(`Return successfully verified: ${data.inspection_status}`, 'success');
            setInspectingReturn(null);
            setInspectionNotes('');
            setInspectionDecision('RESTOCK');
            queryClient.invalidateQueries(['amazonReturns']);
            queryClient.invalidateQueries({ queryKey: ['inventory'] });
            queryClient.invalidateQueries({ queryKey: ['defectiveInventory'] });
        },
        onError: (err) => {
            addNotification(err.response?.data?.detail || 'Failed to verify return', 'error');
        }
    });

    const openInspectModal = (ret) => {
        setInspectingReturn(ret);
        setInspectionDecision('RESTOCK');
        setInspectionNotes('');
        const activeWh = warehouses.find(w => (w.status || '').toUpperCase() === 'ACTIVE') || warehouses[0];
        if (activeWh) {
            setSelectedWarehouseId(String(activeWh.id));
        }
    };

    const handleInspectSubmit = (e) => {
        e.preventDefault();
        if (!inspectingReturn) return;
        inspectMutation.mutate({
            returnId: inspectingReturn.id,
            data: {
                decision: inspectionDecision,
                warehouse_id: inspectionDecision === 'RESTOCK' && selectedWarehouseId ? Number(selectedWarehouseId) : undefined,
                notes: inspectionNotes,
                images: []
            }
        });
    };

    const activeWarehouses = warehouses.filter(w => !w.status || (w.status || '').toUpperCase() === 'ACTIVE');
    const selectedWarehouse = warehouses.find(w => String(w.id) === String(selectedWarehouseId));

    const columns = [
        { key: 'amazon_return_id', label: 'Return ID / LPN' },
        { key: 'amazon_order_id', label: 'Amazon Order' },
        { key: 'sku', label: 'SKU' },
        { key: 'product_name', label: 'Product Name' },
        { key: 'quantity', label: 'Qty' },
        { key: 'return_reason', label: 'Return Reason & Remarks' },
        { 
            key: 'return_status', 
            label: 'Tracking Status', 
            render: (val) => <span className={`${styles.badge} ${styles[val?.replace(' ', '') || '']}`}>{val}</span> 
        },
        { 
            key: 'inspection_status', 
            label: 'Verification Status', 
            render: (val) => {
                if (!val) {
                    return <span className={`${styles.badge} ${styles.AwaitingVerification}`}>Awaiting Verification</span>;
                }
                return <span className={`${styles.badge} ${styles[val] || styles.Pending}`}>{val}</span>;
            }
        },
        { 
            key: 'received_at', 
            label: 'Received Date', 
            render: (val) => formatDate(val) 
        },
        {
            key: 'actions',
            label: 'Actions',
            render: (_, ret) => (
                !ret.inspection_status ? (
                    <Button 
                        variant="primary" 
                        onClick={() => openInspectModal(ret)}
                        style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                    >
                        Verify & Restock
                    </Button>
                ) : (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {ret.inspection_notes ? `Notes: ${ret.inspection_notes}` : 'Verified'}
                    </div>
                )
            )
        }
    ];

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h2>Amazon Customer Returns</h2>
                    <p className={styles.subtitle}>Synchronize returns, inspect condition, and verify before restocking inventory.</p>
                </div>
                <div className={styles.actions}>
                    <div className={styles.syncStatus}>
                        <span>Last Sync: {syncStatus?.last_run ? new Date(syncStatus.last_run).toLocaleString() : 'Never'}</span>
                        <span className={`${styles.statusBadge} ${styles[syncStatus?.status?.toLowerCase() || 'unknown']}`}>
                            {syncStatus?.status || 'Unknown'}
                        </span>
                    </div>
                    <Button 
                        variant="primary" 
                        onClick={handleSync}
                        isLoading={manualSyncMutation.isPending}
                    >
                        Sync Amazon Returns
                    </Button>
                </div>
            </div>

            {/* Inventory Verification Guardrail Banner */}
            <div className={styles.guardrailBanner}>
                <span className={styles.guardrailIcon}>🛡️</span>
                <div>
                    <strong>Strict Inventory Guardrail:</strong>
                    <span> Amazon returns do NOT automatically revert or increment inventory. Staff must inspect and verify the return's condition before stock is restored to any warehouse.</span>
                </div>
            </div>

            <div className={styles.filters}>
                <input 
                    type="text" 
                    placeholder="Search Order, Return ID / LPN, or SKU..." 
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className={styles.searchInput}
                    autoFocus
                />
                <select 
                    value={verificationFilter} 
                    onChange={(e) => setVerificationFilter(e.target.value)}
                    className={styles.selectInput}
                >
                    <option value="ALL">All Verification Statuses</option>
                    <option value="PENDING">Awaiting Verification</option>
                    <option value="RESTOCKED">Verified & Restocked</option>
                    <option value="DEFECTIVE">Verified Defective</option>
                    <option value="REJECTED">Rejected</option>
                </select>
                <select 
                    value={statusFilter} 
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className={styles.selectInput}
                >
                    <option value="">All Tracking Statuses</option>
                    <option value="Received">Received</option>
                    <option value="In Transit">In Transit</option>
                </select>
            </div>

            <DataTable>
                <TableHeader columns={columns} />
                <tbody>
                    {isLoading ? (
                        <tr><td colSpan={columns.length} style={{textAlign: 'center', padding: '2rem'}}>Loading Amazon returns...</td></tr>
                    ) : returns.length === 0 ? (
                        <tr><td colSpan={columns.length} style={{textAlign: 'center', padding: '2rem'}}>No Amazon returns found. Click "Sync Amazon Returns" to pull latest returns from Amazon.</td></tr>
                    ) : (
                        returns.map(ret => (
                            <TableRow key={ret.id} row={ret} columns={columns} />
                        ))
                    )}
                </tbody>
            </DataTable>

            {inspectingReturn && (
                <div className={styles.modalOverlay}>
                    <div className={styles.modal}>
                        <h3>Verify Customer Return</h3>
                        <div className={styles.modalBody}>
                            <div className={styles.detailGrid}>
                                <div className={styles.detailItem}>
                                    <strong>SKU</strong>
                                    <span>{inspectingReturn.sku}</span>
                                </div>
                                <div className={styles.detailItem}>
                                    <strong>Quantity</strong>
                                    <span>{inspectingReturn.quantity}</span>
                                </div>
                                <div className={styles.detailItem}>
                                    <strong>Order ID</strong>
                                    <span>{inspectingReturn.amazon_order_id}</span>
                                </div>
                                <div className={styles.detailItem}>
                                    <strong>Return ID / LPN</strong>
                                    <span>{inspectingReturn.amazon_return_id}</span>
                                </div>
                                <div className={styles.detailItem} style={{ gridColumn: 'span 2' }}>
                                    <strong>Product Name</strong>
                                    <span>{inspectingReturn.product_name || '-'}</span>
                                </div>
                                <div className={styles.detailItem} style={{ gridColumn: 'span 2' }}>
                                    <strong>Amazon Return Reason & Notes</strong>
                                    <span>{inspectingReturn.return_reason || 'Customer Return'}</span>
                                </div>
                            </div>
                            
                            <form onSubmit={handleInspectSubmit} className={styles.inspectForm}>
                                <div className={styles.formGroup}>
                                    <label>Inspection Decision:</label>
                                    <div className={styles.radioGroup}>
                                        <div 
                                            className={`${styles.decisionOption} ${inspectionDecision === 'RESTOCK' ? styles.selected : ''}`}
                                            onClick={() => setInspectionDecision('RESTOCK')}
                                        >
                                            <input 
                                                type="radio" 
                                                name="decision"
                                                value="RESTOCK"
                                                checked={inspectionDecision === 'RESTOCK'}
                                                onChange={() => setInspectionDecision('RESTOCK')}
                                            />
                                            <div>
                                                <div className={styles.decisionOptionTitle}>Good Condition (Verify & Restock)</div>
                                                <div className={styles.decisionOptionDesc}>Product is in sellable condition. Reverts inventory back to selected warehouse.</div>
                                            </div>
                                        </div>

                                        <div 
                                            className={`${styles.decisionOption} ${inspectionDecision === 'DEFECTIVE' ? styles.selected : ''}`}
                                            onClick={() => setInspectionDecision('DEFECTIVE')}
                                        >
                                            <input 
                                                type="radio" 
                                                name="decision"
                                                value="DEFECTIVE"
                                                checked={inspectionDecision === 'DEFECTIVE'}
                                                onChange={() => setInspectionDecision('DEFECTIVE')}
                                            />
                                            <div>
                                                <div className={styles.decisionOptionTitle}>Defective / Damaged</div>
                                                <div className={styles.decisionOptionDesc}>Product is broken or opened. Routes to Defective Inventory without increasing sellable stock.</div>
                                            </div>
                                        </div>

                                        <div 
                                            className={`${styles.decisionOption} ${inspectionDecision === 'REJECTED' ? styles.selected : ''}`}
                                            onClick={() => setInspectionDecision('REJECTED')}
                                        >
                                            <input 
                                                type="radio" 
                                                name="decision"
                                                value="REJECTED"
                                                checked={inspectionDecision === 'REJECTED'}
                                                onChange={() => setInspectionDecision('REJECTED')}
                                            />
                                            <div>
                                                <div className={styles.decisionOptionTitle}>Reject Return (Fraud / Empty Box)</div>
                                                <div className={styles.decisionOptionDesc}>Wrong item received, fraudulent return, or discarded. No inventory will be restored.</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {inspectionDecision === 'RESTOCK' && (
                                    <div className={styles.formGroup}>
                                        <label>Restock To Warehouse:</label>
                                        <select 
                                            value={selectedWarehouseId} 
                                            onChange={(e) => setSelectedWarehouseId(e.target.value)}
                                            className={styles.selectInput}
                                            style={{ width: '100%' }}
                                            required
                                        >
                                            {activeWarehouses.map(wh => (
                                                <option key={wh.id} value={wh.id}>
                                                    {wh.name} ({wh.code || wh.id})
                                                </option>
                                            ))}
                                        </select>
                                        <div className={`${styles.actionWarning} ${styles.restock}`}>
                                            ✅ Will add +{inspectingReturn.quantity} unit(s) of {inspectingReturn.sku} into {selectedWarehouse?.name || 'warehouse'}.
                                        </div>
                                    </div>
                                )}

                                {inspectionDecision === 'DEFECTIVE' && (
                                    <div className={`${styles.actionWarning} ${styles.defective}`}>
                                        ⚠️ Product will be logged under Defective Inventory. Sellable inventory will NOT increase.
                                    </div>
                                )}

                                {inspectionDecision === 'REJECTED' && (
                                    <div className={`${styles.actionWarning} ${styles.rejected}`}>
                                        🚫 Return is marked as Rejected. No inventory movements will occur.
                                    </div>
                                )}

                                <div className={styles.formGroup} style={{ marginTop: '14px' }}>
                                    <label>Inspection Notes / Remarks:</label>
                                    <textarea 
                                        value={inspectionNotes}
                                        onChange={(e) => setInspectionNotes(e.target.value)}
                                        placeholder="Add inspection observations, physical condition remarks..."
                                        rows="3"
                                        className={styles.textarea}
                                    />
                                </div>

                                <div className={styles.modalActions}>
                                    <Button 
                                        type="button"
                                        variant="secondary"
                                        onClick={() => setInspectingReturn(null)}
                                        disabled={inspectMutation.isPending}
                                    >
                                        Cancel
                                    </Button>
                                    <Button 
                                        type="submit" 
                                        variant="primary"
                                        isLoading={inspectMutation.isPending}
                                    >
                                        Confirm Verification
                                    </Button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AmazonReturns;

import { useAuthStore } from '../../../stores/authStore';
import useCompanyStore from '../../../stores/useCompanyStore';
import React, { useState } from 'react';
import { useProducts } from '../../../hooks/useProducts';

import { Modal } from '../../../components/Modal/Modal';
import Button from '../../../components/forms/Button';
import styles from './UploadModal.module.css';
import api from '../../../services/api';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

const TallyUploadModal = ({ isOpen, onClose, warehouses }) => {
  const [warehouseId, setWarehouseId] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [previewItems, setPreviewItems] = useState(null);
  const navigate = useNavigate();
  
  // Fetch products for manual mapping only when the modal is open
  const { data: productsData } = useProducts({ limit: 10000, enabled: Boolean(isOpen) });
  const products = Array.isArray(productsData) ? productsData : [];


  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setPreviewItems(null);
    }
  };

  const handlePreview = async () => {
    if (!file) {
      toast.error('Please select a file first');
      return;
    }
    
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const token = useAuthStore.getState().token;
      const companyId = useCompanyStore.getState().companyId;
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/bulk-upload/tally-bill-preview`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Company-Id': companyId?.toString() || ''
        },
        body: formData
      });
      const data = await response.json();
      if (!response.ok) {
        throw { response: { data } };
      }
      setPreviewItems(data.items);
      toast.success('Tally bill parsed successfully!');
    } catch (err) {
      
    let errMsg = 'An error occurred';
    if (err.response?.data?.detail) {
      if (typeof err.response.data.detail === 'string') {
        errMsg = err.response.data.detail;
      } else if (Array.isArray(err.response.data.detail)) {
        errMsg = err.response.data.detail[0]?.msg || 'Validation Error';
      }
    } else if (err.message) {
      errMsg = err.message;
    }
    toast.error(errMsg);
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPreviewItems(null);
    const el = document.getElementById('tally-file-upload');
    if (el) el.value = '';
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleMapSku = (idx, skuValue) => {
    const newItems = [...previewItems];
    const matchedProduct = products.find(p => p.sku?.trim().toLowerCase() === skuValue?.trim().toLowerCase());
    
    if (matchedProduct) {
      newItems[idx].matched_sku = matchedProduct.sku;
      newItems[idx].product_id = matchedProduct.id;
      newItems[idx].product_name = matchedProduct.name;
      newItems[idx].hsn_sac = matchedProduct.hsn;
    } else {
      newItems[idx].matched_sku = null;
      newItems[idx].product_id = null;
    }
    setPreviewItems(newItems);
  };

  
  const handleProceed = async () => {
    if (!warehouseId) {
      toast.error('Please select a destination warehouse');
      return;
    }
    
    // Only upload the items that actually mapped to an SKU
    const validItems = previewItems.filter(i => i.matched_sku);
    if (validItems.length === 0) {
      toast.error('No valid items to upload');
      return;
    }
    
    // Warn if skipping items
    const unmappedCount = previewItems.filter(i => !i.description?.toLowerCase().includes('total') && !String(i.sl_no).toLowerCase().includes('total')).length - validItems.length;
    if (unmappedCount > 0) {
      if (!window.confirm(`${unmappedCount} items are currently unmapped (red border). They will be skipped and NOT updated in inventory. Do you want to proceed anyway?`)) {
        return;
      }
    }
    
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('warehouse_id', warehouseId);
    formData.append('items', JSON.stringify(validItems));
    
    try {
      const token = useAuthStore.getState().token;
      const companyId = useCompanyStore.getState().companyId;
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/bulk-upload/tally-bill-confirm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Company-Id': companyId?.toString() || ''
        },
        body: formData
      });
      const data = await response.json();
      if (!response.ok) {
        throw { response: { data } };
      }
      toast.success('Inventory updated successfully!');
      setTimeout(() => {
        window.location.reload();
      }, 1500);
      handleClose();
    } catch (err) {
      
    let errMsg = 'An error occurred';
    if (err.response?.data?.detail) {
      if (typeof err.response.data.detail === 'string') {
        errMsg = err.response.data.detail;
      } else if (Array.isArray(err.response.data.detail)) {
        errMsg = err.response.data.detail[0]?.msg || 'Validation Error';
      }
    } else if (err.message) {
      errMsg = err.message;
    }
    toast.error(errMsg);
      setUploading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Upload Tally Bill" maxWidth="900px">
      <div className={styles.uploadContainer}>
        {!previewItems ? (
          <div className={styles.dropZone}>
            <div style={{ marginBottom: '20px', textAlign: 'left' }}>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px' }}>Destination Warehouse</label>
              <select 
                value={warehouseId} 
                onChange={e => setWarehouseId(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              >
                <option value="">-- Select Warehouse --</option>
                {warehouses.map(wh => (
                  <option key={wh.id} value={wh.id}>{wh.name}</option>
                ))}
              </select>
            </div>
            <input 
              type="file" 
              id="tally-file-upload"
              accept=".xlsx,.xls" 
              onChange={handleFileChange}
              className={styles.fileInput}
              style={{ display: 'none' }}
            />
            <label htmlFor="tally-file-upload" style={{ cursor: 'pointer', padding: '40px', border: '2px dashed #cbd5e1', display: 'block', textAlign: 'center', borderRadius: '8px' }}>
              <div style={{ fontSize: '3rem', marginBottom: '10px' }}>📑</div>
              <div style={{ fontWeight: '500', color: '#475569' }}>
                {file ? file.name : "Click to select Tally .xlsx file"}
              </div>
            </label>
            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <Button onClick={handlePreview} disabled={!file || uploading}>
                {uploading ? 'Parsing...' : 'Preview Items'}
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.previewSection}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>Parsed Items ({previewItems.length})</h4>
              <Button variant="secondary" onClick={handleReset}>Upload Different File</Button>
            </div>
            
            <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8fafc', zIndex: 1 }}>
                  <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                    <th style={{ padding: '10px' }}>Sl</th>
                    <th style={{ padding: '10px' }}>Description</th>
                    <th style={{ padding: '10px' }}>Mapped SKU</th>
                    <th style={{ padding: '10px' }}>Qty</th>
                    <th style={{ padding: '10px' }}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {previewItems.map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '10px' }}>{item.sl_no}</td>
                      <td style={{ padding: '10px' }}>{item.description}</td>
                      <td style={{ padding: '10px' }}>
                        {(item.description?.toLowerCase().includes('total') || String(item.sl_no).toLowerCase().includes('total')) ? (
                           <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Ignored (Total Row)</span>
                        ) : (
                          <input
                            type="text"
                            list="products-list"
                            placeholder={item.matched_sku ? "Mapped to " + item.matched_sku : "Type to map SKU..."}
                            defaultValue={item.matched_sku || ''}
                            onChange={(e) => handleMapSku(idx, e.target.value)}
                            style={{ 
                              padding: '6px', 
                              width: '180px', 
                              border: item.matched_sku ? '2px solid #059669' : '2px solid #dc2626', 
                              borderRadius: '4px',
                              backgroundColor: item.matched_sku ? '#ecfdf5' : '#fef2f2',
                              color: '#0f172a'
                            }}
                          />
                        )}
                      </td>
                      <td style={{ padding: '10px' }}>{item.quantity}</td>
                      <td style={{ padding: '10px' }}>{item.rate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <datalist id="products-list">
              {products.map(p => (
                <option key={p.id} value={p.sku}>{p.name} - {p.sku}</option>
              ))}
            </datalist>

            {previewItems.some(i => !i.matched_sku && !(i.description?.toLowerCase().includes('total') || String(i.sl_no).toLowerCase().includes('total'))) && (
              <div style={{ color: '#b91c1c', marginTop: '15px', padding: '10px', backgroundColor: '#fee2e2', borderRadius: '4px', fontSize: '0.9rem' }}>
                <strong>Warning:</strong> You have items highlighted in red that are unmatched. Please use the dropdown to map them to an existing SKU, otherwise they will be skipped during upload.
              </div>
            )}
            
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <Button variant="secondary" onClick={handleClose}>Cancel</Button>
              <Button variant="primary" onClick={handleProceed}>
                Update Inventory
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default TallyUploadModal;

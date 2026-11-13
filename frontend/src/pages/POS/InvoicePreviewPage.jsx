import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  FiPrinter, 
  FiDownload, 
  FiArrowLeft, 
  FiRefreshCw, 
  FiCheckCircle, 
  FiAlertCircle,
  FiFileText,
  FiCopy,
  FiEye,
  FiXCircle, FiEdit
} from 'react-icons/fi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posService } from '../../services/pos';
import { einvoiceService } from '../../services/einvoice';
import { handleApiError } from '../../utils/errorHandler';
import InvoiceRenderer from '../../components/invoice/InvoiceRenderer';
import { downloadInvoicePdf } from '../../services/invoicePdfService';
import { formatDate } from '../../utils/dateUtils';
import styles from './InvoicePreviewPage.module.css';

export default function InvoicePreviewPage() {
  const { saleId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const invoiceRef = useRef(null);

  const { data: rawInvoice, isLoading: loading, error: fetchError } = useQuery({

    queryKey: ['sale', saleId],
    queryFn: () => posService.getSaleById(saleId),
    initialData: location.state?.receipt,
  });

  const invoice = rawInvoice?.receipt || rawInvoice;
  const error = fetchError ? (fetchError.response?.data?.detail || fetchError.message) : null;

  const [retryingTally, setRetryingTally] = useState(false);
  const [showTallyModal, setShowTallyModal] = useState(false);
  const [tallyPayloadFormat, setTallyPayloadFormat] = useState('XML');

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [emailDomain, setEmailDomain] = useState('@gmail.com');
  const [emailing, setEmailing] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [printScale, setPrintScale] = useState(100);
  const [emailSuccess, setEmailSuccess] = useState('');

  const { data: tallyPayloads, refetch: fetchTallyPayloads } = useQuery({
    queryKey: ['tallyPayload', saleId],
    queryFn: () => posService.getTallyPayload(saleId),
    enabled: false,
  });

  const retryTallyMutation = useMutation({
    mutationFn: posService.retryTallySync,
    onMutate: () => setRetryingTally(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sale', saleId] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
    onError: (err) => handleApiError(err, 'Failed to retry Tally sync'),
    onSettled: () => setRetryingTally(false),
  });

  const handleRetryTally = () => {
    if (!saleId) return;
    retryTallyMutation.mutate(saleId);
  };

  const handlePreviewTally = () => {
    if (!saleId) return;
    setShowTallyModal(true);
    if (!tallyPayloads) {
      fetchTallyPayloads();
    }
  };

  const [cancelling, setCancelling] = useState(false);

  const handleCancelBill = async () => {
    if (!invoice?.id) return;
    if (!window.confirm(`Are you sure you want to cancel bill ${invoice.invoice_number || invoice.bill_number}? This will permanently void the sale and revert inventory stock.`)) {
      return;
    }
    setCancelling(true);
    try {
      await posService.cancelSale(invoice.id);
      await queryClient.invalidateQueries({ queryKey: ['sale', saleId] });
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      alert(`Sale ${invoice.invoice_number || invoice.bill_number} successfully cancelled and inventory reverted.`);
    } catch (err) {
      handleApiError(err, 'Failed to cancel sale');
    } finally {
      setCancelling(false);
    }
  };

  const [generatingIrn, setGeneratingIrn] = useState(false);

  const handleGenerateEInvoice = async () => {
    if (!invoice?.id) return;
    setGeneratingIrn(true);
    try {
      const isRetry = (invoice.einvoice?.status === 'FAILED') || (invoice.einvoice_status === 'FAILED');
      const res = await einvoiceService.generateIRN(invoice.id, isRetry);
      await queryClient.invalidateQueries({ queryKey: ['sale', saleId] });
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      const irnDisplay = res?.irn ? (String(res.irn).length > 16 ? `${String(res.irn).substring(0, 16)}...` : String(res.irn)) : 'Active';
      alert(`E-Invoice IRN Generated Successfully!\nIRN: ${irnDisplay}\nAck No: ${res?.ack_no || '-'}`);
    } catch (err) {
      handleApiError(err, 'Failed to generate E-Invoice IRN');
    } finally {
      setGeneratingIrn(false);
    }
  };

  const handleDownloadEInvoiceJson = async () => {
    try {
      const response = await einvoiceService.downloadSingleJson(invoice.id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      const invNo = (invoice.invoice_number || invoice.bill_number || `Bill_${invoice.id}`).replace(/[\/\\]/g, '_');
      link.setAttribute('download', `EInvoice_${invNo}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      handleApiError(err, 'Failed to download E-Invoice JSON');
    }
  };

  const handlePrint = () => {
    const originalTitle = document.title;
    const invNo = invoice?.invoice_number || invoice?.bill_number || 'Invoice';
    document.title = invNo;
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
    }, 1000);
  };

  const handleDownloadPdf = () => {
    if (invoiceRef.current && invoice) {
      downloadInvoicePdf(invoiceRef.current, invoice.invoice_number || saleId);
    }
  };

  const handleOpenEmailModal = () => {
    setEmailAddress(invoice?.customer?.email || '');
    setEmailError('');
    setEmailSuccess('');
    setShowEmailModal(true);
  };

  const emailMutation = useMutation({
    mutationFn: posService.emailInvoice,
    onMutate: () => setEmailing(true),
    onSuccess: () => {
      setEmailSuccess('Email sent successfully!');
      setTimeout(() => setShowEmailModal(false), 2000);
    },
    onError: (err) => {
      setEmailError(err.response?.data?.detail || err.message || 'Failed to send email');
    },
    onSettled: () => setEmailing(false),
  });

  const handleEmailInvoice = async () => {
    if (!emailAddress) {
      setEmailError('Please enter an email address.');
      return;
    }
    
    setEmailError('');
    setEmailSuccess('');
    
    try {
      // 1. Generate PDF blob via dynamic import
      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = html2pdfModule.default || html2pdfModule;
      const opt = {
        margin:       0,
        filename:     `Invoice_${invoice.invoice_number || saleId}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
      };
      
      const pdfBlob = await html2pdf().set(opt).from(invoiceRef.current).output('blob');
      
      // 2. Create FormData
      const formData = new FormData();
      formData.append('file', pdfBlob, opt.filename);
      formData.append('to_email', emailAddress + emailDomain);
      
      emailMutation.mutate({ saleId: invoice.id, formData });
    } catch (err) {
      console.error('Failed to generate PDF for email:', err);
      setEmailError('Failed to generate PDF');
    }
  };

  if (loading) {
    return <div className={styles.loadingContainer}>Loading invoice...</div>;
  }

  if (error) {
    return (
      <div className={styles.errorContainer}>
        <p className={styles.errorMessage}>{error}</p>
        <button className={styles.backButton} onClick={() => navigate(-1)}>
          <FiArrowLeft /> Go Back
        </button>
      </div>
    );
  }

  if (!invoice) return null;

  const isB2b = invoice.invoice_type === 'B2B' || invoice.customer?.gstin;
  const tallyStatus = invoice.tally?.status || 'PENDING';
  const showRetry = isB2b && (tallyStatus === 'FAILED' || tallyStatus === 'PENDING');
  const einvoiceStatus = invoice.einvoice?.status || invoice.einvoice_status || 'NOT_GENERATED';

  return (
    <div className={styles.container}>
      <style>
        {`
          @page {
            size: A4 portrait !important;
            margin: 5mm !important;
          }
          @media print {
            @page {
              size: A4 portrait !important;
              margin: 5mm !important;
            }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .print-only {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              max-width: 100% !important;
              margin: 0 !important;
              padding: 0 !important;
              border: none !important;
              box-shadow: none !important;
              transform: none !important;
            }
          }
        `}
      </style>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <button className={styles.actionButton} onClick={() => navigate(-1)}>
            <FiArrowLeft /> Back
          </button>
        </div>
        
        <div className={styles.toolbarCenter}>
          {isB2b && (
            <>
              <div className={styles.tallyStatusWrapper}>
                <span className={`${styles.badge} ${styles[tallyStatus.toLowerCase()]}`}>
                  {tallyStatus === 'SUCCESS' && <FiCheckCircle />}
                  {tallyStatus === 'FAILED' && <FiAlertCircle />}
                  {tallyStatus === 'PENDING' && <FiRefreshCw />}
                  Tally: {tallyStatus}
                </span>
                {showRetry && (
                  <button 
                    className={styles.retryButton} 
                    onClick={handleRetryTally}
                    disabled={retryingTally}
                  >
                    <FiRefreshCw className={retryingTally ? styles.spin : ''} />
                    Retry Sync
                  </button>
                )}
                <button className={styles.actionButton} onClick={handlePreviewTally}>
                  <FiFileText /> Preview Tally
                </button>
              </div>

              <div className={styles.tallyStatusWrapper} style={{ marginLeft: '8px' }}>
                <span className={`${styles.badge} ${einvoiceStatus === 'GENERATED' ? styles.success : (einvoiceStatus === 'FAILED' ? styles.failed : styles.pending)}`}>
                  {einvoiceStatus === 'GENERATED' && <FiCheckCircle />}
                  {einvoiceStatus === 'FAILED' && <FiAlertCircle />}
                  {einvoiceStatus !== 'GENERATED' && einvoiceStatus !== 'FAILED' && <FiRefreshCw />}
                  IRN: {einvoiceStatus === 'GENERATED' ? 'Active' : (einvoiceStatus === 'FAILED' ? 'Failed' : 'Not Generated')}
                </span>
                {einvoiceStatus !== 'GENERATED' && invoice.status !== 'Cancelled' && (
                  <button 
                    className={styles.retryButton} 
                    onClick={handleGenerateEInvoice}
                    disabled={generatingIrn}
                    title="Generate Government IRN and Signed QR Code"
                  >
                    <FiRefreshCw className={generatingIrn ? styles.spin : ''} />
                    {generatingIrn ? 'Generating...' : (einvoiceStatus === 'FAILED' ? 'Retry IRN' : 'Gen IRN')}
                  </button>
                )}
                <button 
                  className={styles.actionButton} 
                  onClick={handleDownloadEInvoiceJson}
                  title="Download Government-compliant E-Invoice JSON for einvoice1.gst.gov.in"
                  style={{ marginLeft: '6px' }}
                >
                  <FiDownload /> E-Invoice JSON
                </button>
              </div>
            </>
          )}
        </div>

        <div className={styles.toolbarRight}>
          {invoice.status !== 'Cancelled' ? (
            <button 
              className={styles.actionButton} 
              style={{ color: '#ef4444', borderColor: '#ef4444' }}
              onClick={handleCancelBill}
              disabled={cancelling}
            >
              <FiXCircle style={{ marginRight: '4px' }} className={cancelling ? styles.spin : ''} />
              {cancelling ? 'Cancelling...' : 'Cancel Bill'}
            </button>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', color: '#dc2626', background: '#fee2e2', padding: '6px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '12px' }}>
              <FiXCircle style={{ marginRight: '5px' }} /> Bill Cancelled (Void)
            </span>
          )}
          {invoice.status !== 'Cancelled' && (!invoice.related_returns || invoice.related_returns.length === 0) && (
            <button className={styles.actionButton} onClick={() => navigate(`/sales/${invoice.id}/edit`)}>
              <FiEdit style={{ marginRight: '4px' }} /> Edit Bill
            </button>
          )}
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '14px', background: '#f8fafc', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
            <span style={{ fontSize: '12px', fontWeight: '700', color: '#475569' }}>Zoom:</span>
            <button
              onClick={() => setPrintScale(prev => Math.max(50, Number(prev) - 15))}
              style={{ padding: '2px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', lineHeight: '16px' }}
              title="Zoom Out"
            >
              -
            </button>
            <span style={{ fontSize: '12px', fontWeight: '700', minWidth: '40px', textAlign: 'center' }}>{printScale}%</span>
            <button 
              onClick={() => setPrintScale(prev => Math.min(200, Number(prev) + 15))}
              style={{ padding: '2px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', lineHeight: '16px' }}
              title="Zoom In"
            >
              +
            </button>
            <button
              onClick={() => setPrintScale(100)}
              style={{ padding: '2px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', background: printScale === 100 ? '#e2e8f0' : '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}
            >
              100%
            </button>
            <button
              onClick={() => setPrintScale(125)}
              style={{ padding: '2px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', background: printScale === 125 ? '#e2e8f0' : '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}
            >
              125%
            </button>
          </div>
          <button className={styles.actionButton} onClick={handlePrint}>

            <FiPrinter /> Print
          </button>
          <button className={styles.actionButton} onClick={handleDownloadPdf}>
            <FiDownload /> Download PDF
          </button>
          <button className={styles.primaryButton} onClick={handleOpenEmailModal}>
            Email Customer
          </button>
        </div>
      </div>

      <div className={styles.invoiceWrapper}>

      

        <div className={`${styles.invoicePaper} print-only`} ref={invoiceRef} style={{ transform: `scale(${printScale / 100})`, transformOrigin: "top center" }}>
          <InvoiceRenderer invoice={invoice} />
        </div>
        
        {invoice.related_returns && invoice.related_returns.length > 0 && (
          <div className={styles.relatedReturnsSection}>
            <h3 style={{ marginTop: '24px', marginBottom: '16px', color: '#1e293b' }}>Related Sales Returns</h3>
            <div className={styles.returnsGrid} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {invoice.related_returns.map(ret => (
                <div key={ret.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                  <div>
                    <div style={{ fontWeight: '600', color: '#0f172a' }}>Return #{ret.return_number}</div>
                    <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                      Date: {formatDate(ret.date)} &bull; Qty: {ret.returned_quantity} &bull; Status: <span style={{ fontWeight: '600', color: ret.status === 'Completed' ? '#16a34a' : '#ea580c' }}>{ret.status}</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => navigate(`/sales-returns/${ret.id}`)}
                    style={{ padding: '8px 16px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: '#334155' }}
                  >
                    <FiEye /> View Return
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showTallyModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h3>Tally Payload Preview</h3>
              <button onClick={() => setShowTallyModal(false)} className={styles.closeButton}>&times;</button>
            </div>
            
            {tallyPayloads ? (
              <div className={styles.modalBody}>
                <div className={styles.tabs}>
                  <button 
                    className={tallyPayloadFormat === 'XML' ? styles.activeTab : styles.tab} 
                    onClick={() => setTallyPayloadFormat('XML')}
                  >
                    XML
                  </button>
                  <button 
                    className={tallyPayloadFormat === 'JSON' ? styles.activeTab : styles.tab} 
                    onClick={() => setTallyPayloadFormat('JSON')}
                  >
                    JSON
                  </button>
                </div>
                
                <pre className={styles.payloadPre}>
                  {tallyPayloadFormat === 'XML' ? tallyPayloads.xml : tallyPayloads.json}
                </pre>
                
                <div className={styles.modalActions}>
                  <button 
                    className={styles.secondaryButton} 
                    onClick={() => navigator.clipboard.writeText(tallyPayloadFormat === 'XML' ? tallyPayloads.xml : tallyPayloads.json)}
                  >
                    <FiCopy /> Copy
                  </button>
                  <button 
                    className={styles.secondaryButton}
                    onClick={() => {
                       const blob = new Blob([tallyPayloadFormat === 'XML' ? tallyPayloads.xml : tallyPayloads.json], {type: 'text/plain'});
                       const url = URL.createObjectURL(blob);
                       const a = document.createElement('a');
                       a.href = url;
                       a.download = `tally_payload_${saleId}.${tallyPayloadFormat.toLowerCase()}`;
                       a.click();
                    }}
                  >
                    <FiDownload /> Download
                  </button>
                  <button 
                    className={styles.primaryButton} 
                    onClick={() => { setShowTallyModal(false); handleRetryTally(); }}
                  >
                    <FiRefreshCw /> Send to Tally
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.modalBody}>Loading payload...</div>
            )}
          </div>
        </div>
      )}

      {showEmailModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent} style={{ maxWidth: '400px' }}>
            <div className={styles.modalHeader}>
              <h3>Email Invoice</h3>
              <button onClick={() => setShowEmailModal(false)} className={styles.closeButton}>&times;</button>
            </div>
            
            <div className={styles.modalBody}>
              <div className={styles.formGroup}>
                <label>Customer Email</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input 
                    type="text" 
                    value={emailAddress} 
                    onChange={e => setEmailAddress(e.target.value.replace(/@.*$/, ''))}
                    placeholder="customer"
                    className={styles.inputField}
                    style={{ flex: 1 }}
                    autoFocus
                  />
                  <select 
                    value={emailDomain} 
                    onChange={e => setEmailDomain(e.target.value)}
                    className={styles.inputField}
                    style={{ width: '140px' }}
                  >
                    <option value="@gmail.com">@gmail.com</option>
                    <option value="@yahoo.com">@yahoo.com</option>
                    <option value="@outlook.com">@outlook.com</option>
                    <option value="@hotmail.com">@hotmail.com</option>
                    <option value="">(Custom / Full Email)</option>
                  </select>
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                  Will send to: <strong>{emailAddress ? `${emailAddress}${emailDomain}` : ''}</strong>
                </div>
              </div>
              
              {emailError && <div className={styles.errorText} style={{ color: 'red', marginTop: '10px' }}>{emailError}</div>}
              {emailSuccess && <div className={styles.successText} style={{ color: 'green', marginTop: '10px' }}>{emailSuccess}</div>}
              
              <div className={styles.modalActions} style={{ marginTop: '20px' }}>
                <button 
                  className={styles.secondaryButton} 
                  onClick={() => setShowEmailModal(false)}
                  disabled={emailing}
                >
                  Cancel
                </button>
                <button 
                  className={styles.primaryButton} 
                  onClick={handleEmailInvoice}
                  disabled={emailing}
                >
                  {emailing ? 'Sending...' : 'Send Email'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React from 'react';
import styles from '../InvoiceRenderer.module.css';
import { formatDate } from '../../../utils/dateUtils';

const InvoiceMeta = ({ invoice }) => {

  return (
    <div className={styles.metaContainer}>
      <div className={styles.metaGrid}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Invoice No.</span>
          <span className={styles.metaValue} style={{ fontWeight: 700 }}>{invoice.invoice_number || invoice.bill_number}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Bill Series</span>
          <span className={styles.metaValue} style={{ fontWeight: 600 }}>
            {invoice.invoice_prefix || (invoice.invoice_number && invoice.invoice_number.includes('-') ? invoice.invoice_number.split('-')[0] : (invoice.invoice_number && invoice.invoice_number.includes('/') ? invoice.invoice_number.split('/')[0] : 'GST'))}
          </span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Invoice Date</span>
          <span className={styles.metaValue}>{formatDate(invoice.date || invoice.sale_date)}</span>
        </div>
        
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Buyer's Order No.</span>
          <span className={styles.metaValue}>{invoice.buyer_order_no || invoice.order_no || '-'}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Buyer's Order Date</span>
          <span className={styles.metaValue}>{formatDate(invoice.buyer_order_date || invoice.order_date) || '-'}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Payment Mode</span>
          <span className={styles.metaValue}>{invoice.payment_method ? `${invoice.payment_method}${invoice.payment_reference ? ` (${invoice.payment_reference})` : ''}` : '-'}</span>
        </div>
        {invoice.payment_remarks && (
          <div className={styles.metaItem} style={{ background: '#f8fafc', borderRadius: '4px', padding: '4px 6px' }}>
            <span className={styles.metaLabel} style={{ color: '#0369a1', fontWeight: 600 }}>Payment Remarks</span>
            <span className={styles.metaValue} style={{ fontWeight: 600, color: '#0f172a' }}>{invoice.payment_remarks}</span>
          </div>
        )}
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Payment Terms</span>
          <span className={styles.metaValue}>{invoice.payment_terms || '-'}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Delivery Note</span>
          <span className={styles.metaValue}>{invoice.delivery_note || '-'}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Delivery Note Date</span>
          <span className={styles.metaValue}>{formatDate(invoice.delivery_note_date) || '-'}</span>
        </div>
      </div>

      <div className={styles.metaGrid}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Dispatch Doc No.</span>
          <span className={styles.metaValue}>{invoice.dispatch_document_number || '-'}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Dispatch Through</span>
          <span className={styles.metaValue}>{invoice.dispatch_through || '-'}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Destination</span>
          <span className={styles.metaValue}>{invoice.destination || '-'}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Vehicle No.</span>
          <span className={styles.metaValue}>{invoice.vehicle_number || '-'}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>LR/RR No.</span>
          <span className={styles.metaValue}>{invoice.lr_rr_number || '-'}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Terms of Delivery</span>
          <span className={styles.metaValue}>{invoice.terms_of_delivery || '-'}</span>
        </div>
      </div>
    </div>
  );
};

export default InvoiceMeta;

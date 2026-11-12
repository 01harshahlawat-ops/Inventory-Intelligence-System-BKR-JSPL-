import React from 'react';
import styles from '../InvoiceRenderer.module.css';
import { formatDate } from '../../../utils/dateUtils';

const InvoiceDetailsBox = ({ invoice }) => {
  const customer = invoice?.customer || {};
  const shipping = invoice?.shipping;
  
  const customerName = customer?.name || '';
  const customerPhone = customer?.phone || customer?.mobile || '';
  const customerGstin = customer?.gstin || '';
  const customerAddress = customer?.address || '';
  const customerPincode = customer?.pincode || customer?.postal_code || '';

  const shippingName = shipping?.name || customerName;
  const shippingPhone = shipping?.phone || shipping?.mobile || customerPhone;
  const shippingAddress = shipping?.address || '';

  const billNo = invoice?.invoice_number || invoice?.bill_number || '';
  const billDate = formatDate(invoice?.date || invoice?.sale_date || invoice?.created_at, '');
  const payMode = (invoice?.payment_method || 'CREDIT').toUpperCase();
  const transportMode = invoice?.dispatch_through || invoice?.transport_mode || '';
  const orderNo = invoice?.buyer_order_no || invoice?.order_no || '';
  const lutNo = invoice?.lut_no || '';

  return (
    <div className={styles.partyBoxContainer}>
      {/* Column 1: Billed to */}
      <div className={styles.partyColBilled}>
        <div className={styles.partyBoxHeader}>Billed to :</div>
        <div className={styles.partyBoxRow}>
          <strong>M/S : </strong>{customerName}{customerPhone ? ` - ${customerPhone}` : ''}
        </div>
        {customerAddress && (
          <div className={styles.partyBoxRow}>{customerAddress}</div>
        )}
        <div className={styles.partyBoxRow}>
          <strong>PIN CODE:</strong> {customerPincode}
        </div>
        <div className={styles.partyBoxRow}>
          <strong>GST NO:- </strong>{customerGstin}
        </div>
        <div className={styles.partyBoxRow}>
          <strong>PHONE NO.: </strong>{customerPhone}
        </div>
      </div>

      {/* Column 2: Bill Info & Transport */}
      <div className={styles.partyColMeta}>
        <table className={styles.metaMiniTable}>
          <tbody>
            <tr>
              <td className={styles.metaMiniKey}>BILL NO.</td>
              <td className={styles.metaMiniSep}>:</td>
              <td className={styles.metaMiniValBold}>{billNo}</td>
            </tr>
            <tr>
              <td className={styles.metaMiniKey}>DATE</td>
              <td className={styles.metaMiniSep}>:</td>
              <td className={styles.metaMiniVal}>{billDate}</td>
            </tr>
            <tr>
              <td className={styles.metaMiniKey}>PAY MODE</td>
              <td className={styles.metaMiniSep}>:</td>
              <td className={styles.metaMiniVal}>{payMode}</td>
            </tr>
            {orderNo ? (
              <tr>
                <td className={styles.metaMiniKey}>ORDER No.</td>
                <td className={styles.metaMiniSep}>:</td>
                <td className={styles.metaMiniVal}>{orderNo}</td>
              </tr>
            ) : null}
            <tr>
              <td className={styles.metaMiniKey}>TRANSPORT MODE</td>
              <td className={styles.metaMiniSep}>:-</td>
              <td className={styles.metaMiniVal}>{transportMode}</td>
            </tr>
            <tr>
              <td className={styles.metaMiniKey}>LUT NO</td>
              <td className={styles.metaMiniSep}>:</td>
              <td className={styles.metaMiniVal}>{lutNo}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Column 3: Shipped to */}
      <div className={styles.partyColShipped}>
        <div className={styles.partyBoxHeader}>Shipped to :</div>
        <div className={styles.partyBoxRow}>
          {shippingName}{shippingPhone ? ` - ${shippingPhone}` : ''}
        </div>
        {shippingAddress && (
          <div className={styles.partyBoxRow}>{shippingAddress}</div>
        )}
        <div className={styles.partyBoxRowOrder}>
          <strong>ORDER No.: </strong>{orderNo}
        </div>
      </div>
    </div>
  );
};

export default InvoiceDetailsBox;

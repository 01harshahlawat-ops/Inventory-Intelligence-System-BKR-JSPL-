import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import styles from '../InvoiceRenderer.module.css';

const InvoiceHeader = ({ company, invoiceType, tallyData, items, einvoice }) => {
  const hasOnlyZeroGst = items?.length > 0 && items.every(item => parseFloat(item.gst_rate || 0) === 0);
  const invoiceTitle = hasOnlyZeroGst ? 'BILL OF SUPPLY' : 'TAX INVOICE';
  
  const rawIrn = einvoice?.irn || tallyData?.irn;
  const irn = rawIrn ? String(rawIrn) : '';
  const ackNo = einvoice?.ack_no || tallyData?.ack_no;
  const ackDate = einvoice?.ack_date || tallyData?.ack_date;
  const rawQr = einvoice?.qr_code_data || tallyData?.qr_code_data || irn;
  const qrCodeData = typeof rawQr === 'string' ? rawQr : (rawQr ? JSON.stringify(rawQr) : '');
  const hasEInvoice = Boolean(irn && einvoice?.status !== 'CANCELLED');

  const formattedAckDate = React.useMemo(() => {
    if (!ackDate) return '';
    try {
      const d = new Date(ackDate);
      return isNaN(d.getTime()) ? String(ackDate) : d.toLocaleDateString('en-IN');
    } catch {
      return String(ackDate);
    }
  }, [ackDate]);

  // Robust BKR vs JSPL detection
  const coId = company?.id || company?.company_id;
  const coCodeUpper = (company?.code || '').toUpperCase();
  const coNameUpper = (company?.name || company?.legal_name || '').toUpperCase();

  const isBkr = coId === 2 || coCodeUpper === 'BKR' || coNameUpper.includes('RAMAN') || coNameUpper.startsWith('BKR') || coNameUpper.includes('B.K.') || coNameUpper.includes('BK ');
  const isJspl = !isBkr;

  const gstNo = company?.gstin || (isBkr ? '04AEFPS6301F1ZU' : '04AAFCJ8215N1ZC');
  const brandName = isBkr ? 'B.K. RAMAN & CO.' : 'HALTE';
  const legalName = isBkr ? (company?.name || 'B K RAMAN AND CO (Formerly Jagan Hardware)') : 'C/O Jagan Shopsmart Pvt Ltd.';
  
  let addressLine1 = '';
  let addressLine2 = '';
  if (isBkr) {
    if (company?.address && company.address.includes('\n')) {
      const parts = company.address.split('\n');
      addressLine1 = parts[0].trim();
      addressLine2 = parts.slice(1).join(' ').trim();
    } else if (company?.address) {
      addressLine1 = company.address;
      addressLine2 = `${company?.state || 'CHANDIGARH'} ${company?.state_code ? `(${company.state_code})` : ''}`;
    } else {
      addressLine1 = 'Showroom : Plot No.150, Business & Industrial Park-2,';
      addressLine2 = 'CHANDIGARH - 160002 | Godown : Plot No.24/9, Industrial Park-2';
    }
  } else {
    let rawAddr = (company?.address || '').trim();
    if (rawAddr.includes('\n')) {
      const parts = rawAddr.split('\n');
      addressLine1 = parts[0].trim();
      addressLine2 = parts.slice(1).join(' ').trim();
    } else if (rawAddr) {
      addressLine1 = rawAddr;
      addressLine2 = '';
    } else {
      addressLine1 = 'Plot no: 150, Industrial & Business Park-2,';
      addressLine2 = 'Chandigarh (UT)- 160002';
    }
  }

  const email = company?.email || (isBkr ? 'bkramanco@gmail.com' : 'halteindia@gmail.com');
  const website = isBkr ? (company?.website || '') : (company?.website || 'www.halte.in');
  
  const phones = company?.phone 
    ? [company.phone] 
    : (isBkr ? ['9501200185, 9914130130'] : ['9914130130, 9216407929,', '9872607929, 9501200185']);

  const logoSrc = isBkr ? (company?.logo_url || '') : (company?.logo_url || '/halte_logo.png');

  return (
    <div className={styles.headerContainer}>
      {/* Top Left: GST No & QRs */}
      <div className={styles.headerLeft}>
        <div className={styles.gstinLabel}>
          <strong>GST NO. :</strong>{gstNo}
        </div>
        <div className={styles.qrRow}>
          {hasEInvoice && (
            <div className={styles.eInvoiceBlock}>
              {qrCodeData && (
                <div className={styles.qrCodeWrapper}>
                  <QRCodeSVG value={qrCodeData} size={58} level="M" />
                </div>
              )}
              <div className={styles.eInvoiceMeta}>
                <div style={{ fontWeight: 700, color: '#1d4ed8' }}>e-Invoice</div>
                <div>IRN: {irn.length > 14 ? `${irn.substring(0, 7)}...${irn.substring(irn.length - 5)}` : irn}</div>
                {ackNo && <div>Ack: {ackNo}</div>}
                {formattedAckDate && <div>Dt: {formattedAckDate}</div>}
                {einvoice?.eway_bill_number && <div style={{ color: '#047857', fontWeight: 600 }}>EWB: {einvoice.eway_bill_number}</div>}
              </div>
            </div>
          )}
          {isJspl && (
            <div className={styles.instaQrBlock}>
              <img src="/halte_insta_qr.png" alt="@HALTE.INDIA" className={styles.instaQrImg} />
            </div>
          )}
        </div>
      </div>

      {/* Center: Title & Company details */}
      <div className={styles.headerCenter}>
        <div className={styles.taxInvoiceTitle}>{invoiceTitle}</div>
        <div className={styles.mainBrandName}>{brandName}</div>
        {legalName && <div className={styles.coLegalName}>{legalName}</div>}
        {addressLine1 && <div className={styles.headerAddress}>{addressLine1}</div>}
        {addressLine2 && <div className={styles.headerAddress}>{addressLine2}</div>}
        <div className={styles.headerContactLine}>
          {email && <span><strong>EMAIL :- </strong>{email}</span>}
          {website && <span className={styles.shopOnlineCenter}><strong>Shop Online - </strong>{website}</span>}
        </div>
      </div>

      {/* Top Right: Phones, Logo, Shop Online */}
      <div className={styles.headerRight}>
        <div className={styles.phoneBlock}>
          {phones.length > 0 && <span><strong>PH NO. </strong>{phones[0]}</span>}
          {phones.length > 1 && <div>{phones[1]}</div>}
        </div>
        {logoSrc ? (
          <div className={styles.headerLogoWrapper}>
            <img 
              src={logoSrc} 
              alt="Logo" 
              className={styles.headerLogoImg}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          </div>
        ) : isBkr ? (
          <div className={styles.bkrBrandBadge}>
            <div className={styles.bkrBrandTitle}>B.K. RAMAN &amp; CO.</div>
            <div className={styles.bkrBrandSub}>ESTD. 1978 &bull; CHANDIGARH</div>
          </div>
        ) : null}
        {website && (
          <div className={styles.headerShopOnline}>
            <strong>Shop Online - </strong>{website}
          </div>
        )}
      </div>
    </div>
  );
};

export default InvoiceHeader;

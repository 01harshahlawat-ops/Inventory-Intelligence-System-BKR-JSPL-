import React from 'react';
import styles from '../InvoiceRenderer.module.css';

const formatNum = (val) => {
  if (val === null || val === undefined || val === '') return '';
  const n = Number(val);
  return isNaN(n) ? '' : n.toFixed(2);
};

const InvoiceItems = ({ items = [], isInterState = false }) => {
  const minRows = 6;
  const emptyRowsCount = Math.max(0, minRows - items.length);

  return (
    <div className={styles.itemsTableWrapper}>
      <table className={styles.halteItemsTable}>
        <thead>
          <tr>
            <th className={styles.thSN}>SN</th>
            <th className={styles.thItemName}>ITEM NAME</th>
            <th className={styles.thPackGrade}>PACK/GRADE</th>
            <th className={styles.thHSN}>HSN</th>
            <th className={styles.thQty}>QTY.</th>
            <th className={styles.thRate}>RATE</th>
            <th className={styles.thCD}>C.D%</th>
            <th className={styles.thTax}>TAX</th>
            {isInterState ? (
              <>
                <th className={styles.thIgstRate}>IGST%</th>
                <th className={styles.thIgstAmt}>IGST AMT</th>
              </>
            ) : (
              <>
                <th className={styles.thGstRate}>CGST%</th>
                <th className={styles.thGstAmt}>CGST AMT</th>
                <th className={styles.thGstAmt}>SGST AMT</th>
                <th className={styles.thGstRate}>SGST%</th>
              </>
            )}
            <th className={styles.thAmount}>AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const qty = parseFloat(item.remaining_quantity ?? item.quantity ?? 0);
            const rate = parseFloat(item.rate ?? item.selling_price ?? 0);
            const gross = qty * rate;
            const discount = parseFloat(item.discount || 0);
            
            let cdDisplay = '';
            if (gross > 0 && discount > 0) {
              const cdPct = Math.round((discount / gross) * 100);
              cdDisplay = `${cdPct} %`;
            }

            const taxableVal = item.taxable_value !== undefined 
              ? parseFloat(item.taxable_value) 
              : Math.max(0, gross - discount);

            const gstRate = parseFloat(item.gst_rate || 0);
            const halfRate = (gstRate / 2).toFixed(2);
            
            const cgstAmt = item.cgst !== undefined ? parseFloat(item.cgst) : (taxableVal * (gstRate / 200));
            const sgstAmt = item.sgst !== undefined ? parseFloat(item.sgst) : (taxableVal * (gstRate / 200));
            const igstAmt = item.igst !== undefined ? parseFloat(item.igst) : (taxableVal * (gstRate / 100));

            const taxLabel = gstRate > 0 ? `GST ${Math.round(gstRate)}%` : 'TAXFREE';

            return (
              <tr key={item.id || index} className={styles.itemRow}>
                <td className={styles.tdCenter}>{index + 1}</td>
                <td className={styles.tdItemName}>
                  {(() => {
                    const sku = item.sku || item.product_sku || '';
                    const name = item.product_name || item.name || item.description || '';
                    if (sku && name && !name.toUpperCase().includes(sku.toUpperCase())) {
                      return `${sku} - ${name}`;
                    }
                    return name || sku;
                  })()}
                </td>
                <td className={styles.tdLeft}>{item.pack_grade || (item.sku === 'SERVICE CHARGE' || item.hsn_sac === '9987' ? 'SERV' : '')}</td>
                <td className={styles.tdCenter}>{item.hsn_sac || item.hsn || ''}</td>
                <td className={styles.tdQty}>{qty.toFixed(2)}</td>
                <td className={styles.tdRate}>{formatNum(rate)}</td>
                <td className={styles.tdRight}>{cdDisplay}</td>
                <td className={styles.tdCenter}>{taxLabel}</td>
                {isInterState ? (
                  <>
                    <td className={styles.tdRight}>{gstRate > 0 ? gstRate.toFixed(2) : ''}</td>
                    <td className={styles.tdRight}>{formatNum(igstAmt)}</td>
                  </>
                ) : (
                  <>
                    <td className={styles.tdRight}>{gstRate > 0 ? halfRate : ''}</td>
                    <td className={styles.tdRight}>{formatNum(cgstAmt)}</td>
                    <td className={styles.tdRight}>{formatNum(sgstAmt)}</td>
                    <td className={styles.tdRight}>{gstRate > 0 ? halfRate : ''}</td>
                  </>
                )}
                <td className={styles.tdRight}>{formatNum(gross)}</td>
              </tr>
            );
          })}
          {/* Filler rows to ensure table extends cleanly like the printed bill */}
          {Array.from({ length: emptyRowsCount }).map((_, i) => (
            <tr key={`filler-${i}`} className={styles.fillerRow}>
              <td>&nbsp;</td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              {isInterState ? (
                <>
                  <td></td>
                  <td></td>
                </>
              ) : (
                <>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                </>
              )}
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default InvoiceItems;

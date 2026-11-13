import React from 'react';
import styles from '../InvoiceRenderer.module.css';
import { amountInWords } from '../../../utils/amountInWords';

const formatNum = (val) => {
  if (val === null || val === undefined || val === '') return '';
  const n = Number(val);
  return isNaN(n) ? '' : n.toFixed(2);
};

const InvoiceSummary = ({ company, customer, items = [], totals }) => {
  const sellerStateCode = company?.state_code || (company?.gstin ? company.gstin.substring(0, 2) : '04');
  const buyerStateCode = customer?.state_code || (customer?.gstin ? customer.gstin.substring(0, 2) : '');
  
  const itemsHaveIGST = items.some(item => parseFloat(item.igst || 0) > 0);
  const isInterState = itemsHaveIGST || Boolean(buyerStateCode && buyerStateCode !== sellerStateCode);
  const isUT = ['04', '35', '38', '31', '26'].includes(sellerStateCode) || (company?.state && company.state.toUpperCase().includes('CHANDIGARH'));

  // Calculate gross, discounts, taxable, taxes
  let totalSoldQty = 0;
  let totalGross = 0;
  let totalDiscount = 0;
  let totalTaxable = 0;
  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;

  // Compute GST Slabs: 0 (Taxfree), 5, 12, 18, 28
  const slabs = {
    0: { taxable: 0, sgst_utgst: 0, cgst: 0, igst: 0 },
    5: { taxable: 0, sgst_utgst: 0, cgst: 0, igst: 0 },
    12: { taxable: 0, sgst_utgst: 0, cgst: 0, igst: 0 },
    18: { taxable: 0, sgst_utgst: 0, cgst: 0, igst: 0 },
    28: { taxable: 0, sgst_utgst: 0, cgst: 0, igst: 0 },
  };

  items.forEach(item => {
    const qty = parseFloat(item.remaining_quantity ?? item.quantity ?? 0);
    const rate = parseFloat(item.rate ?? item.selling_price ?? 0);
    const gross = qty * rate;
    const disc = parseFloat(item.discount || 0);
    const taxable = item.taxable_value !== undefined ? parseFloat(item.taxable_value) : Math.max(0, gross - disc);
    const gstRate = parseFloat(item.gst_rate || 0);

    const itemCgst = item.cgst !== undefined ? parseFloat(item.cgst) : (taxable * (gstRate / 200));
    const itemSgst = item.sgst !== undefined ? parseFloat(item.sgst) : (taxable * (gstRate / 200));
    const itemIgst = item.igst !== undefined ? parseFloat(item.igst) : (taxable * (gstRate / 100));

    totalSoldQty += qty;
    totalGross += gross;
    totalDiscount += disc;
    totalTaxable += taxable;
    totalCGST += itemCgst;
    totalSGST += itemSgst;
    totalIGST += itemIgst;

    const roundedRate = Math.round(gstRate);
    const targetKey = slabs[roundedRate] !== undefined ? roundedRate : 18;
    slabs[targetKey].taxable += taxable;
    slabs[targetKey].cgst += itemCgst;
    slabs[targetKey].sgst_utgst += itemSgst;
    slabs[targetKey].igst += itemIgst;
  });

  const rawTotalTax = isInterState ? totalIGST : (totalCGST + totalSGST);
  const rawGrandTotal = totalTaxable + rawTotalTax;
  const roundedGrandTotal = totals?.grand_total ? Math.round(totals.grand_total) : Math.round(rawGrandTotal);
  const roundOff = parseFloat((roundedGrandTotal - rawGrandTotal).toFixed(2));

  // Robust BKR vs JSPL identification
  const coId = company?.id || company?.company_id;
  const coCodeUpper = (company?.code || '').toUpperCase();
  const coNameUpper = (company?.name || company?.legal_name || '').toUpperCase();

  const isBkr = coId === 2 || coCodeUpper === 'BKR' || coNameUpper.includes('RAMAN') || coNameUpper.startsWith('BKR') || coNameUpper.includes('B.K.') || coNameUpper.includes('BK ');
  const isJspl = !isBkr;

  const bankDetails = company?.bank_details || {};
  const bankInfo = {
    name: isBkr ? (bankDetails.account_name || 'B K RAMAN AND CO') : 'JAGAN SHOPSMART PVT LTD',
    accountNumber: (bankDetails.account_no || bankDetails.account_number || (isBkr ? '41836801381' : '50200075992904')).trim(),
    branch: (bankDetails.branch || (isBkr ? 'Industrial Area, Phase-2' : 'CHD- INDUSTRIAL AREA PH-II')).trim(),
    accountType: (bankDetails.account_type || 'CURRENT ACCOUNT').trim(),
    ifsc: (bankDetails.ifsc || (isBkr ? 'SBIN0007501' : 'HDFC0001417')).trim(),
    bankName: (bankDetails.bank_name || (isBkr ? 'State Bank Of India' : 'HDFC Bank Ltd')).trim(),
    city: (bankDetails.city || 'Chandigarh').trim()
  };

  const sgstUtgstLabel = isUT ? 'ADD UTGST' : 'ADD SGST';
  const gridSgstUtgstCol = isUT ? 'UTGST' : 'GST';

  let rawWords = amountInWords(roundedGrandTotal);
  if (rawWords.endsWith(' Only')) {
    rawWords = rawWords.substring(0, rawWords.length - 5);
  }

  return (
    <div className={styles.summaryContainerModern}>
      {/* Upper totals section matching exactly */}
      <table className={styles.upperTotalsTable}>
        <tbody>
          <tr>
            <td className={styles.emptyLeftCell}></td>
            <td className={styles.totalsLabelCell}>TOTAL</td>
            <td className={styles.totalsQtyCell}>{totalSoldQty}</td>
            <td className={styles.totalsValueCell}>{formatNum(totalGross)}</td>
          </tr>
          {totalDiscount > 0 && (
            <tr>
              <td className={styles.emptyLeftCell}></td>
              <td colSpan="2" className={styles.totalsLabelCell}>LESS CD</td>
              <td className={styles.totalsValueCell}>-{formatNum(totalDiscount)}</td>
            </tr>
          )}
          {isInterState ? (
            <tr>
              <td className={styles.emptyLeftCell}></td>
              <td colSpan="2" className={styles.totalsLabelCell}>ADD IGST</td>
              <td className={styles.totalsValueCell}>{formatNum(totalIGST)}</td>
            </tr>
          ) : (
            <>
              <tr>
                <td className={styles.emptyLeftCell}></td>
                <td colSpan="2" className={styles.totalsLabelCell}>{sgstUtgstLabel}</td>
                <td className={styles.totalsValueCell}>{formatNum(totalSGST)}</td>
              </tr>
              <tr>
                <td className={styles.emptyLeftCell}></td>
                <td colSpan="2" className={styles.totalsLabelCell}>ADD CGST</td>
                <td className={styles.totalsValueCell}>{formatNum(totalCGST)}</td>
              </tr>
            </>
          )}
          <tr>
            <td className={styles.wordsCell}>
              <strong>Rs.:</strong>{rawWords}    Only
            </td>
            <td colSpan="2" className={styles.totalsLabelCell}>Round Off</td>
            <td className={styles.totalsValueCell}>{roundOff >= 0 ? formatNum(roundOff) : formatNum(roundOff)}</td>
          </tr>
          <tr className={styles.netAmountRow}>
            <td className={styles.emptyLeftCell}></td>
            <td colSpan="2" className={styles.netAmountLabel}>Net Amount</td>
            <td className={styles.netAmountValue}>{formatNum(roundedGrandTotal)}</td>
          </tr>
        </tbody>
      </table>

      {/* Lower section with GST Matrix on left and Bank Details / Sign on right */}
      <div className={styles.lowerSectionGrid}>
        <div className={styles.lowerLeftBlock}>
          <table className={styles.gstMatrixTable}>
            <tbody>
              <tr>
                <td className={styles.gstMatrixLabel}>GST SALE TAXFREE :</td>
                <td className={styles.gstMatrixTaxable}>{slabs[0].taxable > 0 ? formatNum(slabs[0].taxable) : ''}</td>
                <td colSpan="6"></td>
              </tr>
              {[5, 12, 18, 28].map(rate => {
                const slab = slabs[rate];
                const halfRate = rate / 2;
                return (
                  <tr key={rate}>
                    <td className={styles.gstMatrixLabel}>GST SALE {rate}% :</td>
                    <td className={styles.gstMatrixTaxable}>{slab.taxable > 0 ? formatNum(slab.taxable) : ''}</td>
                    <td className={styles.gstMatrixTag}>{gridSgstUtgstCol} {halfRate}%:</td>
                    <td className={styles.gstMatrixVal}>{!isInterState && slab.sgst_utgst > 0 ? formatNum(slab.sgst_utgst) : ''}</td>
                    <td className={styles.gstMatrixTag}>CGST {halfRate}%:</td>
                    <td className={styles.gstMatrixVal}>{!isInterState && slab.cgst > 0 ? formatNum(slab.cgst) : ''}</td>
                    <td className={styles.gstMatrixTag}>IGST {rate} %:</td>
                    <td className={styles.gstMatrixVal}>{isInterState && slab.igst > 0 ? formatNum(slab.igst) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Exact 5 Terms & Conditions from Sample Bill */}
          <div className={styles.termsAndConditions}>
            <div className={styles.termsTitle}>Terms &amp; Conditions:-</div>
            <div className={styles.termItem}>1.GOODS ONCE SOLD WILL NOT BE TAKEN BACK.</div>
            <div className={styles.termItem}>2.WE WILL GLADLY EXC. WITHIN 2 DAYS ON PRODUCING THE BILL WITH  TAG &amp; BARCODE INTACT.</div>
            <div className={styles.termItem}>3.ALL DISPUTES ARE SUBJECT TO CHANDIGARH JURISDICTION.</div>
            <div className={styles.termItem}>4.INTEREST @24% PER ANUUM APPLICABLE FOR CREDIT OUTSTANDING ABOVE DUE PERIOD.</div>
            <div className={styles.termItem}>5.WARRANTY AGAINST SPARE PARTS IS NOT APPLICABLE.</div>
            <div className={styles.eoeLabel}>E.&amp;.O.E</div>
          </div>
        </div>

        <div className={styles.lowerRightBlock}>
          {isBkr ? (
            <>
              <div className={styles.bankDetailBox}>
                <div className={styles.bankDetailTitle}>OUR BANK DETAIL</div>
                <div className={styles.bankDetailRow}>Bank Details -{bankInfo.name}</div>
                <div className={styles.bankDetailRow}>Account Number: {bankInfo.accountNumber}</div>
                <div className={styles.bankDetailRow}>Branch: {bankInfo.branch}</div>
                <div className={styles.bankDetailRow}>Account Type: {bankInfo.accountType}</div>
                <div className={styles.bankDetailRow}>IFSC CODE : {bankInfo.ifsc}</div>
                <div className={styles.bankDetailRow}>Bank Name : {bankInfo.bankName}</div>
              </div>
              <div className={styles.signatureBox}>
                <div className={styles.forCompanyTitle}>For {company?.name || 'B K RAMAN AND CO'}</div>
                <div className={styles.signSpacer}></div>
                <div className={styles.signLabelAuth}>AUTH. SIGNATURY.</div>
              </div>
            </>
          ) : (
            <>
              <div className={styles.bankDetailBox}>
                <div className={styles.bankDetailTitle}>OUR BANK DETAIL</div>
                <div className={styles.bankDetailRow}>Bank Details -{bankInfo.name}</div>
                <div className={styles.bankDetailRow}>Account Number: {bankInfo.accountNumber}</div>
                <div className={styles.bankDetailRow}>Branch: {bankInfo.branch}</div>
                <div className={styles.bankDetailRow}>Account Type: {bankInfo.accountType}</div>
                <div className={styles.bankDetailRow}>IFSC CODE : {bankInfo.ifsc}</div>
              </div>
              <div className={styles.signatureBox}>
                <div className={styles.forCompanyTitle}>For Jagan Shopsmart Pvt Ltd</div>
                <div className={styles.signSpacer}></div>
                <div className={styles.signLabelAuth}>AUTH. SIGNATURY.</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default InvoiceSummary;

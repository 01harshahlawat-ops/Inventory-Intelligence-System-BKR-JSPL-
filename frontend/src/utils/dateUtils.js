/**
 * Formats a date value into strictly DD/MM/YYYY.
 * Handles ISO strings, timestamps, Date objects, and YYYY-MM-DD / DD-MM-YYYY strings
 * without timezone shifting bugs.
 */
export function formatDate(dateVal, fallback = '-') {
  if (dateVal === null || dateVal === undefined || dateVal === '') {
    return fallback;
  }
  
  if (typeof dateVal !== 'string' && !(dateVal instanceof Date)) {
    dateVal = String(dateVal);
  }

  if (typeof dateVal === 'string') {
    const trimmed = dateVal.trim();
    if (!trimmed) return fallback;

    // If already in DD/MM/YYYY format
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
      return trimmed;
    }

    // If in YYYY-MM-DD format (with optional time or timezone)
    const ymdMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (ymdMatch) {
      const year = ymdMatch[1];
      const month = ymdMatch[2].padStart(2, '0');
      const day = ymdMatch[3].padStart(2, '0');
      return `${day}/${month}/${year}`;
    }

    // If in DD-MM-YYYY format
    const dmyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmyMatch) {
      const day = dmyMatch[1].padStart(2, '0');
      const month = dmyMatch[2].padStart(2, '0');
      const year = dmyMatch[3];
      return `${day}/${month}/${year}`;
    }
  }

  try {
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch (e) {
    return String(dateVal);
  }
}

export const formatDateToDDMMYYYY = formatDate;

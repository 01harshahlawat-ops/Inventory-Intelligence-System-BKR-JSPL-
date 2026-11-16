const a = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen'
];

const b = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety'
];

function numberToWords(num) {
  if (num === 0) return 'Zero';
  if (num < 0) return 'Minus ' + numberToWords(Math.abs(num));

  let str = '';
  
  if (num >= 10000000) {
    str += numberToWords(Math.floor(num / 10000000)) + ' Crore ';
    num %= 10000000;
  }
  
  if (num >= 100000) {
    str += numberToWords(Math.floor(num / 100000)) + ' Lakh ';
    num %= 100000;
  }
  
  if (num >= 1000) {
    str += numberToWords(Math.floor(num / 1000)) + ' Thousand ';
    num %= 1000;
  }
  
  if (num >= 100) {
    str += numberToWords(Math.floor(num / 100)) + ' Hundred ';
    num %= 100;
  }
  
  if (num > 0) {
    if (num < 20) {
      str += a[num] + ' ';
    } else {
      str += b[Math.floor(num / 10)] + ' ';
      if (num % 10 > 0) {
        str += a[num % 10] + ' ';
      }
    }
  }
  
  return str.trim();
}

/**
 * Converts a number to Indian English words (Crore, Lakh, Thousand, Hundred)
 * @param {number|string} num - The number to convert
 * @returns {string} The number in words
 */
export function amountInWords(num) {
  if (num === null || num === undefined || isNaN(Number(num)) || String(num).trim() === '') {
    return '';
  }

  const isNegative = Number(num) < 0;
  let absNum = Math.abs(Number(num));
  
  if (absNum === 0) return 'Zero Only';
  
  const integerPart = Math.floor(absNum);
  let decimalPart = Math.round((absNum - integerPart) * 100);
  
  let finalInt = integerPart;
  if (decimalPart >= 100) {
    finalInt += Math.floor(decimalPart / 100);
    decimalPart = decimalPart % 100;
  }
  
  let result = numberToWords(finalInt);
  
  if (decimalPart > 0) {
    if (result === 'Zero') {
      result = '';
    } else {
      result += ' and ';
    }
    result += numberToWords(decimalPart) + ' Paise';
  }
  
  if (isNegative) {
    result = 'Minus ' + result;
  }
  
  return result.trim() + ' Only';
}

/**
 * Helper to convert tax amount to words, currently uses the same logic
 * @param {number|string} num - The number to convert
 * @returns {string} The tax amount in words
 */
export function taxAmountInWords(num) {
  return amountInWords(num);
}

export default amountInWords;


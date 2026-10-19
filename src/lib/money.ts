/**
 * Money is stored as integer **minor units** in the branch currency.
 * The exponent differs per currency (IDR/JPY are zero-decimal for payment
 * providers; AED/USD are 2-decimal), so all conversion happens here.
 */

export const CURRENCY_EXPONENTS: Record<string, number> = {
  IDR: 0,
  JPY: 0,
  KRW: 0,
  VND: 0,
  USD: 2,
  AED: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  SGD: 2,
  MYR: 2,
  THB: 2,
  SAR: 2,
  QAR: 2,
  INR: 2,
  CNY: 2,
  HKD: 2,
  NZD: 2,
  CAD: 2,
  CHF: 2,
};

export const CURRENCIES = Object.keys(CURRENCY_EXPONENTS);

export function exponentOf(currency: string): number {
  return CURRENCY_EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** Amount the gateway expects: Stripe/Razorpay use integer minor units. */
export function toGatewayAmount(minor: number, currency: string): number {
  return Math.round(minor);
}

/** Format minor units for display: 350000 IDR -> "Rp 350.000", 8000 AED -> "AED 80.00" */
export function formatMoney(minor: number, currency: string, locale = 'en-US'): string {
  const exp = exponentOf(currency);
  const major = minor / 10 ** exp;
  const numberFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: exp > 0 && minor % 10 ** exp !== 0 ? exp : exp === 0 ? 0 : 2,
    maximumFractionDigits: exp,
  });
  const n = numberFormat.format(major);
  switch (currency.toUpperCase()) {
    case 'IDR':
      return `Rp ${n}`;
    case 'AED':
      return `AED ${n}`;
    case 'USD':
      return `$${n}`;
    case 'EUR':
      return `€${n}`;
    case 'GBP':
      return `£${n}`;
    case 'THB':
      return `฿${n}`;
    case 'INR':
      return `₹${n}`;
    default:
      return `${currency.toUpperCase()} ${n}`;
  }
}

/** Parse user input ("350.000", "350,000", "80.5") into minor units. */
export function parseMoneyToMinor(input: string | number, currency: string): number {
  if (typeof input === 'number') return Math.round(input);
  const cleaned = input.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) return 0;
  // Last separator is the decimal marker when it leaves <= 2 decimals.
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const lastSep = Math.max(lastDot, lastComma);
  let major = cleaned;
  if (lastSep > -1) {
    const decimals = cleaned.length - lastSep - 1;
    const hasDecimalPoint = decimals <= 2 && decimals > 0 && (lastDot >= lastComma || lastComma > -1);
    major = hasDecimalPoint
      ? cleaned.slice(0, lastSep) + '.' + cleaned.slice(lastSep + 1)
      : cleaned.replace(/[.,]/g, '');
  }
  const value = Number(major);
  if (Number.isNaN(value)) return 0;
  return Math.round(value * 10 ** exponentOf(currency));
}

/** 15% -> 1500 basis points. */
export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

export function bpsToPercent(bps: number): number {
  return bps / 100;
}

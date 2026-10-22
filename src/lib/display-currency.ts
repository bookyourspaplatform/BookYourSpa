import { CURRENCY_EXPONENTS, formatMoney } from '@/lib/money';

/**
 * Display-currency conversion for the public storefront.
 *
 * Money is ALWAYS stored and charged in the branch currency — this only
 * changes what guests see while browsing. Rates below are static mid-market
 * snapshots (relative to USD); swap `FX` for a live rate feed when one is
 * wired in. Amounts are converted from the source currency's minor units to
 * the display currency's minor units, respecting each exponent.
 */

export const DISPLAY_CURRENCIES = [
  { code: 'USD', label: 'US Dollar', symbol: '$' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'GBP', label: 'British Pound', symbol: '£' },
  { code: 'IDR', label: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'AED', label: 'UAE Dirham', symbol: 'AED' },
  { code: 'SGD', label: 'Singapore Dollar', symbol: 'S$' },
  { code: 'AUD', label: 'Australian Dollar', symbol: 'A$' },
  { code: 'JPY', label: 'Japanese Yen', symbol: '¥' },
  { code: 'THB', label: 'Thai Baht', symbol: '฿' },
  { code: 'MYR', label: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'INR', label: 'Indian Rupee', symbol: '₹' },
  { code: 'CNY', label: 'Chinese Yuan', symbol: '¥' },
] as const;

export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number]['code'];

/** Units of each currency per 1 USD (mid-market snapshot). */
const FX: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  IDR: 15_850,
  AED: 3.6725,
  SGD: 1.34,
  AUD: 1.52,
  JPY: 152.4,
  THB: 34.6,
  MYR: 4.45,
  INR: 83.9,
  CNY: 7.24,
};

export function isDisplayCurrency(v: string): v is DisplayCurrency {
  return (DISPLAY_CURRENCIES as readonly { code: string }[]).some((c) => c.code === v.toUpperCase());
}

// Cookie-backed getDisplayCurrency() lives in '@/lib/currency-cookie' so this
// module stays importable from client components (no next/headers in the bundle).

/**
 * Convert minor units in `from` to minor units in `to`, honouring exponents.
 *
 * `FX` holds **major units per 1 USD**, so the amount must first be scaled out
 * of the source currency's minor units (÷ 10^fromExp) before the rate applies,
 * then into the target's minor units (× 10^toExp). Skipping the first step —
 * as an earlier revision did — multiplied by the rate while leaving the amount
 * in minor units, inflating zero-decimal currencies like IDR ~15,850×.
 */
export function convertMinor(minor: number, from: string, to: string): number {
  const fromU = from.toUpperCase();
  const toU = to.toUpperCase();
  if (fromU === toU) return minor;
  const fromExp = CURRENCY_EXPONENTS[fromU] ?? 2;
  const toExp = CURRENCY_EXPONENTS[toU] ?? 2;
  const majorPerUsd = (from: string) => FX[from] ?? 1;
  // Source minor -> source major -> USD major -> target major -> target minor.
  const sourceMajor = minor / 10 ** fromExp;
  const usdMajor = sourceMajor / majorPerUsd(fromU);
  const targetMajor = usdMajor * majorPerUsd(toU);
  return Math.round(targetMajor * 10 ** toExp);
}

/**
 * Format a stored amount in the visitor's display currency (falling back to
 * the source currency when no display currency applies).
 */
export function formatDisplayMoney(
  minor: number,
  from: string,
  display: DisplayCurrency | undefined,
  locale = 'en-US',
): string {
  if (!display || display.toUpperCase() === from.toUpperCase()) {
    return formatMoney(minor, from, locale);
  }
  return formatMoney(convertMinor(minor, from, display), display, locale);
}

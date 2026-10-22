import { describe, expect, it } from 'vitest';
import { convertMinor, formatDisplayMoney } from '@/lib/display-currency';

describe('convertMinor', () => {
  it('returns the same amount when source and target match', () => {
    expect(convertMinor(1_600_000, 'IDR', 'IDR')).toBe(1_600_000);
    expect(convertMinor(10_000, 'USD', 'USD')).toBe(10_000);
  });

  // Regression: convertMinor once multiplied by the FX rate without first
  // dividing out the source exponent, so zero-decimal currencies (IDR exponent
  // 0) came out ~15,850x too large — 1,600,000 IDR displayed as $25,360,000,000.
  it('scales a zero-decimal source down into a 2-decimal target', () => {
    // 1,600,000 IDR at 15,850 IDR/USD = ~100.95 USD = 10,095 cents.
    expect(convertMinor(1_600_000, 'IDR', 'USD')).toBe(10_095);
    expect(convertMinor(420_000, 'IDR', 'USD')).toBe(2_650);
  });

  it('round-trips within rounding tolerance', () => {
    const usd = convertMinor(1_600_000, 'IDR', 'USD');
    const back = convertMinor(usd, 'USD', 'IDR');
    expect(Math.abs(back - 1_600_000)).toBeLessThanOrEqual(200);
  });

  it('converts between two-decimal currencies', () => {
    expect(convertMinor(10_000, 'USD', 'EUR')).toBe(9_200); // 0.92 EUR/USD
  });

  it('inverts correctly for AED -> USD', () => {
    // 36,725 fils at 3.6725 AED/USD = 100.00 USD = 10,000 cents.
    expect(convertMinor(36_725, 'AED', 'USD')).toBe(10_000);
  });

  it('respects the target exponent for zero-decimal targets', () => {
    // 100.95 USD at 15,850 IDR/USD ~ 1,600,058 IDR (no minor units).
    expect(convertMinor(10_095, 'USD', 'IDR')).toBe(1_600_058);
    // 100.00 USD at 152.4 JPY/USD = 15,240 JPY (no minor units).
    expect(convertMinor(10_000, 'USD', 'JPY')).toBe(15_240);
  });
});

describe('formatDisplayMoney', () => {
  it('formats in the display currency', () => {
    expect(formatDisplayMoney(1_600_000, 'IDR', 'USD')).toBe('$100.95');
  });

  it('falls back to the source currency when none is given', () => {
    expect(formatDisplayMoney(1_600_000, 'IDR', undefined)).toBe('Rp 1,600,000');
  });

  it('falls back to the source currency when it equals the display currency', () => {
    expect(formatDisplayMoney(1_600_000, 'IDR', 'IDR')).toBe('Rp 1,600,000');
  });
});

import { describe, expect, it } from 'vitest';
import { formatAmountInput, parseMoneyToMinor } from '@/lib/money';

describe('formatAmountInput', () => {
  it('shows grouped major units for two-decimal currencies', () => {
    expect(formatAmountInput(42000, 'AED')).toBe('420.00');
    expect(formatAmountInput(42050, 'AED')).toBe('420.50');
    expect(formatAmountInput(1250000, 'AED')).toBe('12,500.00');
    expect(formatAmountInput(0, 'AED')).toBe('0.00');
  });

  it('groups zero-decimal currencies without a decimal part', () => {
    expect(formatAmountInput(350000, 'IDR')).toBe('350,000');
    expect(formatAmountInput(0, 'IDR')).toBe('0');
  });
});

describe('parseMoneyToMinor', () => {
  it('parses plain, grouped and decimal input', () => {
    expect(parseMoneyToMinor('420.00', 'AED')).toBe(42000);
    expect(parseMoneyToMinor('1,250.00', 'AED')).toBe(125000);
    expect(parseMoneyToMinor('1,234.5', 'AED')).toBe(123450);
    expect(parseMoneyToMinor('1250', 'AED')).toBe(125000);
    expect(parseMoneyToMinor('350,000', 'IDR')).toBe(350000);
    expect(parseMoneyToMinor('', 'AED')).toBe(0);
  });

  it('round-trips through formatAmountInput', () => {
    const cases = [
      [42000, 'AED'],
      [1250000, 'AED'],
      [99999, 'AED'],
      [350000, 'IDR'],
      [7, 'AED'],
    ] as const;
    for (const [minor, currency] of cases) {
      expect(parseMoneyToMinor(formatAmountInput(minor, currency), currency)).toBe(minor);
    }
  });
});

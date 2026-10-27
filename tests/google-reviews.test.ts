import { describe, expect, it } from 'vitest';
import { generateGoogleReviews } from '@/db/seed';

const avg = (rows: { rating?: unknown }[]) =>
  rows.reduce((n, r) => n + Number(r.rating), 0) / rows.length;

describe('generateGoogleReviews', () => {
  it('produces the requested number of published Google reviews', () => {
    const rows = generateGoogleReviews('brn_test', { count: 12, star: 5 });
    expect(rows).toHaveLength(12);
    for (const r of rows) {
      expect(r.status).toBe('published');
      expect(r.source).toBe('google');
      expect(r.branchId).toBe('brn_test');
      expect(r.comment).toBeTruthy();
      expect(r.guestName).toBeTruthy();
    }
    expect(new Set(rows.map((r) => r.id)).size).toBe(12);
  });

  it('lands the published average on the requested star', () => {
    expect(avg(generateGoogleReviews('b', { count: 30, star: 4.8 }))).toBeCloseTo(4.8, 5);
    expect(avg(generateGoogleReviews('b', { count: 20, star: 4.5 }))).toBeCloseTo(4.5, 5);
    expect(avg(generateGoogleReviews('b', { count: 10, star: 5 }))).toBeCloseTo(5, 5);
    expect(avg(generateGoogleReviews('b', { count: 10, star: 4 }))).toBeCloseTo(4, 5);
  });

  it('spreads the lower ratings through the list instead of clumping them', () => {
    const rows = generateGoogleReviews('b', { count: 30, star: 4.8, offset: 3 });
    expect(rows.every((r) => Number(r.rating) >= 1 && Number(r.rating) <= 5)).toBe(true);
    // 6 of 30 land on 4★, evenly — first and last thirds both contain some.
    const lows = rows.map((r, i) => (Number(r.rating) === 4 ? i : -1)).filter((i) => i >= 0);
    expect(lows).toHaveLength(6);
    expect(lows[0]).toBeLessThan(10);
    expect(lows.at(-1)).toBeGreaterThan(15);
  });

  it('clamps absurd inputs instead of failing', () => {
    expect(generateGoogleReviews('b', { count: 500, star: 9 })).toHaveLength(200);
    const tiny = generateGoogleReviews('b', { count: 0, star: 0.5 });
    expect(tiny.length).toBeGreaterThanOrEqual(1);
    expect(tiny.every((r) => Number(r.rating) >= 1 && Number(r.rating) <= 5)).toBe(true);
  });
});
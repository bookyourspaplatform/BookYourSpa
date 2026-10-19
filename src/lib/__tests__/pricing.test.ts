import { describe, expect, it } from 'vitest';
import { applyCoupon, couponApplies, priceBooking, splitOf } from '@/lib/pricing';

describe('applyCoupon', () => {
  it('applies percent discounts from basis points', () => {
    expect(applyCoupon({ code: 'X', discountType: 'percent', discountValue: 1000 }, 450_000)).toBe(45_000);
    expect(applyCoupon({ code: 'X', discountType: 'percent', discountValue: 1550 }, 1_000_000)).toBe(155_000);
  });

  it('applies fixed discounts capped at the list price', () => {
    expect(applyCoupon({ code: 'X', discountType: 'fixed', discountValue: 50_000 }, 400_000)).toBe(50_000);
    expect(applyCoupon({ code: 'X', discountType: 'fixed', discountValue: 900_000 }, 400_000)).toBe(400_000);
  });
});

describe('couponApplies', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const base = {
    active: true,
    code: 'WELCOME10',
    minAmount: 0,
    startsAt: null,
    endsAt: null,
    maxUses: 0,
    usedCount: 0,
    currency: null,
  };

  it('accepts a healthy coupon', () => {
    expect(couponApplies(base, { now, listPrice: 100_000, branchCurrency: 'IDR' })).toEqual({ ok: true });
  });

  it('rejects inactive, future, expired and exhausted coupons', () => {
    expect(couponApplies({ ...base, active: false }, { now, listPrice: 1, branchCurrency: 'IDR' }).ok).toBe(false);
    expect(couponApplies({ ...base, startsAt: new Date('2026-07-01') }, { now, listPrice: 1, branchCurrency: 'IDR' }).ok).toBe(false);
    expect(couponApplies({ ...base, endsAt: new Date('2026-06-01') }, { now, listPrice: 1, branchCurrency: 'IDR' }).ok).toBe(false);
    expect(couponApplies({ ...base, maxUses: 5, usedCount: 5 }, { now, listPrice: 1, branchCurrency: 'IDR' }).ok).toBe(false);
  });

  it('rejects currency mismatches and unmet minimums', () => {
    expect(couponApplies({ ...base, currency: 'AED' }, { now, listPrice: 100, branchCurrency: 'IDR' }).ok).toBe(false);
    expect(couponApplies({ ...base, minAmount: 500_000 }, { now, listPrice: 100, branchCurrency: 'IDR' }).ok).toBe(false);
  });
});

describe('priceBooking', () => {
  it('splits a direct booking between platform and provider', () => {
    const q = priceBooking({ listPrice: 450_000, platformBps: 1500 });
    expect(q.total).toBe(450_000);
    expect(q.platformFee).toBe(67_500);
    expect(q.agentCommission).toBe(0);
    expect(q.providerEarning).toBe(382_500);
  });

  it('applies a coupon before computing fees', () => {
    const q = priceBooking({
      listPrice: 450_000,
      coupon: { code: 'WELCOME10', discountType: 'percent', discountValue: 1000 },
      platformBps: 1500,
    });
    expect(q.discountAmount).toBe(45_000);
    expect(q.total).toBe(405_000);
    expect(q.platformFee).toBe(Math.round(405_000 * 0.15));
    expect(q.providerEarning).toBe(405_000 - q.platformFee);
  });

  it('pays an agent a percent commission on the discounted total', () => {
    const q = priceBooking({
      listPrice: 1_000_000,
      platformBps: 1500,
      agent: { commissionBps: 1000 },
    });
    expect(q.agentCommission).toBe(100_000);
    expect(q.platformFee).toBe(150_000);
    expect(q.providerEarning).toBe(750_000);
  });

  it('honours negotiated net agent rates', () => {
    const q = priceBooking({
      listPrice: 1_000_000,
      platformBps: 1500,
      agent: { commissionBps: 1000, netPrice: 820_000 },
    });
    expect(q.agentCommission).toBe(180_000); // total - net price
    expect(q.platformFee).toBe(150_000); // min(raw, net price)
    expect(q.providerEarning).toBe(670_000);
  });

  it('never lets fees exceed the total', () => {
    for (const platformBps of [0, 1500, 5000, 10_000]) {
      for (const agent of [null, { commissionBps: 9000 }, { commissionBps: 9000, netPrice: 100_000 }]) {
        const q = priceBooking({ listPrice: 400_000, platformBps, agent });
        expect(q.platformFee + q.agentCommission + q.providerEarning).toBe(q.total);
        expect(q.platformFee).toBeGreaterThanOrEqual(0);
        expect(q.agentCommission).toBeGreaterThanOrEqual(0);
        expect(q.providerEarning).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('round-trips through splitOf percentages', () => {
    const q = priceBooking({ listPrice: 450_000, platformBps: 1500, agent: { commissionBps: 1000 } });
    const s = splitOf(q);
    expect(s.platformPct).toBe(15);
    expect(s.agentPct).toBe(10);
    expect(s.providerPct).toBe(75);
  });
});

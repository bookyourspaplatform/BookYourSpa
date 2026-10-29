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

  it('funds a promotion discount from the supplier — fees stay on the list price', () => {
    const q = priceBooking({
      listPrice: 450_000,
      coupon: { code: 'PROMO20', discountType: 'percent', discountValue: 2000 },
      platformBps: 1500,
      discountBearer: 'provider',
    });
    expect(q.discountAmount).toBe(90_000);
    expect(q.total).toBe(360_000);
    expect(q.platformFee).toBe(67_500); // full platform cut on the list price
    expect(q.providerEarning).toBe(292_500); // 382_500 − the whole 90_000 discount
    expect(q.platformFee + q.providerEarning).toBe(q.total);
  });

  it('funds an admin promo code from the platform — the supplier keeps its full earning', () => {
    const q = priceBooking({
      listPrice: 450_000,
      coupon: { code: 'WELCOME10', discountType: 'percent', discountValue: 1000 },
      platformBps: 1500,
      discountBearer: 'platform',
    });
    expect(q.discountAmount).toBe(45_000);
    expect(q.total).toBe(405_000);
    expect(q.platformFee).toBe(67_500 - 45_000); // discount comes out of the platform's fee
    expect(q.providerEarning).toBe(382_500); // identical to a booking without a discount
    expect(q.platformFee + q.providerEarning).toBe(q.total);
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

describe('booking fee & deposit', () => {
  it('adds the fee on top without moving the spa\u2019s share', () => {
    const base = priceBooking({ listPrice: 450_000, platformBps: 1500 });
    const withFee = priceBooking({ listPrice: 450_000, platformBps: 1500, bookingFeeBps: 500 });

    expect(withFee.bookingFee).toBe(22_500); // 5%
    expect(withFee.total).toBe(472_500);
    expect(withFee.platformFee).toBe(base.platformFee + 22_500); // the fee is the platform\u2019s
    expect(withFee.providerEarning).toBe(base.providerEarning); // unchanged
    expect(withFee.platformFee + withFee.agentCommission + withFee.providerEarning).toBe(withFee.total);
  });

  it('splits the total into a deposit paid now and a balance paid later', () => {
    const q = priceBooking({
      listPrice: 450_000,
      platformBps: 1500,
      bookingFeeBps: 500,
      depositBps: 1000, // 10%
    });
    expect(q.total).toBe(472_500);
    expect(q.dueNow).toBe(47_250);
    expect(q.balanceDue).toBe(425_250);
    expect(q.dueNow + q.balanceDue).toBe(q.total);
  });

  it('charges everything up front when no deposit is configured', () => {
    const q = priceBooking({ listPrice: 450_000, platformBps: 1500 });
    expect(q.bookingFee).toBe(0);
    expect(q.dueNow).toBe(q.total);
    expect(q.balanceDue).toBe(0);
  });

  it('keeps the split exact with a coupon, fee and deposit together', () => {
    const q = priceBooking({
      listPrice: 450_000,
      coupon: { code: 'WELCOME10', discountType: 'percent', discountValue: 1000 },
      platformBps: 1500,
      bookingFeeBps: 500,
      depositBps: 1000,
    });
    expect(q.discountAmount).toBe(45_000);
    expect(q.bookingFee).toBe(20_250); // 5% of the discounted 405_000
    expect(q.total).toBe(425_250);
    expect(q.platformFee + q.agentCommission + q.providerEarning).toBe(q.total);
    expect(q.dueNow + q.balanceDue).toBe(q.total);
  });

  it('clamps nonsense percentages instead of blowing the price up', () => {
    const q = priceBooking({
      listPrice: 100_000,
      platformBps: 1500,
      bookingFeeBps: 999_999,
      depositBps: -50,
    });
    expect(q.bookingFee).toBe(100_000); // capped at 100%
    expect(q.dueNow).toBe(q.total); // a negative deposit means pay in full
  });
});

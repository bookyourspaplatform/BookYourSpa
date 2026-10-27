import type { DiscountType } from '@/db/schema';

/**
 * Pure pricing engine — the single source of truth for what a booking costs
 * and how money is split between platform, agent and provider. Every figure
 * stored on a booking is produced here (never trusted from the client).
 */

export type CouponLike = {
  code: string;
  discountType: DiscountType;
  discountValue: number; // percent = bps, fixed = minor units
  currency?: string | null;
  minAmount?: number | null;
};

/**
 * Who funds the discount:
 * - 'provider' — a promotion's value is deducted from the supplier's price
 *   (platform fee and agent commission are computed on the list price, so the
 *   provider's slice absorbs the whole discount).
 * - 'platform' — an admin promo code: the platform owns it, so the supplier's
 *   earning is unchanged and the discount comes out of the platform's fee.
 */
export type DiscountBearer = 'provider' | 'platform';

export type AgentTermsLike = {
  commissionBps: number;
  /** Net reseller price, when the agent has a special rate for this treatment. */
  netPrice?: number | null;
};

export type PriceQuote = {
  listPrice: number;
  discountAmount: number;
  couponCode: string | null;
  total: number;
  platformBps: number;
  platformFee: number;
  agentCommission: number;
  providerEarning: number;
};

export function applyCoupon(coupon: CouponLike, listPrice: number): number {
  if (coupon.discountType === 'percent') {
    return Math.min(listPrice, Math.floor((listPrice * coupon.discountValue) / 10_000));
  }
  // Fixed discounts are expressed in the coupon currency; branch currency must match.
  return Math.min(listPrice, coupon.discountValue);
}

export function priceBooking(input: {
  listPrice: number;
  coupon?: CouponLike | null;
  platformBps: number;
  agent?: AgentTermsLike | null;
  discountBearer?: DiscountBearer;
}): PriceQuote {
  const { listPrice, coupon, platformBps, agent, discountBearer } = input;
  const discountAmount = coupon ? applyCoupon(coupon, listPrice) : 0;
  const total = Math.max(0, listPrice - discountAmount);

  // Fees are taken from `feeBase`: with no stated bearer the discount is
  // shared (legacy split on the discounted total); with a stated bearer the
  // fees stay on the list price and the bearer then absorbs the discount.
  const feeBase = discountBearer ? listPrice : total;
  const rawPlatformFee = Math.round((feeBase * platformBps) / 10_000);

  let platformFee = rawPlatformFee;
  let agentCommission = 0;

  if (agent) {
    const hasNetRate =
      typeof agent.netPrice === 'number' && agent.netPrice > 0 && agent.netPrice < feeBase;
    if (hasNetRate) {
      // Reseller model: the agent keeps everything above its net price.
      agentCommission = feeBase - (agent.netPrice as number);
      // Platform still takes its cut, but never more than the provider's net.
      platformFee = Math.min(rawPlatformFee, agent.netPrice as number);
    } else {
      agentCommission = Math.round((feeBase * agent.commissionBps) / 10_000);
      platformFee = Math.min(rawPlatformFee, Math.max(0, feeBase - agentCommission));
    }
  }

  // Platform-funded discount (admin promo code): the platform pays it out of
  // its own fee, so the provider's earning is untouched — unless the discount
  // exceeds the fee, in which case the remainder falls back to the provider.
  if (discountBearer === 'platform' && discountAmount > 0) {
    platformFee -= discountAmount;
  }
  // Provider-funded discount (promotions): fees were computed on the list
  // price above, so providerEarning = total - fees already absorbs the whole
  // discount — the clamping below only guards the edge case where a discount
  // exceeds the provider's entire slice.

  platformFee = Math.max(0, Math.min(platformFee, total - agentCommission));
  agentCommission = Math.max(0, Math.min(agentCommission, total));
  const providerEarning = total - platformFee - agentCommission;

  return {
    listPrice,
    discountAmount,
    couponCode: coupon?.code ?? null,
    total,
    platformBps,
    platformFee,
    agentCommission,
    providerEarning,
  };
}

/* ------------------------ treatment price options ---------------------- */

export type PriceOptionLike = {
  durationMin: number;
  price: number;
  /** Concurrent-guest capacity for this tier (shared facilities only). */
  capacity?: number | null;
};

/**
 * Pick a duration/price tier by index. Absent, non-integer or out-of-range
 * indexes return null so every caller falls back to the treatment's
 * canonical single price/duration — a tampered index can never change what
 * a booking costs.
 */
export function pickPriceOption(
  options: readonly PriceOptionLike[] | null | undefined,
  index: number | null | undefined,
): PriceOptionLike | null {
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null;
  return options?.[index] ?? null;
}

/**
 * Re-base a provider-level price option onto the branch's own price for the
 * same treatment, so per-branch pricing in the price matrix keeps applying to
 * every duration tier (option 0 maps exactly to the branch price).
 */
export function branchOptionPrice(
  option: PriceOptionLike,
  listPrice: number,
  branchPrice: number,
): number {
  return Math.max(0, option.price + (branchPrice - listPrice));
}

/** Coupon validity check shared by quote + booking creation. */
export function couponApplies(
  coupon: {
    active: boolean;
    code: string;
    minAmount?: number | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
    maxUses?: number | null;
    usedCount?: number | null;
    currency?: string | null;
  },
  opts: { now: Date; listPrice: number; branchCurrency: string },
): { ok: true } | { ok: false; reason: string } {
  if (!coupon.active) return { ok: false, reason: 'This coupon is no longer active.' };
  if (coupon.startsAt && coupon.startsAt > opts.now)
    return { ok: false, reason: 'This coupon is not active yet.' };
  if (coupon.endsAt && coupon.endsAt < opts.now)
    return { ok: false, reason: 'This coupon has expired.' };
  if (coupon.maxUses && coupon.maxUses > 0 && (coupon.usedCount ?? 0) >= coupon.maxUses)
    return { ok: false, reason: 'This coupon has been fully redeemed.' };
  if (coupon.currency && coupon.currency !== opts.branchCurrency)
    return { ok: false, reason: 'This coupon cannot be applied to this branch currency.' };
  if (coupon.minAmount && coupon.minAmount > opts.listPrice)
    return { ok: false, reason: 'Your cart does not meet the minimum spend for this coupon.' };
  return { ok: true };
}

/** Basis-point split used by dashboards for "what if" previews. */
export function splitOf(quote: PriceQuote) {
  const denom = quote.total || 1;
  return {
    platformPct: Math.round((quote.platformFee / denom) * 1000) / 10,
    agentPct: Math.round((quote.agentCommission / denom) * 1000) / 10,
    providerPct: Math.round((quote.providerEarning / denom) * 1000) / 10,
  };
}

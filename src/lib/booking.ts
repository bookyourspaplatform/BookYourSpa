import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { AppDb } from '@/db';
import {
  agents,
  agentRates,
  bookings,
  bookingProducts,
  branches,
  branchTreatments,
  coupons,
  commissions,
  products,
  providers,
  promotions,
  providerPromotions,
  therapists,
  treatments,
  type Booking,
  type DiscountType,
} from '@/db/schema';
import { getSettings } from '@/lib/settings';
import { couponApplies, pickPriceOption, branchOptionPrice, priceBooking, type PriceQuote } from '@/lib/pricing';
import {
  getAvailability,
  slotsForDate,
  zonedToUtc,
  type BranchRules,
  type Slot,
  type TherapistInput,
} from '@/lib/availability';
import { dateKeyInTz, newId, newVoucherCode, partsInTz } from '@/lib/utils';

export type BookingErrorCode =
  | 'not_found'
  | 'unavailable'
  | 'conflict'
  | 'invalid'
  | 'coupon';

export class BookingError extends Error {
  constructor(
    message: string,
    public code: BookingErrorCode,
    public field?: string,
  ) {
    super(message);
    this.name = 'BookingError';
  }
}

/* ------------------------------------------------------------------ */
/* Discount codes: coupons + redeemable promotions                      */
/* ------------------------------------------------------------------ */

type ResolvedDiscount = {
  code: string;
  /** Shape the pricing engine understands. */
  asCoupon: {
    code: string;
    discountType: DiscountType;
    discountValue: number;
    currency: string | null;
  };
};

/**
 * Optional daily hour window in the spa's local timezone. Returns `null` when
 * no window is set, otherwise whether the current local hour falls inside it.
 * `from > until` means an overnight window (e.g. 22:00–06:00).
 */
function dailyHourWindow(
  from: number | null,
  until: number | null,
  timezone: string,
): { ok: boolean; window: string } | null {
  if (from == null && until == null) return null;
  const rawHour = partsInTz(new Date(), timezone).hour;
  const h = rawHour === 24 ? 0 : rawHour;
  const hh = (n: number) => `${String(n).padStart(2, '0')}:00`;
  if (from != null && until != null) {
    const ok = from <= until ? h >= from && h <= until : h >= from || h <= until;
    return { ok, window: `between ${hh(from)} and ${hh(until)}` };
  }
  if (from != null) return { ok: h >= from, window: `from ${hh(from)}` };
  return { ok: h <= (until as number), window: `until ${hh(until as number)}` };
}

/**
 * Resolve a checkout code: first a coupon (scoped codes), then a promotion
 * carrying a discount (general platform promotions unless a spa opted out;
 * optional treatment scope limits which treatments are discounted).
 */
async function resolveDiscountCode(
  db: AppDb,
  opts: {
    code: string;
    branch: { id: string; providerId: string; currency: string; timezone: string };
    /** Treatments in the cart — a scoped promotion needs at least one match. */
    treatmentIds: string[];
    listPrice: number;
  },
): Promise<ResolvedDiscount> {
  const code = opts.code.trim().toUpperCase();

  const coupon = await db.query.coupons.findFirst({ where: eq(coupons.code, code) });
  if (coupon) {
    const applies = couponApplies(coupon, {
      now: new Date(),
      listPrice: opts.listPrice,
      branchCurrency: opts.branch.currency,
    });
    if (!applies.ok) throw new BookingError(applies.reason, 'coupon', 'couponCode');
    const win = dailyHourWindow(coupon.validFromHour, coupon.validUntilHour, opts.branch.timezone);
    if (win && !win.ok)
      throw new BookingError(
        `That code is only valid ${win.window} (spa local time).`,
        'coupon',
        'couponCode',
      );
    const scopeOk =
      coupon.scope === 'global' ||
      (coupon.scope === 'provider' && coupon.providerId === opts.branch.providerId) ||
      (coupon.scope === 'branch' && coupon.branchId === opts.branch.id) ||
      (coupon.scope === 'treatment' && opts.treatmentIds.every((id) => id === coupon.treatmentId));
    if (!scopeOk) throw new BookingError('That coupon does not apply here.', 'coupon', 'couponCode');
    return {
      code: coupon.code,
      asCoupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        currency: coupon.currency,
      },
    };
  }

  const promo = await db.query.promotions.findFirst({ where: eq(promotions.code, code) });
  if (!promo) throw new BookingError('That coupon code was not found.', 'coupon', 'couponCode');
  if (!promo.discountType || promo.discountValue == null)
    throw new BookingError('That promotion cannot be applied as a discount.', 'coupon', 'couponCode');

  const applies = couponApplies({ ...promo, code: promo.code! }, {
    now: new Date(),
    listPrice: opts.listPrice,
    branchCurrency: opts.branch.currency,
  });
  if (!applies.ok) throw new BookingError(applies.reason, 'coupon', 'couponCode');

  // Owner scope: a general promotion applies at every spa unless this one
  // opted out in its supplier console; provider/branch promos stay local.
  let choice: { active: boolean; treatmentIds: string[] | null } | undefined;
  if (promo.branchId) {
    if (promo.branchId !== opts.branch.id)
      throw new BookingError('That promotion does not apply here.', 'coupon', 'couponCode');
  } else if (promo.providerId) {
    if (promo.providerId !== opts.branch.providerId)
      throw new BookingError('That promotion does not apply here.', 'coupon', 'couponCode');
  } else {
    choice = await db.query.providerPromotions.findFirst({
      where: and(
        eq(providerPromotions.providerId, opts.branch.providerId),
        eq(providerPromotions.promotionId, promo.id),
      ),
      columns: { active: true, treatmentIds: true },
    });
    if (choice && !choice.active)
      throw new BookingError('That promotion is not available at this spa.', 'coupon', 'couponCode');
  }

  /* --- optional daily hour window, checked in the spa's local time --- */
  const win = dailyHourWindow(promo.validFromHour, promo.validUntilHour, opts.branch.timezone);
  if (win && !win.ok)
    throw new BookingError(
      `That promotion is only valid ${win.window} (spa local time).`,
      'coupon',
      'couponCode',
    );

  // Treatment scope — 'all' discounts every treatment at the spa. 'selected'
  // takes the supplier's own list, or — for a platform promotion — the list
  // this spa picked when it activated the offer (admin never picks treatments).
  let scoped: string[] = [];
  if (promo.appliesTo === 'selected') {
    scoped = (promo.branchId || promo.providerId ? promo.treatmentIds : choice?.treatmentIds) ?? [];
    if (!scoped.length)
      throw new BookingError(
        'That promotion is not yet available at this spa.',
        'coupon',
        'couponCode',
      );
  }
  if (scoped.length && !opts.treatmentIds.some((id) => scoped.includes(id)))
    throw new BookingError(
      'That promotion does not apply to the treatments in your cart.',
      'coupon',
      'couponCode',
    );

  return {
    code: promo.code!,
    asCoupon: {
      code: promo.code!,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      currency: promo.currency,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Listing the codes a customer can redeem at one spa                  */
/* ------------------------------------------------------------------ */

export type BranchPromoCode = {
  id: string;
  title: string;
  summary: string | null;
  code: string;
  discountLabel: string;
  /** Effective treatment scope — empty = every treatment at this spa. */
  treatmentIds: string[];
  /** Optional daily hour window in the spa's local time. */
  validFromHour: number | null;
  validUntilHour: number | null;
};

/**
 * Redeemable promotions currently offered at a branch: active, carrying a
 * code and a discount, inside their date window, in owner scope for this spa
 * and not switched off by it. Each row carries the *effective* treatment
 * scope — for a platform “selected” promotion that is the list the spa itself
 * picked when activating it; a promotion the spa has not chosen yet is left
 * out because its code would be rejected at checkout.
 */
export async function redeemablePromotionsFor(
  db: AppDb,
  opts: { providerId: string; branchId: string; now?: Date },
): Promise<BranchPromoCode[]> {
  const now = opts.now ?? new Date();
  const rows = await db.query.promotions.findMany({
    where: and(
      eq(promotions.active, true),
      isNotNull(promotions.code),
      isNotNull(promotions.discountType),
      isNotNull(promotions.discountValue),
      or(isNull(promotions.endsAt), gte(promotions.endsAt, now)),
      or(isNull(promotions.startsAt), lte(promotions.startsAt, now)),
      or(
        and(isNull(promotions.providerId), isNull(promotions.branchId)),
        eq(promotions.providerId, opts.providerId),
        eq(promotions.branchId, opts.branchId),
      ),
    ),
    orderBy: [asc(promotions.sortOrder)],
  });
  const choices = rows.length
    ? await db.query.providerPromotions.findMany({
        where: eq(providerPromotions.providerId, opts.providerId),
        columns: { promotionId: true, active: true, treatmentIds: true },
      })
    : [];
  const choiceBy = new Map(choices.map((c) => [c.promotionId, c]));

  const out: BranchPromoCode[] = [];
  for (const p of rows) {
    const isPlatform = !p.providerId && !p.branchId;
    if (isPlatform && choiceBy.get(p.id)?.active === false) continue; // spa opted out

    let scoped: string[] = [];
    if (p.appliesTo === 'selected') {
      scoped = (isPlatform ? choiceBy.get(p.id)?.treatmentIds : p.treatmentIds) ?? [];
      if (scoped.length === 0) continue; // spa has not picked its treatments yet
    }
    out.push({
      id: p.id,
      title: p.title,
      summary: p.summary,
      code: p.code,
      discountLabel:
        p.discountType === 'percent'
          ? `${(p.discountValue ?? 0) / 100}% off`
          : `${p.discountValue ?? 0} off`,
      treatmentIds: scoped,
      validFromHour: p.validFromHour,
      validUntilHour: p.validUntilHour,
    });
  }
  return couponsFor(db, opts, now, out);
}

/**
 * Coupon codes from the `coupons` table that also work at this spa — same
 * window/cap rules, plus their own scope (global / provider / branch / one
 * treatment). Appended to the promotion rows above.
 */
async function couponsFor(
  db: AppDb,
  opts: { providerId: string; branchId: string },
  now: Date,
  out: BranchPromoCode[],
): Promise<BranchPromoCode[]> {
  const rows = await db.query.coupons.findMany({
    where: and(
      eq(coupons.active, true),
      or(isNull(coupons.endsAt), gte(coupons.endsAt, now)),
      or(isNull(coupons.startsAt), lte(coupons.startsAt, now)),
      or(isNull(coupons.maxUses), eq(coupons.maxUses, 0), lt(coupons.usedCount, coupons.maxUses)),
      or(
        eq(coupons.scope, 'global'),
        and(eq(coupons.scope, 'provider'), eq(coupons.providerId, opts.providerId)),
        and(eq(coupons.scope, 'branch'), eq(coupons.branchId, opts.branchId)),
        eq(coupons.scope, 'treatment'),
      ),
    ),
    orderBy: [asc(coupons.startsAt)],
  });
  for (const c of rows) {
    out.push({
      id: c.id,
      title: c.description || 'Promo code',
      summary: c.description,
      code: c.code,
      discountLabel:
        c.discountType === 'percent'
          ? `${(c.discountValue ?? 0) / 100}% off`
          : `${c.discountValue ?? 0} off`,
      treatmentIds: c.scope === 'treatment' && c.treatmentId ? [c.treatmentId] : [],
      validFromHour: c.validFromHour,
      validUntilHour: c.validUntilHour,
    });
  }
  return out;
}

type Tx = Parameters<Parameters<AppDb['transaction']>[0]>[0];

/** Atomically redeem a code against its cap — coupons and promotions share the rule. */
async function redeemCode(tx: Tx, code: string) {
  const couponHit = await tx
    .update(coupons)
    .set({ usedCount: sql`${coupons.usedCount} + 1` })
    .where(
      and(
        eq(coupons.code, code),
        or(isNull(coupons.maxUses), eq(coupons.maxUses, 0), lt(coupons.usedCount, coupons.maxUses)),
      ),
    )
    .returning({ id: coupons.id });
  if (couponHit.length > 0) return;

  const promoHit = await tx
    .update(promotions)
    .set({ usedCount: sql`${promotions.usedCount} + 1` })
    .where(
      and(
        eq(promotions.code, code),
        or(isNull(promotions.maxUses), eq(promotions.maxUses, 0), lt(promotions.usedCount, promotions.maxUses)),
      ),
    )
    .returning({ id: promotions.id });
  if (promoHit.length === 0) {
    throw new BookingError('That coupon has been fully redeemed.', 'coupon', 'couponCode');
  }
}

export type QuoteInput = {
  branchId: string;
  treatmentId: string;
  /** Index into the treatment's price options; invalid/absent → default tier. */
  optionIndex?: number | null;
  couponCode?: string | null;
  agentId?: string | null;
};

export type Quote = {
  branch: {
    id: string;
    name: string;
    slug: string;
    providerId: string;
    providerName: string;
    providerSlug: string;
    city: string;
    country: string;
    timezone: string;
    currency: string;
    onlinePaymentEnabled: boolean;
    paymentMethods: string[];
    cancellationHours: number;
  };
  treatment: { id: string; name: string; slug: string; durationMin: number; imageUrl: string | null };
  listPrice: number;
  currency: string;
  pricing: PriceQuote;
  couponCode: string | null;
  agentTerms: { commissionBps: number; netPrice: number | null } | null;
  payment: { online: boolean; venue: boolean; methods: string[] };
};

/** Server-side source of truth for what a booking costs. */
export async function quoteBooking(db: AppDb, input: QuoteInput): Promise<Quote> {
  const branch = await db.query.branches.findFirst({
    where: eq(branches.id, input.branchId),
    with: { provider: { columns: { id: true, name: true, slug: true, commissionBps: true, status: true } } },
  });
  if (!branch) throw new BookingError('Branch not found.', 'not_found');
  if (branch.status !== 'active') throw new BookingError('This branch is not accepting bookings.', 'invalid');
  if (branch.provider.status !== 'approved')
    throw new BookingError('This provider is not currently approved.', 'invalid');

  const link = await db.query.branchTreatments.findFirst({
    where: and(eq(branchTreatments.branchId, branch.id), eq(branchTreatments.treatmentId, input.treatmentId)),
  });
  if (!link || !link.active)
    throw new BookingError('This treatment is not offered at the selected branch.', 'invalid');

  const treatment = await db.query.treatments.findFirst({
    where: eq(treatments.id, input.treatmentId),
  });
  if (!treatment || treatment.status !== 'active')
    throw new BookingError('This treatment is currently unavailable.', 'invalid');

  // Resolve the chosen duration/price tier (falls back to the branch price
  // for the treatment's default duration when no valid option was picked).
  const chosenOption = pickPriceOption(treatment.priceOptions, input.optionIndex);
  const listPrice = chosenOption
    ? branchOptionPrice(chosenOption, treatment.listPrice, link.price)
    : link.price;
  const durationMin = chosenOption?.durationMin ?? treatment.durationMin;

  const settings = await getSettings();
  const platformBps = branch.provider.commissionBps ?? settings['finance.defaultPlatformCommissionBps'];

  /* --- agent terms --- */
  let agentTerms: Quote['agentTerms'] = null;
  if (input.agentId) {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, input.agentId), eq(agents.status, 'approved')),
      columns: { id: true, commissionBps: true },
    });
    if (agent) {
      const rate = await db.query.agentRates.findFirst({
        where: and(eq(agentRates.agentId, agent.id), eq(agentRates.treatmentId, treatment.id)),
      });
      // The branch can set its own agent/reseller/affiliate fee (%); it
      // overrides the partner's default rate when configured.
      agentTerms = {
        commissionBps: branch.agentFeeBps ?? agent.commissionBps,
        netPrice: rate?.active ? rate.netPrice : null,
      };
    }
  }

  /* --- coupon / promotion code --- */
  const discount = input.couponCode?.trim()
    ? await resolveDiscountCode(db, {
        code: input.couponCode,
        branch: { id: branch.id, providerId: branch.providerId, currency: branch.currency, timezone: branch.timezone },
        treatmentIds: [treatment.id],
        listPrice,
      })
    : null;

  const pricing = priceBooking({
    listPrice,
    coupon: discount?.asCoupon ?? null,
    platformBps,
    agent: agentTerms,
  });

  const online =
    branch.onlinePaymentEnabled &&
    settings['features.onlinePayments'] &&
    branch.paymentMethods.some((m) => m !== 'venue');
  const venue = branch.paymentMethods.includes('venue');

  return {
    branch: {
      id: branch.id,
      name: branch.name,
      slug: branch.slug,
      providerId: branch.providerId,
      providerName: branch.provider.name,
      providerSlug: branch.provider.slug,
      city: branch.city,
      country: branch.country,
      timezone: branch.timezone,
      currency: branch.currency,
      onlinePaymentEnabled: branch.onlinePaymentEnabled,
      paymentMethods: branch.paymentMethods,
      cancellationHours: settings['booking.cancellationHours'],
    },
    treatment: {
      id: treatment.id,
      name: treatment.name,
      slug: treatment.slug,
      durationMin,
      imageUrl: treatment.imageUrl,
    },
    listPrice,
    currency: branch.currency,
    pricing,
    couponCode: discount?.code ?? null,
    agentTerms,
    payment: { online, venue, methods: branch.paymentMethods },
  };
}

/* ------------------------------------------------------------------ */
/* Reservation                                                         */
/* ------------------------------------------------------------------ */

export type CreateBookingInput = {
  branchId: string;
  treatmentId: string;
  /** Index into the treatment's price options — drives both price and length. */
  optionIndex?: number | null;
  /** ISO instant of the appointment start. */
  startAt: Date;
  /** Explicit therapist, or null to auto-assign the first free one. */
  therapistId?: string | null;
  customer: { name: string; email: string; phone?: string | null };
  customerId?: string | null;
  agentId?: string | null;
  couponCode?: string | null;
  notes?: string | null;
  channel?: 'direct' | 'agent' | 'admin';
  /** 'venue' = pay at spa now; anything else starts an online payment flow. */
  paymentMode: 'venue' | 'online';
};

export type CreateBookingResult = {
  booking: Booking;
  quote: Quote;
};

async function loadBookingContext(db: AppDb, branchId: string, treatmentId: string) {
  const branch = await db.query.branches.findFirst({
    where: eq(branches.id, branchId),
    with: { provider: { columns: { id: true, name: true, slug: true, commissionBps: true, status: true } } },
  });
  if (!branch) throw new BookingError('Branch not found.', 'not_found');
  const link = await db.query.branchTreatments.findFirst({
    where: and(eq(branchTreatments.branchId, branchId), eq(branchTreatments.treatmentId, treatmentId)),
  });
  if (!link) throw new BookingError('This treatment is not offered here.', 'invalid');
  const treatment = await db.query.treatments.findFirst({ where: eq(treatments.id, treatmentId) });
  if (!treatment) throw new BookingError('Treatment not found.', 'not_found');
  return { branch, link, treatment };
}

export async function createBooking(
  db: AppDb,
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  const quote = await quoteBooking(db, {
    branchId: input.branchId,
    treatmentId: input.treatmentId,
    optionIndex: input.optionIndex,
    couponCode: input.couponCode,
    agentId: input.agentId,
  });

  const { branch, treatment } = await loadBookingContext(db, input.branchId, input.treatmentId);
  const settings = await getSettings();
  const now = new Date();

  if (Number.isNaN(input.startAt.getTime())) {
    throw new BookingError('Invalid appointment time.', 'invalid', 'startAt');
  }
  const local = partsInTz(input.startAt, branch.timezone);
  if (input.startAt.getTime() < now.getTime() + branch.leadTimeMinutes * 60_000) {
    throw new BookingError('That time is too close to now — please pick a later slot.', 'conflict', 'startAt');
  }
  const horizonEnd = zonedToUtc(
    dateKeyInTz(now, branch.timezone),
    (branch.maxAdvanceDays + 1) * 24 * 60,
    branch.timezone,
  );
  if (input.startAt.getTime() > horizonEnd.getTime()) {
    throw new BookingError('Bookings cannot be made that far ahead.', 'invalid', 'startAt');
  }
  const expectedDurationMin =
    pickPriceOption(treatment.priceOptions, input.optionIndex)?.durationMin ?? treatment.durationMin;
  const expectedEnd = new Date(
    input.startAt.getTime() + (expectedDurationMin + branch.bufferMinutes) * 60_000,
  );

  const holdMinutes = settings['booking.pendingHoldMinutes'] as number;
  const channel = input.channel ?? (input.agentId ? 'agent' : 'direct');

  const created = await db.transaction(async (tx) => {
    /* 1. Lock the resource row so concurrent requests serialise here. */
    if (treatment.requiresTherapist && input.therapistId) {
      const rows = await tx
        .select({ id: therapists.id, branchId: therapists.branchId, active: therapists.active })
        .from(therapists)
        .where(eq(therapists.id, input.therapistId))
        .for('update');
      if (rows.length === 0) throw new BookingError('Therapist not found.', 'not_found');
      if (rows[0]!.branchId !== branch.id)
        throw new BookingError('Therapist is not at this branch.', 'invalid');
      if (!rows[0]!.active) throw new BookingError('That therapist is not available.', 'conflict');
    } else {
      // Auto-assignment and shared-capacity treatments race on the branch row.
      await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, branch.id)).for('update');
    }

    /* 2. Re-validate the slot against live data inside the transaction. */
    const availability = await getAvailability(tx, {
      branchId: branch.id,
      treatmentId: treatment.id,
      optionIndex: input.optionIndex,
      therapistId: treatment.requiresTherapist ? (input.therapistId ?? null) : null,
      from: local.date,
      days: 1,
      now,
    });
    if (!availability.ok) throw new BookingError(availability.error, 'invalid');

    const day = availability.days[0];
    const match = day?.slots.find((s) => s.start.getTime() === input.startAt.getTime());
    if (!match) {
      throw new BookingError(
        'That time slot was just taken — please choose another.',
        'conflict',
        'startAt',
      );
    }
    const therapistId = treatment.requiresTherapist ? match.therapistId : null;

    /* 3. Code redemption (atomic against max_uses) — coupon or promotion. */
    if (quote.couponCode) await redeemCode(tx, quote.couponCode);

    /* 4. Insert the booking (partial unique index backstops therapist slots). */
    let bookingRow: Booking | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const rows = await tx
          .insert(bookings)
          .values({
            id: newId('bkg'),
            code: newVoucherCode(),
            providerId: branch.providerId,
            branchId: branch.id,
            treatmentId: treatment.id,
            therapistId,
            customerId: input.customerId ?? null,
            agentId: input.agentId ?? null,
            guestName: input.customer.name.trim(),
            guestEmail: input.customer.email.trim().toLowerCase(),
            guestPhone: input.customer.phone?.trim() || null,
            startAt: input.startAt,
            endAt: expectedEnd,
            timezone: branch.timezone,
            status: input.paymentMode === 'venue' ? 'confirmed' : 'pending',
            paymentStatus: input.paymentMode === 'venue' ? 'venue' : 'unpaid',
            channel,
            currency: quote.currency,
            listPrice: quote.pricing.listPrice,
            discountAmount: quote.pricing.discountAmount,
            totalAmount: quote.pricing.total,
            platformFee: quote.pricing.platformFee,
            agentCommission: quote.pricing.agentCommission,
            providerEarning: quote.pricing.providerEarning,
            couponCode: quote.pricing.couponCode,
            expiresAt: input.paymentMode === 'venue' ? null : new Date(now.getTime() + holdMinutes * 60_000),
            notes: input.notes?.trim() || null,
          })
          .returning();
        bookingRow = rows[0]!;
        break;
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string })?.code;
        if (code === '23505') continue; // unique violation → regenerate code / slot raced
        throw err;
      }
    }
    if (!bookingRow) {
      throw lastErr instanceof Error
        ? new BookingError('That time slot was just taken — please choose another.', 'conflict', 'startAt')
        : new BookingError('Could not create the booking.', 'invalid');
    }

    /* 5. Commission ledger rows (snapshotted figures). */
    const ledger: (typeof commissions.$inferInsert)[] = [];
    if (bookingRow.platformFee > 0) {
      ledger.push({
        id: newId('com'),
        bookingId: bookingRow.id,
        party: 'platform',
        providerId: branch.providerId,
        rateBps: quote.pricing.platformBps,
        amount: bookingRow.platformFee,
        currency: bookingRow.currency,
      });
    }
    if (bookingRow.agentCommission > 0 && bookingRow.agentId) {
      ledger.push({
        id: newId('com'),
        bookingId: bookingRow.id,
        party: 'agent',
        providerId: branch.providerId,
        agentId: bookingRow.agentId,
        rateBps: quote.agentTerms?.commissionBps ?? 0,
        amount: bookingRow.agentCommission,
        currency: bookingRow.currency,
      });
    }
    if (bookingRow.providerEarning > 0) {
      ledger.push({
        id: newId('com'),
        bookingId: bookingRow.id,
        party: 'provider',
        providerId: branch.providerId,
        agentId: bookingRow.agentId,
        amount: bookingRow.providerEarning,
        currency: bookingRow.currency,
      });
    }
    if (ledger.length) await tx.insert(commissions).values(ledger);

    return bookingRow;
  });

  return { booking: created, quote };
}

/* ------------------------------------------------------------------ */
/* Multi-treatment cart: quote + group reservation                     */
/* ------------------------------------------------------------------ */

export type CartItemInput = {
  treatmentId: string;
  /** Index into the treatment's price options; invalid/absent → default tier. */
  optionIndex?: number | null;
  /** Guests for this line (1–8). Priced per person. */
  persons?: number;
};

export type CartProductInput = { productId: string; quantity: number };

export type CartLine = {
  treatmentId: string;
  name: string;
  optionIndex: number | null;
  durationMin: number;
  /** Per-person list price at this branch (tier re-based onto branch pricing). */
  unitPrice: number;
  persons: number;
  lineTotal: number;
  requiresTherapist: boolean;
  /** Therapists seated together for this line (couples / four-hand). */
  therapistsPerBooking: number;
};

export type CartProductLine = {
  productId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type CartQuote = {
  branch: Quote['branch'];
  lines: CartLine[];
  products: CartProductLine[];
  /** Treatments subtotal after persons, before coupon. */
  treatmentsTotal: number;
  productsTotal: number;
  /** Grand list price (treatments + products) before coupon. */
  listPrice: number;
  currency: string;
  pricing: PriceQuote;
  couponCode: string | null;
  agentTerms: Quote['agentTerms'];
  payment: Quote['payment'];
};

function normalizePersons(raw: number | undefined): number {
  if (!Number.isInteger(raw)) return 1;
  return Math.min(8, Math.max(1, raw as number));
}

/** Server-side source of truth for what a multi-item cart costs. */
export async function quoteCart(db: AppDb, input: {
  branchId: string;
  items: CartItemInput[];
  products?: CartProductInput[];
  couponCode?: string | null;
  agentId?: string | null;
}): Promise<CartQuote> {
  if (!input.items.length) throw new BookingError('Add at least one treatment.', 'invalid', 'items');
  if (input.items.length > 8)
    throw new BookingError('A single booking can hold up to 8 treatments.', 'invalid', 'items');

  const branch = await db.query.branches.findFirst({
    where: eq(branches.id, input.branchId),
    with: { provider: { columns: { id: true, name: true, slug: true, commissionBps: true, status: true } } },
  });
  if (!branch) throw new BookingError('Branch not found.', 'not_found');
  if (branch.status !== 'active') throw new BookingError('This branch is not accepting bookings.', 'invalid');
  if (branch.provider.status !== 'approved')
    throw new BookingError('This provider is not currently approved.', 'invalid');

  /* --- treatment lines --- */
  const treatmentIds = [...new Set(input.items.map((i) => i.treatmentId))];
  const links = await db.query.branchTreatments.findMany({
    where: and(eq(branchTreatments.branchId, branch.id), inArray(branchTreatments.treatmentId, treatmentIds)),
  });
  const treatmentRows = await db.query.treatments.findMany({
    where: inArray(treatments.id, treatmentIds),
  });

  const lines: CartLine[] = input.items.map((item) => {
    const link = links.find((l) => l.treatmentId === item.treatmentId);
    if (!link || !link.active)
      throw new BookingError('A treatment in your cart is not offered at this branch.', 'invalid', 'items');
    const treatment = treatmentRows.find((t) => t.id === item.treatmentId);
    if (!treatment || treatment.status !== 'active')
      throw new BookingError('A treatment in your cart is currently unavailable.', 'invalid', 'items');

    const chosenOption = pickPriceOption(treatment.priceOptions, item.optionIndex);
    const unitPrice = chosenOption
      ? branchOptionPrice(chosenOption, treatment.listPrice, link.price)
      : link.price;
    const persons = normalizePersons(item.persons);
    return {
      treatmentId: treatment.id,
      name: treatment.name,
      optionIndex: chosenOption ? (item.optionIndex ?? null) : null,
      durationMin: chosenOption?.durationMin ?? treatment.durationMin,
      unitPrice,
      persons,
      lineTotal: unitPrice * persons,
      requiresTherapist: treatment.requiresTherapist,
      therapistsPerBooking: treatment.requiresTherapist
        ? Math.max(1, Math.min(treatment.therapistsPerBooking ?? 1, 4))
        : 1,
    };
  });

  const treatmentsTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

  /* --- retail products --- */
  const productLines: CartProductLine[] = [];
  const wanted = input.products ?? [];
  if (wanted.length > 20) throw new BookingError('Too many products in one order.', 'invalid', 'products');
  if (wanted.length) {
    const ids = [...new Set(wanted.map((p) => p.productId))];
    const rows = await db.query.products.findMany({
      where: and(eq(products.branchId, branch.id), inArray(products.id, ids)),
    });
    for (const req of wanted) {
      const row = rows.find((p) => p.id === req.productId);
      if (!row || !row.active)
        throw new BookingError('A product in your cart is no longer available.', 'invalid', 'products');
      if (row.currency !== branch.currency)
        throw new BookingError('Product currency does not match this branch.', 'invalid', 'products');
      const quantity = Math.min(99, Math.max(1, Math.floor(req.quantity || 1)));
      const existing = productLines.find((l) => l.productId === row.id);
      if (existing) {
        existing.quantity += quantity;
        existing.lineTotal = existing.unitPrice * existing.quantity;
      } else {
        productLines.push({
          productId: row.id,
          name: row.name,
          unitPrice: row.price,
          quantity,
          lineTotal: row.price * quantity,
        });
      }
    }
  }
  const productsTotal = productLines.reduce((sum, l) => sum + l.lineTotal, 0);
  const listPrice = treatmentsTotal + productsTotal;

  const settings = await getSettings();
  const platformBps = branch.provider.commissionBps ?? settings['finance.defaultPlatformCommissionBps'];

  /* --- agent terms --- */
  let agentTerms: CartQuote['agentTerms'] = null;
  if (input.agentId) {
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, input.agentId), eq(agents.status, 'approved')),
      columns: { id: true, commissionBps: true },
    });
    if (agent) {
      const commissionBps = branch.agentFeeBps ?? agent.commissionBps;
      // Net reseller rates are per-treatment, so they only apply to a
      // single-treatment cart without products; bigger carts use the % rate.
      let netPrice: number | null = null;
      if (lines.length === 1 && productLines.length === 0) {
        const rate = await db.query.agentRates.findFirst({
          where: and(eq(agentRates.agentId, agent.id), eq(agentRates.treatmentId, lines[0]!.treatmentId)),
        });
        netPrice = rate?.active ? rate.netPrice : null;
      }
      agentTerms = { commissionBps, netPrice };
    }
  }

  /* --- coupon / promotion code (validated once against the whole cart) --- */
  const discount = input.couponCode?.trim()
    ? await resolveDiscountCode(db, {
        code: input.couponCode,
        branch: { id: branch.id, providerId: branch.providerId, currency: branch.currency, timezone: branch.timezone },
        treatmentIds: lines.map((l) => l.treatmentId),
        listPrice,
      })
    : null;

  const pricing = priceBooking({
    listPrice,
    coupon: discount?.asCoupon ?? null,
    platformBps,
    agent: agentTerms,
  });

  const online =
    branch.onlinePaymentEnabled &&
    settings['features.onlinePayments'] &&
    branch.paymentMethods.some((m) => m !== 'venue');
  const venue = branch.paymentMethods.includes('venue');

  return {
    branch: {
      id: branch.id,
      name: branch.name,
      slug: branch.slug,
      providerId: branch.providerId,
      providerName: branch.provider.name,
      providerSlug: branch.provider.slug,
      city: branch.city,
      country: branch.country,
      timezone: branch.timezone,
      currency: branch.currency,
      onlinePaymentEnabled: branch.onlinePaymentEnabled,
      paymentMethods: branch.paymentMethods,
      cancellationHours: settings['booking.cancellationHours'],
    },
    lines,
    products: productLines,
    treatmentsTotal,
    productsTotal,
    listPrice,
    currency: branch.currency,
    pricing,
    couponCode: discount?.code ?? null,
    agentTerms,
    payment: { online, venue, methods: branch.paymentMethods },
  };
}

/** One line of a multi-treatment checkout: a tier, its guests and its slot. */
export type CreateGroupItem = CartItemInput & {
  /** ISO instant of this line's appointment start (same for every line in Together mode). */
  startAt: Date;
  /** Preferred therapist for this line, or null to auto-assign. */
  therapistId?: string | null;
};

export type CreateGroupInput = {
  branchId: string;
  items: CreateGroupItem[];
  products?: CartProductInput[];
  customer: { name: string; email: string; phone?: string | null };
  customerId?: string | null;
  agentId?: string | null;
  couponCode?: string | null;
  notes?: string | null;
  channel?: 'direct' | 'agent' | 'admin';
  /** 'venue' = pay at spa now; anything else starts an online payment flow. */
  paymentMode: 'venue' | 'online';
};

export type CreateGroupResult = {
  groupId: string;
  /** First treatment line — carries the product lines and the payment row. */
  primary: Booking;
  bookings: Booking[];
  quote: CartQuote;
};

/**
 * Creates a whole cart as ONE booking group in a single transaction: every
 * line's slot is re-validated against live availability, therapists are
 * assigned without overlaps, the coupon is redeemed once, and money is split
 * across the rows so their sums equal the cart quote exactly.
 */
export async function createBookingGroup(
  db: AppDb,
  input: CreateGroupInput,
): Promise<CreateGroupResult> {
  const quote = await quoteCart(db, {
    branchId: input.branchId,
    items: input.items.map((i) => ({
      treatmentId: i.treatmentId,
      optionIndex: i.optionIndex,
      persons: i.persons,
    })),
    products: input.products,
    couponCode: input.couponCode,
    agentId: input.agentId,
  });

  const branchRow = await db.query.branches.findFirst({ where: eq(branches.id, input.branchId) });
  if (!branchRow) throw new BookingError('Branch not found.', 'not_found');
  const branch = branchRow;
  const settings = await getSettings();
  const now = new Date();
  const holdMinutes = settings['booking.pendingHoldMinutes'] as number;
  const channel = input.channel ?? (input.agentId ? 'agent' : 'direct');
  const venue = input.paymentMode === 'venue';

  /* --- validate every requested instant before touching the db --- */
  const items = input.items.map((item, idx) => {
    const line = quote.lines[idx]!;
    if (Number.isNaN(item.startAt.getTime()))
      throw new BookingError('Invalid appointment time.', 'invalid', 'startAt');
    if (item.startAt.getTime() < now.getTime() + branch.leadTimeMinutes * 60_000)
      throw new BookingError('That time is too close to now — please pick a later slot.', 'conflict', 'startAt');
    const horizonEnd = zonedToUtc(
      dateKeyInTz(now, branch.timezone),
      (branch.maxAdvanceDays + 1) * 24 * 60,
      branch.timezone,
    );
    if (item.startAt.getTime() > horizonEnd.getTime())
      throw new BookingError('Bookings cannot be made that far ahead.', 'invalid', 'startAt');
    return {
      idx,
      line,
      startAt: item.startAt,
      endAt: new Date(item.startAt.getTime() + (line.durationMin + branch.bufferMinutes) * 60_000),
      preferredTherapistId: item.therapistId || null,
      date: partsInTz(item.startAt, branch.timezone).date,
    };
  });

  const created = await db.transaction(async (tx) => {
    /* 1. Serialise concurrent checkouts for this branch. */
    await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, branch.id)).for('update');

    /* 2. Re-validate slots against live data inside the transaction. */
    const availCache = new Map<string, Awaited<ReturnType<typeof getAvailability>>>();
    const fetchSlots = async (key: string, args: Parameters<typeof getAvailability>[1]) => {
      const hit = availCache.get(key);
      if (hit) return hit;
      const res = await getAvailability(tx, args);
      availCache.set(key, res);
      return res;
    };

    // Shared-facility lines at the same tier+time share one capacity pool.
    const sharedBuckets = new Map<
      string,
      { treatmentId: string; optionIndex: number | null; persons: number; date: string; startAt: Date }
    >();
    for (const it of items) {
      if (it.line.requiresTherapist) continue;
      const key = `${it.line.treatmentId}|${it.line.optionIndex ?? ''}|${it.startAt.getTime()}`;
      const bucket = sharedBuckets.get(key) ?? {
        treatmentId: it.line.treatmentId,
        optionIndex: it.line.optionIndex,
        persons: 0,
        date: it.date,
        startAt: it.startAt,
      };
      bucket.persons += it.line.persons;
      sharedBuckets.set(key, bucket);
    }
    for (const bucket of sharedBuckets.values()) {
      const res = await fetchSlots(
        `shared|${bucket.treatmentId}|${bucket.optionIndex ?? ''}|${bucket.persons}|${bucket.date}`,
        {
          branchId: branch.id,
          treatmentId: bucket.treatmentId,
          optionIndex: bucket.optionIndex,
          persons: bucket.persons,
          from: bucket.date,
          days: 1,
          now,
        },
      );
      if (!res.ok) throw new BookingError(res.error, 'invalid');
      const match = res.days[0]?.slots.find((s) => s.start.getTime() === bucket.startAt.getTime());
      if (!match)
        throw new BookingError('That time slot was just taken — please choose another.', 'conflict', 'startAt');
    }

    // Therapist lines: candidate therapists free at this line's start.
    const candidates = new Map<number, Slot[]>();
    for (const it of items) {
      if (!it.line.requiresTherapist) continue;
      const team = it.line.therapistsPerBooking > 1;
      const res = await fetchSlots(
        `thr|${it.line.treatmentId}|${it.line.optionIndex ?? ''}|${team ? '' : it.preferredTherapistId ?? ''}|${it.date}`,
        {
          branchId: branch.id,
          treatmentId: it.line.treatmentId,
          optionIndex: it.line.optionIndex,
          // A team needs every free therapist listed so partners can be seated;
          // the customer's preferred pick is ordered first instead of filtered.
          therapistId: team ? null : it.preferredTherapistId || null,
          persons: it.line.persons,
          from: it.date,
          days: 1,
          now,
        },
      );
      if (!res.ok) throw new BookingError(res.error, 'invalid');
      const slots = (res.days[0]?.slots ?? []).filter(
        (s) => s.start.getTime() === it.startAt.getTime() && s.therapistId !== null,
      );
      if (slots.length === 0)
        throw new BookingError('That time slot was just taken — please choose another.', 'conflict', 'startAt');
      if (team && it.preferredTherapistId) {
        const pref = it.preferredTherapistId;
        slots.sort(
          (a, b) =>
            (a.therapistId === pref ? 0 : 1) - (b.therapistId === pref ? 0 : 1),
        );
      }
      candidates.set(it.idx, slots);
    }

    /* 3. Assign distinct therapists with no overlapping windows. */
    const ordered = items
      .filter((i) => i.line.requiresTherapist)
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    const assignment = new Map<number, string[]>();
    const busy: { therapistId: string; start: number; end: number }[] = [];
    const isBusy = (tid: string, it: (typeof items)[number]) =>
      busy.some((b) => b.therapistId === tid && b.start < it.endAt.getTime() && it.startAt.getTime() < b.end);
    const assign = (pos: number): boolean => {
      if (pos >= ordered.length) return true;
      const it = ordered[pos]!;
      const pool = candidates.get(it.idx)!;
      const need = Math.max(1, Math.min(it.line.therapistsPerBooking, 4));
      const team: string[] = [];
      const seat = (from: number): boolean => {
        if (team.length === need) {
          for (const tid of team)
            busy.push({ therapistId: tid, start: it.startAt.getTime(), end: it.endAt.getTime() });
          assignment.set(it.idx, [...team]);
          if (assign(pos + 1)) return true;
          assignment.delete(it.idx);
          for (let k = 0; k < need; k++) busy.pop();
          return false;
        }
        for (let k = from; k < pool.length; k++) {
          const tid = pool[k]!.therapistId!;
          if (team.includes(tid) || isBusy(tid, it)) continue;
          team.push(tid);
          if (seat(k + 1)) return true;
          team.pop();
        }
        return false;
      };
      return seat(0);
    };
    if (!assign(0)) {
      throw new BookingError(
        'These treatments could not all be assigned therapists at that time — please pick another slot.',
        'conflict',
        'startAt',
      );
    }

    /* 4. Code redemption (atomic against max_uses) — once for the whole cart. */
    if (quote.couponCode) await redeemCode(tx, quote.couponCode);

    /* 5. One row per therapist seat — a couples line becomes two rows. */
    const { discountAmount: D, platformFee: F, agentCommission: A, total: grandTotal } = quote.pricing;
    /** Split `amount` into `n` parts that sum back to `amount` exactly. */
    const splitAmount = (amount: number, n: number): number[] =>
      Array.from(
        { length: n },
        (_, j) => Math.floor((amount * (j + 1)) / n) - Math.floor((amount * j) / n),
      );

    type RowSpec = {
      it: (typeof items)[number];
      therapistId: string | null;
      persons: number;
      list: number;
    };
    const specs: RowSpec[] = [];
    for (const it of items) {
      const need = it.line.requiresTherapist
        ? Math.max(1, Math.min(it.line.therapistsPerBooking, 4))
        : 1;
      const team = assignment.get(it.idx) ?? [];
      const perRow = Math.floor(it.line.persons / need);
      const extra = it.line.persons % need;
      const parts = splitAmount(it.line.lineTotal, need);
      for (let j = 0; j < need; j++) {
        specs.push({
          it,
          therapistId: it.line.requiresTherapist ? team[j] ?? null : null,
          persons: Math.max(1, perRow + (j < extra ? 1 : 0)),
          list: parts[j]!,
        });
      }
    }

    /* Money allocation — per-row figures sum exactly to the cart quote. */
    const rowList = specs.map((s, i) => s.list + (i === 0 ? quote.productsTotal : 0));
    const rowDiscount = rowList.map((l) => (quote.listPrice > 0 ? Math.floor((D * l) / quote.listPrice) : 0));
    rowDiscount[0] = (rowDiscount[0] ?? 0) + (D - rowDiscount.reduce((s, d) => s + d, 0));
    const rowTotals = rowList.map((l, i) => l - rowDiscount[i]!);
    const rowFee = rowTotals.map((t) => (grandTotal > 0 ? Math.round((F * t) / grandTotal) : 0));
    rowFee[0] = (rowFee[0] ?? 0) + (F - rowFee.reduce((s, f) => s + f, 0));
    const rowAgent = rowTotals.map((t) => (grandTotal > 0 ? Math.round((A * t) / grandTotal) : 0));
    rowAgent[0] = (rowAgent[0] ?? 0) + (A - rowAgent.reduce((s, f) => s + f, 0));

    /* 6. Insert the rows (one voucher code each, all in one group). */
    const groupId = newId('grp');
    const expiresAt = venue ? null : new Date(now.getTime() + holdMinutes * 60_000);
    const rows: Booking[] = [];
    for (let r = 0; r < specs.length; r++) {
      const spec = specs[r]!;
      const it = spec.it;
      const providerEarning = rowTotals[r]! - rowFee[r]! - rowAgent[r]!;
      const [bookingRow] = await tx
        .insert(bookings)
        .values({
          id: newId('bkg'),
          code: newVoucherCode(),
          groupId,
          providerId: branch.providerId,
          branchId: branch.id,
          treatmentId: it.line.treatmentId,
          therapistId: spec.therapistId,
          customerId: input.customerId ?? null,
          agentId: input.agentId ?? null,
          guestName: input.customer.name.trim(),
          guestEmail: input.customer.email.trim().toLowerCase(),
          guestPhone: input.customer.phone?.trim() || null,
          guestCount: spec.persons,
          startAt: it.startAt,
          endAt: it.endAt,
          timezone: branch.timezone,
          status: venue ? 'confirmed' : 'pending',
          paymentStatus: venue ? 'venue' : 'unpaid',
          channel,
          currency: quote.currency,
          listPrice: rowList[r]!,
          discountAmount: rowDiscount[r]!,
          totalAmount: rowTotals[r]!,
          platformFee: rowFee[r]!,
          agentCommission: rowAgent[r]!,
          providerEarning,
          couponCode: (rowDiscount[r] ?? 0) > 0 ? quote.pricing.couponCode : null,
          expiresAt,
          notes: r === 0 ? (input.notes?.trim() || null) : null,
        })
        .returning();
      const row = bookingRow!;
      rows.push(row);

      const ledger: (typeof commissions.$inferInsert)[] = [];
      if (row.platformFee > 0) {
        ledger.push({
          id: newId('com'),
          bookingId: row.id,
          party: 'platform',
          providerId: branch.providerId,
          rateBps: quote.pricing.platformBps,
          amount: row.platformFee,
          currency: row.currency,
        });
      }
      if (row.agentCommission > 0 && row.agentId) {
        ledger.push({
          id: newId('com'),
          bookingId: row.id,
          party: 'agent',
          providerId: branch.providerId,
          agentId: row.agentId,
          rateBps: quote.agentTerms?.commissionBps ?? 0,
          amount: row.agentCommission,
          currency: row.currency,
        });
      }
      if (providerEarning > 0) {
        ledger.push({
          id: newId('com'),
          bookingId: row.id,
          party: 'provider',
          providerId: branch.providerId,
          agentId: row.agentId,
          amount: providerEarning,
          currency: row.currency,
        });
      }
      if (ledger.length) await tx.insert(commissions).values(ledger);
    }

    /* 7. Retail product lines hang off the group's primary booking. */
    if (quote.products.length) {
      await tx.insert(bookingProducts).values(
        quote.products.map((p) => ({
          id: newId('bpr'),
          bookingId: rows[0]!.id,
          productId: p.productId,
          name: p.name,
          unitPrice: p.unitPrice,
          quantity: p.quantity,
          currency: quote.currency,
        })),
      );
    }

    return { groupId, rows };
  });

  return { groupId: created.groupId, primary: created.rows[0]!, bookings: created.rows, quote };
}

/** Release unpaid online holds so their slots become bookable again. */
export async function releaseExpiredHolds(db: AppDb, branchId?: string): Promise<number> {
  const where = and(
    eq(bookings.status, 'pending'),
    eq(bookings.paymentStatus, 'unpaid'),
    lt(bookings.expiresAt, new Date()),
  );
  const rows = await db
    .update(bookings)
    .set({ status: 'cancelled', cancelReason: 'Payment not completed', cancelledAt: new Date() })
    .where(branchId ? and(where, eq(bookings.branchId, branchId)) : where)
    .returning({ id: bookings.id });
  if (rows.length) console.log(`[booking] released ${rows.length} expired hold(s)`);
  return rows.length;
}

export type CancelContext = { actorRole: string; reason?: string | null };

/** Customer/partner cancellation with policy check. */
export async function cancelBooking(
  db: AppDb,
  bookingId: string,
  ctx: CancelContext,
): Promise<Booking> {
  const booking = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
  if (!booking) throw new BookingError('Booking not found.', 'not_found');
  if (['cancelled', 'completed', 'no_show'].includes(booking.status)) {
    throw new BookingError('This booking can no longer be changed.', 'invalid');
  }
  const settings = await getSettings();
  const staff = ctx.actorRole !== 'customer';
  if (!staff) {
    const cutoff = booking.startAt.getTime() - settings['booking.cancellationHours'] * 3600_000;
    if (Date.now() > cutoff) {
      throw new BookingError(
        `Free cancellation closed ${settings['booking.cancellationHours']}h before the appointment. Contact the spa or our support team.`,
        'invalid',
      );
    }
    if (booking.paymentStatus === 'paid' || booking.paymentStatus === 'refunded') {
      throw new BookingError(
        'Paid bookings need to be refunded by our team — please contact support.',
        'invalid',
      );
    }
  }
  const [updated] = await db
    .update(bookings)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: ctx.reason?.trim() || (staff ? 'Cancelled by staff' : 'Cancelled by customer'),
    })
    .where(eq(bookings.id, booking.id))
    .returning();
  return updated!;
}

/** Concurrency-safe slot conflict check used by tests and admin overrides. */
export async function hasSlotConflict(
  db: AppDb,
  args: { branchId: string; therapistId: string; startAt: Date; endAt: Date; excludeBookingId?: string },
): Promise<boolean> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.branchId, args.branchId),
        eq(bookings.therapistId, args.therapistId),
        or(eq(bookings.status, 'pending'), eq(bookings.status, 'confirmed')),
        args.excludeBookingId ? sql`${bookings.id} <> ${args.excludeBookingId}` : sql`true`,
        sql`${bookings.startAt} < ${args.endAt} AND ${bookings.endAt} > ${args.startAt}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export { slotsForDate, type BranchRules, type TherapistInput };

import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { AppDb } from '@/db';
import {
  agents,
  agentRates,
  bookings,
  branches,
  branchTreatments,
  coupons,
  commissions,
  providers,
  therapists,
  treatments,
  type Booking,
} from '@/db/schema';
import { getSettings } from '@/lib/settings';
import { couponApplies, priceBooking, type PriceQuote } from '@/lib/pricing';
import { getAvailability, slotsForDate, zonedToUtc, type BranchRules, type TherapistInput } from '@/lib/availability';
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

export type QuoteInput = {
  branchId: string;
  treatmentId: string;
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
      agentTerms = { commissionBps: agent.commissionBps, netPrice: rate?.active ? rate.netPrice : null };
    }
  }

  /* --- coupon --- */
  let couponRow: (typeof coupons.$inferSelect) | null = null;
  if (input.couponCode?.trim()) {
    const code = input.couponCode.trim().toUpperCase();
    const found = await db.query.coupons.findFirst({ where: eq(coupons.code, code) });
    if (!found) throw new BookingError('That coupon code was not found.', 'coupon', 'couponCode');
    const applies = couponApplies(found, {
      now: new Date(),
      listPrice: link.price,
      branchCurrency: branch.currency,
    });
    if (!applies.ok) throw new BookingError(applies.reason, 'coupon', 'couponCode');
    const scopeOk =
      found.scope === 'global' ||
      (found.scope === 'provider' && found.providerId === branch.providerId) ||
      (found.scope === 'branch' && found.branchId === branch.id) ||
      (found.scope === 'treatment' && found.treatmentId === treatment.id);
    if (!scopeOk) throw new BookingError('That coupon does not apply here.', 'coupon', 'couponCode');
    couponRow = found;
  }

  const pricing = priceBooking({
    listPrice: link.price,
    coupon: couponRow
      ? {
          code: couponRow.code,
          discountType: couponRow.discountType,
          discountValue: couponRow.discountValue,
          currency: couponRow.currency,
        }
      : null,
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
      durationMin: treatment.durationMin,
      imageUrl: treatment.imageUrl,
    },
    listPrice: link.price,
    currency: branch.currency,
    pricing,
    couponCode: couponRow?.code ?? null,
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
  const expectedEnd = new Date(
    input.startAt.getTime() + (treatment.durationMin + branch.bufferMinutes) * 60_000,
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

    /* 3. Coupon redemption (atomic against max_uses). */
    if (quote.couponCode) {
      const updated = await tx
        .update(coupons)
        .set({ usedCount: sql`${coupons.usedCount} + 1` })
        .where(
          and(
            eq(coupons.code, quote.couponCode),
            or(isNull(coupons.maxUses), eq(coupons.maxUses, 0), lt(coupons.usedCount, coupons.maxUses)),
          ),
        )
        .returning({ id: coupons.id });
      if (updated.length === 0) {
        throw new BookingError('That coupon has been fully redeemed.', 'coupon', 'couponCode');
      }
    }

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

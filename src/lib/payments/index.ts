import { and, eq, ne, or, sql } from 'drizzle-orm';
import { getDb, type Tx } from '@/db';
import { bookings, branches, payments, treatments, type Booking, type PaymentGateway } from '@/db/schema';
import { sendBookingVoucherEmail } from '@/lib/email';
import { logAudit } from '@/lib/audit';
import { getSettings, platformGatewayEnabled } from '@/lib/settings';
import { stripeGateway } from './stripe';
import { paypalGateway } from './paypal';
import { razorpayGateway } from './razorpay';
import type { Gateway } from './types';

export * from './types';

const ALL: Gateway[] = [stripeGateway, paypalGateway, razorpayGateway];

export function getGateway(name: string): Gateway | null {
  const gateway = ALL.find((g) => g.name === name);
  return gateway && gateway.enabled() ? gateway : null;
}

/**
 * Gateways the branch allows AND that are configured in this environment AND
 * that the admin has switched on in System settings.
 */
export async function enabledGatewaysForBranch(branch: {
  paymentMethods: string[];
  onlinePaymentEnabled: boolean;
  currency: string;
}): Promise<Gateway[]> {
  if (!branch.onlinePaymentEnabled) return [];
  const settings = await getSettings();
  return ALL.filter(
    (g) =>
      g.enabled() &&
      branch.paymentMethods.includes(g.name) &&
      platformGatewayEnabled(g.name, settings),
  );
}

export type ConfirmResult = { changed: boolean; bookingCode?: string; alreadyPaid?: boolean };

/**
 * Idempotent payment confirmation shared by webhook and return-URL handlers.
 * Marks the payment row + booking as paid and emails the voucher.
 */
export async function confirmPayment(opts: {
  bookingId?: string | null;
  gateway: PaymentGateway;
  externalId: string;
  outcome?: 'paid' | 'failed';
  amountMinor?: number;
  currency?: string;
  payerEmail?: string;
  paymentMethodLabel?: string;
  actorId?: string | null;
}): Promise<ConfirmResult> {
  const db = await getDb();
  const { gateway, externalId, outcome = 'paid' } = opts;

  const existing =
    externalId && externalId.length > 0
      ? await db.query.payments.findFirst({
          where: and(eq(payments.gateway, gateway), eq(payments.externalId, externalId)),
        })
      : undefined;

  const bookingId = opts.bookingId ?? existing?.bookingId ?? null;
  if (!bookingId) return { changed: false };

  const booking = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
  if (!booking) return { changed: false };

  if (outcome === 'failed') {
    if (existing && existing.status === 'pending') {
      await db.update(payments).set({ status: 'failed' }).where(eq(payments.id, existing.id));
    }
    return { changed: false, bookingCode: booking.code };
  }

  const paymentAmount = opts.amountMinor ?? existing?.amount ?? booking.totalAmount;

  // What the whole checkout is worth: a multi-treatment group shares one
  // payment, so the rows' totals are summed before comparing with the capture.
  const covered = booking.groupId
    ? await db.query.bookings.findMany({
        where: eq(bookings.groupId, booking.groupId),
        columns: { totalAmount: true },
      })
    : [booking];
  const grandTotal = covered.reduce((sum, row) => sum + row.totalAmount, 0);
  // A capture below the grand total is a deposit — the balance stays payable
  // at the spa, so the booking is settled but not fully paid.
  const settled = paymentAmount >= grandTotal;
  const finalStatus = settled ? 'paid' : 'deposit_paid';

  if (booking.paymentStatus === 'paid' || booking.paymentStatus === 'deposit_paid') {
    return { changed: false, bookingCode: booking.code, alreadyPaid: true };
  }

  await db.transaction(async (tx) => {
    // Lock the booking row so concurrent webhook + return-URL cannot double-apply.
    const locked = await tx
      .select({ id: bookings.id, paymentStatus: bookings.paymentStatus })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for('update');
    if (
      !locked.length ||
      locked[0]!.paymentStatus === 'paid' ||
      locked[0]!.paymentStatus === 'deposit_paid'
    )
      return;

    if (existing) {
      await tx
        .update(payments)
        .set({
          status: 'succeeded',
          amount: paymentAmount,
          payerEmail: opts.payerEmail ?? existing.payerEmail,
          paidAt: new Date(),
          gatewayData: {
            ...(existing.gatewayData ?? {}),
            ...(opts.paymentMethodLabel ? { label: opts.paymentMethodLabel } : {}),
          },
        })
        .where(eq(payments.id, existing.id));
    } else {
      await tx.insert(payments).values({
        id: `pay_${externalId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20).toLowerCase()}_${Date.now().toString(36)}`,
        bookingId,
        gateway,
        status: 'succeeded',
        amount: paymentAmount,
        currency: opts.currency ?? booking.currency,
        externalId,
        payerEmail: opts.payerEmail ?? booking.guestEmail,
        paidAt: new Date(),
        gatewayData: opts.paymentMethodLabel ? { label: opts.paymentMethodLabel } : {},
      });
    }

    await tx
      .update(bookings)
      .set({
        paymentStatus: finalStatus,
        status: booking.status === 'pending' ? 'confirmed' : booking.status,
        paidAt: new Date(),
        expiresAt: null,
      })
      .where(eq(bookings.id, bookingId));

    // One checkout can hold several treatment lines — the payment covers the
    // whole group, so confirm/release every sibling row too.
    if (booking.groupId) {
      const siblings = and(
        eq(bookings.groupId, booking.groupId),
        ne(bookings.id, bookingId),
        sql`${bookings.status} IN ('pending','confirmed')`,
      );
      await tx
        .update(bookings)
        .set({ paymentStatus: finalStatus, paidAt: new Date(), expiresAt: null })
        .where(siblings);
      await tx
        .update(bookings)
        .set({ status: 'confirmed' })
        .where(and(siblings, eq(bookings.status, 'pending')));
    }
  });

  const fresh = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
  const branch = fresh ? await db.query.branches.findFirst({ where: eq(branches.id, fresh.branchId) }) : null;
  const treatment = fresh ? await db.query.treatments.findFirst({ where: eq(treatments.id, fresh.treatmentId) }) : null;

  if (fresh && branch && treatment && (fresh.paymentStatus === 'paid' || fresh.paymentStatus === 'deposit_paid')) {
    await logAudit({
      actorId: opts.actorId ?? null,
      actorRole: opts.actorId ? 'super_admin' : null,
      action: 'payment.confirmed',
      entity: 'booking',
      entityId: fresh.id,
      meta: { gateway, externalId, amount: opts.amountMinor },
    });
    await sendBookingVoucherEmail(fresh, branch, treatment).catch((err) =>
      console.error('[payments] voucher email failed', err),
    );
    return { changed: true, bookingCode: fresh.code };
  }

  return { changed: false, bookingCode: fresh?.code };
}

/** Best-effort email for pay-at-venue bookings (called right after reservation). */
export async function emailVoucherForBooking(booking: Booking): Promise<void> {
  try {
    const db = await getDb();
    const branch = await db.query.branches.findFirst({ where: eq(branches.id, booking.branchId) });
    const treatment = await db.query.treatments.findFirst({ where: eq(treatments.id, booking.treatmentId) });
    if (branch && treatment) await sendBookingVoucherEmail(booking, branch, treatment);
  } catch (err) {
    console.error('[payments] voucher email failed', err);
  }
}

/** Server-side refund (admin action). Returns the gateway refund id. */
export async function refundBookingPayment(
  bookingId: string,
  opts: { actorId?: string | null; reason?: string } = {},
): Promise<{ ok: boolean; error?: string; refundId?: string }> {
  const db = await getDb();
  const payment = await db.query.payments.findFirst({
    where: and(eq(payments.bookingId, bookingId), eq(payments.status, 'succeeded')),
  });
  if (!payment) return { ok: false, error: 'No captured payment found for this booking.' };

  // Refunds need the gateway secret — load admin-entered credentials first.
  await getSettings();
  const gateway = getGateway(payment.gateway);
  if (!gateway?.refund) return { ok: false, error: `${payment.gateway} refunds are not configured.` };

  const refundable = payment.amount - payment.refundedAmount;
  if (refundable <= 0) return { ok: false, error: 'Nothing left to refund.' };
  const totalRefunded = payment.refundedAmount + refundable;

  let refundId: string;
  try {
    refundId = await gateway.refund({
      externalId: payment.externalId ?? '',
      amountMinor: refundable,
      currency: payment.currency,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Refund failed.' };
  }

  const refundedStatus = totalRefunded >= payment.amount ? 'refunded' : 'partially_refunded';
  const bookingRow = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
  await db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({
        refundedAmount: totalRefunded,
        status: refundedStatus,
        refundedAt: new Date(),
        gatewayData: { ...(payment.gatewayData ?? {}), lastRefundId: refundId, reason: opts.reason },
      })
      .where(eq(payments.id, payment.id));
    await tx
      .update(bookings)
      .set({ paymentStatus: refundedStatus })
      .where(eq(bookings.id, bookingId));
    // Refund state mirrors across every line of the group checkout.
    if (bookingRow?.groupId) {
      await tx
        .update(bookings)
        .set({ paymentStatus: refundedStatus })
        .where(and(eq(bookings.groupId, bookingRow.groupId), ne(bookings.id, bookingId)));
    }
  });

  await logAudit({
    actorId: opts.actorId ?? null,
    actorRole: opts.actorId ? 'super_admin' : null,
    action: 'payment.refunded',
    entity: 'booking',
    entityId: bookingId,
    meta: { refundId, amount: refundable, reason: opts.reason },
  });

  return { ok: true, refundId };
}

/** Helper for route handlers: locate a booking by its public voucher code. */
export async function findBookingByCode(db: Tx, code: string): Promise<Booking | null> {
  const rows = await db.query.bookings.findMany({ where: eq(bookings.code, code.toUpperCase()), limit: 1 });
  return rows[0] ?? null;
}

export const PAYMENT_GATEWAY_NAMES: PaymentGateway[] = ['stripe', 'paypal', 'razorpay', 'venue'];

import { desc, eq, or, sql } from 'drizzle-orm';
import type { AppDb } from '@/db';
import { bookings } from '@/db/schema';

export type MyBooking = {
  id: string;
  code: string;
  status: string;
  paymentStatus: string;
  channel: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  currency: string;
  totalAmount: number;
  listPrice: number;
  discountAmount: number;
  cancelledAt: Date | null;
  cancelReason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  branch: { name: string; city: string; country: string; addressLine: string } | null;
  providerName: string | null;
  treatmentName: string | null;
  durationMin: number | null;
  therapistName: string | null;
};

/**
 * A customer's bookings: rows linked to their account, plus guest rows booked
 * with the same email (so vouchers bought as a guest appear after sign-up).
 */
export async function getMyBookings(
  db: AppDb,
  user: { id: string; email: string },
): Promise<MyBooking[]> {
  const rows = await db.query.bookings.findMany({
    where: or(eq(bookings.customerId, user.id), sql`lower(${bookings.guestEmail}) = ${user.email.toLowerCase()}`),
    orderBy: [desc(bookings.startAt)],
    with: {
      branch: { columns: { name: true, city: true, country: true, addressLine: true } },
      provider: { columns: { name: true } },
      treatment: { columns: { name: true, durationMin: true } },
      therapist: { columns: { name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    status: r.status,
    paymentStatus: r.paymentStatus,
    channel: r.channel,
    startAt: r.startAt,
    endAt: r.endAt,
    timezone: r.timezone,
    currency: r.currency,
    totalAmount: r.totalAmount,
    listPrice: r.listPrice,
    discountAmount: r.discountAmount,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    branch: r.branch ?? null,
    providerName: r.provider?.name ?? null,
    treatmentName: r.treatment?.name ?? null,
    durationMin: r.treatment?.durationMin ?? null,
    therapistName: r.therapist?.name ?? null,
  }));
}

export function bookingSummary(rows: MyBooking[]) {
  const now = Date.now();
  const active = rows.filter((r) => r.status === 'pending' || r.status === 'confirmed');
  const upcoming = active.filter((r) => r.startAt.getTime() > now);
  const past = rows.filter(
    (r) => r.status === 'completed' || (r.status !== 'cancelled' && r.startAt.getTime() <= now),
  );
  const cancelled = rows.filter((r) => r.status === 'cancelled');
  return {
    upcoming: upcoming.sort((a, b) => a.startAt.getTime() - b.startAt.getTime()),
    past,
    cancelled,
    next: upcoming[0] ?? null,
    totalSpend: past
      .filter((r) => r.paymentStatus === 'paid' || r.paymentStatus === 'venue')
      .reduce((sum, r) => sum + r.totalAmount, 0),
  };
}

export function canCancelCustomer(booking: MyBooking, cancellationHours: number): { allowed: boolean; reason?: string } {
  if (booking.status === 'cancelled') return { allowed: false, reason: 'Already cancelled' };
  if (booking.status === 'completed' || booking.status === 'no_show')
    return { allowed: false, reason: 'Visit already finished' };
  if (booking.paymentStatus === 'paid' || booking.paymentStatus === 'refunded')
    return { allowed: false, reason: 'Paid bookings are refunded by our team — contact support' };
  const cutoff = booking.startAt.getTime() - cancellationHours * 3600_000;
  if (Date.now() > cutoff) return { allowed: false, reason: `Free cancellation closed ${cancellationHours}h before` };
  return { allowed: true };
}

export const ACTIVE_STATUSES = ['pending', 'confirmed'] as const;

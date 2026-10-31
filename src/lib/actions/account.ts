'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { bookings, users } from '@/db/schema';
import { cancelBooking, BookingError } from '@/lib/booking';
import { requireUser } from '@/lib/auth/session';
import { logAudit } from '@/lib/audit';

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Guest lookup behind the header's "My Bookings" window: voucher code + the
 * email the booking was made with. Only a match hands back the code, which
 * then opens the (unguessable) voucher page — the email is the second factor
 * that keeps a mistyped code from opening someone else's booking.
 */
export async function findMyBooking(
  input: { code: string; email: string },
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  try {
    const code = input.code.trim().toUpperCase();
    const email = input.email.trim().toLowerCase();
    if (!/^BYS-[A-Z0-9]{4,16}$/.test(code)) {
      return { ok: false, error: 'Enter your booking code, e.g. BYS-4F7K2Q.' };
    }
    if (!email.includes('@') || !email.includes('.')) {
      return { ok: false, error: 'Enter the email address you booked with.' };
    }
    const db = await getDb();
    const booking = await db.query.bookings.findFirst({ where: eq(bookings.code, code) });
    if (!booking) return { ok: false, error: 'No booking found with that code.' };
    if (booking.guestEmail.trim().toLowerCase() !== email) {
      return { ok: false, error: 'That code belongs to a different email address.' };
    }
    return { ok: true, code: booking.code };
  } catch {
    return { ok: false, error: 'Could not look up your booking. Please try again.' };
  }
}

/** Customer cancels their own booking (policy enforced in cancelBooking). */
export async function cancelMyBooking(bookingId: string): Promise<ActionResult> {
  try {
    const user = await requireUser(['customer']);
    const db = await getDb();
    const booking = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
    if (!booking) return { ok: false, error: 'Booking not found.' };
    const isOwner =
      booking.customerId === user.id || booking.guestEmail.toLowerCase() === user.email.toLowerCase();
    if (!isOwner) return { ok: false, error: 'This booking belongs to another account.' };

    await cancelBooking(db, booking.id, { actorRole: 'customer', reason: 'Cancelled by customer' });
    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'booking.cancelled',
      entity: 'booking',
      entityId: booking.id,
      meta: { by: 'customer', code: booking.code },
    });
    revalidatePath('/account/bookings');
    revalidatePath('/account');
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof BookingError ? err.message : 'Could not cancel this booking. Please try again.';
    return { ok: false, error: message };
  }
}

/** Update the customer's display name / phone. */
export async function updateProfile(input: { name: string; phone?: string }): Promise<ActionResult> {
  try {
    const user = await requireUser(['customer']);
    const name = input.name.trim();
    if (name.length < 2) return { ok: false, error: 'Please enter your full name.' };
    const db = await getDb();
    await db
      .update(users)
      .set({ name, phone: input.phone?.trim() || null, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'account.profile_updated',
      entity: 'user',
      entityId: user.id,
    });
    revalidatePath('/account');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not save your profile.' };
  }
}

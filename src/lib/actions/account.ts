'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { bookings, users } from '@/db/schema';
import { cancelBooking, BookingError } from '@/lib/booking';
import { requireUser } from '@/lib/auth/session';
import { logAudit } from '@/lib/audit';

export type ActionResult = { ok: true } | { ok: false; error: string };

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

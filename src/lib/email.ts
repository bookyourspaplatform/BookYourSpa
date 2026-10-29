import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { emailOutbox, type Booking, type Branch, type Treatment } from '@/db/schema';
import { newId } from '@/lib/utils';
import { formatDateTime, formatDate } from '@/lib/utils';
import { formatMoney } from '@/lib/money';

/**
 * Voucher / transactional email.
 * With RESEND_API_KEY set it sends via Resend; otherwise the message is
 * recorded in email_outbox as `skipped` so nothing is silently lost and the
 * voucher remains available at /voucher/[CODE].
 */

const money = (v: number, c: string) => formatMoney(v, c);

export function voucherEmailHtml(booking: Booking, branch: Branch, treatment: Treatment): string {
  const voucherUrl = `/voucher/${booking.code}`;
  const paid = booking.paymentStatus === 'paid';
  const payLabel = paid
    ? 'Paid online'
    : booking.paymentStatus === 'deposit_paid'
      ? `Deposit paid online — ${money(booking.totalAmount, booking.currency)} still due at the spa`
      : booking.paymentStatus === 'venue'
        ? 'Pay at the venue'
        : 'Payable at the venue / pending';
  return `
  <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f6f2ec;padding:32px 16px;color:#17201d">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid #eef1f0">
      <tr><td style="padding:28px 28px 8px">
        <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#26665e;margin:0 0 6px">Booking confirmed</p>
        <h1 style="font-size:22px;margin:0 0 4px">Your spa voucher</h1>
        <p style="margin:0;color:#66746f;font-size:14px">Show this code at the reception desk.</p>
      </td></tr>
      <tr><td style="padding:16px 28px">
        <div style="border:2px dashed #b1d7d0;border-radius:12px;padding:18px;text-align:center;background:#eef7f5">
          <p style="margin:0;font-size:12px;color:#66746f;text-transform:uppercase;letter-spacing:.1em">Voucher code</p>
          <p style="margin:6px 0 0;font-size:26px;font-weight:700;letter-spacing:.06em;color:#20524c">${booking.code}</p>
        </div>
      </td></tr>
      <tr><td style="padding:8px 28px 4px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px">
          <tr><td style="padding:7px 0;color:#66746f">Treatment</td><td style="padding:7px 0;text-align:right;font-weight:600">${treatment.name} (${treatment.durationMin} min)</td></tr>
          <tr><td style="padding:7px 0;color:#66746f">Branch</td><td style="padding:7px 0;text-align:right;font-weight:600">${branch.name} — ${branch.city}</td></tr>
          <tr><td style="padding:7px 0;color:#66746f">Address</td><td style="padding:7px 0;text-align:right">${branch.addressLine}</td></tr>
          <tr><td style="padding:7px 0;color:#66746f">Date</td><td style="padding:7px 0;text-align:right;font-weight:600">${formatDate(booking.startAt, booking.timezone)}</td></tr>
          <tr><td style="padding:7px 0;color:#66746f">Time</td><td style="padding:7px 0;text-align:right;font-weight:600">${formatDateTime(booking.startAt, booking.timezone).split(',').pop()?.trim()}</td></tr>
          <tr><td style="padding:7px 0;color:#66746f">Guest</td><td style="padding:7px 0;text-align:right">${booking.guestName}</td></tr>
          <tr><td style="padding:7px 0;color:#66746f">Total</td><td style="padding:7px 0;text-align:right;font-weight:700">${money(booking.totalAmount, booking.currency)}</td></tr>
          <tr><td style="padding:7px 0;color:#66746f">Payment</td><td style="padding:7px 0;text-align:right">${payLabel}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:14px 28px 28px">
        <p style="margin:0 0 14px;font-size:14px;color:#66746f">
          Free cancellation up to 24 hours before your appointment. Please arrive 10 minutes early.
        </p>
        <a href="${voucherUrl}" style="display:inline-block;background:#20524c;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px">Open your voucher</a>
        <p style="margin:16px 0 0;font-size:12px;color:#8b9793">BookYourSpa · bookyourspa.net · This voucher was sent to ${booking.guestEmail}</p>
      </td></tr>
    </table>
  </div>`;
}

export type SendResult = { status: 'sent' | 'skipped' | 'failed'; error?: string };

export async function sendBookingVoucherEmail(booking: Booking, branch: Branch, treatment: Treatment): Promise<SendResult> {
  const html = voucherEmailHtml(booking, branch, treatment);
  const subject = `Voucher ${booking.code} — ${treatment.name} at ${branch.name}`;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'BookYourSpa <bookings@resend.dev>';

  let status: SendResult['status'] = 'skipped';
  let error: string | undefined;

  if (apiKey) {
    try {
      const { Resend } = await import('resend');
      const resend = new Resend(apiKey);
      const { error: sendError } = await resend.emails.send({
        from,
        to: booking.guestEmail,
        subject,
        html,
      });
      if (sendError) {
        status = 'failed';
        error = String(sendError);
      } else {
        status = 'sent';
      }
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
    }
  } else {
    error = 'RESEND_API_KEY not configured';
  }

  try {
    const db = await getDb();
    await db.insert(emailOutbox).values({
      id: newId('eml'),
      toEmail: booking.guestEmail,
      subject,
      template: 'booking_voucher',
      body: html,
      status,
      error,
      bookingId: booking.id,
      sentAt: status === 'sent' ? new Date() : null,
    });
  } catch (err) {
    console.error('[email] failed to record outbox row', err);
  }

  if (status !== 'sent') {
    console.log(`[email] voucher ${booking.code} for ${booking.guestEmail} → ${status} (${error})`);
  }
  return { status, error };
}

export async function getOutboxForBooking(bookingId: string) {
  const db = await getDb();
  return db.query.emailOutbox.findMany({ where: eq(emailOutbox.bookingId, bookingId) });
}

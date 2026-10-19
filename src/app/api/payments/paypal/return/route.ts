import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { bookings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { captureOrder } from '@/lib/payments/paypal';
import { confirmPayment } from '@/lib/payments';
import { appUrl } from '@/lib/seo';
import { rateLimit, clientIpOf } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/payments/paypal/return?code=BYS-XXXXXX&token=ORDER_ID
 * PayPal appends `token` after redirecting the buyer back. We capture the
 * approved order here — so payments settle even without a webhook configured.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code')?.toUpperCase() ?? null;
  const orderId = url.searchParams.get('token');

  const limited = rateLimit(`ppreturn:${clientIpOf(req)}`, 20, 60_000);
  if (!limited.ok) return NextResponse.redirect(`${await appUrl('/spas')}`, 429);

  const base = await appUrl('');
  if (!orderId || !code) {
    return NextResponse.redirect(`${base}/spas`, 303);
  }

  const db = await getDb();
  const booking = (await db.query.bookings.findMany({ where: eq(bookings.code, code), limit: 1 }))[0];
  if (!booking) return NextResponse.redirect(`${base}/spas`, 303);

  try {
    const settled = await captureOrder(orderId);
    if (settled?.state === 'paid') {
      await confirmPayment({
        bookingId: booking.id,
        gateway: 'paypal',
        externalId: orderId,
        outcome: 'paid',
        amountMinor: settled.amountMinor,
        currency: settled.currency ?? booking.currency,
        payerEmail: settled.payerEmail,
        paymentMethodLabel: 'PayPal',
      });
      return NextResponse.redirect(`${base}/voucher/${code}?paid=1`, 303);
    }
    if (settled?.state === 'failed') {
      return NextResponse.redirect(`${base}/voucher/${code}?payment=failed`, 303);
    }
    return NextResponse.redirect(`${base}/voucher/${code}?payment=pending`, 303);
  } catch (err) {
    console.error('[paypal:return] capture failed', err);
    return NextResponse.redirect(`${base}/voucher/${code}?payment=error`, 303);
  }
}

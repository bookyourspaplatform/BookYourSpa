import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { bookings } from '@/db/schema';
import { fetchRazorpayPayment, verifyRazorpayCheckout } from '@/lib/payments/razorpay';
import { confirmPayment } from '@/lib/payments';
import { appUrl } from '@/lib/seo';
import { assertSameOrigin, clientIpOf, jsonError, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

const schema = z.object({
  bookingId: z.string().min(1),
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  signature: z.string().min(1),
});

export async function POST(req: Request) {
  const origin = assertSameOrigin(req);
  if (!origin.ok) return origin.response;

  const limited = rateLimit(`rzverify:${clientIpOf(req)}`, 20, 60_000);
  if (!limited.ok) return jsonError('Too many attempts.', 429);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError('Invalid payload.');
  const { bookingId, orderId, paymentId, signature } = parsed.data;

  if (!verifyRazorpayCheckout({ orderId, paymentId, signature })) {
    return jsonError('Signature verification failed.', 400);
  }

  // Trust but verify: read the payment back from Razorpay before settling.
  const payment = await fetchRazorpayPayment(paymentId);
  if (!payment?.captured) {
    return jsonError('Payment not captured yet.', 409);
  }

  const result = await confirmPayment({
    bookingId,
    gateway: 'razorpay',
    externalId: orderId,
    outcome: 'paid',
    amountMinor: payment.amount,
    payerEmail: payment.email,
    paymentMethodLabel: 'Razorpay',
  });

  const db = await getDb();
  const booking = (await db.query.bookings.findMany({ where: eq(bookings.id, bookingId), limit: 1 }))[0];
  const base = await appUrl('');
  if (!booking) return jsonError('Booking not found.', 404);

  return NextResponse.json({
    ok: true,
    changed: result.changed,
    voucherUrl: `${base}/voucher/${booking.code}?paid=1`,
  });
}

import { NextResponse } from 'next/server';
import { razorpayGateway } from '@/lib/payments/razorpay';
import { confirmPayment } from '@/lib/payments';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    // Loads admin-entered credentials from settings into the environment.
    await getSettings();
    const event = await razorpayGateway.verifyWebhook?.(req);
    if (!event?.ok) {
      return NextResponse.json(
        { error: event?.reason ?? 'verification failed' },
        { status: event?.httpStatus ?? 400 },
      );
    }
    if (event.externalId && event.outcome) {
      await confirmPayment({
        gateway: 'razorpay',
        externalId: event.externalId,
        outcome: event.outcome,
        amountMinor: event.amountMinor,
        payerEmail: event.payerEmail,
        paymentMethodLabel: event.paymentMethodLabel,
      });
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[webhook:razorpay] error', err);
    return NextResponse.json({ error: 'handler error' }, { status: 500 });
  }
}

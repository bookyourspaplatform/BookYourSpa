import { NextResponse } from 'next/server';
import { paypalGateway } from '@/lib/payments/paypal';
import { confirmPayment } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const event = await paypalGateway.verifyWebhook?.(req);
    if (!event?.ok) {
      return NextResponse.json(
        { error: event?.reason ?? 'verification failed' },
        { status: event?.httpStatus ?? 400 },
      );
    }
    if (event.externalId && event.outcome) {
      await confirmPayment({
        gateway: 'paypal',
        externalId: event.externalId,
        outcome: event.outcome,
        amountMinor: event.amountMinor,
        currency: event.currency,
        payerEmail: event.payerEmail,
        paymentMethodLabel: event.paymentMethodLabel,
      });
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[webhook:paypal] error', err);
    return NextResponse.json({ error: 'handler error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { stripeGateway } from '@/lib/payments/stripe';
import { confirmPayment } from '@/lib/payments';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    // Loads admin-entered credentials from settings into the environment.
    await getSettings();
    const event = await stripeGateway.verifyWebhook?.(req);
    if (!event?.ok) {
      return NextResponse.json(
        { error: event?.reason ?? 'verification failed' },
        { status: event?.httpStatus ?? 400 },
      );
    }
    if (event.externalId && event.outcome) {
      await confirmPayment({
        gateway: 'stripe',
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
    console.error('[webhook:stripe] error', err);
    return NextResponse.json({ error: 'handler error' }, { status: 500 });
  }
}

import Stripe from 'stripe';
import type { CheckoutInput, CheckoutResult, Gateway, WebhookOutcome } from './types';

let cached: Stripe | null = null;

function client(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) cached = new Stripe(key, { typescript: true });
  return cached;
}

export const stripeGateway: Gateway = {
  name: 'stripe',
  label: 'Card payment (Stripe)',
  enabled: () => Boolean(process.env.STRIPE_SECRET_KEY),

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const stripe = client();
    if (!stripe) throw new Error('Stripe is not configured.');
    const { booking, branch, treatment, amountMinor, currency } = input;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: input.customerEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: amountMinor,
            product_data: {
              name: `${treatment.name} — ${branch.name}`,
              description: `Booking ${booking.code} · ${branch.city}`,
            },
          },
        },
      ],
      metadata: { bookingId: booking.id, bookingCode: booking.code },
      success_url: `${input.successUrl}${input.successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: input.cancelUrl,
    });

    if (!session.url) throw new Error('Stripe did not return a checkout URL.');
    return { url: session.url, externalId: session.id, clientSecret: session.client_secret };
  },

  async verifyWebhook(req: Request): Promise<WebhookOutcome> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripe = client();
    if (!secret || !stripe) return { ok: false, reason: 'stripe webhook not configured', httpStatus: 503 };

    const signature = req.headers.get('stripe-signature');
    const raw = await req.text();
    if (!signature) return { ok: false, reason: 'missing signature', httpStatus: 400 };

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(raw, signature, secret);
    } catch {
      return { ok: false, reason: 'invalid signature', httpStatus: 400 };
    }

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        ok: true,
        externalId: session.id,
        outcome: 'paid',
        amountMinor: session.amount_total ?? undefined,
        currency: (session.currency ?? '').toUpperCase(),
        payerEmail: session.customer_details?.email ?? undefined,
        paymentMethodLabel: 'Card (Stripe)',
      };
    }

    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object as Stripe.Checkout.Session;
      return { ok: true, externalId: session.id, outcome: 'failed' };
    }

    return { ok: false, reason: `ignored event ${event.type}`, httpStatus: 200 };
  },

  async refund({ externalId, amountMinor }) {
    const stripe = client();
    if (!stripe) throw new Error('Stripe is not configured.');
    const session = await stripe.checkout.sessions.retrieve(externalId);
    const paymentIntent =
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!paymentIntent) throw new Error('Checkout session has no payment intent yet.');
    const refund = await stripe.refunds.create({ payment_intent: paymentIntent, amount: amountMinor });
    return refund.id;
  },
};

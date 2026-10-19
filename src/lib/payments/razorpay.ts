import { createHmac, timingSafeEqual } from 'node:crypto';
import Razorpay from 'razorpay';
import type { CheckoutInput, CheckoutResult, Gateway, WebhookOutcome } from './types';

let cached: Razorpay | null = null;

function client(): Razorpay | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  if (!cached) cached = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return cached;
}

export const razorpayGateway: Gateway = {
  name: 'razorpay',
  label: 'Razorpay',
  enabled: () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),

  /**
   * Creates a Razorpay order; the buyer completes payment through our
   * /checkout/razorpay page (Razorpay Standard Checkout), which posts back to
   * /api/payments/razorpay/verify with an HMAC-signed payload.
   */
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const rzp = client();
    if (!rzp) throw new Error('Razorpay is not configured.');
    const order = await rzp.orders.create({
      amount: input.amountMinor, // minor units (paise)
      currency: input.currency.toUpperCase(),
      receipt: input.booking.code,
      notes: { bookingId: input.booking.id, bookingCode: input.booking.code },
    });
    const params = new URLSearchParams({ order: order.id, booking: input.booking.id });
    return {
      url: `${input.baseUrl.replace(/\/$/, '')}/checkout/razorpay?${params.toString()}`,
      externalId: order.id,
    };
  },

  async verifyWebhook(req: Request): Promise<WebhookOutcome> {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? secret;
    if (!secret || !webhookSecret) return { ok: false, reason: 'razorpay not configured', httpStatus: 503 };

    const signature = req.headers.get('x-razorpay-signature');
    const raw = await req.text();
    if (!signature) return { ok: false, reason: 'missing signature', httpStatus: 400 };

    const expected = createHmac('sha256', webhookSecret).update(raw).digest('hex');
    if (!safeEqual(signature, expected)) return { ok: false, reason: 'invalid signature', httpStatus: 400 };

    let event: {
      event?: string;
      payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; email?: string; status?: string } } };
    };
    try {
      event = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'unparsable payload', httpStatus: 400 };
    }

    const payment = event.payload?.payment?.entity;
    if (!payment?.order_id || payment.status !== 'captured') {
      return { ok: false, reason: 'ignored event', httpStatus: 200 };
    }

    return {
      ok: true,
      externalId: payment.order_id,
      outcome: 'paid',
      amountMinor: payment.amount,
      currency: undefined,
      payerEmail: payment.email,
      paymentMethodLabel: 'Razorpay',
    };
  },

  async refund({ externalId, amountMinor }) {
    const rzp = client();
    if (!rzp) throw new Error('Razorpay is not configured.');
    const refund = await rzp.payments.refund(externalId, { amount: amountMinor });
    return refund.id;
  },
};

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Server-side confirmation of a checkout callback payment. */
export async function fetchRazorpayPayment(paymentId: string): Promise<{
  captured: boolean;
  amount?: number;
  email?: string;
  error?: string;
} | null> {
  const rzp = client();
  if (!rzp) return null;
  try {
    const payment = await rzp.payments.fetch(paymentId);
    return {
      captured: payment.captured === true || payment.status === 'captured',
      amount: typeof payment.amount === 'number' ? payment.amount : undefined,
      email: typeof payment.email === 'string' ? payment.email : undefined,
    };
  } catch (err) {
    return { captured: false, error: err instanceof Error ? err.message : 'fetch failed' };
  }
}

/** Validates the browser-side Standard Checkout callback payload. */
export function verifyRazorpayCheckout(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(`${input.orderId}|${input.paymentId}`).digest('hex');
  return safeEqual(input.signature, expected);
}

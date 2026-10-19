import type { CheckoutInput, CheckoutResult, Gateway, WebhookOutcome } from './types';
import { decimalStringToMinor, minorToDecimalString } from './types';

/**
 * PayPal Orders v2 via REST (no SDK dependency). Webhook authenticity is
 * established by round-tripping the order through PayPal's API and reading
 * its authoritative capture status — no signature material required.
 */

const API = () => (process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

function creds(): { clientId: string; secret: string } | null {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) return null;
  return { clientId, secret };
}

let tokenCache: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
  const c = creds();
  if (!c) throw new Error('PayPal is not configured.');
  const basic = Buffer.from(`${c.clientId}:${c.secret}`).toString('base64');
  const res = await fetch(`${API()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const token = await accessToken();
  const res = await fetch(`${API()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

type PaypalOrder = {
  id: string;
  status: string;
  links?: { rel: string; href: string }[];
  payer?: { email_address?: string };
  purchase_units?: {
    amount?: { value?: string; currency_code?: string };
    payments?: { captures?: { id?: string; status: string; amount?: { value?: string; currency_code?: string } }[] };
  }[];
};

export const paypalGateway: Gateway = {
  name: 'paypal',
  label: 'PayPal',
  enabled: () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const { booking, branch, treatment, amountMinor, currency } = input;
    const res = await api<PaypalOrder>('/v2/checkout/orders', {
      method: 'POST',
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: booking.id,
            custom_id: booking.code,
            description: `${treatment.name} at ${branch.name} — ${booking.code}`,
            amount: { currency_code: currency.toUpperCase(), value: minorToDecimalString(amountMinor, currency) },
          },
        ],
        application_context: {
          return_url: input.successUrl,
          cancel_url: input.cancelUrl,
          user_action: 'PAY_NOW',
          brand_name: 'BookYourSpa',
        },
      }),
    });
    if (!res.ok || !res.data) throw new Error(`PayPal order creation failed (${res.status}).`);
    const approval = res.data.links?.find((l) => l.rel === 'approve');
    if (!approval) throw new Error('PayPal did not return an approval link.');
    return { url: approval.href, externalId: res.data.id };
  },

  async verifyWebhook(req: Request): Promise<WebhookOutcome> {
    const body = (await req.json().catch(() => null)) as
      | { event_type?: string; resource?: { id?: string; order_id?: string } }
      | null;
    if (!body?.event_type) return { ok: false, reason: 'unparsable payload', httpStatus: 400 };

    const orderId = body.resource?.order_id ?? (body.event_type.startsWith('CHECKOUT.ORDER') ? body.resource?.id : undefined);
    if (!orderId) return { ok: false, reason: 'no order id', httpStatus: 200 };

    const settled = await captureOrder(orderId);
    if (settled?.state === 'paid') {
      return {
        ok: true,
        externalId: orderId,
        outcome: 'paid',
        amountMinor: settled.amountMinor,
        currency: settled.currency,
        payerEmail: settled.payerEmail,
        paymentMethodLabel: 'PayPal',
      };
    }
    return { ok: false, reason: `order not capturable (${settled?.state ?? 'unknown'})`, httpStatus: 200 };
  },

  async refund({ externalId, amountMinor, currency }) {
    const order = await api<PaypalOrder>(`/v2/checkout/orders/${externalId}`);
    const captureId = order.data?.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    if (!captureId) throw new Error('No capture found to refund.');
    const refund = await api<{ id: string }>(`/v2/payments/captures/${captureId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ amount: { value: minorToDecimalString(amountMinor, currency), currency_code: currency.toUpperCase() } }),
    });
    if (!refund.ok || !refund.data) throw new Error(`PayPal refund failed (${refund.status}).`);
    return refund.data.id;
  },
};

/** GET/verify helper used by the return-URL handler and webhooks alike. */
export async function captureOrder(
  orderId: string,
): Promise<{ state: 'paid' | 'pending' | 'failed'; amountMinor?: number; currency?: string; payerEmail?: string } | null> {
  let order = (await api<PaypalOrder>(`/v2/checkout/orders/${orderId}`)).data;
  if (!order) return null;

  if (order.status === 'APPROVED') {
    const captured = await api<PaypalOrder>(`/v2/checkout/orders/${orderId}/capture`, { method: 'POST', body: '{}' });
    order = captured.data;
    if (!order) return null;
  }

  const unit = order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.find((c) => c.status === 'COMPLETED') ?? unit?.payments?.captures?.[0];
  if (order.status === 'COMPLETED' && capture?.amount) {
    return {
      state: 'paid',
      amountMinor: decimalStringToMinor(capture.amount.value ?? '0', capture.amount.currency_code ?? 'USD'),
      currency: (capture.amount.currency_code ?? '').toUpperCase(),
      payerEmail: order.payer?.email_address,
    };
  }
  if (order.status === 'VOIDED' || order.status === 'FAILED') return { state: 'failed' };
  return { state: 'pending' };
}

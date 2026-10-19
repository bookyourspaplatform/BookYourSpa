import type { Booking, Branch, PaymentGateway, Treatment } from '@/db/schema';

export type CheckoutInput = {
  booking: Booking;
  branch: Branch;
  treatment: Treatment;
  /** Integer minor units in `currency` (IDR is zero-decimal). */
  amountMinor: number;
  currency: string;
  /** Absolute URL of the voucher page for successful payments. */
  successUrl: string;
  /** Absolute URL to return to when the buyer abandons checkout. */
  cancelUrl: string;
  /** Site origin, e.g. https://www.bookyourspa.net — for gateway-built pages. */
  baseUrl: string;
  customerEmail: string;
};

export type CheckoutResult = {
  /** Where the buyer must be redirected to complete payment. */
  url: string;
  /** Gateway checkout/order id — stored on the payments row. */
  externalId: string;
  clientSecret?: string | null;
};

export type WebhookOutcome = {
  ok: boolean;
  reason?: string;
  httpStatus?: number;
  /** Same idempotent confirmation path used by return-URL handlers. */
  externalId?: string;
  outcome?: 'paid' | 'failed';
  amountMinor?: number;
  currency?: string;
  payerEmail?: string;
  paymentMethodLabel?: string;
};

export type Gateway = {
  name: PaymentGateway;
  label: string;
  enabled(): boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  /** Verify an inbound webhook (raw body) and extract the payment event. */
  verifyWebhook?(req: Request): Promise<WebhookOutcome>;
  /** Server-side refund. Returns gateway refund id. */
  refund?(input: { externalId: string; amountMinor: number; currency: string }): Promise<string>;
};

/** 42000 AED-minor → "420.00" (PayPal wants a decimal string in major units). */
export function minorToDecimalString(minor: number, currency: string): string {
  const exp = ['IDR', 'JPY', 'KRW', 'VND'].includes(currency.toUpperCase()) ? 0 : 2;
  return (minor / 10 ** exp).toFixed(exp);
}

/** "420.00" → 42000 (minor units). */
export function decimalStringToMinor(value: string, currency: string): number {
  const exp = ['IDR', 'JPY', 'KRW', 'VND'].includes(currency.toUpperCase()) ? 0 : 2;
  return Math.round(Number(value) * 10 ** exp);
}

import { settings as settingsTable } from '@/db/schema';
import { getDb } from '@/db';

/** Platform settings with safe defaults — DB rows override these. */
export const DEFAULT_SETTINGS = {
  'site.name': 'BookYourSpa',
  'site.tagline': "Discover and book the best spas in Bali, Dubai and beyond",
  'site.url': 'https://www.bookyourspa.net',
  'site.description':
    'Book spa treatments, massages and wellness rituals online across Bali, Dubai and international destinations. Compare prices, choose your therapist and get instant booking vouchers.',
  'site.keywords': [
    'spa booking',
    'massage booking',
    'wellness',
    'Bali spa',
    'Dubai spa',
    'online spa reservation',
  ],
  'site.announcement': '',
  'site.supportEmail': 'hello@bookyourspa.net',
  'site.phone': '+62 361 000 0000',
  'seo.ogImage': '', // empty → per-route opengraph-image.tsx file convention takes over
  'seo.googleVerification': '',
  'seo.indexing': true,
  'booking.leadTimeMinutes': 60,
  'booking.cancellationHours': 24,
  'booking.pendingHoldMinutes': 30,
  'booking.defaultIntervalMinutes': 30,
  /** Booking fee added to every reservation (percent of the subtotal). */
  'booking.feePercent': 5,
  /**
   * Share of the grand total collected online at checkout; the remainder is
   * settled at the spa. 0 = the customer pays in full up front.
   */
  'booking.depositPercent': 10,
  'finance.defaultPlatformCommissionBps': 1500,
  /** Commission charged on walk-in sales taken through the POS till. */
  'finance.posCommissionBps': 300,
  'finance.defaultAgentCommissionBps': 1000,
  'finance.defaultCurrency': 'IDR',
  'features.onlinePayments': true,
  /** Platform-wide switches for the hosted gateways (branch lists still apply). */
  'features.stripe': true,
  'features.paypal': true,
  /* Gateway credentials — admin-editable; empty falls back to env vars. */
  'payments.stripe.secretKey': '',
  'payments.stripe.webhookSecret': '',
  'payments.paypal.clientId': '',
  'payments.paypal.clientSecret': '',
  /** 'sandbox' (test money) or 'live' (real money). */
  'payments.paypal.mode': 'sandbox' as string,
  'features.guestCheckout': true,
  'features.agentPortal': true,
  'features.providerSignup': true,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export type Settings = { [K in SettingKey]: (typeof DEFAULT_SETTINGS)[K] };

let cache: { value: Settings; at: number } | null = null;
const TTL_MS = 15_000;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  try {
    const db = await getDb();
    const rows = await db.select().from(settingsTable);
    for (const row of rows) if (row.key in DEFAULT_SETTINGS) merged[row.key] = row.value;
  } catch (err) {
    console.error('[settings] falling back to defaults:', err);
  }
  applyPaymentEnv(merged);
  cache = { value: merged as Settings, at: Date.now() };
  return cache.value;
}

/**
 * Publish admin-entered gateway credentials to the environment the payment
 * gateways read. A non-empty DB value wins (the admin just typed it); an
 * empty row restores whatever the real environment provides (usually nothing)
 * — so removing a saved key really does disable it again. Server-side only —
 * these values must never reach the client.
 */
const originalEnv = new Map<string, string | undefined>();

export function applyPaymentEnv(s: Record<string, unknown>): void {
  const put = (key: string, env: string) => {
    if (!originalEnv.has(env)) originalEnv.set(env, process.env[env]); // capture before first write
    const v = s[key];
    const value = typeof v === 'string' && v.trim() ? v.trim() : originalEnv.get(env);
    if (value === undefined) delete process.env[env];
    else process.env[env] = value;
  };
  put('payments.stripe.secretKey', 'STRIPE_SECRET_KEY');
  put('payments.stripe.webhookSecret', 'STRIPE_WEBHOOK_SECRET');
  put('payments.paypal.clientId', 'PAYPAL_CLIENT_ID');
  put('payments.paypal.clientSecret', 'PAYPAL_CLIENT_SECRET');
  const mode = s['payments.paypal.mode'];
  if (mode === 'live' || mode === 'sandbox') process.env.PAYPAL_MODE = mode;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  const all = await getSettings();
  return all[key];
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db
    .insert(settingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  cache = null;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

/**
 * Is this gateway switched on for the whole platform? Branch-level
 * `paymentMethods` only choose what a spa *offers* — these settings are the
 * admin's kill switch, so a gateway off here never reaches checkout even when
 * the branch and the environment both allow it.
 */
export function platformGatewayEnabled(name: string, settings: Settings): boolean {
  if (name === 'stripe') return settings['features.stripe'];
  if (name === 'paypal') return settings['features.paypal'];
  return true; // razorpay and pay-at-venue are not admin-switchable
}

/** Percent setting → basis points, clamped to 0–100%. */
export function percentToBps(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(100, Math.max(0, n)) * 100);
}

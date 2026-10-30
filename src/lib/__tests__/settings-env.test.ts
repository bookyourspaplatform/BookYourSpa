import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_MODE',
] as const;

type EnvKey = (typeof KEYS)[number];
type SettingsMod = typeof import('@/lib/settings');

const settings = (over: Record<string, unknown> = {}) => ({
  'payments.stripe.secretKey': '',
  'payments.stripe.webhookSecret': '',
  'payments.paypal.clientId': '',
  'payments.paypal.clientSecret': '',
  'payments.paypal.mode': 'sandbox',
  ...over,
});

/** Fresh module instance — its "original env" capture starts empty. */
async function freshModule(): Promise<SettingsMod> {
  vi.resetModules();
  return import('@/lib/settings');
}

describe('applyPaymentEnv', () => {
  const before = {} as Record<EnvKey, string | undefined>;

  beforeEach(() => {
    for (const k of KEYS) {
      before[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k]!;
    }
  });

  it('publishes non-empty admin-entered credentials to the environment', async () => {
    const mod = await freshModule();
    mod.applyPaymentEnv(
      settings({
        'payments.stripe.secretKey': ' sk_live_abc ',
        'payments.stripe.webhookSecret': 'whsec_1',
        'payments.paypal.clientId': 'cid',
        'payments.paypal.clientSecret': 'sec',
        'payments.paypal.mode': 'live',
      }),
    );
    expect(process.env.STRIPE_SECRET_KEY).toBe('sk_live_abc'); // trimmed
    expect(process.env.STRIPE_WEBHOOK_SECRET).toBe('whsec_1');
    expect(process.env.PAYPAL_CLIENT_ID).toBe('cid');
    expect(process.env.PAYPAL_CLIENT_SECRET).toBe('sec');
    expect(process.env.PAYPAL_MODE).toBe('live');
  });

  it('leaves the real environment untouched when nothing is saved', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_env_original';
    const mod = await freshModule();
    mod.applyPaymentEnv(settings());
    expect(process.env.STRIPE_SECRET_KEY).toBe('sk_env_original');
    expect(process.env.PAYPAL_CLIENT_ID).toBeUndefined();
    expect(process.env.PAYPAL_MODE).toBe('sandbox');
  });

  it('removes an injected credential again when the admin clears it', async () => {
    const mod = await freshModule();
    mod.applyPaymentEnv(settings({ 'payments.stripe.secretKey': 'sk_test_temp' }));
    expect(process.env.STRIPE_SECRET_KEY).toBe('sk_test_temp');
    mod.applyPaymentEnv(settings()); // cleared in the admin UI
    expect(process.env.STRIPE_SECRET_KEY).toBeUndefined();
  });
});

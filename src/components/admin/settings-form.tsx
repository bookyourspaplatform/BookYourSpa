'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Save, Wallet } from 'lucide-react';
import { saveSettings } from '@/lib/actions/admin';
import { Button } from '@/components/ui/button';
import { inputCls, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { CopyCode } from '@/components/site/copy-code';

type Entry = { key: string; value: unknown; label?: string };

const LABELS: Record<string, string> = {
  'site.name': 'Site name',
  'site.tagline': 'Tagline',
  'site.url': 'Site URL (canonical origin)',
  'site.description': 'Default meta description',
  'site.keywords': 'Meta keywords (comma separated)',
  'site.announcement': 'Announcement bar (empty = hidden)',
  'site.supportEmail': 'Support email',
  'site.phone': 'Support phone',
  'booking.cancellationHours': 'Free cancellation window (hours)',
  'booking.leadTimeMinutes': 'Global minimum lead time (minutes)',
  'booking.pendingHoldMinutes': 'Unpaid hold released after (minutes)',
  'booking.defaultIntervalMinutes': 'Default slot interval (minutes)',
  'booking.feePercent': 'Booking fee (% of the booking)',
  'booking.depositPercent': 'Deposit collected online now (% of the total, 0 = pay in full)',
  'features.guestCheckout': 'Allow guest checkout',
  'features.providerSignup': 'Open spa registrations',
  'features.agentPortal': 'Agent / reseller portal enabled',
  'features.onlinePayments': 'Online payments enabled',
  'features.stripe': 'Accept card payments (Stripe)',
  'features.paypal': 'Accept PayPal',
  'finance.defaultPlatformCommissionBps': 'Default platform commission (bps)',
  'finance.defaultAgentCommissionBps': 'Default agent commission (bps)',
  'finance.defaultCurrency': 'Default currency',
  'seo.ogImage': 'Default OG image path (empty = auto-generated)',
  'seo.googleVerification': 'Google site verification tag',
  'seo.indexing': 'Allow search engine indexing',
};

function describe(value: unknown): 'boolean' | 'number' | 'longtext' | 'shorttext' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value) || (typeof value === 'string' && value.length > 80)) return 'longtext';
  return 'shorttext';
}

export function SettingsForm({ entries }: { entries: Entry[] }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const e of entries) {
      out[e.key] = typeof e.value === 'boolean' ? String(e.value) : Array.isArray(e.value) ? e.value.join(', ') : String(e.value ?? '');
    }
    return out;
  });
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function save() {
    startTransition(async () => {
      const payload: Record<string, unknown> = {};
      for (const e of entries) {
        const raw = values[e.key] ?? '';
        const kind = describe(e.value);
        if (kind === 'boolean') payload[e.key] = raw === 'true';
        else if (kind === 'number') payload[e.key] = Number(raw);
        else if (Array.isArray(e.value)) payload[e.key] = raw.split(',').map((s) => s.trim()).filter(Boolean);
        else payload[e.key] = raw;
      }
      const res = await saveSettings(payload);
      if (res.ok) {
        toast.success('Settings saved');
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {entries.map((e) => {
          const kind = describe(e.value);
          const label = LABELS[e.key] ?? e.key;
          if (kind === 'boolean') {
            return (
              <label
                key={e.key}
                className="flex items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-white px-4 py-3 text-sm"
              >
                <span>
                  <span className="font-medium">{label}</span>
                  <span className="block font-mono text-[11.5px] text-ink-400">{e.key}</span>
                </span>
                <input
                  type="checkbox"
                  checked={values[e.key] === 'true'}
                  onChange={(ev) => setValues((v) => ({ ...v, [e.key]: String(ev.target.checked) }))}
                  className="size-4 accent-[#20524c]"
                />
              </label>
            );
          }
          return (
            <label key={e.key} className="flex flex-col gap-1.5 rounded-2xl border border-ink-100 bg-white px-4 py-3">
              <span className="text-[13px] font-medium text-ink-700">{label}</span>
              <span className="font-mono text-[11px] text-ink-400">{e.key}</span>
              {kind === 'longtext' ? (
                <textarea
                  value={values[e.key]}
                  onChange={(ev) => setValues((v) => ({ ...v, [e.key]: ev.target.value }))}
                  className={inputCls() + ' min-h-20 h-auto py-2'}
                />
              ) : (
                <input
                  type={kind === 'number' ? 'number' : 'text'}
                  value={values[e.key]}
                  onChange={(ev) => setValues((v) => ({ ...v, [e.key]: ev.target.value }))}
                  className={inputCls() + (kind === 'number' ? ' tabular-nums' : '')}
                />
              )}
            </label>
          );
        })}
      </div>

      <Button onClick={save} size="md" loading={pending}>
        <Save className="size-4" /> Save all settings
      </Button>
    </div>
  );
}

/* --------------------- gateway configuration panels --------------------- */

/**
 * Non-secret state only — credentials themselves never leave the server; the
 * password inputs below send a replacement only when the admin types one.
 */
export type PaymentsConfig = {
  origin: string;
  stripe: {
    enabled: boolean;
    keyMode: 'live' | 'test' | 'none';
    keyFrom: 'settings' | 'env' | null;
    webhookConfigured: boolean;
  };
  paypal: {
    enabled: boolean;
    idConfigured: boolean;
    secretConfigured: boolean;
    mode: 'live' | 'sandbox';
    modeFrom: 'settings' | 'env';
  };
};

function ToggleCard({
  settingKey,
  label,
  note,
  checked,
  onChange,
}: {
  settingKey: string;
  label: string;
  note?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-2xl border border-ink-100 bg-white px-4 py-3">
      <span>
        <span className="text-sm font-medium">{label}</span>
        <span className="block font-mono text-[11.5px] text-ink-400">{settingKey}</span>
        {note && <span className="mt-1 block text-[12.5px] text-ink-500">{note}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(ev) => onChange(ev.target.checked)}
        className="mt-0.5 size-4 accent-[#20524c]"
      />
    </label>
  );
}

function SecretInput({
  label,
  hint,
  saved,
  value,
  onChange,
  placeholder,
  cleared,
  onClear,
  onUndoClear,
}: {
  label: string;
  hint: string;
  saved: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  cleared?: boolean;
  onClear?: () => void;
  onUndoClear?: () => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-700">{label}</span>
      <input
        type="password"
        autoComplete="new-password"
        value={cleared ? '' : value}
        placeholder={saved ? (cleared ? 'removing on save…' : '•••••••• saved') : placeholder}
        onChange={(ev) => onChange(ev.target.value)}
        className={inputCls()}
      />
      <span className="flex items-center justify-between gap-2 text-[12px] text-ink-400">
        <span>
          {cleared
            ? 'Will be removed when you save'
            : value
              ? 'Will replace the saved value when you save'
              : saved
                ? `${hint} — saved, leave empty to keep`
                : hint}
        </span>
        {saved && !value &&
          (cleared ? (
            <button type="button" onClick={onUndoClear} className="shrink-0 font-medium text-brand-700 hover:underline">
              Undo
            </button>
          ) : (
            <button type="button" onClick={onClear} className="shrink-0 font-medium text-rose-600 hover:underline">
              Remove
            </button>
          ))}
      </span>
    </label>
  );
}

function StatusPill({ text, tone }: { text: string; tone: string }) {
  return <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium ${tone}`}>{text}</span>;
}

export function PaymentsSettings({ config }: { config: PaymentsConfig }) {
  const [stripeOn, setStripeOn] = useState(config.stripe.enabled);
  const [paypalOn, setPaypalOn] = useState(config.paypal.enabled);
  const [stripeKey, setStripeKey] = useState('');
  const [stripeWebhook, setStripeWebhook] = useState('');
  const [paypalId, setPaypalId] = useState('');
  const [paypalSecret, setPaypalSecret] = useState('');
  const [paypalMode, setPaypalMode] = useState<'live' | 'sandbox'>(config.paypal.mode);
  /** Secrets the admin explicitly chose to delete on the next save. */
  const [clears, setClears] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function save() {
    startTransition(async () => {
      const payload: Record<string, unknown> = {
        'features.stripe': stripeOn,
        'features.paypal': paypalOn,
        // A switched-off gateway never stays in live mode.
        'payments.paypal.mode': paypalOn ? paypalMode : 'sandbox',
      };
      const put = (key: string, v: string) => {
        if (clears[key]) payload[key] = ''; // explicitly removed
        else if (v.trim()) payload[key] = v.trim(); // empty = keep what's saved
      };
      put('payments.stripe.secretKey', stripeKey);
      put('payments.stripe.webhookSecret', stripeWebhook);
      put('payments.paypal.clientId', paypalId);
      put('payments.paypal.clientSecret', paypalSecret);
      const res = await saveSettings(payload);
      if (res.ok) {
        toast.success('Payment settings saved');
        setStripeKey('');
        setStripeWebhook('');
        setPaypalId('');
        setPaypalSecret('');
        setClears({});
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
      }
    });
  }

  const stripeStatus =
    config.stripe.keyMode === 'none'
      ? { text: 'No secret key — this option stays hidden at checkout', tone: 'bg-ink-100 text-ink-500' }
      : config.stripe.keyMode === 'live'
        ? {
            text: `Live key active (${config.stripe.keyFrom === 'settings' ? 'saved here' : 'environment variable'})`,
            tone: 'bg-emerald-50 text-emerald-700',
          }
        : { text: 'Test (sandbox) key — no real charges', tone: 'bg-amber-50 text-amber-700' };

  const paypalReady = config.paypal.idConfigured && config.paypal.secretConfigured;
  const paypalStatus = !paypalReady
    ? { text: 'Credentials missing — this option stays hidden at checkout', tone: 'bg-ink-100 text-ink-500' }
    : config.paypal.mode === 'live'
      ? { text: 'Live mode — real PayPal payments', tone: 'bg-emerald-50 text-emerald-700' }
      : { text: 'Sandbox mode — test payments only', tone: 'bg-amber-50 text-amber-700' };

  const stripeWebhookUrl = `${config.origin}/api/webhooks/stripe`;
  const paypalWebhookUrl = `${config.origin}/api/webhooks/paypal`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <ToggleCard
          settingKey="features.stripe"
          label="Accept card payments (Stripe)"
          note="Card checkout through Stripe's hosted page."
          checked={stripeOn}
          onChange={setStripeOn}
        />
        <ToggleCard
          settingKey="features.paypal"
          label="Accept PayPal"
          note="Buyers approve in PayPal and return to the voucher."
          checked={paypalOn}
          onChange={setPaypalOn}
        />
      </div>

      {stripeOn && (
        <section className="space-y-4 rounded-2xl border border-brand-200 bg-brand-50/40 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <CreditCard className="size-4 text-brand-700" />
            <h3 className="text-sm font-semibold">Stripe configuration</h3>
            <StatusPill {...stripeStatus} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SecretInput
              label="Secret key"
              hint="sk_live_… (real) or sk_test_… (sandbox)"
              saved={config.stripe.keyMode !== 'none'}
              value={stripeKey}
              onChange={setStripeKey}
              placeholder="sk_live_… / sk_test_…"
              cleared={clears['payments.stripe.secretKey']}
              onClear={() => setClears((c) => ({ ...c, ['payments.stripe.secretKey']: true }))}
              onUndoClear={() => setClears((c) => ({ ...c, ['payments.stripe.secretKey']: false }))}
            />
            <SecretInput
              label="Webhook signing secret"
              hint="whsec_… from the webhook below"
              saved={config.stripe.webhookConfigured}
              value={stripeWebhook}
              onChange={setStripeWebhook}
              placeholder="whsec_…"
              cleared={clears['payments.stripe.webhookSecret']}
              onClear={() => setClears((c) => ({ ...c, ['payments.stripe.webhookSecret']: true }))}
              onUndoClear={() => setClears((c) => ({ ...c, ['payments.stripe.webhookSecret']: false }))}
            />
          </div>
          <div>
            <p className="text-[13px] font-medium text-ink-700">Webhook URL</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <code className="rounded-lg border border-ink-100 bg-white px-2.5 py-1.5 font-mono text-[12.5px]">{stripeWebhookUrl}</code>
              <CopyCode code={stripeWebhookUrl} />
            </div>
            <p className="mt-1.5 text-[12.5px] text-ink-500">
              Stripe Dashboard → Developers → Webhooks → add this URL with the events <code>checkout.session.completed</code>,{' '}
              <code>checkout.session.async_payment_succeeded</code> and <code>checkout.session.async_payment_failed</code>, then paste
              the signing secret above. Without it a paid booking is never confirmed.
            </p>
          </div>
        </section>
      )}

      {paypalOn && (
        <section className="space-y-4 rounded-2xl border border-brand-200 bg-brand-50/40 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Wallet className="size-4 text-brand-700" />
            <h3 className="text-sm font-semibold">PayPal configuration</h3>
            <StatusPill {...paypalStatus} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SecretInput
              label="REST app client ID"
              hint="From developer.paypal.com → My Apps & Credentials"
              saved={config.paypal.idConfigured}
              value={paypalId}
              onChange={setPaypalId}
              placeholder="Af… client ID"
              cleared={clears['payments.paypal.clientId']}
              onClear={() => setClears((c) => ({ ...c, ['payments.paypal.clientId']: true }))}
              onUndoClear={() => setClears((c) => ({ ...c, ['payments.paypal.clientId']: false }))}
            />
            <SecretInput
              label="REST app secret"
              hint="Same app → secret"
              saved={config.paypal.secretConfigured}
              value={paypalSecret}
              onChange={setPaypalSecret}
              placeholder="Client secret"
              cleared={clears['payments.paypal.clientSecret']}
              onClear={() => setClears((c) => ({ ...c, ['payments.paypal.clientSecret']: true }))}
              onUndoClear={() => setClears((c) => ({ ...c, ['payments.paypal.clientSecret']: false }))}
            />
          </div>
          <label className="flex flex-col gap-1.5 sm:max-w-sm">
            <span className="text-[13px] font-medium text-ink-700">Mode</span>
            <Select value={paypalMode} onChange={(ev) => setPaypalMode(ev.target.value === 'live' ? 'live' : 'sandbox')}>
              <option value="sandbox">Sandbox (test money)</option>
              <option value="live">Live (real money)</option>
            </Select>
            <span className="text-[12px] text-ink-400">
              Sandbox uses PayPal test accounts — switch to Live once your app is approved for production.{' '}
              {config.paypal.modeFrom === 'settings' ? 'Currently set here.' : 'Currently from the environment variable.'}
            </span>
          </label>
          <div>
            <p className="text-[13px] font-medium text-ink-700">Webhook URL (optional)</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <code className="rounded-lg border border-ink-100 bg-white px-2.5 py-1.5 font-mono text-[12.5px]">{paypalWebhookUrl}</code>
              <CopyCode code={paypalWebhookUrl} />
            </div>
            <p className="mt-1.5 text-[12.5px] text-ink-500">
              Optional — payments settle when the buyer returns from PayPal, so the checkout works without it. Add it in the PayPal
              dashboard for extra reliability.
            </p>
          </div>
        </section>
      )}

      <Button onClick={save} size="md" loading={pending}>
        <Save className="size-4" /> Save payment settings
      </Button>
    </div>
  );
}

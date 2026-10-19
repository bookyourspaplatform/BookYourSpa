'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { saveSettings } from '@/lib/actions/admin';
import { Button } from '@/components/ui/button';
import { inputCls } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

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
  'features.guestCheckout': 'Allow guest checkout',
  'features.providerSignup': 'Open spa registrations',
  'features.agentPortal': 'Agent / reseller portal enabled',
  'features.onlinePayments': 'Online payments enabled',
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

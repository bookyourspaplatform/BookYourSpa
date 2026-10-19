'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Store } from 'lucide-react';
import { saveBranch, setBranchStatus } from '@/lib/actions/provider';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field, Input, Textarea, inputCls } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export type BranchRow = {
  id: string;
  name: string;
  addressLine: string;
  city: string;
  region: string | null;
  country: string;
  timezone: string;
  currency: string;
  phone: string | null;
  email: string | null;
  description: string | null;
  hours: { day: number; open: string; close: string; closed: boolean }[];
  leadTimeMinutes: number;
  maxAdvanceDays: number;
  bufferMinutes: number;
  slotIntervalMinutes: number;
  onlinePaymentEnabled: boolean;
  paymentMethods: string[];
  status: string;
  treatmentCount: number;
  therapistCount: number;
};

const EMPTY: Omit<BranchRow, 'id' | 'treatmentCount' | 'therapistCount'> = {
  name: '',
  addressLine: '',
  city: '',
  region: '',
  country: 'ID',
  timezone: 'Asia/Makassar',
  currency: 'IDR',
  phone: '',
  email: '',
  description: '',
  hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    open: day === 0 ? '11:00' : '10:00',
    close: day === 0 ? '20:00' : '21:00',
    closed: false,
  })),
  leadTimeMinutes: 60,
  maxAdvanceDays: 90,
  bufferMinutes: 0,
  slotIntervalMinutes: 30,
  onlinePaymentEnabled: true,
  paymentMethods: ['stripe', 'paypal', 'razorpay', 'venue'],
  status: 'active',
};

const TIMEZONES = [
  'Asia/Makassar',
  'Asia/Denpasar',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Kolkata',
  'Europe/London',
  'UTC',
];
const CURRENCIES = ['IDR', 'AED', 'USD', 'SGD', 'THB', 'EUR', 'GBP', 'AUD'];
const COUNTRIES = ['ID', 'AE', 'SG', 'TH', 'MY', 'IN', 'GB', 'US', 'AU'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const METHODS = [
  { id: 'stripe', label: 'Card (Stripe)' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'razorpay', label: 'Razorpay' },
  { id: 'venue', label: 'Pay at venue' },
];

type Draft = typeof EMPTY;

export function BranchManager({ branches }: { branches: BranchRow[] }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function openCreate() {
    setEditingId(null);
    setDraft(EMPTY);
    setOpen(true);
  }

  function openEdit(b: BranchRow) {
    setEditingId(b.id);
    setDraft({
      ...b,
      region: b.region ?? '',
      phone: b.phone ?? '',
      email: b.email ?? '',
      description: b.description ?? '',
      hours: b.hours.length ? b.hours : EMPTY.hours,
    });
    setOpen(true);
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      const res = await saveBranch({
        ...(editingId ? { id: editingId } : {}),
        name: draft.name.trim(),
        addressLine: draft.addressLine.trim(),
        city: draft.city.trim(),
        region: draft.region?.trim() || null,
        country: draft.country,
        timezone: draft.timezone,
        currency: draft.currency,
        phone: draft.phone?.trim() || null,
        email: draft.email?.trim() || null,
        description: draft.description?.trim() || null,
        hours: draft.hours,
        leadTimeMinutes: Number(draft.leadTimeMinutes),
        maxAdvanceDays: Number(draft.maxAdvanceDays),
        bufferMinutes: Number(draft.bufferMinutes),
        slotIntervalMinutes: Number(draft.slotIntervalMinutes),
        onlinePaymentEnabled: draft.onlinePaymentEnabled,
        paymentMethods: draft.paymentMethods as ('stripe' | 'paypal' | 'razorpay' | 'venue')[],
        status: draft.status as 'active' | 'pending' | 'suspended',
      });
      if (res.ok) {
        toast.success(editingId ? 'Branch updated' : 'Branch created');
        setOpen(false);
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
      }
    });
  }

  function toggleStatus(b: BranchRow) {
    startTransition(async () => {
      const next = b.status === 'active' ? 'suspended' : 'active';
      const res = await setBranchStatus(b.id, next);
      if (res.ok) {
        toast.success(next === 'active' ? 'Branch reactivated' : 'Branch suspended');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">
          {branches.length} location{branches.length === 1 ? '' : 's'} · each branch owns its own hours, prices and team.
        </p>
        <button type="button" onClick={openCreate} className={buttonClasses('primary', 'md')}>
          <Plus className="size-4" /> New branch
        </button>
      </div>

      {branches.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-14 text-center">
          <Store className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 text-[15px] font-medium">Add your first location</p>
          <p className="mt-1 text-sm text-ink-500">Branches are what customers see and book on the marketplace.</p>
          <button type="button" onClick={openCreate} className={buttonClasses('primary', 'md', 'mt-4')}>
            <Plus className="size-4" /> New branch
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {branches.map((b) => (
            <li key={b.id} className="rounded-3xl border border-ink-100 bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[16px] font-medium">{b.name}</h2>
                    <Badge tone={b.status === 'active' ? 'success' : b.status === 'suspended' ? 'danger' : 'warning'}>
                      {b.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[13.5px] text-ink-500">
                    {b.addressLine}, {b.city}
                    {b.region ? `, ${b.region}` : ''}, {b.country} · {b.timezone} · {b.currency}
                  </p>
                  <p className="mt-1 text-[13px] text-ink-400">
                    {b.treatmentCount} treatments · {b.therapistCount} therapists ·{' '}
                    {b.paymentMethods.join(', ')}
                    {!b.onlinePaymentEnabled && ' · online payments off'}
                  </p>
                  <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
                    {b.hours.slice(0, 7).map((h) => (
                      <span
                        key={h.day}
                        className={cn(
                          'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                          h.closed ? 'bg-ink-100 text-ink-400' : 'bg-brand-50 text-brand-700',
                        )}
                      >
                        {DAY_NAMES[h.day]} {h.closed ? 'closed' : `${h.open}–${h.close}`}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => openEdit(b)} className={buttonClasses('outline', 'sm')}>
                    <Pencil className="size-3.5" /> Edit
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => toggleStatus(b)}
                    className={buttonClasses('ghost', 'sm', b.status === 'active' ? 'text-rose-600 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50')}
                  >
                    {b.status === 'active' ? 'Suspend' : 'Activate'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Editor */}
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={editingId ? 'Edit branch' : 'New branch'}
        description="Customers see these details on your listing and voucher."
        size="lg"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Branch name" required className="sm:col-span-2">
            {({ id }) => (
              <Input id={id} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Seminyak flagship" required />
            )}
          </Field>
          <Field label="Street address" required className="sm:col-span-2">
            {({ id }) => (
              <Input id={id} value={draft.addressLine} onChange={(e) => set('addressLine', e.target.value)} placeholder="Jl. Kayu Jati No. 12" required />
            )}
          </Field>
          <Field label="City" required>
            {({ id }) => <Input id={id} value={draft.city} onChange={(e) => set('city', e.target.value)} placeholder="Seminyak" required />}
          </Field>
          <Field label="Region / state">
            {({ id }) => <Input id={id} value={draft.region ?? ''} onChange={(e) => set('region', e.target.value)} placeholder="Bali" />}
          </Field>
          <Field label="Country" required>
            {({ id }) => (
              <select id={id} value={draft.country} onChange={(e) => set('country', e.target.value)} className={inputCls()}>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Currency" required>
            {({ id }) => (
              <select id={id} value={draft.currency} onChange={(e) => set('currency', e.target.value)} className={inputCls()}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Timezone" required>
            {({ id }) => (
              <select id={id} value={draft.timezone} onChange={(e) => set('timezone', e.target.value)} className={inputCls()}>
                {TIMEZONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Phone">
            {({ id }) => <Input id={id} value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+62 …" />}
          </Field>
          <Field label="Email">
            {({ id }) => <Input id={id} type="email" value={draft.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="venue@example.com" />}
          </Field>
          <Field label="Description" className="sm:col-span-2">
            {({ id }) => (
              <Textarea id={id} value={draft.description ?? ''} onChange={(e) => set('description', e.target.value)} maxLength={2000} placeholder="What makes this location special…" />
            )}
          </Field>
        </div>

        {/* Booking rules */}
        <p className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Booking rules</p>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Lead time (min)">
            {({ id }) => (
              <Input id={id} type="number" min={0} value={draft.leadTimeMinutes} onChange={(e) => set('leadTimeMinutes', Number(e.target.value))} />
            )}
          </Field>
          <Field label="Book ahead (days)">
            {({ id }) => (
              <Input id={id} type="number" min={1} value={draft.maxAdvanceDays} onChange={(e) => set('maxAdvanceDays', Number(e.target.value))} />
            )}
          </Field>
          <Field label="Buffer (min)">
            {({ id }) => (
              <Input id={id} type="number" min={0} value={draft.bufferMinutes} onChange={(e) => set('bufferMinutes', Number(e.target.value))} />
            )}
          </Field>
          <Field label="Slot step (min)">
            {({ id }) => (
              <Input id={id} type="number" min={5} value={draft.slotIntervalMinutes} onChange={(e) => set('slotIntervalMinutes', Number(e.target.value))} />
            )}
          </Field>
        </div>

        {/* Hours */}
        <p className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Opening hours</p>
        <div className="mt-2 space-y-1.5">
          {draft.hours.map((h, i) => (
            <div key={h.day} className="flex items-center gap-2">
              <span className="w-10 text-[13px] font-medium text-ink-600">{DAY_NAMES[h.day]}</span>
              <input
                type="checkbox"
                checked={h.closed}
                onChange={(e) => {
                  const hours = [...draft.hours];
                  hours[i] = { ...h, closed: e.target.checked };
                  set('hours', hours);
                }}
                className="size-4 accent-[#20524c]"
                aria-label={`${DAY_NAMES[h.day]} closed`}
              />
              <span className="text-[12.5px] text-ink-500">closed</span>
              <input
                type="time"
                value={h.open}
                disabled={h.closed}
                onChange={(e) => {
                  const hours = [...draft.hours];
                  hours[i] = { ...h, open: e.target.value };
                  set('hours', hours);
                }}
                className={cn(inputCls(), 'h-9 w-28 disabled:opacity-40')}
                aria-label={`${DAY_NAMES[h.day]} open`}
              />
              <span className="text-ink-300">–</span>
              <input
                type="time"
                value={h.close}
                disabled={h.closed}
                onChange={(e) => {
                  const hours = [...draft.hours];
                  hours[i] = { ...h, close: e.target.value };
                  set('hours', hours);
                }}
                className={cn(inputCls(), 'h-9 w-28 disabled:opacity-40')}
                aria-label={`${DAY_NAMES[h.day]} close`}
              />
            </div>
          ))}
        </div>

        {/* Payments */}
        <p className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Payments</p>
        <label className="mt-2 flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={draft.onlinePaymentEnabled}
            onChange={(e) => set('onlinePaymentEnabled', e.target.checked)}
            className="size-4 accent-[#20524c]"
          />
          Accept online payments (gateway must be configured by the platform)
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {METHODS.map((m) => {
            const on = draft.paymentMethods.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() =>
                  set('paymentMethods', on ? draft.paymentMethods.filter((x) => x !== m.id) : [...draft.paymentMethods, m.id])
                }
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition',
                  on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-500 hover:border-ink-300',
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" size="md" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="md" onClick={save} loading={pending}>
            {editingId ? 'Save changes' : 'Create branch'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

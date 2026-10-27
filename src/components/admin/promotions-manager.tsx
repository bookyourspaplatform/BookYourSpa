'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Gift, Pencil, Percent, Plus, Trash2 } from 'lucide-react';
import { savePromotion, deletePromotion, saveCoupon, deleteCoupon } from '@/lib/actions/admin';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field, Input, Textarea, inputCls } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { cn, hourToTimeInput, hourWindowLabel, timeInputToHour } from '@/lib/utils';

/* ------------------------------ promotions --------------------------- */

type PromoRow = {
  id: string;
  title: string;
  summary: string | null;
  linkUrl: string | null;
  position: string;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  sortOrder: number;
  code: string;
  discountType: string | null;
  discountValue: number | null;
  currency: string | null;
  minAmount: number;
  maxUses: number;
  usedCount: number;
  /** 'all' = every treatment; 'selected' = each spa picks its own list. */
  appliesTo: string;
  validFromHour: number | null;
  validUntilHour: number | null;
};

export type TreatmentOption = { id: string; name: string; providerName: string };

type PromoDraft = {
  id?: string;
  title: string;
  summary: string;
  linkUrl: string;
  position: 'hero' | 'banner' | 'deal';
  startsAt: string;
  endsAt: string;
  active: boolean;
  sortOrder: number;
  code: string;
  discountMode: 'none' | 'percent' | 'fixed';
  /** percent = basis points (1000 = 10%), fixed = minor units. */
  discountValue: number;
  currency: string;
  minAmount: number;
  maxUses: number;
  scope: 'all' | 'selected';
  /** Optional daily hour window — "HH:MM" or empty for all day. */
  validFrom: string;
  validUntil: string;
};

const EMPTY_PROMO: PromoDraft = {
  title: '',
  summary: '',
  linkUrl: '/spas',
  position: 'deal',
  startsAt: '',
  endsAt: '',
  active: true,
  sortOrder: 0,
  code: '',
  discountMode: 'none',
  discountValue: 1000,
  currency: 'AED',
  minAmount: 0,
  maxUses: 0,
  scope: 'all',
  validFrom: '',
  validUntil: '',
};

function toDateInput(v: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export function PromotionsManager({ promotions }: { promotions: PromoRow[] }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PromoDraft>(EMPTY_PROMO);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function set<K extends keyof PromoDraft>(key: K, value: PromoDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function save() {
    if (!draft.code.trim()) {
      toast.error('Add a promo code', 'Every promotion needs a code customers can redeem.');
      return;
    }
    startTransition(async () => {
      const res = await savePromotion({
        ...(draft.id ? { id: draft.id } : {}),
        title: draft.title.trim(),
        summary: draft.summary.trim() || null,
        linkUrl: draft.linkUrl.trim() || null,
        position: draft.position,
        startsAt: draft.startsAt || null,
        endsAt: draft.endsAt || null,
        active: draft.active,
        sortOrder: draft.sortOrder,
        code: draft.code.trim().toUpperCase(),
        discountType: draft.discountMode === 'none' ? null : draft.discountMode,
        discountValue: draft.discountMode === 'none' ? null : draft.discountValue,
        currency: draft.discountMode === 'fixed' ? draft.currency : null,
        minAmount: draft.minAmount,
        maxUses: draft.maxUses,
        appliesTo: draft.scope,
        validFromHour: timeInputToHour(draft.validFrom),
        validUntilHour: timeInputToHour(draft.validUntil),
      });
      if (res.ok) {
        toast.success(draft.id ? 'Promotion updated' : 'Promotion created');
        setOpen(false);
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deletePromotion(id);
      if (res.ok) {
        toast.success('Promotion deleted');
        router.refresh();
      } else toast.error('Could not delete', res.error);
    });
  }

  return (
    <div className="rounded-3xl border border-ink-100 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-[16px] font-semibold">
            <Gift className="size-4 text-clay-500" /> Promotions & banners
          </h2>
          <p className="text-[13px] text-ink-500">Shown on the home page, deals page and seasonal sections.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDraft(EMPTY_PROMO);
            setOpen(true);
          }}
          className={buttonClasses('primary', 'sm')}
        >
          <Plus className="size-4" /> New promotion
        </button>
      </div>

      {promotions.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13.5px] text-ink-500">No promotions yet.</p>
      ) : (
        <ul className="divide-y divide-ink-50">
          {promotions.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
                  {p.title}
                  <Badge tone="clay">{p.position}</Badge>
                  {p.code && <Badge tone="brand">{p.code}</Badge>}
                  {p.discountType && p.discountValue != null && (
                    <Badge tone="success">
                      {p.discountType === 'percent' ? `${p.discountValue / 100}% off` : `${p.discountValue} off`}
                    </Badge>
                  )}
                  <Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'active' : 'off'}</Badge>
                </p>
                {p.summary && <p className="line-clamp-1 text-[13px] text-ink-500">{p.summary}</p>}
                <p className="text-[12.5px] text-ink-400">
                  general — valid at all spas ·{' '}
                  {p.appliesTo === 'selected' ? 'selected treatments (each spa picks its own)' : 'all treatments'} ·{' '}
                  {p.startsAt ? `from ${toDateInput(p.startsAt)}` : 'no start'} →{' '}
                  {p.endsAt ? toDateInput(p.endsAt) : 'no end'}
                  {p.validFromHour != null || p.validUntilHour != null
                    ? ` · daily ${hourWindowLabel(p.validFromHour, p.validUntilHour)}`
                    : ''}
                  {p.code ? ` · used ${p.usedCount}/${p.maxUses || '∞'}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraft({
                      id: p.id,
                      title: p.title,
                      summary: p.summary ?? '',
                      linkUrl: p.linkUrl ?? '',
                      position: (p.position as PromoDraft['position']) ?? 'deal',
                      startsAt: toDateInput(p.startsAt),
                      endsAt: toDateInput(p.endsAt),
                      active: p.active,
                      sortOrder: p.sortOrder,
                      code: p.code ?? '',
                      discountMode: (p.discountType as 'percent' | 'fixed' | null) ?? 'none',
                      discountValue: p.discountValue ?? 1000,
                      currency: p.currency ?? 'AED',
                      minAmount: p.minAmount,
                      maxUses: p.maxUses,
                      scope: p.appliesTo === 'selected' ? 'selected' : 'all',
                      validFrom: hourToTimeInput(p.validFromHour),
                      validUntil: hourToTimeInput(p.validUntilHour),
                    });
                    setOpen(true);
                  }}
                  className={buttonClasses('outline', 'sm')}
                >
                  <Pencil className="size-3.5" /> Edit
                </button>
                <button type="button" disabled={pending} onClick={() => remove(p.id)} className={buttonClasses('ghost', 'sm', 'text-rose-600 hover:bg-rose-50')}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={draft.id ? 'Edit promotion' : 'New promotion'}
        description="A platform promotion — valid at a spa once its supplier activates it. Deal-position cards show on /deals."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required className="sm:col-span-2">
            {({ id }) => <Input id={id} value={draft.title} onChange={(e) => set('title', e.target.value)} required />}
          </Field>
          <Field label="Summary" className="sm:col-span-2">
            {({ id }) => <Textarea id={id} value={draft.summary} onChange={(e) => set('summary', e.target.value)} maxLength={400} />}
          </Field>
          <Field label="Link">
            {({ id }) => <Input id={id} value={draft.linkUrl} onChange={(e) => set('linkUrl', e.target.value)} placeholder="/spas" />}
          </Field>
          <Field label="Position">
            {({ id }) => (
              <select id={id} value={draft.position} onChange={(e) => set('position', e.target.value as PromoDraft['position'])} className={inputCls()}>
                <option value="hero">Home hero</option>
                <option value="banner">Banner</option>
                <option value="deal">Deal card</option>
              </select>
            )}
          </Field>
          <Field label="Starts">
            {({ id }) => <Input id={id} type="date" value={draft.startsAt} onChange={(e) => set('startsAt', e.target.value)} />}
          </Field>
          <Field label="Ends">
            {({ id }) => <Input id={id} type="date" value={draft.endsAt} onChange={(e) => set('endsAt', e.target.value)} />}
          </Field>
          <Field label="Sort order">
            {({ id }) => <Input id={id} type="number" min={0} max={999} value={draft.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} />}
          </Field>
          <label className="flex items-end gap-2 pb-3 text-sm text-ink-700">
            <input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} className="size-4 accent-[#20524c]" />
            Active
          </label>
        </div>

        {/* --------------------- redeemable general discount --------------------- */}
        <div className="mt-4 space-y-4 rounded-xl border border-brand-100 bg-brand-50/40 p-3.5">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">Discount code</p>
            <p className="mt-0.5 text-[12.5px] text-ink-500">
              Every promotion needs a code. Registered customers see it at checkout and apply it only if they want
              it. It works only at spas whose supplier activated it in their console, and its value is deducted
              from that supplier&apos;s price — unless you limit it to selected treatments, which the supplier then
              picks.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Promo code" required>
              {({ id }) => (
                <Input
                  id={id}
                  value={draft.code}
                  onChange={(e) => set('code', e.target.value.toUpperCase())}
                  placeholder="SPA20"
                  className="font-mono"
                  maxLength={40}
                  required
                />
              )}
            </Field>
            <Field label="Discount">
              {({ id }) => (
                <select
                  id={id}
                  value={draft.discountMode}
                  onChange={(e) => set('discountMode', e.target.value as PromoDraft['discountMode'])}
                  className={inputCls()}
                >
                  <option value="none">None (display only)</option>
                  <option value="percent">Percent off</option>
                  <option value="fixed">Fixed amount off</option>
                </select>
              )}
            </Field>
            {draft.discountMode === 'percent' && (
              <Field label="Percent (10 = 10)">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={100}
                    step={0.5}
                    value={draft.discountValue / 100}
                    onChange={(e) => set('discountValue', Math.round(Number(e.target.value) * 100))}
                  />
                )}
              </Field>
            )}
            {draft.discountMode === 'fixed' && (
              <>
                <Field label={`Amount (${draft.currency})`}>
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      value={draft.discountValue}
                      onChange={(e) => set('discountValue', Number(e.target.value))}
                    />
                  )}
                </Field>
                <Field label="Currency">
                  {({ id }) => (
                    <select id={id} value={draft.currency} onChange={(e) => set('currency', e.target.value)} className={inputCls()}>
                      {['IDR', 'AED', 'USD', 'SGD', 'THB', 'EUR', 'GBP'].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </>
            )}
            <Field label="Min. spend (0 = none)">
              {({ id }) => (
                <Input id={id} type="number" min={0} value={draft.minAmount} onChange={(e) => set('minAmount', Number(e.target.value))} />
              )}
            </Field>
            <Field label="Max redemptions (0 = unlimited)">
              {({ id }) => (
                <Input id={id} type="number" min={0} value={draft.maxUses} onChange={(e) => set('maxUses', Number(e.target.value))} />
              )}
            </Field>
            <Field label="Valid from (hour)">
              {({ id }) => (
                <Input
                  id={id}
                  type="time"
                  step={3600}
                  value={draft.validFrom}
                  onChange={(e) => set('validFrom', e.target.value)}
                />
              )}
            </Field>
            <Field label="Valid until (hour)">
              {({ id }) => (
                <Input
                  id={id}
                  type="time"
                  step={3600}
                  value={draft.validUntil}
                  onChange={(e) => set('validUntil', e.target.value)}
                />
              )}
            </Field>
          </div>
          <p className="-mt-1 text-[12px] text-ink-400">
            Hour validity (optional) — the code only works between these hours each day, spa local time. Leave both
            empty for all day.
          </p>

          <div>
            <p className="text-[13px] font-medium text-ink-700">Applies to</p>
            <div className="mt-1.5 flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="radio"
                  name="promo-scope"
                  checked={draft.scope === 'all'}
                  onChange={() => setDraft((d) => ({ ...d, scope: 'all' }))}
                  className="size-4 accent-[#20524c]"
                />
                All treatments
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="radio"
                  name="promo-scope"
                  checked={draft.scope === 'selected'}
                  onChange={() => setDraft((d) => ({ ...d, scope: 'selected' }))}
                  className="size-4 accent-[#20524c]"
                />
                Selected treatments
              </label>
            </div>

            {draft.scope === 'selected' && (
              <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-800">
                You don&apos;t pick the treatments here — each spa selects the exact treatments this code applies to
                when it activates the promotion in its supplier dashboard.
              </p>
            )}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" size="md" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="md" onClick={save} loading={pending}>
            {draft.id ? 'Save promotion' : 'Create promotion'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* -------------------------------- coupons ---------------------------- */

type CouponRow = {
  id: string;
  code: string;
  description: string | null;
  discountType: string;
  discountValue: number;
  currency: string | null;
  minAmount: number;
  maxUses: number | null;
  usedCount: number;
  startsAt: string | null;
  endsAt: string | null;
  validFromHour: number | null;
  validUntilHour: number | null;
  active: boolean;
};

type CouponDraft = {
  id?: string;
  code: string;
  description: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  currency: string;
  minAmount: number;
  maxUses: number;
  startsAt: string;
  endsAt: string;
  validFrom: string;
  validUntil: string;
  active: boolean;
};

const EMPTY_COUPON: CouponDraft = {
  code: '',
  description: '',
  discountType: 'percent',
  discountValue: 1000,
  currency: 'IDR',
  minAmount: 0,
  maxUses: 0,
  startsAt: '',
  endsAt: '',
  validFrom: '',
  validUntil: '',
  active: true,
};

export function CouponsManager({ coupons }: { coupons: CouponRow[] }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CouponDraft>(EMPTY_COUPON);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function set<K extends keyof CouponDraft>(key: K, value: CouponDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      const res = await saveCoupon({
        ...draft,
        validFromHour: timeInputToHour(draft.validFrom),
        validUntilHour: timeInputToHour(draft.validUntil),
      });
      if (res.ok) {
        toast.success(draft.id ? 'Coupon updated' : 'Coupon created');
        setOpen(false);
        router.refresh();
      } else toast.error('Could not save', res.error);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteCoupon(id);
      if (res.ok) {
        toast.success('Coupon deleted');
        router.refresh();
      } else toast.error('Could not delete', res.error);
    });
  }

  return (
    <div className="rounded-3xl border border-ink-100 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-[16px] font-semibold">
            <Percent className="size-4 text-brand-600" /> Promo codes
          </h2>
          <p className="text-[13px] text-ink-500">
            Entered at checkout. Percent values are basis points — 1000 = 10%.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDraft(EMPTY_COUPON);
            setOpen(true);
          }}
          className={buttonClasses('primary', 'sm')}
        >
          <Plus className="size-4" /> New code
        </button>
      </div>

      {coupons.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13.5px] text-ink-500">No coupon codes yet.</p>
      ) : (
        <ul className="divide-y divide-ink-50">
          {coupons.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
                  <span className="font-mono tracking-wide">{c.code}</span>
                  <Badge tone="brand">
                    {c.discountType === 'percent' ? `${c.discountValue / 100}% off` : `${c.discountValue} off`}
                  </Badge>
                  <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'active' : 'off'}</Badge>
                </p>
                {c.description && <p className="line-clamp-1 text-[13px] text-ink-500">{c.description}</p>}
                <p className="text-[12.5px] text-ink-400">
                  used {c.usedCount}/{c.maxUses || '∞'} · {c.startsAt ? `from ${toDateInput(c.startsAt)}` : 'no start'} →{' '}
                  {c.endsAt ? toDateInput(c.endsAt) : 'no end'}
                  {c.minAmount > 0 ? ` · min spend ${c.minAmount}` : ''}
                  {hourWindowLabel(c.validFromHour, c.validUntilHour)
                    ? ` · daily ${hourWindowLabel(c.validFromHour, c.validUntilHour)}`
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraft({
                      id: c.id,
                      code: c.code,
                      description: c.description ?? '',
                      discountType: (c.discountType as CouponDraft['discountType']) ?? 'percent',
                      discountValue: c.discountValue,
                      currency: c.currency ?? 'IDR',
                      minAmount: c.minAmount,
                      maxUses: c.maxUses ?? 0,
                      startsAt: toDateInput(c.startsAt),
                      endsAt: toDateInput(c.endsAt),
                      validFrom: hourToTimeInput(c.validFromHour),
                      validUntil: hourToTimeInput(c.validUntilHour),
                      active: c.active,
                    });
                    setOpen(true);
                  }}
                  className={buttonClasses('outline', 'sm')}
                >
                  <Pencil className="size-3.5" /> Edit
                </button>
                <button type="button" disabled={pending} onClick={() => remove(c.id)} className={buttonClasses('ghost', 'sm', 'text-rose-600 hover:bg-rose-50')}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={draft.id ? 'Edit coupon' : 'New coupon code'}
        description="Codes apply automatically in the booking wizard at review step."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" required>
            {({ id }) => (
              <Input
                id={id}
                value={draft.code}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
                placeholder="WELCOME10"
                className="font-mono"
                required
              />
            )}
          </Field>
          <Field label="Type" required>
            {({ id }) => (
              <select id={id} value={draft.discountType} onChange={(e) => set('discountType', e.target.value as CouponDraft['discountType'])} className={inputCls()}>
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed amount off</option>
              </select>
            )}
          </Field>
          <Field label={draft.discountType === 'percent' ? 'Percent (10 = 10)' : `Amount (${draft.currency})`} required>
            {({ id }) =>
              draft.discountType === 'percent' ? (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={100}
                  step={0.5}
                  value={draft.discountValue / 100}
                  onChange={(e) => set('discountValue', Math.round(Number(e.target.value) * 100))}
                />
              ) : (
                <Input id={id} type="number" min={1} value={draft.discountValue} onChange={(e) => set('discountValue', Number(e.target.value))} />
              )
            }
          </Field>
          <Field label="Currency (fixed discounts)">
            {({ id }) => (
              <select id={id} value={draft.currency} onChange={(e) => set('currency', e.target.value)} className={inputCls()}>
                {['IDR', 'AED', 'USD', 'SGD', 'THB', 'EUR'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Min. spend (0 = none)">
            {({ id }) => <Input id={id} type="number" min={0} value={draft.minAmount} onChange={(e) => set('minAmount', Number(e.target.value))} />}
          </Field>
          <Field label="Max uses (0 = unlimited)">
            {({ id }) => <Input id={id} type="number" min={0} value={draft.maxUses} onChange={(e) => set('maxUses', Number(e.target.value))} />}
          </Field>
          <Field label="Starts">
            {({ id }) => <Input id={id} type="date" value={draft.startsAt} onChange={(e) => set('startsAt', e.target.value)} />}
          </Field>
          <Field label="Ends">
            {({ id }) => <Input id={id} type="date" value={draft.endsAt} onChange={(e) => set('endsAt', e.target.value)} />}
          </Field>
          <Field label="Description" className="sm:col-span-2">
            {({ id }) => <Input id={id} value={draft.description} onChange={(e) => set('description', e.target.value)} maxLength={240} />}
          </Field>
          <Field label="Valid from (hour)">
            {({ id }) => (
              <Input id={id} type="time" step={3600} value={draft.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
            )}
          </Field>
          <Field label="Valid until (hour)">
            {({ id }) => (
              <Input id={id} type="time" step={3600} value={draft.validUntil} onChange={(e) => set('validUntil', e.target.value)} />
            )}
          </Field>
        </div>
        <p className="mt-1 text-[12px] text-ink-400">
          Hour validity (optional) — the code only works between these hours each day, spa local time. Leave both
          empty for all day.
        </p>

        <label className={cn('mt-4 flex items-center gap-2 text-sm text-ink-700')}>
          <input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} className="size-4 accent-[#20524c]" />
          Active
        </label>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" size="md" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="md" onClick={save} loading={pending}>
            {draft.id ? 'Save coupon' : 'Create coupon'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

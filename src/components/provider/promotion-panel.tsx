'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Megaphone, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { deletePromotion, saveBranchPromotion, setPromotionActive } from '@/lib/actions/provider';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field, Input, Textarea, inputCls } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { cn, hourToTimeInput, hourWindowLabel, timeInputToHour } from '@/lib/utils';

export type PromotionRow = {
  id: string;
  title: string;
  summary: string | null;
  position: string;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  linkUrl: string | null;
  sortOrder: number;
  code: string;
  discountType: string | null;
  discountValue: number | null;
  currency: string | null;
  minAmount: number;
  maxUses: number;
  usedCount: number;
  /** 'all' = every treatment; 'selected' = treatmentIds below. */
  appliesTo: string;
  treatmentIds: string[] | null;
  validFromHour: number | null;
  validUntilHour: number | null;
};

export type TreatmentOption = { id: string; name: string };

/** Same draft shape as the admin promotion form — this panel clones it. */
type Draft = {
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
  treatmentIds: string[];
  /** Optional daily hour window — "HH:MM" or empty for all day. */
  validFrom: string;
  validUntil: string;
};

const EMPTY_DRAFT: Draft = {
  title: '',
  summary: '',
  linkUrl: '',
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
  treatmentIds: [],
  validFrom: '',
  validUntil: '',
};

const POSITIONS = [
  { id: 'hero', label: 'Hero' },
  { id: 'banner', label: 'Banner' },
  { id: 'deal', label: 'Deal' },
] as const;

function isoDate(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function discountLabel(p: PromotionRow): string | null {
  if (!p.discountType || p.discountValue == null) return null;
  return p.discountType === 'percent' ? `${p.discountValue / 100}% off` : `${p.discountValue} off`;
}

export function PromotionPanel({
  branchId,
  rows,
  treatmentOptions,
}: {
  branchId: string;
  rows: PromotionRow[];
  treatmentOptions: TreatmentOption[];
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [treatmentQuery, setTreatmentQuery] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function save() {
    if (!draft) return;
    if (!draft.code.trim()) {
      toast.error('Add a promo code', 'Every promotion needs a code customers can redeem.');
      return;
    }
    if (draft.discountMode !== 'none' && !(draft.discountValue > 0)) {
      toast.error('Enter a discount value', 'Pick how much the code takes off.');
      return;
    }
    if (draft.scope === 'selected' && draft.treatmentIds.length === 0) {
      toast.error('Pick at least one treatment', 'Or switch back to “All treatments”.');
      return;
    }
    startTransition(async () => {
      const res = await saveBranchPromotion({
        ...(draft.id ? { id: draft.id } : {}),
        branchId,
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
        treatmentIds: draft.scope === 'selected' ? draft.treatmentIds : [],
        validFromHour: timeInputToHour(draft.validFrom),
        validUntilHour: timeInputToHour(draft.validUntil),
      });
      if (res.ok) {
        toast.success(draft.id ? 'Promotion updated' : 'Promotion created');
        setDraft(null);
        setTreatmentQuery('');
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
      }
    });
  }

  function toggle(p: PromotionRow) {
    startTransition(async () => {
      const res = await setPromotionActive(p.id, !p.active);
      if (res.ok) {
        toast.success(p.active ? 'Promotion unpublished' : 'Promotion published');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  function remove(p: PromotionRow) {
    startTransition(async () => {
      const res = await deletePromotion(p.id);
      if (res.ok) {
        toast.success('Promotion deleted');
        router.refresh();
      } else {
        toast.error('Could not delete', res.error);
      }
    });
  }

  function edit(p: PromotionRow) {
    setDraft({
      id: p.id,
      title: p.title,
      summary: p.summary ?? '',
      linkUrl: p.linkUrl ?? '',
      position: (p.position as Draft['position']) ?? 'deal',
      startsAt: isoDate(p.startsAt),
      endsAt: isoDate(p.endsAt),
      active: p.active,
      sortOrder: p.sortOrder,
      code: p.code ?? '',
      discountMode: (p.discountType as 'percent' | 'fixed' | null) ?? 'none',
      discountValue: p.discountValue ?? 1000,
      currency: p.currency ?? 'AED',
      minAmount: p.minAmount,
      maxUses: p.maxUses,
      scope: p.appliesTo === 'selected' ? 'selected' : 'all',
      treatmentIds: p.treatmentIds ?? [],
      validFrom: hourToTimeInput(p.validFromHour),
      validUntil: hourToTimeInput(p.validUntilHour),
    });
    setTreatmentQuery('');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">Promotions for this branch — shown on your listing and the deals page.</p>
        <button
          type="button"
          onClick={() => {
            setDraft(EMPTY_DRAFT);
            setTreatmentQuery('');
          }}
          className={buttonClasses('primary', 'md')}
        >
          <Plus className="size-4" /> New promotion
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
          <Megaphone className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 text-[15px] font-medium">No promotions yet</p>
          <p className="mt-1 text-sm text-ink-500">Run a seasonal offer or feature a package at this location.</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((p) => {
            const hours = hourWindowLabel(p.validFromHour, p.validUntilHour);
            const discount = discountLabel(p);
            return (
              <li key={p.id} className="rounded-2xl border border-ink-100 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[15px] font-medium">{p.title}</p>
                      <Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'published' : 'unpublished'}</Badge>
                      <Badge tone="clay">{p.position}</Badge>
                      {p.code && (
                        <Badge tone="brand">
                          <Tag className="size-3" /> {p.code}
                        </Badge>
                      )}
                      {discount && <Badge tone="success">{discount}</Badge>}
                    </div>
                    {p.summary && <p className="mt-0.5 max-w-prose text-[13px] text-ink-500">{p.summary}</p>}
                    <p className="mt-0.5 text-[13px] text-ink-400">
                      {p.appliesTo === 'selected'
                        ? `${p.treatmentIds?.length ?? 0} selected treatment${(p.treatmentIds?.length ?? 0) === 1 ? '' : 's'}`
                        : 'all treatments'}
                      {' · '}
                      {p.startsAt || p.endsAt
                        ? `${p.startsAt ? isoDate(p.startsAt) : 'now'} → ${p.endsAt ? isoDate(p.endsAt) : 'no end date'}`
                        : 'always on'}
                      {hours ? ` · daily ${hours}` : ''}
                      {p.discountType ? ` · used ${p.usedCount}/${p.maxUses || '∞'}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => edit(p)} className={buttonClasses('ghost', 'sm')}>
                      <Pencil className="size-3.5" /> Edit
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => toggle(p)}
                      className={buttonClasses('ghost', 'sm', p.active ? 'text-rose-600 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50')}
                    >
                      {p.active ? 'Unpublish' : 'Publish'}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(p)}
                      className={buttonClasses('ghost', 'sm', 'text-rose-600 hover:bg-rose-50')}
                      aria-label={`Delete ${p.title}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={draft !== null}
        onClose={() => !pending && setDraft(null)}
        title={draft?.id ? 'Edit promotion' : 'New promotion'}
        description="The same promotion form the platform admin uses — a code customers can redeem, optional dates and hours, and a scope of all or selected treatments."
        size="lg"
      >
        {draft && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" required className="sm:col-span-2">
                {({ id }) => (
                  <Input id={id} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="20% off weekday massages" required />
                )}
              </Field>
              <Field label="Summary" className="sm:col-span-2">
                {({ id }) => (
                  <Textarea id={id} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} maxLength={400} />
                )}
              </Field>
              <Field label="Link">
                {({ id }) => (
                  <Input id={id} value={draft.linkUrl} onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })} placeholder="/spas" />
                )}
              </Field>
              <Field label="Position">
                {({ id }) => (
                  <select id={id} value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value as Draft['position'] })} className={inputCls()}>
                    {POSITIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Starts">
                {({ id }) => <Input id={id} type="date" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />}
              </Field>
              <Field label="Ends">
                {({ id }) => <Input id={id} type="date" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />}
              </Field>
              <Field label="Sort order">
                {({ id }) => (
                  <Input id={id} type="number" min={0} max={999} value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} />
                )}
              </Field>
              <label className="flex items-end gap-2 pb-3 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                  className="size-4 accent-[#20524c]"
                />
                Active
              </label>
            </div>

            {/* ------------- redeemable discount (cloned from admin) ------------- */}
            <div className="mt-4 space-y-4 rounded-xl border border-brand-100 bg-brand-50/40 p-3.5">
              <div>
                <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">Discount code</p>
                <p className="mt-0.5 text-[12.5px] text-ink-500">
                  Every promotion needs a code. Registered customers see it at checkout and activate it only if they
                  want it. It applies automatically to this spa once published.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Promo code" required>
                  {({ id }) => (
                    <Input
                      id={id}
                      value={draft.code}
                      onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
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
                      onChange={(e) => setDraft({ ...draft, discountMode: e.target.value as Draft['discountMode'] })}
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
                        onChange={(e) => setDraft({ ...draft, discountValue: Math.round(Number(e.target.value) * 100) })}
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
                          onChange={(e) => setDraft({ ...draft, discountValue: Number(e.target.value) })}
                        />
                      )}
                    </Field>
                    <Field label="Currency">
                      {({ id }) => (
                        <select id={id} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} className={inputCls()}>
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
                    <Input id={id} type="number" min={0} value={draft.minAmount} onChange={(e) => setDraft({ ...draft, minAmount: Number(e.target.value) })} />
                  )}
                </Field>
                <Field label="Max redemptions (0 = unlimited)">
                  {({ id }) => (
                    <Input id={id} type="number" min={0} value={draft.maxUses} onChange={(e) => setDraft({ ...draft, maxUses: Number(e.target.value) })} />
                  )}
                </Field>
                <Field label="Valid from (hour)">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="time"
                      step={3600}
                      value={draft.validFrom}
                      onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })}
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
                      onChange={(e) => setDraft({ ...draft, validUntil: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <p className="-mt-1 text-[12px] text-ink-400">
                Hour validity (optional) — the code only works between these hours each day, spa local time. Leave
                both empty for all day.
              </p>

              <div>
                <p className="text-[13px] font-medium text-ink-700">Applies to</p>
                <div className="mt-1.5 flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm text-ink-700">
                    <input
                      type="radio"
                      name={`promo-scope-${branchId}`}
                      checked={draft.scope === 'all'}
                      onChange={() => setDraft({ ...draft, scope: 'all' })}
                      className="size-4 accent-[#20524c]"
                    />
                    All treatments
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink-700">
                    <input
                      type="radio"
                      name={`promo-scope-${branchId}`}
                      checked={draft.scope === 'selected'}
                      onChange={() => setDraft({ ...draft, scope: 'selected' })}
                      className="size-4 accent-[#20524c]"
                    />
                    Selected treatments{draft.treatmentIds.length > 0 && ` (${draft.treatmentIds.length} picked)`}
                  </label>
                </div>

                {draft.scope === 'selected' && (
                  <div className="mt-2">
                    <input
                      value={treatmentQuery}
                      onChange={(e) => setTreatmentQuery(e.target.value)}
                      placeholder="Search your treatments…"
                      aria-label="Search treatments"
                      className={cn(inputCls(), 'h-10')}
                    />
                    <ul className="mt-2 max-h-56 divide-y divide-ink-50 overflow-y-auto rounded-xl border border-ink-100 bg-white">
                      {treatmentOptions
                        .filter((t) => {
                          const q = treatmentQuery.trim().toLowerCase();
                          return !q || t.name.toLowerCase().includes(q);
                        })
                        .slice(0, 100)
                        .map((t) => {
                          const on = draft.treatmentIds.includes(t.id);
                          return (
                            <li key={t.id}>
                              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-sand-50">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  className="size-4 accent-[#20524c]"
                                  onChange={() =>
                                    setDraft({
                                      ...draft,
                                      treatmentIds: on
                                        ? draft.treatmentIds.filter((x) => x !== t.id)
                                        : [...draft.treatmentIds, t.id],
                                    })
                                  }
                                />
                                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                              </label>
                            </li>
                          );
                        })}
                      {treatmentOptions.length === 0 && (
                        <li className="px-3 py-3 text-[13px] text-ink-500">
                          No treatments at this location yet — add one under Treatments first.
                        </li>
                      )}
                    </ul>
                    <p className="mt-1 text-[12px] text-ink-400">
                      {draft.treatmentIds.length > 0
                        ? `${draft.treatmentIds.length} treatment${draft.treatmentIds.length === 1 ? '' : 's'} picked.`
                        : 'The discount will only apply to the treatments you pick.'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="ghost" size="md" onClick={() => setDraft(null)} disabled={pending}>
                Cancel
              </Button>
              <Button size="md" onClick={save} loading={pending}>
                {draft.id ? 'Save changes' : 'Create promotion'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { saveTreatment, setTreatmentStatus } from '@/lib/actions/provider';
import { SPA_TYPES, TREATMENT_GENRES, TREATMENT_DELIVERY_TYPES } from '@/db/schema';
import { SPA_TYPE_LABELS, GENRE_LABELS, DELIVERY_TYPE_LABELS } from '@/lib/catalog';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { MoneyInput } from '@/components/ui/money-input';
import { RichText } from '@/components/ui/rich-text';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

export type TreatmentRow = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  listPrice: number;
  currency: string;
  requiresTherapist: boolean;
  capacity: number;
  agentApproved: boolean;
  tags: string[];
  genre: string;
  deliveryType: string;
  priceOptions: { durationMin: number; price: number; capacity: number }[] | null;
  status: string;
  branchCount: number;
};

type PriceOption = { durationMin: number; price: number; capacity: number };

type Draft = {
  id?: string;
  name: string;
  description: string;
  priceOptions: PriceOption[];
  genre: string;
  deliveryType: string;
  requiresTherapist: boolean;
  agentApproved: boolean;
  tags: string[];
  status: string;
};

const DURATION_CHOICES = [30, 45, 60, 75, 90, 105, 120, 150, 180, 240];

const EMPTY: Draft = {
  name: '',
  description: '',
  priceOptions: [{ durationMin: 60, price: 400000, capacity: 1 }],
  genre: 'both',
  deliveryType: 'both',
  requiresTherapist: true,
  agentApproved: false,
  tags: [],
  status: 'active',
};

const SELECT_CLS =
  'h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15';

export function TreatmentManager({ treatments, currency }: { treatments: TreatmentRow[]; currency: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function openCreate() {
    setDraft(EMPTY);
    setOpen(true);
  }

  function openEdit(t: TreatmentRow) {
    setDraft({
      id: t.id,
      name: t.name,
      description: t.description ?? '',
      priceOptions:
        t.priceOptions && t.priceOptions.length > 0
          ? t.priceOptions
          : [{ durationMin: t.durationMin, price: t.listPrice, capacity: t.capacity }],
      genre: t.genre,
      deliveryType: t.deliveryType,
      requiresTherapist: t.requiresTherapist,
      agentApproved: t.agentApproved,
      tags: t.tags ?? [],
      status: t.status,
    });
    setOpen(true);
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setOption(i: number, patch: Partial<PriceOption>) {
    setDraft((d) => ({
      ...d,
      priceOptions: d.priceOptions.map((o, idx) => (idx === i ? { ...o, ...patch } : o)),
    }));
  }

  function addOption() {
    setDraft((d) => ({
      ...d,
      priceOptions: [...d.priceOptions, { durationMin: 90, price: Math.round(d.priceOptions[0]?.price ?? 400000), capacity: 1 }],
    }));
  }

  function removeOption(i: number) {
    setDraft((d) => ({ ...d, priceOptions: d.priceOptions.filter((_, idx) => idx !== i) }));
  }

  function save() {
    startTransition(async () => {
      const res = await saveTreatment({
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        priceOptions: draft.priceOptions,
        genre: draft.genre as (typeof TREATMENT_GENRES)[number],
        deliveryType: draft.deliveryType as (typeof TREATMENT_DELIVERY_TYPES)[number],
        requiresTherapist: draft.requiresTherapist,
        agentApproved: draft.agentApproved,
        tags: draft.tags as (typeof SPA_TYPES)[number][],
        status: draft.status as 'active' | 'pending',
      });
      if (res.ok) {
        toast.success(draft.id ? 'Treatment updated' : 'Treatment created');
        setOpen(false);
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
      }
    });
  }

  function toggle(t: TreatmentRow) {
    startTransition(async () => {
      const next = t.status === 'active' ? 'pending' : 'active';
      const res = await setTreatmentStatus(t.id, next);
      if (res.ok) {
        toast.success(next === 'active' ? 'Published' : 'Unpublished');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  return (
    <div className="rounded-3xl border border-ink-100 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div>
          <h2 className="text-[16px] font-semibold">Treatment menu</h2>
          <p className="text-[13px] text-ink-500\">Published treatments appear in search, compare and your listing.</p>
        </div>
        <button type="button" onClick={openCreate} className={buttonClasses('primary', 'sm')}>
          <Plus className="size-4" /> Add treatment
        </button>
      </div>

      {treatments.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <Sparkles className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 text-[15px] font-medium">No treatments yet</p>
          <p className="mt-1 text-sm text-ink-500\">Create your menu, then set branch prices in the matrix below.</p>
        </div>
      ) : (
        <ul className="divide-y divide-ink-50">
          {treatments.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-medium">{t.name}</p>
                  {t.genre !== 'both' && <Badge tone="info">{GENRE_LABELS[t.genre] ?? t.genre}</Badge>}
                  {t.deliveryType !== 'both' && (
                    <Badge tone={t.deliveryType === 'doorstep' ? 'clay' : 'brand'}>
                      {DELIVERY_TYPE_LABELS[t.deliveryType] ?? t.deliveryType}
                    </Badge>
                  )}
                  {t.status !== 'active' && <Badge tone="warning">unpublished</Badge>}
                  {!t.requiresTherapist && <Badge tone="info">shared facility</Badge>}
                  {t.agentApproved && <Badge tone="clay">agent-approved</Badge>}
                </div>
                <p className="mt-0.5 text-[13px] text-ink-500">
                  {(t.priceOptions?.length ?? 0) > 1
                    ? `${t.priceOptions!.map((o) => `${o.durationMin} min`).join(' / ')}`
                    : `${t.durationMin} min`}{' '}
                  · from {formatMoney(t.listPrice, t.currency)} · offered at {t.branchCount}{' '}
                  branch{t.branchCount === 1 ? '' : 'es'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => openEdit(t)} className={buttonClasses('outline', 'sm')}>
                  <Pencil className="size-3.5" /> Edit
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => toggle(t)}
                  className={buttonClasses('ghost', 'sm', 'text-ink-500')}
                >
                  {t.status === 'active' ? 'Unpublish' : 'Publish'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={draft.id ? 'Edit treatment' : 'New treatment'}
        description="Price options feed the availability engine — the first option is the booking default."
        size="lg"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            {({ id }) => (
              <Input id={id} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Balinese Boreh Massage" required />
            )}
          </Field>

          <div className="sm:col-span-2">
            <p className="mb-1.5 text-[13px] font-medium text-ink-700">Description</p>
            <RichText
              key={draft.id ?? 'new-treatment'}
              value={draft.description}
              onChange={(html) => set('description', html)}
              placeholder="Benefits, technique, ideal for…"
              minHeight={140}
            />
          </div>

          {/* ---------------------------- price options --------------------------- */}
          <div className="sm:col-span-2">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[13px] font-medium text-ink-700">
                Price options <span className="text-clay-600">*</span>
              </p>
              <button
                type="button"
                onClick={addOption}
                disabled={draft.priceOptions.length >= 10}
                className={buttonClasses('ghost', 'sm', 'text-brand-700')}
              >
                <Plus className="size-3.5" /> Add option
              </button>
            </div>
            <p className="mb-2 text-[12.5px] text-ink-500">
              Add one or more duration/price options. The first option is what guests book by default.
            </p>
            <div className="space-y-2">
              {draft.priceOptions.map((o, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2 rounded-xl border border-ink-100 bg-sand-50 p-2.5">
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[12px] text-ink-500">Duration</span>
                    <select
                      value={o.durationMin}
                      onChange={(e) => setOption(i, { durationMin: Number(e.target.value) })}
                      className={cn(SELECT_CLS, 'h-10')}
                      aria-label={`Option ${i + 1} duration`}
                    >
                      {DURATION_CHOICES.map((m) => (
                        <option key={m} value={m}>
                          {m} minutes
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[12px] text-ink-500">Price ({currency})</span>
                    <MoneyInput
                      value={o.price}
                      currency={currency}
                      onValueChange={(minor) => setOption(i, { price: minor })}
                      aria-label={`Option ${i + 1} price`}
                    />
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[12px] text-ink-500">Concurrent capacity</span>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={o.capacity}
                      onChange={(e) => setOption(i, { capacity: Number(e.target.value) })}
                      aria-label={`Option ${i + 1} capacity`}
                      className="h-10"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    disabled={draft.priceOptions.length <= 1}
                    aria-label={`Remove option ${i + 1}`}
                    className="mb-0.5 rounded-lg p-2 text-ink-400 transition hover:bg-white hover:text-rose-600 disabled:opacity-40"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ------------------------------ selectors ----------------------------- */}
          <Field label="Genre">
            {({ id }) => (
              <Select id={id} value={draft.genre} onChange={(e) => set('genre', e.target.value)}>
                {TREATMENT_GENRES.map((g) => (
                  <option key={g} value={g}>
                    {GENRE_LABELS[g]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Delivery type">
            {({ id }) => (
              <Select id={id} value={draft.deliveryType} onChange={(e) => set('deliveryType', e.target.value)}>
                {TREATMENT_DELIVERY_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {DELIVERY_TYPE_LABELS[d]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="mt-4">
          <p className="text-[13px] font-semibold text-ink-700">Spa type</p>
          <p className="mt-0.5 text-[12.5px] text-ink-500\">Shown to guests when they filter the search bar by spa type.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SPA_TYPES.map((t) => {
              const on = draft.tags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    set('tags', on ? draft.tags.filter((x) => x !== t) : [...draft.tags, t])
                  }
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition',
                    on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-500 hover:border-ink-300',
                  )}
                >
                  {SPA_TYPE_LABELS[t] ?? t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          <label className={cn('flex items-center gap-2 text-sm text-ink-700')}>
            <input type="checkbox" checked={draft.requiresTherapist} onChange={(e) => set('requiresTherapist', e.target.checked)} className="size-4 accent-[#20524c]" />
            Needs a therapist
          </label>
          <label className={cn('flex items-center gap-2 text-sm text-ink-700')}>
            <input type="checkbox" checked={draft.agentApproved} onChange={(e) => set('agentApproved', e.target.checked)} className="size-4 accent-[#20524c]" />
            Available to agents/resellers
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" size="md" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="md" onClick={save} loading={pending}>
            {draft.id ? 'Save changes' : 'Create treatment'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

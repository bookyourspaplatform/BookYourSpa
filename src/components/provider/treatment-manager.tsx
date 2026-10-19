'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Sparkles } from 'lucide-react';
import { saveTreatment, setTreatmentStatus } from '@/lib/actions/provider';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field, Input, Textarea, Select } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

export type TreatmentRow = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  durationMin: number;
  listPrice: number;
  currency: string;
  requiresTherapist: boolean;
  capacity: number;
  agentApproved: boolean;
  status: string;
  branchCount: number;
};

export const CATEGORY_OPTIONS = [
  { id: 'massage', label: 'Massage' },
  { id: 'body_treatment', label: 'Body treatment' },
  { id: 'facial', label: 'Facial' },
  { id: 'scrub_wrap', label: 'Scrub & wrap' },
  { id: 'reflexology', label: 'Reflexology' },
  { id: 'acupuncture', label: 'Acupuncture' },
  { id: 'hair_nail', label: 'Hair & nail' },
  { id: 'sauna_steambath', label: 'Sauna & steam' },
  { id: 'yoga_class', label: 'Yoga class' },
  { id: 'wellness_program', label: 'Wellness program' },
  { id: 'package', label: 'Package' },
  { id: 'other', label: 'Other' },
];

type Draft = {
  id?: string;
  name: string;
  category: string;
  description: string;
  durationMin: number;
  listPrice: number;
  requiresTherapist: boolean;
  capacity: number;
  agentApproved: boolean;
  status: string;
};

const EMPTY: Draft = {
  name: '',
  category: 'massage',
  description: '',
  durationMin: 60,
  listPrice: 400000,
  requiresTherapist: true,
  capacity: 1,
  agentApproved: false,
  status: 'active',
};

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
      category: t.category,
      description: t.description ?? '',
      durationMin: t.durationMin,
      listPrice: t.listPrice,
      requiresTherapist: t.requiresTherapist,
      capacity: t.capacity,
      agentApproved: t.agentApproved,
      status: t.status,
    });
    setOpen(true);
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      const res = await saveTreatment({
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name.trim(),
        category: draft.category as Draft['category'] & Parameters<typeof saveTreatment>[0]['category'],
        description: draft.description.trim() || null,
        durationMin: Number(draft.durationMin),
        listPrice: Number(draft.listPrice),
        requiresTherapist: draft.requiresTherapist,
        capacity: Number(draft.capacity),
        agentApproved: draft.agentApproved,
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
          <p className="text-[13px] text-ink-500">Published treatments appear in search, compare and your listing.</p>
        </div>
        <button type="button" onClick={openCreate} className={buttonClasses('primary', 'sm')}>
          <Plus className="size-4" /> Add treatment
        </button>
      </div>

      {treatments.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <Sparkles className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 text-[15px] font-medium">No treatments yet</p>
          <p className="mt-1 text-sm text-ink-500">Create your menu, then set branch prices in the matrix below.</p>
        </div>
      ) : (
        <ul className="divide-y divide-ink-50">
          {treatments.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-medium">{t.name}</p>
                  <Badge tone="brand">{CATEGORY_OPTIONS.find((c) => c.id === t.category)?.label ?? t.category}</Badge>
                  {t.status !== 'active' && <Badge tone="warning">unpublished</Badge>}
                  {!t.requiresTherapist && <Badge tone="info">shared facility</Badge>}
                  {t.agentApproved && <Badge tone="clay">agent-approved</Badge>}
                </div>
                <p className="mt-0.5 text-[13px] text-ink-500">
                  {t.durationMin} min · from {formatMoney(t.listPrice, t.currency)} · offered at {t.branchCount}{' '}
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
        description="Durations and categories feed the availability engine."
        size="lg"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            {({ id }) => <Input id={id} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Balinese Boreh Massage" required />}
          </Field>
          <Field label="Category" required>
            {({ id }) => (
              <select id={id} value={draft.category} onChange={(e) => set('category', e.target.value)} className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15">
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={`List price (${currency})`} required>
            {({ id }) => <Input id={id} type="number" min={0} value={draft.listPrice} onChange={(e) => set('listPrice', Number(e.target.value))} />}
          </Field>
          <Field label="Duration (min)" required>
            {({ id }) => (
              <select id={id} value={draft.durationMin} onChange={(e) => set('durationMin', Number(e.target.value))} className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15">
                {[30, 45, 60, 75, 90, 105, 120, 150, 180, 240].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Concurrent capacity">
            {({ id }) => <Input id={id} type="number" min={1} max={50} value={draft.capacity} onChange={(e) => set('capacity', Number(e.target.value))} />}
          </Field>
          <Field label="Description" className="sm:col-span-2">
            {({ id }) => (
              <Textarea id={id} value={draft.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} placeholder="Benefits, technique, ideal for…" />
            )}
          </Field>
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

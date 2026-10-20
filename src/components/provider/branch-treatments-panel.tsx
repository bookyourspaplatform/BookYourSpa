'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, X } from 'lucide-react';
import { setBranchPrice, setBranchTreatmentActive } from '@/lib/actions/provider';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field, Input, inputCls } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export type BranchTreatmentRow = {
  id: string;
  treatmentId: string;
  name: string;
  category: string;
  durationMin: number;
  price: number;
  active: boolean;
};

export function BranchTreatmentsPanel({
  branchId,
  rows,
  catalog,
  currency,
}: {
  branchId: string;
  rows: BranchTreatmentRow[];
  /** Provider treatments not yet offered at this branch. */
  catalog: { id: string; name: string; durationMin: number; listPrice: number }[];
  currency: string;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [pick, setPick] = useState<string>('');
  const [pickPrice, setPickPrice] = useState<number>(0);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const value = (r: BranchTreatmentRow) => drafts[r.id] ?? r.price;

  function savePrice(r: BranchTreatmentRow) {
    const price = value(r);
    startTransition(async () => {
      const res = await setBranchPrice({ branchId, treatmentId: r.treatmentId, price });
      if (res.ok) {
        setDrafts((d) => {
          const next = { ...d };
          delete next[r.id];
          return next;
        });
        toast.success('Price saved');
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
      }
    });
  }

  function toggle(r: BranchTreatmentRow) {
    startTransition(async () => {
      const res = await setBranchTreatmentActive(r.id, !r.active);
      if (res.ok) {
        toast.success(r.active ? 'Treatment hidden' : 'Treatment published');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  function openAdd() {
    setPick(catalog[0]?.id ?? '');
    setPickPrice(catalog[0]?.listPrice ?? 0);
    setAddOpen(true);
  }

  function add() {
    if (!pick) return;
    startTransition(async () => {
      const res = await setBranchPrice({ branchId, treatmentId: pick, price: pickPrice });
      if (res.ok) {
        toast.success('Treatment added to this branch');
        setAddOpen(false);
        router.refresh();
      } else {
        toast.error('Could not add', res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">
          Treatments offered at this branch, with the price customers pay here.
        </p>
        <button type="button" onClick={openAdd} disabled={catalog.length === 0} className={buttonClasses('primary', 'md', 'disabled:opacity-50')}>
          <Plus className="size-4" /> Add treatment
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
          <p className="text-[15px] font-medium">No treatments at this branch yet</p>
          <p className="mt-1 text-sm text-ink-500">
            {catalog.length > 0 ? 'Add one from your catalog to start taking bookings.' : 'Create treatments under Treatments first.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-ink-100 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[15px] font-medium">{r.name}</p>
                    <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'published' : 'unpublished'}</Badge>
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink-500">
                    {r.category} · {r.durationMin} min
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] text-ink-400">{currency}</span>
                    <input
                      type="number"
                      min={0}
                      value={value(r)}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: Number(e.target.value) }))}
                      onKeyDown={(e) => e.key === 'Enter' && savePrice(r)}
                      disabled={pending}
                      aria-label={`Price for ${r.name}`}
                      className="h-9 w-28 rounded-lg border border-ink-200 bg-white px-2.5 text-[13px] tabular-nums outline-none focus:border-brand-500"
                    />
                    <button
                      type="button"
                      disabled={pending || drafts[r.id] === undefined}
                      onClick={() => savePrice(r)}
                      className={cn(buttonClasses('ghost', 'sm'), 'disabled:opacity-40')}
                      aria-label="Save price"
                    >
                      <Check className="size-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => toggle(r)}
                    className={buttonClasses('ghost', 'sm', r.active ? 'text-rose-600 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50')}
                  >
                    {r.active ? 'Unpublish' : 'Publish'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={addOpen} onClose={() => !pending && setAddOpen(false)} title="Add a treatment" description="Pick from your catalog and set this branch's price.">
        {catalog.length === 0 ? (
          <p className="text-sm text-ink-500">Every catalog treatment is already offered here.</p>
        ) : (
          <>
            <Field label="Treatment">
              {({ id }) => (
                <select
                  id={id}
                  value={pick}
                  onChange={(e) => {
                    setPick(e.target.value);
                    const t = catalog.find((c) => c.id === e.target.value);
                    setPickPrice(t?.listPrice ?? 0);
                  }}
                  className={inputCls()}
                >
                  {catalog.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.durationMin} min
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={`Price (${currency})`} className="mt-4">
              {({ id }) => (
                <Input id={id} type="number" min={0} value={pickPrice} onChange={(e) => setPickPrice(Number(e.target.value))} />
              )}
            </Field>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="ghost" size="md" onClick={() => setAddOpen(false)} disabled={pending}>
                <X className="size-3.5" /> Cancel
              </Button>
              <Button size="md" onClick={add} loading={pending}>
                Add treatment
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

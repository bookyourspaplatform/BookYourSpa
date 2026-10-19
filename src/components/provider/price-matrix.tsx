'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Layers } from 'lucide-react';
import { setBranchPrice, setBranchTreatmentActive } from '@/lib/actions/provider';
import { buttonClasses } from '@/components/ui/button';
import { inputCls } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

type Cell = {
  id: string;
  branchId: string;
  treatmentId: string;
  price: number;
  active: boolean;
};

export function PriceMatrix({
  branches,
  treatments,
  cells,
  currency,
}: {
  branches: { id: string; name: string }[];
  treatments: { id: string; name: string; durationMin: number; listPrice: number }[];
  cells: Cell[];
  currency: string;
}) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const cellIndex = useMemo(() => {
    const map = new Map<string, Cell>();
    for (const c of cells) map.set(`${c.branchId}:${c.treatmentId}`, c);
    return map;
  }, [cells]);

  if (branches.length === 0 || treatments.length === 0) return null;

  const value = (treatmentId: string) => {
    const key = `${branchId}:${treatmentId}`;
    if (drafts[key] !== undefined) return drafts[key];
    return cellIndex.get(key)?.price ?? 0;
  };

  function save(treatmentId: string) {
    const price = value(treatmentId);
    startTransition(async () => {
      const res = await setBranchPrice({ branchId, treatmentId, price });
      if (res.ok) {
        setDrafts((d) => {
          const next = { ...d };
          delete next[`${branchId}:${treatmentId}`];
          return next;
        });
        toast.success('Price saved');
        router.refresh();
      } else {
        toast.error('Could not save price', res.error);
      }
    });
  }

  function toggleOffering(treatmentId: string) {
    const cell = cellIndex.get(`${branchId}:${treatmentId}`);
    startTransition(async () => {
      if (cell) {
        const res = await setBranchTreatmentActive(cell.id, !cell.active);
        if (!res.ok) toast.error('Could not update', res.error);
        else {
          toast.success(cell.active ? 'Removed from this branch' : 'Now offered here');
          router.refresh();
        }
      } else {
        const fallback = treatments.find((t) => t.id === treatmentId)?.listPrice ?? 0;
        const res = await setBranchPrice({ branchId, treatmentId, price: drafts[`${branchId}:${treatmentId}`] ?? fallback });
        if (!res.ok) toast.error('Could not add', res.error);
        else {
          toast.success('Added to this branch');
          router.refresh();
        }
      }
    });
  }

  return (
    <div className="rounded-3xl border border-ink-100 bg-white">
      <div className="border-b border-ink-100 px-5 py-4">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold">
          <Layers className="size-4 text-brand-600" /> Branch prices
        </h2>
        <p className="text-[13px] text-ink-500">
          Each branch sets its own local price. Changes go live immediately.
        </p>
      </div>

      {/* Branch tabs */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-ink-100 px-4 py-3">
        {branches.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBranchId(b.id)}
            className={cn(
              'shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition',
              b.id === branchId ? 'bg-brand-700 text-white' : 'border border-ink-200 bg-white text-ink-600 hover:border-brand-300',
            )}
          >
            {b.name}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-ink-50">
        {treatments.map((t) => {
          const cell = cellIndex.get(`${branchId}:${t.id}`);
          const dirty = drafts[`${branchId}:${t.id}`] !== undefined && drafts[`${branchId}:${t.id}`] !== cell?.price;
          return (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className={cn('text-[14.5px] font-medium', !cell?.active && 'text-ink-400 line-through')}>{t.name}</p>
                <p className="text-[12.5px] text-ink-400">{t.durationMin} min</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    aria-label={`Price for ${t.name}`}
                    disabled={!cell?.active && drafts[`${branchId}:${t.id}`] === undefined}
                    value={value(t.id)}
                    onChange={(e) => setDrafts((d) => ({ ...d, [`${branchId}:${t.id}`]: Number(e.target.value) }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && cell?.active) save(t.id);
                    }}
                    className={cn(inputCls(), 'h-9 w-32 pr-11 tabular-nums disabled:opacity-50')}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11.5px] text-ink-400">
                    {currency}
                  </span>
                </div>

                {cell?.active ? (
                  <>
                    <button
                      type="button"
                      onClick={() => save(t.id)}
                      disabled={!dirty || pending}
                      className={buttonClasses(dirty ? 'primary' : 'outline', 'sm', dirty ? '' : 'opacity-50')}
                    >
                      <Check className="size-3.5" /> Save
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => toggleOffering(t.id)}
                      className={buttonClasses('ghost', 'sm', 'text-ink-400 hover:text-rose-600')}
                      title="Remove from this branch"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={pending} onClick={() => toggleOffering(t.id)} className={buttonClasses('outline', 'sm', 'text-brand-700')}>
                    Add here
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

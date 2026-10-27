'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ListChecks, Sparkles, Tag } from 'lucide-react';
import { setProviderPromotionActive } from '@/lib/actions/provider';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { hourWindowLabel } from '@/lib/utils';

export type PlatformPromoRow = {
  id: string;
  title: string;
  summary: string | null;
  startsAt: string | null;
  endsAt: string | null;
  code: string | null;
  discountType: string | null;
  discountValue: number | null;
  /** 'all' = every treatment; 'selected' = this spa picks the list below. */
  appliesTo: string;
  validFromHour: number | null;
  validUntilHour: number | null;
  /** This spa's picked treatments for a “selected” promotion (null = not chosen yet). */
  selectedTreatmentIds: string[] | null;
  /** This spa's per-promotion choice — absent means "off" (not activated yet). */
  enabled: boolean;
};

export type TreatmentOption = { id: string; name: string };

function discountLabel(p: PlatformPromoRow): string | null {
  if (!p.discountType || p.discountValue == null) return null;
  return p.discountType === 'percent' ? `${p.discountValue / 100}% off` : `${p.discountValue} off`;
}

/**
 * General platform promotions — valid at a spa only once its supplier
 * activates them (and each supplier can switch them off again for itself).
 * When the admin scopes a promotion to “Selected treatments”, the spa first
 * chooses which treatments the code applies to, then activates it.
 */
export function PlatformPromotions({
  rows,
  treatments,
}: {
  rows: PlatformPromoRow[];
  treatments: TreatmentOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState<PlatformPromoRow | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const router = useRouter();
  const toast = useToast();

  function toggle(p: PlatformPromoRow) {
    const next = !p.enabled;
    startTransition(async () => {
      const res = await setProviderPromotionActive(p.id, next);
      if (res.ok) {
        toast.success(next ? 'Promotion activated for your spa' : 'Promotion deactivated for your spa');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  function openPicker(p: PlatformPromoRow) {
    setPicking(p);
    setPicked(p.selectedTreatmentIds ?? []);
  }

  function saveSelection() {
    if (!picking) return;
    if (picked.length === 0) {
      toast.error('Pick at least one treatment', 'The code needs at least one treatment to apply to.');
      return;
    }
    // First-time choice activates the promotion; editing keeps its current state.
    const wasChosen = Boolean(picking.selectedTreatmentIds?.length);
    const targetActive = wasChosen ? picking.enabled : true;
    startTransition(async () => {
      const res = await setProviderPromotionActive(picking.id, targetActive, picked);
      if (res.ok) {
        toast.success(wasChosen ? 'Treatment selection updated' : 'Promotion activated for your spa');
        setPicking(null);
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-10 text-center">
        <Sparkles className="mx-auto size-7 text-ink-300" />
        <p className="mt-3 text-[15px] font-medium">No platform promotions right now</p>
        <p className="mt-1 text-sm text-ink-500">
          Offers the platform runs for every spa will appear here so you can activate the ones your spa wants.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-2.5">
        {rows.map((p) => {
          const discount = discountLabel(p);
          const selected = p.selectedTreatmentIds ?? [];
          const needsChoice = p.appliesTo === 'selected' && selected.length === 0;
          const hours = hourWindowLabel(p.validFromHour, p.validUntilHour);
          return (
            <li key={p.id} className="rounded-2xl border border-ink-100 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[15px] font-medium">{p.title}</p>
                    <Badge tone="neutral">platform</Badge>
                    {p.code && (
                      <Badge tone="brand">
                        <Tag className="size-3" /> {p.code}
                      </Badge>
                    )}
                    {discount && <Badge tone="success">{discount}</Badge>}
                  </div>
                  {p.summary && <p className="mt-1 line-clamp-2 text-[13.5px] text-ink-600">{p.summary}</p>}
                  <p className="mt-1 text-[12.5px] text-ink-400">
                    {p.appliesTo === 'selected'
                      ? needsChoice
                        ? 'Choose the treatments this code applies to'
                        : `Applies to ${selected.length} selected treatment${selected.length === 1 ? '' : 's'}`
                      : 'Applies to all treatments'}
                    {hours && ` · valid daily ${hours}`}
                    {p.startsAt ? ` · from ${new Date(p.startsAt).toISOString().slice(0, 10)}` : ''}
                    {p.endsAt ? ` · until ${new Date(p.endsAt).toISOString().slice(0, 10)}` : ''}
                    {p.code && ' · registered customers only'}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2.5">
                  {needsChoice ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => openPicker(p)}
                      className={buttonClasses('primary', 'sm')}
                    >
                      <ListChecks className="size-3.5" /> Choose treatments
                    </button>
                  ) : (
                    <>
                      {p.appliesTo === 'selected' && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => openPicker(p)}
                          className={buttonClasses('outline', 'sm')}
                        >
                          <ListChecks className="size-3.5" /> Edit treatments
                        </button>
                      )}
                      <span className="text-[13px] font-medium text-ink-600">{p.enabled ? 'Active' : 'Inactive'}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={p.enabled}
                        aria-label={`${p.enabled ? 'Deactivate' : 'Activate'} ${p.title}`}
                        disabled={pending}
                        onClick={() => toggle(p)}
                        className={
                          p.enabled
                            ? 'relative h-6 w-11 rounded-full bg-brand-700 transition disabled:opacity-60'
                            : 'relative h-6 w-11 rounded-full bg-ink-300 transition disabled:opacity-60'
                        }
                      >
                        <span
                          className={
                            p.enabled
                              ? 'absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform translate-x-5'
                              : 'absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform'
                          }
                        />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Modal
        open={picking !== null}
        onClose={() => !pending && setPicking(null)}
        title="Choose treatments"
        description={
          picking
            ? `Pick the treatments ${picking.code ?? 'this code'} applies to at your spa.`
            : undefined
        }
      >
        {treatments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center text-[13.5px] text-ink-500">
            You have no treatments yet — add one under Treatments first.
          </p>
        ) : (
          <ul className="max-h-72 divide-y divide-ink-50 overflow-y-auto rounded-xl border border-ink-100 bg-white">
            {treatments.map((t) => {
              const on = picked.includes(t.id);
              return (
                <li key={t.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-sand-50">
                    <input
                      type="checkbox"
                      checked={on}
                      className="size-4 accent-[#20524c]"
                      onChange={() =>
                        setPicked((cur) => (on ? cur.filter((x) => x !== t.id) : [...cur, t.id]))
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[12.5px] text-ink-500">
          {picked.length} treatment{picked.length === 1 ? '' : 's'} selected.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" size="md" onClick={() => setPicking(null)} disabled={pending}>
            Cancel
          </Button>
          <Button size="md" onClick={saveSelection} loading={pending}>
            {picking && !picking.selectedTreatmentIds?.length ? 'Save & activate' : 'Save treatments'}
          </Button>
        </div>
      </Modal>
    </>
  );
}

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Minus, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { GREEN_BTN } from '@/components/ui/classes';
import { formatDisplayMoney, type DisplayCurrency } from '@/lib/display-currency';
import { cn } from '@/lib/utils';
import { SPA_TYPES } from '@/db/schema';
import { SPA_TYPE_LABELS } from '@/lib/catalog';

export type SelectableTreatment = {
  id: string;
  name: string;
  description: string | null;
  benefits: string[];
  /** Resolved spa-type chip labels (already filtered to known types). */
  tagLabels: string[];
  /** Fallback chip when the treatment carries no known spa-type tag. */
  categoryLabel: string;
  genreLabel: string | null;
  deliveryLabel: string | null;
  /** Therapists seated together — 2+ means a couples / four-hand treatment. */
  therapistsPerBooking: number;
  durationMin: number;
  /** Branch price — the fallback when the treatment has no tiers. */
  price: number;
  /** Concurrent-guest capacity for the whole treatment (fallback for tiers). */
  capacity: number;
  /** Duration/price tiers rebased onto this branch's price. Never empty. */
  options: { index: number; durationMin: number; price: number; capacity: number }[];
};

/** Mirrors the booking wizard: 1..min(8, tier capacity). */
function maxPersonsOf(t: SelectableTreatment, tierIdx: number): number {
  const tier = t.options[Math.min(Math.max(tierIdx, 0), t.options.length - 1)];
  return Math.max(1, Math.min(8, tier?.capacity ?? t.capacity));
}

/**
 * The spa page's "Treatments & prices" list with the booking wizard's
 * multi-select behaviour: pick any number of treatments (and a duration tier
 * on each), then carry the whole selection into the booking flow.
 *
 * Above the list sit category tabs — "All" plus every spa-type the outlet's
 * treatments carry (Massages, Body Treatment, …) — so a guest can narrow the
 * list to one kind of treatment. Selected treatments stay selected when the
 * guest switches tabs.
 */
export function TreatmentSelectList({
  treatments,
  currency,
  display,
  bookHref,
  highlightedId,
}: {
  treatments: SelectableTreatment[];
  currency: string;
  /** Visitor's display currency — prices are converted for browsing only. */
  display?: DisplayCurrency;
  /*   * Booking URL for this branch, e.g. `/spas/home-care-spa/dubai-spa-at-your-home/book`. */
  bookHref: string;
  /** Card to ring out (from the legacy `?treatment=` deep link). */
  highlightedId?: string | null;
}) {
  // treatmentId -> chosen tier index. Presence in the object = selected.
  const [picked, setPicked] = useState<Record<string, number>>({});
  // treatmentId -> how many guests share this treatment (default 1).
  const [persons, setPersons] = useState<Record<string, number>>({});
  // Which category tab is showing — 'all' or one spa-type label.
  const [tab, setTab] = useState<string>('all');
  const ids = Object.keys(picked);
  const personsOf = (id: string) => persons[id] ?? 1;

  /** Tabs the outlet actually offers, in the same order as the spa-type chips. */
  const tabs = useMemo(() => {
    const seen = new Set<string>();
    for (const t of treatments) for (const label of t.tagLabels) seen.add(label);
    const order = new Map(SPA_TYPES.map((type, i) => [SPA_TYPE_LABELS[type] ?? type, i]));
    return [...seen].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b));
  }, [treatments]);

  const visible = tab === 'all' ? treatments : treatments.filter((t) => t.tagLabels.includes(tab));

  function toggle(id: string) {
    setPicked((cur) => {
      const next = { ...cur };
      if (id in next) delete next[id];
      else next[id] = 0;
      return next;
    });
  }

  /** Pick a duration tier — also selects the treatment if it isn't selected yet. */
  function pickTier(id: string, optionIndex: number) {
    setPicked((cur) => ({ ...cur, [id]: optionIndex }));
    // A tier can have a smaller capacity — keep the guest count valid for it.
    setPersons((cur) => {
      const t = treatments.find((x) => x.id === id);
      if (!t || cur[id] === undefined) return cur;
      const cap = maxPersonsOf(t, optionIndex);
      return cur[id]! <= cap ? cur : { ...cur, [id]: cap };
    });
  }

  /** Guests stepper — selecting the treatment the first time it is touched. */
  function bumpPersons(id: string, delta: number) {
    const t = treatments.find((x) => x.id === id);
    if (!t) return;
    const tierIdx = picked[id] ?? 0;
    const max = maxPersonsOf(t, tierIdx);
    const next = Math.min(max, Math.max(1, personsOf(id) + delta));
    setPicked((cur) => (id in cur ? cur : { ...cur, [id]: 0 }));
    setPersons((cur) => ({ ...cur, [id]: next }));
  }

  const total = treatments.reduce((sum, t) => {
    const idx = picked[t.id];
    if (idx === undefined) return sum;
    const tier = t.options.find((o) => o.index === idx);
    return sum + (tier ? tier.price : t.price) * personsOf(t.id);
  }, 0);
  const totalGuests = ids.reduce((sum, id) => sum + personsOf(id), 0);

  const bookUrl = ids.length
    ? `${bookHref}?treatments=${ids.join(',')}&options=${ids
        .map((id) => picked[id])
        .join(',')}&persons=${ids.map((id) => personsOf(id)).join(',')}`
    : bookHref;

  return (
    <>
      {tabs.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Treatment categories">
          {[{ key: 'all', label: 'All', count: treatments.length },
            ...tabs.map((label) => ({
              key: label,
              label,
              count: treatments.filter((t) => t.tagLabels.includes(label)).length,
            }))].map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-[13px] font-medium transition',
                tab === key
                  ? 'bg-brand-700 text-white shadow-sm'
                  : 'border border-ink-200 bg-white text-ink-600 hover:border-brand-400 hover:text-brand-800',
              )}
            >
              {label}
              <span className={cn('ml-1 tabular-nums', tab === key ? 'text-white/70' : 'text-ink-400')}>
                ({count})
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-4">
        {visible.map((t) => {
          const chosenIdx = picked[t.id];
          const active = chosenIdx !== undefined;
          const tierIdx = Math.min(chosenIdx ?? 0, t.options.length - 1);
          const tier = t.options[tierIdx]!;
          const maxPersons = maxPersonsOf(t, tierIdx);
          const guests = personsOf(t.id);
          const fromPrice = Math.min(...t.options.map((o) => o.price));
          const shownPrice = active ? tier.price * guests : fromPrice;
          const highlighted = highlightedId === t.id;
          const toggleThis = () => toggle(t.id);
          return (
            <article
              key={t.id}
              id={`t-${t.id}`}
              className={cn(
                'flex scroll-mt-24 flex-col gap-4 rounded-3xl border bg-white p-5 transition sm:flex-row sm:items-start sm:justify-between',
                active
                  ? 'border-brand-500 ring-2 ring-brand-200'
                  : highlighted
                    ? 'border-brand-400 ring-2 ring-brand-200 hover:border-brand-300'
                    : 'border-ink-100 hover:border-brand-200 hover:shadow-sm',
              )}
            >
              <div
                className="min-w-0 max-w-2xl cursor-pointer"
                onClick={toggleThis}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[17px] font-semibold text-ink-900">{t.name}</h3>
                  {t.tagLabels.length > 0 ? (
                    t.tagLabels.map((label) => (
                      <Badge key={label} tone="brand">
                        {label}
                      </Badge>
                    ))
                  ) : (
                    <Badge tone="brand">{t.categoryLabel}</Badge>
                  )}
                </div>
                {t.description && (
                  <div
                    className="mt-1.5 [&:has(details[open])_p]:line-clamp-none"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-[13.5px] leading-relaxed text-ink-600 line-clamp-2">
                      {t.description}
                    </p>
                    <details className="group mt-1">
                      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-brand-700 transition hover:text-brand-800 [&::-webkit-details-marker]:hidden">
                        <span className="group-open:hidden">View more ↓</span>
                        <span className="hidden group-open:inline">Show less ↑</span>
                      </summary>
                    </details>
                  </div>
                )}
                {t.benefits.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {t.benefits.slice(0, 2).map((ben) => (
                      <span
                        key={ben}
                        className="rounded-md bg-sand-100 px-2 py-0.5 text-[11.5px] text-ink-600"
                      >
                        {ben}
                      </span>
                    ))}
                  </div>
                )}
                {/* Duration tiers — the same pills the booking wizard shows;
                    tapping one selects the treatment at that tier. */}
                <div
                  className="mt-3 flex flex-wrap items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t.options.map((o) => (
                    <button
                      key={`${o.durationMin}-${o.index}`}
                      type="button"
                      onClick={() => pickTier(t.id, o.index)}
                      aria-pressed={active && o.index === tierIdx}
                      className={cn(
                        'rounded-lg px-2.5 py-1 text-[12.5px] font-medium transition',
                        active && o.index === tierIdx
                          ? 'bg-brand-700 text-white'
                          : 'bg-ink-100 text-ink-600 hover:bg-ink-200',
                      )}
                    >
                      {o.durationMin} min
                    </button>
                  ))}
                  {t.genreLabel && <Badge tone="info">{t.genreLabel}</Badge>}
                  {t.deliveryLabel && (
                    <Badge tone={t.deliveryLabel === 'Doorstep' ? 'clay' : 'neutral'}>
                      {t.deliveryLabel}
                    </Badge>
                  )}
                  {t.therapistsPerBooking > 1 && (
                    <Badge tone="brand">{t.therapistsPerBooking} therapists</Badge>
                  )}
                </div>

                {/* Guests — how many people share this treatment at once.
                    Same stepper the booking wizard shows, capped by the
                    treatment's capacity (and never above 8). */}
                <div
                  className="mt-3 flex flex-wrap items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-[13px] text-ink-500">Persons</span>
                  <button
                    type="button"
                    aria-label={`Fewer persons for ${t.name}`}
                    onClick={() => bumpPersons(t.id, -1)}
                    disabled={personsOf(t.id) <= 1}
                    className="flex size-7 items-center justify-center rounded-lg border border-ink-200 text-ink-700 transition hover:border-brand-400 hover:text-brand-800 disabled:opacity-40"
                  >
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-6 text-center text-[15px] font-semibold tabular-nums">
                    {personsOf(t.id)}
                  </span>
                  <button
                    type="button"
                    aria-label={`More persons for ${t.name}`}
                    onClick={() => bumpPersons(t.id, 1)}
                    disabled={personsOf(t.id) >= maxPersons}
                    className="flex size-7 items-center justify-center rounded-lg border border-ink-200 text-ink-700 transition hover:border-brand-400 hover:text-brand-800 disabled:opacity-40"
                  >
                    <Plus className="size-3.5" />
                  </button>
                  <span className="ml-1 text-[12px] text-ink-400">max {maxPersons}</span>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
                <p className="text-[15px] text-ink-500">
                  {active && guests > 1 && (
                    <span className="mr-1 tabular-nums text-ink-400">{guests} ×</span>
                  )}
                  {t.options.length > 1 && !active && <span>From </span>}
                  <span className="text-xl font-bold tabular-nums text-ink-900">
                    {formatDisplayMoney(shownPrice, currency, display)}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={toggleThis}
                  aria-pressed={active}
                  className={`${GREEN_BTN} h-10 px-5 text-[13.5px]`}
                >
                  {active ? (
                    <>
                      <Check className="size-4" strokeWidth={3} />
                      Selected
                    </>
                  ) : (
                    'Book this treatment'
                  )}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* Spacer so the sticky bar never covers the last card. */}
      {ids.length > 0 && <div className="h-24" aria-hidden />}

      {ids.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div>
              <p className="text-[15px] font-semibold text-ink-900">
                {ids.length} treatment{ids.length === 1 ? '' : 's'} selected
              </p>
              <p className="text-[13px] text-ink-500">
                Total from{' '}
                <span className="font-semibold tabular-nums text-ink-800">
                  {formatDisplayMoney(total, currency, display)}
                </span>
                {totalGuests > 1 && (
                  <span className="text-ink-400"> · {totalGuests} guests</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPicked({})}
                className="inline-flex h-11 items-center gap-1 rounded-xl border border-ink-200 px-4 text-[13.5px] font-medium text-ink-600 transition hover:border-ink-300 hover:text-ink-800"
              >
                <X className="size-3.5" />
                Clear
              </button>
              <Link href={bookUrl} className={`${GREEN_BTN} h-11 px-6 text-sm`}>
                Book now
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
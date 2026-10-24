'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowUpDown, Clock, MapPin, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/money';

type Offer = {
  treatmentId: string;
  name: string;
  category: string;
  durationMin: number;
  requiresTherapist: boolean;
  price: number;
  currency: string;
  branch: { name: string; slug: string; city: string; country: string };
  /** Booking URL path segment only — never displayed. */
  provider: { slug: string };
};

type SortKey = 'price_asc' | 'price_desc' | 'duration' | 'name';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'price_asc', label: 'Price: low → high' },
  { key: 'price_desc', label: 'Price: high → low' },
  { key: 'duration', label: 'Duration: short → long' },
  { key: 'name', label: 'Name A–Z' },
];

export function CompareClient({
  offers,
  categories,
  cities,
}: {
  offers: Offer[];
  categories: { id: string; label: string }[];
  cities: string[];
}) {
  const [category, setCategory] = useState('all');
  const [city, setCity] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('price_asc');

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = offers.filter(
      (o) =>
        (category === 'all' || o.category === category) &&
        (city === 'all' || o.branch.city === city) &&
        (!query ||
          o.name.toLowerCase().includes(query) ||
          o.branch.name.toLowerCase().includes(query)),
    );
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'price_desc':
          return b.price - a.price;
        case 'duration':
          return a.durationMin - b.durationMin || a.price - b.price;
        case 'name':
          return a.name.localeCompare(b.name);
        default:
          return a.price - b.price;
      }
    });
    return list;
  }, [offers, category, city, q, sort]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search treatment or spa…"
            aria-label="Search treatments"
            className="h-11 w-full rounded-xl border border-ink-200 bg-white pl-10 pr-3.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            aria-label="Filter by city"
            className="h-11 rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-700 outline-none focus:border-brand-500"
          >
            <option value="all">All cities</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort results"
            className="h-11 rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-700 outline-none focus:border-brand-500"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Category chips */}
      <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
        <Chip active={category === 'all'} onClick={() => setCategory('all')}>
          All
        </Chip>
        {categories.map((c) => (
          <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
            {c.label}
          </Chip>
        ))}
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[13px] text-ink-500">
        <ArrowUpDown className="size-3.5" /> {rows.length} result{rows.length === 1 ? '' : 's'}
      </p>

      {/* Rows */}
      {rows.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
          <p className="text-[15px] font-medium">No treatments match</p>
          <p className="mt-1 text-sm text-ink-500">Try a different category or clear the search.</p>
        </div>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((o) => (
            <li
              key={`${o.treatmentId}-${o.branch.slug}`}
              className="flex flex-col gap-3 rounded-2xl border border-ink-100 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15.5px] font-medium">{o.name}</h2>
                  <span className="flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[11.5px] text-ink-600">
                    <Clock className="size-3" /> {o.durationMin} min
                  </span>
                  {!o.requiresTherapist && (
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11.5px] text-sky-700">shared facility</span>
                  )}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13.5px] text-ink-500">
                  <span className="font-medium text-ink-700">{o.branch.name}</span>
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3.5" /> {o.branch.city}
                  </span>
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 sm:justify-end">
                <p className="text-[16px] font-semibold tabular-nums text-brand-800">
                  {formatMoney(o.price, o.currency)}
                </p>
                <Link
                  href={`/spas/${o.provider.slug}/${o.branch.slug}/book?treatment=${o.treatmentId}`}
                  className="inline-flex h-9 shrink-0 items-center rounded-full bg-brand-700 px-4 text-[13px] font-medium text-white transition hover:bg-brand-800"
                >
                  Book now
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-4 py-1.5 text-[13.5px] font-medium transition',
        active
          ? 'border-brand-700 bg-brand-700 text-white'
          : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:text-brand-800',
      )}
    >
      {children}
    </button>
  );
}

import Link from 'next/link';
import { MapPin, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/money';
import { CATEGORY_LABELS } from '@/lib/catalog';
import type { SpaListItem } from '@/lib/catalog';

const GRADIENTS = [
  'from-brand-700 via-brand-600 to-clay-500',
  'from-clay-600 via-clay-500 to-amber-400',
  'from-brand-800 via-brand-500 to-brand-300',
  'from-ink-800 via-brand-700 to-clay-400',
  'from-emerald-700 via-brand-600 to-amber-300',
  'from-brand-600 via-clay-500 to-clay-300',
];

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function SpaCard({ spa, index = 0 }: { spa: SpaListItem; index?: number }) {
  const gradient = GRADIENTS[index % GRADIENTS.length];
  return (
    <Link
      href={`/spas/${spa.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-[0_1px_2px_rgba(23,32,29,0.05)] transition-all hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className={`relative flex h-40 items-center justify-center bg-gradient-to-br ${gradient}`}>
        <span className="font-display text-4xl text-white/90 drop-shadow-sm">{initialsOf(spa.name)}</span>
        {spa.featured && (
          <span className="absolute left-3 top-3">
            <Badge tone="warning" className="bg-amber-300/95 border-amber-200 text-amber-950">
              <Star className="size-3" /> Featured
            </Badge>
          </span>
        )}
        <span className="absolute bottom-3 right-3 rounded-full bg-white/95 px-2.5 py-1 text-[12px] font-semibold text-ink-800">
          {spa.branchCount} {spa.branchCount === 1 ? 'branch' : 'branches'}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div>
          <h3 className="text-lg leading-snug group-hover:text-brand-700">{spa.name}</h3>
          <p className="mt-1 flex items-center gap-1 text-[13px] text-ink-500">
            <MapPin className="size-3.5 shrink-0" />
            {spa.cities.join(' · ')}
          </p>
        </div>

        {spa.tagline && <p className="line-clamp-2 text-[13.5px] leading-relaxed text-ink-500">{spa.tagline}</p>}

        <div className="mt-auto flex flex-wrap gap-1.5">
          {spa.categories.slice(0, 3).map((c) => (
            <span key={c} className="rounded-full bg-sand-100 px-2 py-0.5 text-[11.5px] text-ink-600">
              {CATEGORY_LABELS[c] ?? c}
            </span>
          ))}
        </div>

        <div className="flex items-end justify-between border-t border-ink-100 pt-3">
          <div>
            <p className="text-[11.5px] uppercase tracking-wide text-ink-400">From</p>
            <p className="text-[15px] font-semibold text-brand-800">
              {spa.minPrice !== null ? formatMoney(spa.minPrice, spa.baseCurrency) : '—'}
            </p>
          </div>
          <span className="text-[13px] font-medium text-brand-700 group-hover:underline">View spa →</span>
        </div>
      </div>
    </Link>
  );
}

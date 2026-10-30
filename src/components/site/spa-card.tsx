import Link from 'next/link';
import { MapPin, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { formatDisplayMoney, type DisplayCurrency } from '@/lib/display-currency';
import { CATEGORY_LABELS, SPA_CATEGORY_LABELS } from '@/lib/catalog';
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

/** Rough spend level from the outlet's min price in its own currency. */
export function priceLevel(minPrice: number | null, currency: string): string {
  if (minPrice === null) return '';
  const major = currency === 'IDR' || currency === 'JPY' ? minPrice : minPrice / 100;
  const expensive =
    (currency === 'IDR' && major >= 700_000) ||
    (currency === 'JPY' && major >= 15_000) ||
    (!['IDR', 'JPY'].includes(currency) && major >= 100);
  const mid =
    (currency === 'IDR' && major >= 400_000) ||
    (currency === 'JPY' && major >= 8_000) ||
    (!['IDR', 'JPY'].includes(currency) && major >= 50);
  return expensive ? '$$$' : mid ? '$$' : '$';
}

export function StarRating({ avg, count }: { avg: number; count: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-[13px]">
      <Star className="size-3.5 fill-amber-400 text-amber-400" />
      <span className="font-semibold text-ink-800">{avg.toFixed(1)}</span>
      {count != null && <span className="text-ink-400">({count})</span>}
    </span>
  );
}

export function SpaCard({
  spa,
  index = 0,
  display,
  distanceKm,
}: {
  spa: SpaListItem;
  index?: number;
  display?: DisplayCurrency;
  distanceKm?: number | null;
}) {
  const gradient = GRADIENTS[index % GRADIENTS.length];
  const distance = distanceKm ?? spa.distanceKm;
  const href = `/spas/${spa.slug}/${spa.branchSlug}`;
  const bookHref = `${href}/book`;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-[0_1px_2px_rgba(23,32,29,0.05)] transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <Link href={href} className="relative flex h-44 items-center justify-center">
        <span className={`absolute inset-0 bg-gradient-to-br ${gradient}`} aria-hidden />
        {spa.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- cover may be a branch-uploaded data URL
          <img src={spa.coverUrl} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
        )}
        <span className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {spa.spaCategories.slice(0, 1).map((c) => (
            <span
              key={c}
              className="rounded-full bg-white/95 px-2.5 py-1 text-[12px] font-medium text-ink-800 shadow-sm"
            >
              {SPA_CATEGORY_LABELS[c] ?? c}
            </span>
          ))}
          {spa.featured && (
            <Badge tone="warning" className="border-amber-300 bg-amber-300/95 text-amber-950">
              <Star className="size-3" /> Featured
            </Badge>
          )}
        </span>
        {!spa.coverUrl && (
          <span className="relative font-display text-4xl text-white/90 drop-shadow-sm">
            {initialsOf(spa.name)}
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          {spa.rating ? (
            <StarRating avg={spa.rating.avg} count={spa.rating.count} />
          ) : (
            <span className="text-[13px] text-ink-400">New · no reviews yet</span>
          )}
          <span className="text-[13px] font-medium text-ink-400">
            {spa.priceLevel ?? priceLevel(spa.minPrice, spa.currency)}
          </span>
        </div>

        <div>
          <Link href={href} className="text-lg leading-snug hover:text-brand-700">
            {spa.name}
          </Link>
          {spa.tagline && <p className="mt-0.5 text-[13.5px] italic leading-snug text-brand-700">{spa.tagline}</p>}
        </div>

        <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-500">
          <MapPin className="size-3.5 shrink-0" />
          {spa.city}, {spa.country}
          {typeof distance === 'number' && (
            <span className="font-medium text-brand-700">· {distance} km away</span>
          )}
        </p>

        {spa.shortDescription && (
          <p className="line-clamp-2 text-[13px] leading-relaxed text-ink-500">{spa.shortDescription}</p>
        )}

        {spa.spaTypes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {spa.spaTypes
              .slice(0, 3)
              .map((t) => (
                <span key={t} className="rounded-md bg-sand-100 px-2 py-0.5 text-[11.5px] text-ink-600">
                  {SPA_CATEGORY_LABELS[t] ?? CATEGORY_LABELS[t] ?? t}
                </span>
              ))}
            {spa.spaTypes.length > 3 && (
              <span className="px-1 py-0.5 text-[11.5px] text-ink-400">+{spa.spaTypes.length - 3}</span>
            )}
          </div>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 border-t border-ink-100 pt-3">
          <div>
            <p className="text-[11.5px] uppercase tracking-wide text-ink-400">From</p>
            <p className="text-[15px] font-semibold text-brand-800">
              {spa.minPrice !== null ? formatDisplayMoney(spa.minPrice, spa.currency, display) : '—'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={href} className={buttonClasses('outline', 'sm')}>
              View Spa
            </Link>
            <Link href={bookHref} className={buttonClasses('primary', 'sm')}>
              Book Now
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

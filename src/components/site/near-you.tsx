'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronDown, MapPin, Navigation } from 'lucide-react';
import { SpaCard } from '@/components/site/spa-card';
import { haversineKm, type SpaListItem } from '@/lib/catalog';
import { buttonClasses } from '@/components/ui/button';
import { inputCls } from '@/components/ui/classes';
import type { DisplayCurrency } from '@/lib/display-currency';

const RADII = [5, 10, 25, 50, 100];

/**
 * "Spas around you": asks for the visitor's live location, then sorts and
 * filters the outlet list by great-circle distance. Without a location it
 * falls back to the most-loved (top-rated) outlets.
 */
export function NearYouSection({
  spas,
  display,
  langStrings,
}: {
  spas: SpaListItem[];
  display?: DisplayCurrency;
  langStrings: {
    title: string;
    subtitleDefault: string;
    subtitleNear: string;
    useLocation: string;
    radius: string;
    /** Templates with a `{n}` placeholder — server can't pass functions to client components. */
    km: string;
    viewAll: string;
    fullPage: string;
    denied: string;
  };
}) {
  const s = langStrings;
  // Server → client props must be serializable, so counts are injected here.
  const fill = (tpl: string, n: number) => tpl.replaceAll('{n}', String(n));
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(50);
  const [status, setStatus] = useState<'idle' | 'locating' | 'denied'>('idle');

  // Distance math only runs once a location exists — otherwise origin is null.
  const located = origin
    ? spas
        .map((spa) => {
          const distanceKm =
            spa.lat != null && spa.lng != null
              ? Math.round(haversineKm(origin.lat, origin.lng, spa.lat, spa.lng) * 10) / 10
              : null;
          return { spa, distanceKm };
        })
        .filter((r) => r.distanceKm !== null)
        .sort((a, b) => a.distanceKm! - b.distanceKm!)
    : [];

  const withinRadius = located.filter((r) => r.distanceKm! <= radius);
  const results = origin
    ? withinRadius.slice(0, 6)
    : spas.slice(0, 6).map((spa) => ({ spa, distanceKm: null as number | null }));
  const totalNear = withinRadius.length;

  const nearQuery = origin ? `near=${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}&radius=${radius}` : '';

  function locate() {
    if (!navigator.geolocation) {
      setStatus('denied');
      return;
    }
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus('idle');
      },
      () => setStatus('denied'),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl">{s.title}</h2>
          <p className="mt-1 text-sm text-ink-500">
            {origin ? s.subtitleNear : status === 'denied' ? s.denied : s.subtitleDefault}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!origin ? (
            <button
              type="button"
              onClick={locate}
              disabled={status === 'locating'}
              className={buttonClasses('outline', 'sm')}
            >
              <Navigation className="size-4" />
              {status === 'locating' ? 'Locating…' : s.useLocation}
            </button>
          ) : (
            <label className="flex items-center gap-2 text-[13px] text-ink-500">
              {s.radius}
              <select
                className={inputCls() + ' w-auto h-9 py-0 pr-8 text-[13px]'}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              >
                {RADII.map((r) => (
                  <option key={r} value={r}>
                    {fill(s.km, r)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Link
            href={nearQuery ? `/spas?${nearQuery}` : '/spas'}
            className="hidden text-sm font-medium text-brand-700 hover:underline sm:block"
          >
            {s.fullPage} →
          </Link>
        </div>
      </div>

      {results.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          No spas within {radius} km — widen the radius to see more.
        </p>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {results.map(({ spa, distanceKm }, i) => (
            <SpaCard key={spa.id} spa={spa} index={i} display={display} distanceKm={distanceKm} />
          ))}
        </div>
      )}

      <div className="mt-8 text-center">
        <Link
          href={nearQuery ? `/spas?${nearQuery}` : '/spas'}
          className={`${buttonClasses('outline', 'md')} inline-flex`}
        >
          <MapPin className="size-4" />
          {fill(s.viewAll, origin && totalNear > 0 ? totalNear : spas.length)}
          <ChevronDown className="size-4" />
        </Link>
      </div>
    </section>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MapPin, Search, Navigation } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import { inputCls } from '@/components/ui/classes';

export type HeroStat = { icon: 'globe' | 'users' | 'pin' | 'shield'; value: string; label: string };

const STAT_ICONS = {
  globe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-6">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-6">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6S14 16 14.6 19M16 5.6a3 3 0 0 1 0 5.6M17.6 14.7c2 .7 3.2 2.2 3.6 4.3" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-6">
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-6">
      <path d="M12 3l7 2.8V12c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V5.8L12 3Z" />
      <path d="m9 12 2 2 4-4.2" />
    </svg>
  ),
};

/**
 * Landing hero per the design: photo background, visit/deliver toggle,
 * WHAT / WHERE / WHEN search, "spas near me" geolocation shortcut and a
 * stats strip. Search is a plain GET form — it works without JavaScript.
 */
export function SearchHero({
  cities,
  stats,
  langStrings,
}: {
  cities: { city: string; count: number }[];
  stats: HeroStat[];
  langStrings: {
    title: string;
    subtitle: string;
    visit: string;
    delivered: string;
    what: string;
    where: string;
    when: string;
    search: string;
    useLocation: string;
    whatPlaceholder: string;
    wherePlaceholder: string;
  };
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'visit' | 'deliver'>('visit');
  const [locating, setLocating] = useState(false);

  const s = langStrings;

  function findNearMe() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        router.push(`/spas?near=${latitude.toFixed(5)},${longitude.toFixed(5)}&radius=50`);
      },
      () => setLocating(false),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }

  return (
    <section className="relative overflow-hidden bg-brand-900 text-white">
      {/* Photo backdrop */}
      {/* eslint-disable-next-line @next/next/no-img-element -- hero CDN photo */}
      <img
        src="https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=2000&q=80"
        alt=""
        className="absolute inset-0 size-full object-cover"
        fetchPriority="high"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-ink-900/85 via-ink-900/70 to-ink-900/90" aria-hidden />

      <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-14 sm:px-6 sm:pb-14 sm:pt-20 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl leading-[1.08] text-white sm:text-5xl lg:text-[56px]">{s.title}</h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/85 sm:text-base">{s.subtitle}</p>
        </div>

        {/* Search card */}
        <div className="mx-auto mt-8 max-w-4xl rounded-3xl bg-white p-3 shadow-2xl sm:rounded-[28px] sm:p-4">
          {/* Visit / deliver toggle */}
          <div className="mb-3 flex gap-1 rounded-full bg-sand-100 p-1">
            {(
              [
                ['visit', s.visit],
                ['deliver', s.delivered],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                aria-pressed={mode === key}
                className={`flex-1 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
                  mode === key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form
            action="/spas"
            method="get"
            className="grid gap-3 sm:grid-cols-[1.2fr_1.2fr_1fr_auto] sm:items-end"
          >
            {mode === 'deliver' && <input type="hidden" name="spa" value="doorstep_spa" />}

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                {s.what}
              </span>
              <input
                type="text"
                name="q"
                placeholder={s.whatPlaceholder}
                className={inputCls() + ' border-ink-100'}
              />
            </label>

            <label className="relative block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                {s.where}
              </span>
              <MapPin className="pointer-events-none absolute left-3 top-[38px] size-4 -translate-y-1/2 text-ink-400" />
              <input
                type="text"
                name="city"
                list="hero-cities"
                placeholder={s.wherePlaceholder}
                className={inputCls() + ' border-ink-100 pl-9'}
              />
              <datalist id="hero-cities">
                {cities.map((c) => (
                  <option key={c.city} value={c.city}>
                    {c.count} spas
                  </option>
                ))}
              </datalist>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                {s.when}
              </span>
              <input type="date" name="date" className={inputCls() + ' border-ink-100'} />
            </label>

            <button type="submit" className={buttonClasses('primary', 'lg', 'sm:w-auto w-full')}>
              <Search className="size-4" />
              {s.search}
            </button>
          </form>

          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={findNearMe}
              disabled={locating}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-500 transition-colors hover:text-amber-400 disabled:opacity-60"
            >
              <Navigation className="size-4" />
              {locating ? 'Locating…' : s.useLocation}
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <dl className="mx-auto mt-10 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center gap-1 text-center">
              <span className="text-amber-400" aria-hidden>
                {STAT_ICONS[stat.icon]}
              </span>
              <dt className="order-2 text-[12.5px] text-white/75">{stat.label}</dt>
              <dd className="order-1 text-2xl font-semibold text-white sm:text-3xl">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

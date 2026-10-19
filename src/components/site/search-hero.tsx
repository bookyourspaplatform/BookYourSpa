import Link from 'next/link';
import { Search, ShieldCheck, Zap, Sparkles } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import { inputCls } from '@/components/ui/classes';
import { CATEGORY_LABELS } from '@/lib/catalog';

export function SearchHero({
  cities,
  categories,
  announcement,
}: {
  cities: { city: string; count: number }[];
  categories: { value: string; count: number }[];
  announcement?: string;
}) {
  return (
    <section className="relative overflow-hidden bg-brand-900 text-white">
      <div
        className="pointer-events-none absolute -right-32 -top-40 size-[34rem] rounded-full bg-brand-700/50 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-40 -left-24 size-[28rem] rounded-full bg-clay-600/25 blur-3xl"
        aria-hidden
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-12 sm:px-6 sm:pb-20 sm:pt-16 lg:px-8">
        {announcement && (
          <p className="mb-6 inline-flex rounded-full border border-brand-600 bg-brand-800/70 px-4 py-1.5 text-[13px] text-brand-100">
            {announcement}
          </p>
        )}
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-clay-300">
          Bali · Dubai · International
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl leading-[1.05] text-white sm:text-5xl lg:text-6xl">
          Book the spa day you have been promising yourself.
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-brand-100/85 sm:text-base">
          Compare treatments and prices across vetted spas, pick your therapist and time, pay online
          where supported — and walk in with an instant voucher.
        </p>

        {/* Progressive-enhancement search (plain GET) */}
        <form
          action="/spas"
          method="get"
          className="mt-8 rounded-3xl border border-brand-600/60 bg-white p-3 shadow-2xl sm:rounded-full sm:p-2"
        >
          <div className="grid gap-2 sm:grid-cols-[1.1fr_1fr_auto] sm:items-center">
            <label className="sr-only" htmlFor="hero-city">
              Destination
            </label>
            <select
              id="hero-city"
              name="city"
              className={inputCls() + ' border-ink-100'}
              defaultValue=""
            >
              <option value="">Any destination</option>
              {cities.map((c) => (
                <option key={c.city} value={c.city}>
                  {c.city} ({c.count})
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor="hero-category">
              Treatment
            </label>
            <select
              id="hero-category"
              name="category"
              className={inputCls() + ' border-ink-100'}
              defaultValue=""
            >
              <option value="">Any treatment</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {CATEGORY_LABELS[c.value] ?? c.value} ({c.count})
                </option>
              ))}
            </select>

            <button type="submit" className={buttonClasses('secondary', 'lg', 'sm:w-auto w-full sm:mx-1')}>
              <Search className="size-4" />
              Search spas
            </button>
          </div>
        </form>

        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-[13.5px] text-brand-100/85">
          <span className="inline-flex items-center gap-1.5">
            <Zap className="size-4 text-clay-300" /> Instant e-voucher
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-clay-300" /> Vetted spas only
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-4 text-clay-300" /> Pay online or at the venue
          </span>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/spas" className={buttonClasses('primary', 'lg')}>
            Browse all spas
          </Link>
          <Link href="/register/provider" className={buttonClasses('outline', 'lg', 'bg-transparent text-white border-brand-500 hover:bg-brand-800')}>
            List your spa
          </Link>
        </div>
      </div>
    </section>
  );
}

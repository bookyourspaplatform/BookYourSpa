import Link from 'next/link';
import { ArrowRight, CalendarCheck, Handshake, ReceiptText, Ticket, LayoutGrid } from 'lucide-react';
import { getDb } from '@/db';
import { listCategoryCounts, listCities, listPromotions, listPublicCoupons, listSpas } from '@/lib/catalog';
import { getSettings } from '@/lib/settings';
import { organizationJsonLd, webSiteJsonLd, appUrl } from '@/lib/seo';
import { JsonLd } from '@/components/json-ld';
import { SearchHero } from '@/components/site/search-hero';
import { SpaCard } from '@/components/site/spa-card';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const db = await getDb();
  const [cities, categories, spas, promos, coupons, settings] = await Promise.all([
    listCities(db),
    listCategoryCounts(db),
    listSpas(db, { sort: 'featured', pageSize: 6 }),
    listPromotions(db, { limit: 4 }),
    listPublicCoupons(db),
    getSettings(),
  ]);

  const base = await appUrl('/');
  const featured = spas.items;
  const deals = promos.filter((p) => p.position === 'deal' || p.position === 'banner');

  return (
    <>
      <JsonLd data={[organizationJsonLd({ url: base, name: settings['site.name'], description: settings['site.description'] }), webSiteJsonLd(base, settings['site.name'], '/spas')]} />

      <SearchHero
        cities={cities}
        categories={categories}
        announcement={settings['site.announcement'] || undefined}
      />

      {/* Destinations */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl sm:text-3xl">Popular destinations</h2>
            <p className="mt-1 text-sm text-ink-500">Vetted spas in Bali, Dubai and beyond.</p>
          </div>
          <Link href="/spas" className="hidden text-sm font-medium text-brand-700 hover:underline sm:block">
            All spas →
          </Link>
        </div>

        <div className="no-scrollbar mt-6 flex gap-4 overflow-x-auto pb-2 sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-6">
          {cities.slice(0, 6).map((c, i) => (
            <Link
              key={c.city}
              href={`/spas?city=${encodeURIComponent(c.city)}`}
              className={`group relative min-w-40 overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white transition-transform hover:-translate-y-0.5 ${
                ['from-brand-700 to-brand-500', 'from-clay-600 to-clay-400', 'from-ink-800 to-brand-700'][
                  i % 3
                ]
              }`}
            >
              <p className="font-display text-lg">{c.city}</p>
              <p className="text-[13px] text-white/80">{c.count} {c.count === 1 ? 'spa' : 'spas'}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Categories */}
      <section className="border-y border-ink-100 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl">Browse by treatment</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {categories.map((c) => (
              <Link
                key={c.value}
                href={`/spas?category=${c.value}`}
                className="flex flex-col items-center gap-1.5 rounded-2xl border border-ink-100 bg-sand-50 px-3 py-5 text-center transition hover:border-brand-300 hover:bg-brand-50"
              >
                <LayoutGrid className="size-5 text-brand-600" />
                <span className="text-[13.5px] font-medium text-ink-800">{c.label}</span>
                <span className="text-[11.5px] text-ink-400">{c.count} options</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured spas */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl sm:text-3xl">Featured spas</h2>
            <p className="mt-1 text-sm text-ink-500">Hand-picked outlets with the highest guest ratings.</p>
          </div>
          <Link href="/spas" className="text-sm font-medium text-brand-700 hover:underline">
            See all →
          </Link>
        </div>

        {featured.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
            No spas published yet — run <code>npm run db:seed</code> for demo data.
          </p>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((spa, i) => (
              <SpaCard key={spa.id} spa={spa} index={i} />
            ))}
          </div>
        )}
      </section>

      {/* Deals */}
      {(deals.length > 0 || coupons.length > 0) && (
        <section className="border-y border-ink-100 bg-sand-100">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl sm:text-3xl">Deals & promotions</h2>
                <p className="mt-1 text-sm text-ink-500">Limited-time offers from our partner spas.</p>
              </div>
              <Link href="/deals" className="text-sm font-medium text-brand-700 hover:underline">
                All deals →
              </Link>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {deals.slice(0, 3).map((p) => (
                <Link
                  key={p.id}
                  href={p.linkUrl ?? '/deals'}
                  className="group rounded-2xl border border-ink-100 bg-white p-5 transition hover:border-brand-300 hover:shadow-md"
                >
                  <Badge tone="clay">{p.position === 'deal' ? 'Deal' : 'New'}</Badge>
                  <h3 className="mt-3 text-lg group-hover:text-brand-700">{p.title}</h3>
                  {p.summary && <p className="mt-1 text-[13.5px] text-ink-500">{p.summary}</p>}
                </Link>
              ))}
              {coupons.slice(0, 1).map((c) => (
                <div key={c.id} className="rounded-2xl border border-dashed border-brand-300 bg-brand-50 p-5">
                  <Badge tone="brand">
                    <Ticket className="size-3" /> Promo code
                  </Badge>
                  <p className="mt-3 font-mono text-xl font-semibold text-brand-900">{c.code}</p>
                  <p className="mt-1 text-[13.5px] text-ink-600">{c.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <h2 className="text-2xl sm:text-3xl">Booking in three steps</h2>
        <div className="mt-7 grid gap-5 md:grid-cols-3">
          {[
            {
              icon: <LayoutGrid className="size-5" />,
              title: 'Discover & compare',
              body: 'Filter by city and treatment, compare durations and prices side by side, and pick the branch that suits you.',
            },
            {
              icon: <CalendarCheck className="size-5" />,
              title: 'Choose time & therapist',
              body: 'Live availability from each branch roster — no double bookings, no phone tag. Reserve as a guest or member.',
            },
            {
              icon: <ReceiptText className="size-5" />,
              title: 'Pay & get your voucher',
              body: 'Pay online where supported or at the venue. Your voucher lands instantly, ready to show on your phone.',
            },
          ].map((step, i) => (
            <div key={step.title} className="relative rounded-2xl border border-ink-100 bg-white p-6">
              <span className="absolute -top-3 left-6 inline-flex size-7 items-center justify-center rounded-full bg-brand-700 text-[13px] font-semibold text-white">
                {i + 1}
              </span>
              <div className="inline-flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                {step.icon}
              </div>
              <h3 className="mt-4 text-lg">{step.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-500">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Partner CTAs */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="relative overflow-hidden rounded-3xl bg-brand-900 p-7 text-white">
            <Handshake className="size-6 text-clay-300" />
            <h3 className="mt-3 text-2xl text-white">Run a spa? Sell it here.</h3>
            <p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-brand-100/85">
              Branches, menus, therapists, calendars and payouts — one console for your whole operation.
              Approval takes under 48 hours.
            </p>
            <Link href="/register/provider" className={`${buttonClasses('secondary', 'md')} mt-5`}>
              Become a supplier <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="relative overflow-hidden rounded-3xl border border-ink-100 bg-white p-7">
            <Ticket className="size-6 text-clay-600" />
            <h3 className="mt-3 text-2xl">Agent or reseller?</h3>
            <p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-ink-500">
              Access approved spa products at negotiated net rates or earn commission, book for your
              clients and track every sale.
            </p>
            <Link href="/register/agent" className={`${buttonClasses('outline', 'md')} mt-5`}>
              Become an agent <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>

        {coupons.length > 0 && (
          <p className="mt-8 text-center text-sm text-ink-500">
            New here? Use code <span className="font-mono font-semibold text-brand-800">{coupons[0]!.code}</span>{' '}
            for {coupons[0]!.discountType === 'percent' ? `${coupons[0]!.discountValue / 100}% off` : formatMoney(coupons[0]!.discountValue, coupons[0]!.currency ?? 'IDR')} your first booking.
          </p>
        )}
      </section>
    </>
  );
}

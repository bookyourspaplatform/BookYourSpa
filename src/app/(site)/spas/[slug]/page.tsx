import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Clock, MapPin, Phone, ArrowRight, BadgePercent } from 'lucide-react';
import { getDb } from '@/db';
import { getSpaDetail, CATEGORY_LABELS } from '@/lib/catalog';
import { appUrl, breadcrumbJsonLd, daySpaJsonLd, pageMetadata, treatmentJsonLd } from '@/lib/seo';
import { JsonLd } from '@/components/json-ld';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

function initialsOf(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

const GRADIENTS = [
  'from-brand-700 via-brand-600 to-clay-500',
  'from-clay-600 via-clay-500 to-amber-400',
  'from-brand-800 via-brand-500 to-brand-300',
  'from-ink-800 via-brand-700 to-clay-400',
];

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const db = await getDb();
  const spa = await getSpaDetail(db, slug);
  if (!spa) return { title: 'Spa not found' };
  const cities = spa.branches.map((b) => b.city).join(', ');
  return pageMetadata({
    title: `${spa.provider.name} in ${cities} — book treatments`,
    description:
      spa.provider.tagline ??
      `Book treatments at ${spa.provider.name} (${cities}). Compare menus, prices and live availability, and get an instant voucher.`,
    path: `/spas/${slug}`,
    keywords: [spa.provider.name, `${spa.provider.name} booking`, ...spa.branches.map((b) => `${b.city} spa`)],
  });
}

export default async function SpaDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const spa = await getSpaDetail(db, slug);
  if (!spa) notFound();

  const base = await appUrl('');
  const url = `${base}/spas/${slug}`;
  const gradient = GRADIENTS[slug.length % GRADIENTS.length];
  const cities = spa.branches.map((b) => b.city);
  const lowest = spa.treatments.length ? Math.min(...spa.treatments.map((t) => t.branchPrices[0]!.price)) : null;

  const jsonLd = [
    daySpaJsonLd({
      name: spa.provider.name,
      url,
      description: spa.provider.description ?? spa.provider.tagline ?? undefined,
      priceRange: lowest !== null ? formatMoney(lowest, spa.provider.baseCurrency) : undefined,
      ...(spa.branches[0]
        ? {
            address: {
              street: spa.branches[0].addressLine,
              city: spa.branches[0].city,
              region: spa.branches[0].region,
              country: spa.branches[0].country,
            },
          }
        : {}),
      geo: spa.branches[0]?.lat && spa.branches[0]?.lng ? { lat: spa.branches[0].lat, lng: spa.branches[0].lng } : null,
      phone: spa.provider.phone,
      areaServed: [...new Set(cities)],
    }),
    breadcrumbJsonLd(
      [{ name: 'Home', path: '/' }, { name: 'Spas', path: '/spas' }, { name: spa.provider.name, path: `/spas/${slug}` }],
      base,
    ),
    ...spa.treatments.slice(0, 10).map((t) =>
      treatmentJsonLd({
        name: t.name,
        url: `${url}#menu`,
        description: t.description ?? `${t.name} at ${spa.provider.name}`,
        image: t.imageUrl,
        duration: `${t.durationMin} minutes`,
        price: t.branchPrices[0]?.price ?? null,
        currency: spa.provider.baseCurrency,
        providerName: spa.provider.name,
      }),
    ),
  ];

  return (
    <>
      <JsonLd data={jsonLd} />

      {/* Hero */}
      <section className={`relative bg-gradient-to-br ${gradient} text-white`}>
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
          <nav className="mb-5 text-[13px] text-white/75" aria-label="Breadcrumb">
            <Link href="/spas" className="hover:underline">
              Spas
            </Link>{' '}
            / {spa.provider.name}
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-display text-4xl text-white/90 sm:text-5xl">{initialsOf(spa.provider.name)}</span>
            {spa.provider.featured && (
              <Badge tone="warning" className="bg-amber-300 text-amber-950 border-amber-200">
                Featured
              </Badge>
            )}
          </div>
          <h1 className="mt-4 max-w-3xl text-3xl leading-tight text-white sm:text-4xl">{spa.provider.name}</h1>
          {spa.provider.tagline && <p className="mt-2 max-w-2xl text-[15px] text-white/85">{spa.provider.tagline}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-white/85">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" /> {cities.join(' · ')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-4" /> {spa.branches.length} {spa.branches.length === 1 ? 'branch' : 'branches'}
            </span>
            {spa.provider.phone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-4" /> {spa.provider.phone}
              </span>
            )}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="#menu" className={buttonClasses('secondary', 'lg')}>
              View menu & prices
            </a>
            <Link href={`/spas/${slug}/${spa.branches[0]?.slug ?? ''}`} className={buttonClasses('outline', 'lg', 'bg-transparent text-white border-white/50 hover:bg-white/10')}>
              Choose a branch <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:flex lg:px-8">
        <div className="min-w-0 flex-1">
          {/* Branches */}
          <section aria-labelledby="branches-heading">
            <h2 id="branches-heading" className="text-2xl">
              Branches
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {spa.branches.map((b) => (
                <Link
                  key={b.id}
                  href={`/spas/${slug}/${b.slug}`}
                  className="group rounded-2xl border border-ink-100 bg-white p-5 transition hover:border-brand-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg group-hover:text-brand-700">{b.name}</h3>
                      <p className="mt-1 flex items-start gap-1.5 text-[13.5px] text-ink-500">
                        <MapPin className="mt-0.5 size-3.5 shrink-0" /> {b.addressLine}, {b.city}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-sand-100 px-2.5 py-1 text-[12px] text-ink-600">
                      {b.currency}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[13px]">
                    <span className="text-ink-500">
                      {b.therapistCount} therapist{b.therapistCount === 1 ? '' : 's'} · open daily
                    </span>
                    <span className="font-medium text-brand-700 group-hover:underline">Branch details →</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* Treatment menu */}
          <section id="menu" className="mt-10 scroll-mt-20" aria-labelledby="menu-heading">
            <div className="flex items-end justify-between gap-3">
              <h2 id="menu-heading" className="text-2xl">
                Treatment menu
              </h2>
              <Link href={`/compare?provider=${slug}`} className="text-sm font-medium text-brand-700 hover:underline">
                Compare →
              </Link>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-ink-100 bg-white">
              {spa.treatments.map((t) => {
                const from = t.branchPrices[0]!;
                const cheapestBranch = from.branchName;
                return (
                  <div key={t.id} className="flex flex-col gap-3 border-b border-ink-100 p-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[16px] font-medium">{t.name}</h3>
                        <Badge tone="brand">{CATEGORY_LABELS[t.category] ?? t.category}</Badge>
                        {t.agentApproved && (
                          <Badge tone="clay">
                            <BadgePercent className="size-3" /> Agent rates
                          </Badge>
                        )}
                      </div>
                      {t.description && <p className="mt-1 line-clamp-2 text-[13.5px] text-ink-500">{t.description}</p>}
                      <p className="mt-1.5 text-[13px] text-ink-400">
                        {t.durationMin} min · from {cheapestBranch}
                        {t.branchPrices.length > 1 && ` (best of ${t.branchPrices.length} branches)`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end">
                      <p className="text-lg font-semibold text-brand-800">
                        {formatMoney(from.price, spa.provider.baseCurrency)}
                      </p>
                      <Link
                        href={`/spas/${slug}/${from.branchSlug}?treatment=${t.id}`}
                        className={buttonClasses('primary', 'sm')}
                      >
                        Book
                      </Link>
                    </div>
                  </div>
                );
              })}
              {spa.treatments.length === 0 && (
                <p className="p-6 text-center text-sm text-ink-500">Menu coming soon.</p>
              )}
            </div>
          </section>

          {/* About */}
          {spa.provider.description && (
            <section className="mt-10" aria-labelledby="about-heading">
              <h2 id="about-heading" className="text-2xl">
                About {spa.provider.name}
              </h2>
              <p className="mt-3 max-w-3xl whitespace-pre-line text-[15px] leading-relaxed text-ink-600">
                {spa.provider.description}
              </p>
            </section>
          )}
        </div>

        {/* Aside */}
        <aside className="mt-8 w-full shrink-0 lg:mt-0 lg:w-80">
          <div className="rounded-2xl border border-ink-100 bg-white p-5">
            <h3 className="text-[15px] font-semibold">Good to know</h3>
            <ul className="mt-3 space-y-2.5 text-[13.5px] text-ink-600">
              <li className="flex gap-2">
                <span className="text-brand-600">✓</span> Instant e-voucher for every booking
              </li>
              <li className="flex gap-2">
                <span className="text-brand-600">✓</span> Live availability from each branch roster
              </li>
              <li className="flex gap-2">
                <span className="text-brand-600">✓</span> Pay online or at the venue (branch dependent)
              </li>
              <li className="flex gap-2">
                <span className="text-brand-600">✓</span> Free cancellation up to 24h before
              </li>
            </ul>
            <div className="mt-4 border-t border-ink-100 pt-4">
              <p className="text-[13px] text-ink-500">Markets</p>
              <p className="mt-1 text-sm font-medium">{[...new Set(cities)].join(' · ')}</p>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

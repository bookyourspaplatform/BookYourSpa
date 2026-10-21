import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Clock, MapPin, Navigation, Phone, UserRound } from 'lucide-react';
import { getDb } from '@/db';
import { getBranchDetail, CATEGORY_LABELS, SPA_CATEGORY_LABELS, SPA_FACILITY_LABELS, SPA_TYPE_LABELS } from '@/lib/catalog';
import { sanitizeRichText, stripHtml } from '@/lib/security';
import { appUrl, breadcrumbJsonLd, daySpaJsonLd, pageMetadata, treatmentJsonLd } from '@/lib/seo';
import { JsonLd } from '@/components/json-ld';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; branch: string }>;
}): Promise<Metadata> {
  const { slug, branch } = await params;
  const db = await getDb();
  const detail = await getBranchDetail(db, slug, branch);
  if (!detail) return { title: 'Branch not found' };
  const b = detail.branch;
  const provider = b.provider;
  return pageMetadata({
    title: `${b.name} branch — ${provider.name}, ${b.city}`,
    description:
      b.shortDescription?.trim() ||
      `${provider.name} in ${b.city}. View treatments, prices and therapists, check live availability and book instantly.`,
    path: `/spas/${slug}/${branch}`,
    keywords: [`${b.city} spa`, `${b.city} massage`, `${provider.name} ${b.name}`],
  });
}

export default async function BranchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; branch: string }>;
  searchParams: Promise<{ treatment?: string }>;
}) {
  const { slug, branch } = await params;
  const { treatment: highlightTreatment } = await searchParams;
  const db = await getDb();
  const detail = await getBranchDetail(db, slug, branch);
  if (!detail) notFound();

  const b = detail.branch;
  const provider = b.provider;
  const { treatments, therapistList, promos } = detail;
  const base = await appUrl('');
  const url = `${base}/spas/${slug}/${branch}`;

  const today = new Date();
  const hours = b.hours.length
    ? b.hours
        .slice()
        .sort((x, y) => x.day - y.day)
        .map((h) => ({ ...h, label: `${DAY_NAMES[h.day]} ${h.closed ? 'Closed' : `${h.open} – ${h.close}`}` }))
    : [];

  const jsonLd = [
    daySpaJsonLd({
      name: `${provider.name} — ${b.name}`,
      url,
      description: b.description ? stripHtml(b.description) : undefined,
      priceRange: treatments.length ? formatMoney(treatments[0]!.price, b.currency) : undefined,
      address: { street: b.addressLine, city: b.city, region: b.region, country: b.country },
      geo: b.lat && b.lng ? { lat: b.lat, lng: b.lng } : null,
      phone: b.phone,
      areaServed: [b.city],
    }),
    breadcrumbJsonLd(
      [
        { name: 'Home', path: '/' },
        { name: 'Spas', path: '/spas' },
        { name: provider.name, path: `/spas/${slug}` },
        { name: b.name, path: `/spas/${slug}/${branch}` },
      ],
      base,
    ),
    ...treatments.slice(0, 12).map((t) =>
      treatmentJsonLd({
        name: t.name,
        url: `${url}?treatment=${t.id}`,
        description: t.description ? stripHtml(t.description) : t.name,
        image: t.imageUrl,
        duration: `${t.durationMin} minutes`,
        price: t.price,
        currency: b.currency,
        providerName: `${provider.name} ${b.name}`,
      }),
    ),
  ];

  return (
    <>
      <JsonLd data={jsonLd} />

      <section className="border-b border-ink-100 bg-brand-900 text-white">
        <div className="mx-auto max-w-7xl px-4 py-9 sm:px-6 lg:px-8">
          <nav className="mb-4 text-[13px] text-white/70" aria-label="Breadcrumb">
            <Link href="/spas" className="hover:underline">
              Spas
            </Link>{' '}
            /{' '}
            <Link href={`/spas/${slug}`} className="hover:underline">
              {provider.name}
            </Link>{' '}
            / {b.name}
          </nav>
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <h1 className="text-3xl text-white sm:text-4xl">
                {provider.name} — {b.name}
              </h1>
              <p className="mt-2 flex items-start gap-1.5 text-[14.5px] text-brand-100/85">
                <MapPin className="mt-0.5 size-4 shrink-0" /> {b.addressLine}, {b.city}
                {b.region ? `, ${b.region}` : ''}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13.5px] text-brand-100/85">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-4" /> {hours[0] ? `Daily ${b.hours[0]!.open}–${b.hours[0]!.close}` : 'See hours'}
                </span>
                {b.phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="size-4" /> {b.phone}
                  </span>
                )}
                {b.showTherapistOnline && (
                  <span className="inline-flex items-center gap-1.5">
                    <UserRound className="size-4" /> {therapistList.length} therapists
                  </span>
                )}
              </div>
              {b.tagline && <p className="mt-3 text-[17px] font-medium text-white">{b.tagline}</p>}
              {b.shortDescription && <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-brand-100/80">{b.shortDescription}</p>}
              {(b.categories.length > 0 || b.spaTypes.length > 0 || b.doorstepService) && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {b.doorstepService && (
                    <span className="rounded-full border border-clay-300/40 bg-clay-600/30 px-2.5 py-0.5 text-[11.5px] font-medium text-clay-100">
                      Massage on Call / Doorstep
                    </span>
                  )}
                  {b.categories.map((c) => (
                    <span key={c} className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11.5px] text-brand-100">
                      {SPA_CATEGORY_LABELS[c] ?? c}
                    </span>
                  ))}
                  {b.spaTypes.slice(0, 6).map((t) => (
                    <span key={t} className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11.5px] text-brand-100">
                      {SPA_TYPE_LABELS[t] ?? t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Link href={`/spas/${slug}/${branch}/book`} className={buttonClasses('secondary', 'lg')}>
                Book now
              </Link>
              {b.lat && b.lng && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClasses('outlineLight', 'sm')}
                >
                  <Navigation className="size-3.5" /> Directions
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl gap-8 px-4 py-9 sm:px-6 lg:flex lg:px-8">
        <div className="min-w-0 flex-1">
          {promos.length > 0 && (
            <div className="mb-6 rounded-2xl border border-clay-200 bg-clay-50 p-4">
              {promos.map((p) => (
                <div key={p.id} className="flex items-start gap-3 py-1.5">
                  <Badge tone="clay">Offer</Badge>
                  <div>
                    <p className="text-[14.5px] font-medium text-clay-900">{p.title}</p>
                    {p.summary && <p className="text-[13.5px] text-clay-800/80">{p.summary}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Photos */}
          {b.images.length > 0 && (
            <section className="mb-7" aria-label="Photos">
              {/* eslint-disable-next-line @next/next/no-img-element -- branch covers may be data URLs */}
              <img
                src={b.images[0]!}
                alt={`${b.name} cover`}
                className="h-56 w-full rounded-2xl border border-ink-100 object-cover sm:h-72"
              />
              {b.images.length > 1 && (
                <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {b.images.slice(1, 7).map((src, i) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      key={i}
                      src={src}
                      alt={`${b.name} photo ${i + 2}`}
                      className="aspect-square w-full rounded-lg border border-ink-100 object-cover"
                      loading="lazy"
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* About */}
          {(b.description || b.facilities.length > 0) && (
            <section className="mb-7" aria-labelledby="about-heading">
              <h2 id="about-heading" className="text-2xl">
                About {b.name}
              </h2>
              {b.description && (
                <div
                  className="mt-3 max-w-none text-[14.5px] leading-relaxed text-ink-600 [&_a]:text-brand-700 [&_a]:underline [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-0.5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                  dangerouslySetInnerHTML={{ __html: sanitizeRichText(b.description) }}
                />
              )}
              {b.facilities.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {b.facilities.map((f) => (
                    <span key={f} className="rounded-full border border-ink-100 bg-white px-3 py-1 text-[12.5px] text-ink-600">
                      {SPA_FACILITY_LABELS[f] ?? f}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          <h2 className="text-2xl">Treatments & prices</h2>
          <p className="mt-1 text-sm text-ink-500">Prices in {b.currency}. Availability is live per therapist.</p>

          <div className="mt-4 space-y-3">
            {treatments.map((t) => {
              const highlighted = highlightTreatment === t.id;
              return (
                <div
                  key={t.id}
                  id={`t-${t.id}`}
                  className={`scroll-mt-24 rounded-2xl border bg-white p-4 transition sm:p-5 ${
                    highlighted ? 'border-brand-400 ring-2 ring-brand-200' : 'border-ink-100'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[16.5px] font-medium">{t.name}</h3>
                        <Badge tone="brand">{CATEGORY_LABELS[t.category] ?? t.category}</Badge>
                        {!t.requiresTherapist && <Badge tone="info">Shared facility</Badge>}
                      </div>
                      {t.description && (
                        <div
                          className="prose prose-sm mt-1.5 max-w-none text-[14px] leading-relaxed text-ink-600 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-brand-700 [&_a]:underline"
                          dangerouslySetInnerHTML={{ __html: sanitizeRichText(t.description) }}
                        />
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {t.benefits.map((ben) => (
                          <span key={ben} className="rounded-full bg-sand-100 px-2.5 py-0.5 text-[12px] text-ink-600">
                            {ben}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-[13px] text-ink-400">{t.durationMin} minutes</p>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-4 border-t border-ink-100 pt-3 sm:flex-col sm:items-end sm:border-0 sm:pt-0">
                      <p className="text-xl font-semibold text-brand-800">{formatMoney(t.price, b.currency)}</p>
                      <Link
                        href={`/spas/${slug}/${branch}/book?treatment=${t.id}`}
                        className={buttonClasses('primary', 'md')}
                      >
                        Book this treatment
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
            {treatments.length === 0 && (
              <p className="rounded-2xl border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
                This branch has not published its menu yet.
              </p>
            )}
          </div>

          {b.showTherapistOnline && therapistList.length > 0 && (
            <section className="mt-9" aria-labelledby="team-heading">
              <h2 id="team-heading" className="text-2xl">
                Therapists
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {therapistList.map((t) => (
                  <div key={t.id} className="flex items-start gap-3 rounded-2xl border border-ink-100 bg-white p-4">
                    {t.avatarUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element -- staff photo uploaded by the spa */
                      <img
                        src={t.avatarUrl}
                        alt={t.name}
                        className="size-10 shrink-0 rounded-full border border-ink-100 object-cover"
                      />
                    ) : (
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-100 font-display text-brand-800">
                        {t.name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((w) => w[0])
                          .join('')}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-medium">{t.name}</p>
                      {t.bio && <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-500">{t.bio}</p>}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {t.specialties.map((s) => (
                          <span key={s} className="rounded-full bg-sand-100 px-2 py-0.5 text-[11px] text-ink-600">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="mt-8 w-full shrink-0 lg:mt-0 lg:w-80">
          <div className="rounded-2xl border border-ink-100 bg-white p-5">
            <h3 className="text-[15px] font-semibold">Opening hours</h3>
            <ul className="mt-3 space-y-1.5 text-[13.5px]">
              {hours.map((h) => (
                <li key={h.day} className="flex items-center justify-between gap-3 text-ink-600">
                  <span>{DAY_NAMES[h.day]}</span>
                  <span className={h.closed ? 'text-rose-600' : 'font-medium text-ink-800'}>
                    {h.closed ? 'Closed' : `${h.open} – ${h.close}`}
                  </span>
                </li>
              ))}
              {hours.length === 0 && <li className="text-ink-500">Hours to be confirmed.</li>}
            </ul>
            <div className="mt-4 border-t border-ink-100 pt-4 text-[13.5px] text-ink-600">
              <p>
                <span className="text-ink-400">Timezone:</span> {b.timezone}
              </p>
              <p className="mt-1">
                <span className="text-ink-400">Lead time:</span> {Math.round(b.leadTimeMinutes / 60)}h minimum
              </p>
              <p className="mt-1">
                <span className="text-ink-400">Booking window:</span> up to {b.maxAdvanceDays} days ahead
              </p>
            </div>
            <Link href={`/spas/${slug}/${branch}/book`} className={`${buttonClasses('primary', 'md')} mt-5 w-full`}>
              Check availability
            </Link>
            <p className="mt-3 text-center text-[12.5px] text-ink-400">Today is {formatDate(today, b.timezone)}</p>
          </div>

          {/* Location */}
          <div className="mt-4 rounded-2xl border border-ink-100 bg-white p-5">
            <h3 className="text-[15px] font-semibold">Location</h3>
            <p className="mt-2 text-[13.5px] text-ink-600">
              {b.addressLine}, {b.city}
              {b.region ? `, ${b.region}` : ''}
            </p>
            {b.lat && b.lng && (
              <iframe
                title={`Map of ${b.name}`}
                src={`https://maps.google.com/maps?q=${encodeURIComponent(`${b.lat},${b.lng}`)}&z=15&output=embed`}
                loading="lazy"
                className="mt-3 h-44 w-full rounded-xl border-0"
                referrerPolicy="no-referrer-when-downgrade"
              />
            )}
            <div className="mt-3 flex flex-col gap-2 text-[13.5px]">
              {b.lat && b.lng && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-brand-700 hover:underline"
                >
                  <Navigation className="size-3.5" /> Open in Google Maps
                </a>
              )}
              {b.website && (
                <a href={b.website} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
                  {b.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              )}
              {b.phone && <a href={`tel:${b.phone}`} className="text-brand-700 hover:underline">{b.phone}</a>}
              {b.email && <a href={`mailto:${b.email}`} className="text-brand-700 hover:underline">{b.email}</a>}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

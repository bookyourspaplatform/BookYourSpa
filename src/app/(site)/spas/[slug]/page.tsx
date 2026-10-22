import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Mail, MapPin, Sparkles, Star } from 'lucide-react';
import { getDb } from '@/db';
import {
  getSpaDetail,
  listSpas,
  CATEGORY_LABELS,
  SPA_CATEGORY_LABELS,
  SPA_FACILITY_LABELS,
  SPA_TYPE_LABELS,
} from '@/lib/catalog';
import { getCurrentUser } from '@/lib/auth/session';
import { getSettings } from '@/lib/settings';
import { findClaimForUser } from '@/lib/claims';
import { stripHtml } from '@/lib/security';
import { appUrl, breadcrumbJsonLd, daySpaJsonLd, pageMetadata, treatmentJsonLd } from '@/lib/seo';
import { JsonLd } from '@/components/json-ld';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/money';
import { dateKeyInTz, formatDate } from '@/lib/utils';
import { SpaCard, priceLevel } from '@/components/site/spa-card';
import { ClaimSpaCard, type ClaimSpaState } from '@/components/site/claim-spa-card';

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

const COUNTRY_NAMES: Record<string, string> = {
  ID: 'Indonesia',
  AE: 'United Arab Emirates',
  SG: 'Singapore',
  TH: 'Thailand',
  MY: 'Malaysia',
  IN: 'India',
  GB: 'United Kingdom',
  US: 'United States',
  AU: 'Australia',
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PAYMENT_LABELS: Record<string, string> = {
  stripe: 'Visa / Mastercard (Stripe)',
  paypal: 'PayPal',
  razorpay: 'Razorpay / e-wallet',
  venue: 'Pay at the venue',
};

/** Solid green action button — matches the sample design (rounded-xl, not a pill). */
const GREEN_BTN =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-700 px-6 font-semibold text-white shadow-sm transition hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50';

function HighlightHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-2xl text-ink-900">
      <span className="box-decoration-clone rounded-md bg-sand-200/70 px-2.5 py-1">{children}</span>
    </h2>
  );
}

function Stars({ value }: { value: number }) {
  const filled = Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          className={
            i < filled
              ? 'size-4 fill-amber-400 text-amber-400'
              : 'size-4 fill-ink-200 text-ink-200'
          }
        />
      ))}
    </span>
  );
}

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

  const user = await getCurrentUser();
  const settings = await getSettings();
  const myClaim =
    user && !spa.provider.ownerId ? await findClaimForUser(db, spa.provider.id, user.id) : null;

  const base = await appUrl('');
  const url = `${base}/spas/${slug}`;
  const gradient = GRADIENTS[slug.length % GRADIENTS.length];
  const cities = spa.branches.map((b) => b.city);
  const main = spa.branches[0] ?? null;
  const level = priceLevel(spa.minPrice, spa.provider.baseCurrency);

  const jsonLd = [
    daySpaJsonLd({
      name: spa.provider.name,
      url,
      description: spa.provider.description ?? spa.provider.tagline ?? undefined,
      priceRange: spa.minPrice !== null ? formatMoney(spa.minPrice, spa.provider.baseCurrency) : undefined,
      ...(main
        ? {
            address: {
              street: main.addressLine,
              city: main.city,
              region: main.region,
              country: main.country,
            },
          }
        : {}),
      geo: main?.lat && main?.lng ? { lat: main.lat, lng: main.lng } : null,
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
        url: `${url}#treatments`,
        description: t.description ? stripHtml(t.description) : `${t.name} at ${spa.provider.name}`,
        image: t.imageUrl,
        duration: `${t.durationMin} minutes`,
        price: t.branchPrices[0]?.price ?? null,
        currency: spa.provider.baseCurrency,
        providerName: spa.provider.name,
      }),
    ),
  ];

  /* ---------- gallery ---------- */
  const gallery = [
    spa.provider.coverUrl,
    ...spa.branches.flatMap((b) => b.images),
    ...spa.treatments.map((t) => t.imageUrl),
  ]
    .filter((src): src is string => Boolean(src))
    .filter((src, i, arr) => arr.indexOf(src) === i);
  const photos = gallery.slice(0, 5);
  const sidePhotos = photos.slice(1, 5);
  const extraPhotos = Math.max(0, gallery.length - photos.length);

  /* ---------- title block ---------- */
  const categoryKey = main?.categories[0] ?? main?.spaTypes[0] ?? null;
  const categoryLabel = categoryKey
    ? SPA_CATEGORY_LABELS[categoryKey] ??
      SPA_TYPE_LABELS[categoryKey] ??
      CATEGORY_LABELS[categoryKey] ??
      categoryKey
    : null;
  const countryName = COUNTRY_NAMES[spa.provider.country] ?? spa.provider.country;
  const locationText = cities.length ? `${[...new Set(cities)].join(', ')}, ${countryName}` : countryName;

  /* ---------- Spa Business (branch) sourced copy ----------
     The provider row is only the tenant; everything publicly shown comes from
     the spa businesses (outlets) exactly as the supplier console lists them. */
  const descriptionText = (main?.description?.trim() || spa.provider.description?.trim() || '') || null;
  const tagline = spa.provider.tagline ?? main?.tagline ?? null;
  const intro =
    main?.shortDescription ??
    (descriptionText ? `${stripHtml(descriptionText).slice(0, 200).trimEnd()}…` : null);
  const facilities = [...new Set(spa.branches.flatMap((b) => b.facilities))];

  /* ---------- hours (per spa business) ---------- */
  const branchHours = spa.branches.map((b) => {
    const todayKey = dateKeyInTz(new Date(), b.timezone);
    const todayIdx = new Date(`${todayKey}T12:00:00Z`).getUTCDay();
    return {
      name: b.name,
      timezone: b.timezone,
      rows: DAY_LABELS.map((label, day) => {
        const h = b.hours.find((x) => x.day === day);
        const open = Boolean(h && !h.closed);
        return {
          label,
          day,
          open,
          text: open ? `${h!.open} – ${h!.close}` : 'Closed',
          today: day === todayIdx,
        };
      }),
    };
  });

  const cancelHours = settings['booking.cancellationHours'];
  const supportEmail = settings['site.supportEmail'];
  const paymentText = [...new Set(spa.branches.flatMap((b) => b.paymentMethods))]
    .map((m) => PAYMENT_LABELS[m] ?? m)
    .join(', ');

  /* ---------- map ---------- */
  const lat = main?.lat ? Number(main.lat) : null;
  const lng = main?.lng ? Number(main.lng) : null;
  const hasCoords = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng);
  const mapSrc = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${(lng! - 0.007).toFixed(4)}%2C${(lat! - 0.007).toFixed(4)}%2C${(lng! + 0.007).toFixed(4)}%2C${(lat! + 0.007).toFixed(4)}&layer=mapnik&marker=${lat}%2C${lng}`
    : null;
  /* ---------- claim + related ---------- */
  const claimState: ClaimSpaState | null = spa.provider.ownerId
    ? null
    : !user
      ? 'signed_out'
      : myClaim
        ? 'pending'
        : 'ready';

  const related = (await listSpas(db, { pageSize: 48, sort: 'featured' }))
    .items.filter((s) => s.slug !== slug)
    .sort(
      (a, b) =>
        Number(b.country === spa.provider.country) - Number(a.country === spa.provider.country),
    )
    .slice(0, 3);

  const bookHref = main ? `/spas/${slug}/${main.slug}/book` : null;

  return (
    <>
      <JsonLd data={jsonLd} />

      <div className="mx-auto max-w-7xl space-y-6 px-4 pb-14 pt-6 sm:px-6 lg:px-8">
        {/* Photo gallery */}
        <section aria-label="Photos" className="overflow-hidden rounded-3xl border border-ink-100">
          <div className="grid grid-cols-2 gap-1.5 md:h-[430px] md:grid-cols-4 md:grid-rows-2">
            <div className="relative col-span-2 h-60 md:col-span-2 md:row-span-2 md:h-auto">
              {photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element -- branch uploads may be data URLs
                <img
                  src={photos[0]}
                  alt={`${spa.provider.name} — photo`}
                  className="absolute inset-0 size-full object-cover"
                />
              ) : (
                <div
                  className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${gradient}`}
                >
                  <span className="font-display text-6xl text-white/90">
                    {initialsOf(spa.provider.name)}
                  </span>
                </div>
              )}
            </div>
            {sidePhotos.map((src, i) => (
              <div key={src} className="relative h-32 md:h-auto">
                {/* eslint-disable-next-line @next/next/no-img-element -- branch uploads may be data URLs */}
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                />
                {i === sidePhotos.length - 1 && extraPhotos > 0 && (
                  <span className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2.5 py-1 text-[11.5px] font-medium text-white">
                    +{extraPhotos} more photos
                  </span>
                )}
              </div>
            ))}
            {Array.from({ length: Math.max(0, 4 - sidePhotos.length) }).map((_, i) => (
              <div
                key={`ph-${i}`}
                className={`h-32 bg-gradient-to-br opacity-90 md:h-auto ${GRADIENTS[(i + 2) % GRADIENTS.length]}`}
              />
            ))}
          </div>
        </section>

        <div className="gap-8 lg:flex">
          {/* ------------------------------ main ------------------------------ */}
          <main className="min-w-0 flex-1 space-y-10">
            {/* Title block */}
            <header>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[14px] text-ink-500">
                <MapPin className="size-4 text-clay-500" />
                {categoryLabel && <span className="font-medium text-ink-700">{categoryLabel}</span>}
                <span aria-hidden>·</span>
                <span>{locationText}</span>
                {level && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="font-semibold text-ink-600">{level}</span>
                  </>
                )}
                {spa.provider.featured && <Badge tone="warning">Featured</Badge>}
              </p>

              <h1 className="mt-2 text-4xl font-bold leading-[1.06] tracking-tight text-ink-900 sm:text-5xl">
                {spa.provider.name}
              </h1>
              {tagline && (
                <p className="mt-2 text-[17px] font-semibold text-ink-800">{tagline}</p>
              )}
              {intro && (
                <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-ink-600">{intro}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[14.5px]">
                {spa.rating ? (
                  <>
                    <span className="flex items-center gap-1.5">
                      <Stars value={spa.rating.avg} />
                      <span className="font-semibold text-ink-800">{spa.rating.avg.toFixed(1)}</span>
                      <a
                        href="#reviews"
                        className="text-ink-500 underline-offset-2 hover:text-brand-700 hover:underline"
                      >
                        ({spa.rating.count} reviews)
                      </a>
                    </span>
                    {spa.minPrice !== null && (
                      <span className="text-ink-500">
                        From{' '}
                        <span className="font-semibold text-ink-800">
                          {formatMoney(spa.minPrice, spa.provider.baseCurrency)}
                        </span>
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-ink-400">New · no reviews yet</span>
                    {spa.minPrice !== null && (
                      <span className="text-ink-500">
                        From{' '}
                        <span className="font-semibold text-ink-800">
                          {formatMoney(spa.minPrice, spa.provider.baseCurrency)}
                        </span>
                      </span>
                    )}
                  </>
                )}
              </div>
            </header>

            {/* Spa Businesses (outlets) — mirrors the supplier console listing */}
            <section aria-labelledby="business-heading">
              <HighlightHeading id="business-heading">Spa Business</HighlightHeading>
              <p className="mt-2 text-[13.5px] text-ink-500">
                {spa.branches.length} location{spa.branches.length === 1 ? '' : 's'} · each
                business owns its own hours, prices and team.
              </p>
              <div className="mt-4 space-y-4">
                {spa.branches.map((b) => (
                  <article
                    key={b.id}
                    className="rounded-3xl border border-ink-100 bg-white p-5 transition hover:border-brand-200 hover:shadow-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/spas/${slug}/${b.slug}`}
                        className="text-[17px] font-semibold text-ink-900 hover:text-brand-700"
                      >
                        {b.name}
                      </Link>
                      {b.status === 'active' ? (
                        <Badge tone="success">active</Badge>
                      ) : (
                        <Badge tone="neutral">{b.status}</Badge>
                      )}
                      {b.doorstepService && <Badge tone="clay">Doorstep</Badge>}
                    </div>
                    <p className="mt-1.5 flex items-start gap-1.5 text-[13.5px] text-ink-600">
                      <MapPin className="mt-0.5 size-3.5 shrink-0 text-clay-500" />
                      {b.addressLine}, {b.city}, {b.country} · {b.timezone} · {b.currency}
                    </p>
                    <p className="mt-1 text-[13px] text-ink-400">
                      {b.treatmentCount} treatment{b.treatmentCount === 1 ? '' : 's'} ·{' '}
                      {b.therapistCount} therapist{b.therapistCount === 1 ? '' : 's'}
                      {b.paymentMethods.length > 0 &&
                        ` · ${b.paymentMethods.map((m) => PAYMENT_LABELS[m] ?? m).join(', ')}`}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {DAY_LABELS.map((label, day) => {
                        const h = b.hours.find((x) => x.day === day);
                        const open = Boolean(h && !h.closed);
                        return (
                          <span
                            key={label}
                            className={`rounded-full px-2.5 py-1 text-[12px] tabular-nums ${
                              open ? 'bg-brand-50 text-brand-700' : 'bg-sand-100 text-ink-400'
                            }`}
                          >
                            {label} {open ? `${h!.open}–${h!.close}` : 'Closed'}
                          </span>
                        );
                      })}
                    </div>
                    <Link
                      href={`/spas/${slug}/${b.slug}`}
                      className="mt-3.5 inline-flex h-9 items-center justify-center rounded-full border border-ink-200 bg-white px-4 text-[13px] font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-700"
                    >
                      View spa business →
                    </Link>
                  </article>
                ))}
                {spa.branches.length === 0 && (
                  <p className="rounded-3xl border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
                    Locations coming soon.
                  </p>
                )}
              </div>
            </section>

            {/* Offers */}
            {spa.promos.length > 0 && (
              <section
                className="rounded-3xl border border-clay-200 bg-clay-50/60 p-4 sm:p-5"
                aria-label="Current offers"
              >
                <ul className="space-y-3.5">
                  {spa.promos.slice(0, 3).map((p) => (
                    <li key={p.id} className="flex gap-3">
                      <span className="mt-0.5 h-fit shrink-0 rounded-full border border-clay-300 bg-white px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-clay-700">
                        Offer
                      </span>
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-ink-900">{p.title}</p>
                        {p.summary && (
                          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-600">
                            {p.summary}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* About */}
            {(descriptionText || facilities.length > 0) && (
              <section aria-labelledby="about-heading">
                <HighlightHeading id="about-heading">About {spa.provider.name}</HighlightHeading>
                {descriptionText && (
                  <div className="mt-4 max-w-3xl space-y-4 text-[15px] leading-relaxed text-ink-600">
                    {descriptionText.split(/\n{2,}/).map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                )}
                {facilities.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {facilities.map((f) => (
                      <span
                        key={f}
                        className="rounded-full border border-ink-200 bg-white px-3 py-1 text-[12.5px] text-ink-600"
                      >
                        {SPA_FACILITY_LABELS[f] ?? f}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Opening hours + Good to know */}
            <div className="grid gap-8 sm:grid-cols-2">
              {branchHours.length > 0 && (
                <section
                  aria-labelledby="hours-heading"
                  className={branchHours.length > 1 ? 'sm:col-span-2' : ''}
                >
                  <h2 id="hours-heading" className="text-xl font-semibold text-ink-900">
                    Opening hours
                  </h2>
                  <div className={`mt-3 ${branchHours.length > 1 ? 'grid gap-5 sm:grid-cols-2' : ''}`}>
                    {branchHours.map((bh) => (
                      <div key={bh.name}>
                        {branchHours.length > 1 && (
                          <p className="text-[13px] font-semibold text-ink-700">{bh.name}</p>
                        )}
                        <ul className="mt-1 text-[13.5px]">
                          {bh.rows.map((r) => (
                            <li key={r.label} className="flex items-center justify-between py-1.5">
                              <span className={r.today ? 'font-semibold text-ink-800' : 'text-ink-600'}>
                                {r.label}
                                {r.today && <span className="font-normal text-ink-400"> · today</span>}
                              </span>
                              <span
                                className={`tabular-nums ${
                                  r.open
                                    ? r.today
                                      ? 'font-semibold text-ink-800'
                                      : 'text-ink-600'
                                    : 'text-ink-400'
                                }`}
                              >
                                {r.text}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1 text-[12.5px] text-ink-400">
                          Branch-local time ({bh.timezone})
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section aria-labelledby="gtk-heading">
                <h2 id="gtk-heading" className="text-xl font-semibold text-ink-900">
                  Good to know
                </h2>
                <div className="mt-3 space-y-3 text-[13.5px] leading-relaxed text-ink-600">
                  <p>
                    <span className="font-semibold text-ink-800">Booking Confirmation:</span> Your
                    reservation is confirmed once you receive a booking confirmation or voucher.
                  </p>
                  <p>
                    <span className="font-semibold text-ink-800">Contact the Spa:</span> To check
                    your booking status, change your booking, or share special requirements, contact
                    the spa as early as possible.
                  </p>
                  <p>
                    <span className="font-semibold text-ink-800">Please Arrive Early:</span> Arrive
                    10–15 minutes before your scheduled treatment to complete check-in and relax
                    before your session.
                  </p>
                  <p>
                    <span className="font-semibold text-ink-800">Cancellation:</span> Free
                    cancellation up to {cancelHours} hours before your appointment. Later
                    cancellations are charged 50%; no-shows are charged in full.
                  </p>
                  {paymentText && (
                    <p>
                      <span className="font-semibold text-ink-800">Payment:</span> {paymentText}
                    </p>
                  )}
                </div>
              </section>
            </div>

            {/* Treatments & prices */}
            <section id="treatments" aria-labelledby="treatments-heading" className="scroll-mt-24">
              <HighlightHeading id="treatments-heading">Treatments &amp; prices</HighlightHeading>
              <p className="mt-2 text-[13.5px] text-ink-500">
                Prices in {spa.provider.baseCurrency}. Availability is live per therapist.
              </p>

              <div className="mt-4 space-y-4">
                {spa.treatments.map((t) => {
                  const from = t.branchPrices[0]!;
                  return (
                    <article
                      key={t.id}
                      className="flex flex-col gap-4 rounded-3xl border border-ink-100 bg-white p-5 transition hover:border-brand-200 hover:shadow-sm sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 max-w-2xl">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[17px] font-semibold text-ink-900">{t.name}</h3>
                          <Badge tone="brand">{CATEGORY_LABELS[t.category] ?? t.category}</Badge>
                        </div>
                        {t.description && (
                          <p className="mt-1.5 line-clamp-3 text-[13.5px] leading-relaxed text-ink-600">
                            {stripHtml(t.description)}
                          </p>
                        )}
                        {t.benefits.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {t.benefits.slice(0, 3).map((b) => (
                              <span
                                key={b}
                                className="rounded-md bg-sand-100 px-2 py-0.5 text-[11.5px] text-ink-600"
                              >
                                {b}
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="mt-2.5 text-[12.5px] text-ink-400">{t.durationMin} minutes</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-start gap-2.5 sm:items-end">
                        <p className="text-xl font-bold text-ink-900">
                          {formatMoney(from.price, spa.provider.baseCurrency)}
                        </p>
                        <Link
                          href={`/spas/${slug}/${from.branchSlug}?treatment=${t.id}`}
                          className={`${GREEN_BTN} h-9 px-4 text-[13px]`}
                        >
                          Book this treatment
                        </Link>
                      </div>
                    </article>
                  );
                })}
                {spa.treatments.length === 0 && (
                  <p className="rounded-3xl border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
                    Menu coming soon.
                  </p>
                )}
              </div>
            </section>

            {/* Reviews */}
            <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24">
              <h2 id="reviews-heading" className="text-2xl text-ink-900">
                Reviews{' '}
                <span className="text-[17px] font-normal text-ink-400">
                  ({spa.rating?.count ?? 0})
                </span>
              </h2>
              <div className="mt-4 space-y-3">
                {spa.reviews.map((r) => (
                  <article
                    key={r.id}
                    className="rounded-3xl border border-ink-100 bg-white p-4 sm:p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[15px] font-semibold text-brand-700">
                          {r.guestName.trim().charAt(0).toUpperCase() || 'G'}
                        </span>
                        <div>
                          <p className="text-[14.5px] font-medium text-ink-800">{r.guestName}</p>
                          <p className="text-[12.5px] text-ink-400">
                            {formatDate(r.createdAt)} ·{' '}
                            {r.bookingId ? 'Verified booking' : 'Guest review'}
                          </p>
                        </div>
                      </div>
                      <Stars value={r.rating} />
                    </div>
                    {r.comment && (
                      <p className="mt-3 text-[14px] leading-relaxed text-ink-600">{r.comment}</p>
                    )}
                  </article>
                ))}
                {spa.reviews.length === 0 && (
                  <p className="rounded-3xl border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
                    No reviews yet — leave one after your visit.
                  </p>
                )}
              </div>
            </section>

            {/* Related spas */}
            {related.length > 0 && (
              <section aria-labelledby="related-heading">
                <h2 id="related-heading" className="text-2xl text-ink-900">
                  Related Spa - More Spa Experiences to Explore
                </h2>
                <p className="mt-1.5 text-[14px] text-ink-500">
                  Discover more exceptional spas, wellness retreats, and beauty treatments tailored
                  to your preferences.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {related.map((s, i) => (
                    <SpaCard key={s.slug} spa={s} index={i} />
                  ))}
                </div>
              </section>
            )}
          </main>

          {/* ------------------------------ sidebar --------------------------- */}
          <aside className="w-full shrink-0 space-y-4 lg:sticky lg:top-24 lg:w-96 lg:self-start">
            {/* Starting from */}
            {spa.minPrice !== null && main && (
              <div className="rounded-3xl border border-ink-100 bg-white p-5">
                <p className="text-[13px] text-ink-500">Starting from</p>
                <p className="mt-1 text-3xl font-bold text-ink-900">
                  {formatMoney(spa.minPrice, spa.provider.baseCurrency)}
                </p>
                {bookHref && (
                  <Link href={bookHref} className={`${GREEN_BTN} mt-4 h-11 w-full text-sm`}>
                    Check availability
                  </Link>
                )}
              </div>
            )}

            {/* Location — every spa business (outlet) */}
            <div className="rounded-3xl border border-ink-100 bg-white p-5">
              <h3 className="text-[15px] font-semibold text-ink-900">Location</h3>
              {spa.branches.length > 0 ? (
                <>
                  <div className="mt-3 space-y-3">
                    {spa.branches.map((b, i) => {
                      const bLat = b.lat ? Number(b.lat) : null;
                      const bLng = b.lng ? Number(b.lng) : null;
                      const bHasCoords =
                        bLat !== null && bLng !== null && Number.isFinite(bLat) && Number.isFinite(bLng);
                      const bMapsHref =
                        b.googleMapsUrl ??
                        (bHasCoords
                          ? `https://www.google.com/maps/search/?api=1&query=${bLat},${bLng}`
                          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                              [b.addressLine, b.city, b.country].filter(Boolean).join(', '),
                            )}`);
                      return (
                        <div key={b.id} className={i === 0 ? '' : 'border-t border-ink-100 pt-3'}>
                          <Link
                            href={`/spas/${slug}/${b.slug}`}
                            className="text-[14px] font-medium text-ink-800 hover:text-brand-700"
                          >
                            {b.name}
                          </Link>
                          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-600">
                            {b.addressLine}
                            <br />
                            {[b.city, b.region, b.country].filter(Boolean).join(', ')}
                          </p>
                          <a
                            href={bMapsHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand-700 hover:underline"
                          >
                            <MapPin className="size-3.5" /> Open in Google Maps
                          </a>
                        </div>
                      );
                    })}
                  </div>
                  {mapSrc && (
                    <div className="mt-3 overflow-hidden rounded-2xl border border-ink-100">
                      <iframe
                        src={mapSrc}
                        title={`Map of ${spa.provider.name}`}
                        loading="lazy"
                        className="h-44 w-full border-0"
                      />
                    </div>
                  )}
                </>
              ) : (
                <p className="mt-2 text-[13.5px] text-ink-500">Location coming soon.</p>
              )}
            </div>

            {/* Members */}
            {!user && (
              <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-ink-900">
                  <Sparkles className="size-4 text-amber-500" /> Members book smarter
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-600">
                  Sign in and the 5% platform service fee is{' '}
                  <span className="font-semibold text-ink-800">waived</span> on your booking —
                  that&apos;s real savings at this spa and every other on Book Your Spa.
                </p>
                <div className="mt-3 flex gap-2">
                  <Link
                    href={`/login?next=/spas/${slug}`}
                    className={`${GREEN_BTN} h-9 px-4 text-[13px]`}
                  >
                    Sign free
                  </Link>
                  <Link
                    href="/register"
                    className="inline-flex h-9 items-center justify-center rounded-xl border border-ink-200 bg-white px-4 text-[13px] font-medium text-ink-700 transition hover:border-ink-300 hover:bg-sand-50"
                  >
                    Create account
                  </Link>
                </div>
              </div>
            )}

            {/* Claim this spa */}
            {claimState && (
              <ClaimSpaCard providerId={spa.provider.id} slug={slug} state={claimState} />
            )}

            {/* Enquiry */}
            <div className="rounded-3xl border border-dashed border-ink-200 bg-white p-4 text-center">
              <p className="text-[13px] leading-relaxed text-ink-600">
                Still interested in this spa? Send your request and our team will help you{' '}
                {spa.provider.ownerId ? 'get the most out of it.' : 'get it claimed and live.'}
              </p>
              <a
                href={`mailto:${supportEmail}`}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[13px] font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-700"
              >
                <Mail className="size-3.5" /> {supportEmail}
              </a>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

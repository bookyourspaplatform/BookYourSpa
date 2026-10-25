import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Mail, MapPin, Sparkles, Star } from 'lucide-react';
import { getDb } from '@/db';
import {
  getBranchDetail,
  listSpas,
  CATEGORY_LABELS,
  SPA_CATEGORY_LABELS,
  SPA_FACILITY_LABELS,
  SPA_TYPE_LABELS,
  GENRE_LABELS,
  DELIVERY_TYPE_LABELS,
} from '@/lib/catalog';
import { branchOptionPrice } from '@/lib/pricing';
import { getCurrentUser } from '@/lib/auth/session';
import { findClaimForUser } from '@/lib/claims';
import { getSettings } from '@/lib/settings';
import { sanitizeRichText, stripHtml } from '@/lib/security';
import { appUrl, breadcrumbJsonLd, daySpaJsonLd, pageMetadata, treatmentJsonLd } from '@/lib/seo';
import { JsonLd } from '@/components/json-ld';
import { Badge } from '@/components/ui/badge';
import { GREEN_BTN } from '@/components/ui/classes';
import { formatMoney } from '@/lib/money';
import { dateKeyInTz, formatDate } from '@/lib/utils';
import { SpaCard, priceLevel } from '@/components/site/spa-card';
import { TreatmentSelectList } from '@/components/site/treatment-select-list';
import { ClaimSpaCard, type ClaimSpaState } from '@/components/site/claim-spa-card';

export const dynamic = 'force-dynamic';

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

function initialsOf(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function HighlightHeading({ id, children }: { id?: string; children: React.ReactNode }) {
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
  return pageMetadata({
    title: `${b.name} — ${b.city}`,
    description:
      b.shortDescription?.trim() ||
      `${b.name} in ${b.city}. View treatments, prices and therapists, check live availability and book instantly.`,
    path: `/spas/${slug}/${branch}`,
    keywords: [`${b.city} spa`, `${b.city} massage`, b.name],
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
  const { treatments, therapistList, promos, rating, reviews } = detail;
  const base = await appUrl('');
  const url = `${base}/spas/${slug}/${branch}`;

  const settings = await getSettings();
  const user = await getCurrentUser();
  const cancelHours = settings['booking.cancellationHours'];
  const supportEmail = settings['site.supportEmail'];

  const today = new Date();
  const todayKey = dateKeyInTz(today, b.timezone);
  const todayIdx = new Date(`${todayKey}T12:00:00Z`).getUTCDay();

  const jsonLd = [
    daySpaJsonLd({
      name: b.name,
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
        providerName: b.name,
      }),
    ),
  ];

  /* ---------- title block values ---------- */
  const categoryKey = b.categories[0] ?? b.spaTypes[0] ?? null;
  const categoryLabel = categoryKey
    ? SPA_CATEGORY_LABELS[categoryKey] ??
      SPA_TYPE_LABELS[categoryKey] ??
      CATEGORY_LABELS[categoryKey] ??
      categoryKey
    : null;
  const countryName = COUNTRY_NAMES[b.country] ?? b.country;
  const locationText = [b.city, b.region, countryName].filter(Boolean).join(', ');
  const minPrice = treatments.length ? Math.min(...treatments.map((t) => t.price)) : null;
  const level = priceLevel(minPrice, b.currency);
  const featured = detail.featured;
  const tagline = b.tagline?.trim() || null;
  const intro = b.shortDescription?.trim() || null;

  /* ---------- gallery ---------- */
  const gallery = [
    ...b.images,
    ...treatments.map((t) => t.imageUrl),
  ]
    .filter((src): src is string => Boolean(src))
    .filter((src, i, arr) => arr.indexOf(src) === i);
  const photos = gallery.slice(0, 5);
  const sidePhotos = photos.slice(1, 5);
  const extraPhotos = Math.max(0, gallery.length - photos.length);
  const gradient = GRADIENTS[slug.length % GRADIENTS.length];

  /* ---------- facilities ---------- */
  const facilities = [...new Set(b.facilities)];

  /* ---------- hours (today highlighted) ---------- */
  const hourRows = DAY_LABELS.map((label, day) => {
    const h = b.hours.find((x) => x.day === day);
    const open = Boolean(h && !h.closed);
    return {
      label,
      open,
      text: open ? `${h!.open} – ${h!.close}` : 'Closed',
      today: day === todayIdx,
    };
  });

  const paymentText = [...new Set(b.paymentMethods)]
    .map((m) => PAYMENT_LABELS[m] ?? m)
    .join(', ');

  /* ---------- map ---------- */
  const lat = b.lat ? Number(b.lat) : null;
  const lng = b.lng ? Number(b.lng) : null;
  const hasCoords = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng);
  const mapsHref =
    b.googleMapsUrl ??
    (hasCoords
      ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          [b.addressLine, b.city, b.country].filter(Boolean).join(', '),
        )}`);

  /* ---------- claim + related ---------- */
  const myClaim =
    user && !b.provider.ownerId ? await findClaimForUser(db, b.provider.id, user.id) : null;
  const claimState: ClaimSpaState | null = b.provider.ownerId
    ? null
    : !user
      ? 'signed_out'
      : myClaim
        ? 'pending'
        : 'ready';

  const related = (await listSpas(db, { pageSize: 48, sort: 'featured' }))
    .items.filter((s) => s.id !== b.id)
    .sort((x, y) => Number(y.country === b.country) - Number(x.country === b.country))
    .slice(0, 3);

  const bookHref = `/spas/${slug}/${branch}/book`;

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
                  alt={`${b.name} — photo`}
                  className="absolute inset-0 size-full object-cover"
                />
              ) : (
                <div
                  className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${gradient}`}
                >
                  <span className="font-display text-6xl text-white/90">
                    {initialsOf(b.name)}
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
                {featured && <Badge tone="warning">Featured</Badge>}
              </p>

              <h1 className="mt-2 text-4xl font-bold leading-[1.06] tracking-tight text-ink-900 sm:text-5xl">
                {b.name}
              </h1>
              {tagline && (
                <p className="mt-2 text-[17px] font-semibold text-ink-800">{tagline}</p>
              )}
              {intro && (
                <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-ink-600">{intro}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[14.5px]">
                {rating ? (
                  <>
                    <span className="flex items-center gap-1.5">
                      <Stars value={rating.avg} />
                      <span className="font-semibold text-ink-800">{rating.avg.toFixed(1)}</span>
                      <a
                        href="#reviews"
                        className="text-ink-500 underline-offset-2 hover:text-brand-700 hover:underline"
                      >
                        ({rating.count} reviews)
                      </a>
                    </span>
                    {minPrice !== null && (
                      <span className="text-ink-500">
                        From{' '}
                        <span className="font-semibold text-ink-800">
                          {formatMoney(minPrice, b.currency)}
                        </span>
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-ink-400">New · no reviews yet</span>
                    {minPrice !== null && (
                      <span className="text-ink-500">
                        From{' '}
                        <span className="font-semibold text-ink-800">
                          {formatMoney(minPrice, b.currency)}
                        </span>
                      </span>
                    )}
                  </>
                )}
              </div>
            </header>

            {/* Offers */}
            {promos.length > 0 && (
              <section
                className="rounded-3xl border border-clay-200 bg-clay-50/60 p-4 sm:p-5"
                aria-label="Current offers"
              >
                <ul className="space-y-3.5">
                  {promos.slice(0, 3).map((p) => (
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
            {(b.description || facilities.length > 0) && (
              <section aria-labelledby="about-heading">
                <HighlightHeading id="about-heading">About {b.name}</HighlightHeading>
                {b.description && (
                  <div className="mt-4 max-w-3xl text-[15px] leading-relaxed text-ink-600 [&_a]:text-brand-700 [&_a]:underline [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-0.5 [&_p]:my-2.5 [&_ul]:list-disc [&_ul]:pl-5">
                    <div dangerouslySetInnerHTML={{ __html: sanitizeRichText(b.description) }} />
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
              {hourRows.length > 0 && (
                <section aria-labelledby="hours-heading">
                  <h2 id="hours-heading" className="text-xl font-semibold text-ink-900">
                    Opening hours
                  </h2>
                  <ul className="mt-3 text-[13.5px]">
                    {hourRows.map((r) => (
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
                Prices in {b.currency}. Availability is live per therapist.
              </p>

              <TreatmentSelectList
                currency={b.currency}
                bookHref={`/spas/${slug}/${branch}/book`}
                highlightedId={highlightTreatment ?? null}
                treatments={treatments.map((t) => ({
                  id: t.id,
                  name: t.name,
                  description: t.description ? stripHtml(t.description) : null,
                  benefits: t.benefits,
                  // Only recognised spa-type tags are shown; legacy free-form
                  // tags fall back to the treatment's category badge.
                  tagLabels: t.tags
                    .filter((tag) => Boolean(SPA_TYPE_LABELS[tag]))
                    .slice(0, 4)
                    .map((tag) => SPA_TYPE_LABELS[tag]!),
                  categoryLabel: CATEGORY_LABELS[t.category] ?? t.category,
                  genreLabel: t.genre === 'both' ? null : (GENRE_LABELS[t.genre] ?? t.genre),
                  deliveryLabel:
                    t.deliveryType === 'both'
                      ? null
                      : (DELIVERY_TYPE_LABELS[t.deliveryType] ?? t.deliveryType),
                  durationMin: t.durationMin,
                  price: t.price,
                  // Duration tiers re-based onto this branch's own price, so
                  // what guests see here matches what checkout charges.
                  options: (t.priceOptions ?? []).length
                    ? (t.priceOptions ?? []).map((o, i) => ({
                        index: i,
                        durationMin: o.durationMin,
                        price: branchOptionPrice(o, t.listPrice, t.price),
                      }))
                    : [{ index: 0, durationMin: t.durationMin, price: t.price }],
                }))}
              />
              {treatments.length === 0 && (
                <p className="mt-4 rounded-3xl border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
                  Menu coming soon.
                </p>
              )}
            </section>

            {/* Therapists — only when the spa business shows its team online */}
            {b.showTherapistOnline && therapistList.length > 0 && (
              <section aria-labelledby="team-heading">
                <h2 id="team-heading" className="text-2xl text-ink-900">
                  Therapists
                </h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {therapistList.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-start gap-3 rounded-3xl border border-ink-100 bg-white p-4"
                    >
                      {t.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- staff photo uploaded by the spa
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
                        {t.bio && (
                          <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-500">{t.bio}</p>
                        )}
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {t.specialties.map((s) => (
                            <span
                              key={s}
                              className="rounded-full bg-sand-100 px-2 py-0.5 text-[11px] text-ink-600"
                            >
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

            {/* Reviews */}
            <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24">
              <h2 id="reviews-heading" className="text-2xl text-ink-900">
                Reviews{' '}
                <span className="text-[17px] font-normal text-ink-400">
                  ({rating?.count ?? 0})
                </span>
              </h2>
              <div className="mt-4 space-y-3">
                {reviews.map((r) => (
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
                {reviews.length === 0 && (
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
                    <SpaCard key={s.id} spa={s} index={i} />
                  ))}
                </div>
              </section>
            )}
          </main>

          {/* ------------------------------ sidebar --------------------------- */}
          <aside className="w-full shrink-0 space-y-4 lg:sticky lg:top-24 lg:w-96 lg:self-start">
            {/* Starting from */}
            {minPrice !== null && (
              <div className="rounded-3xl border border-ink-100 bg-white p-5">
                <p className="text-[13px] text-ink-500">Starting from</p>
                <p className="mt-1 text-3xl font-bold text-ink-900">
                  {formatMoney(minPrice, b.currency)}
                </p>
                <Link href={bookHref} className={`${GREEN_BTN} mt-4 h-11 w-full text-sm`}>
                  Check availability
                </Link>
              </div>
            )}

            {/* Location */}
            <div className="rounded-3xl border border-ink-100 bg-white p-5">
              <h3 className="text-[15px] font-semibold text-ink-900">Location</h3>
              <p className="mt-3 text-[13.5px] leading-relaxed text-ink-600">
                {b.addressLine}
                <br />
                {[b.city, b.region, b.country].filter(Boolean).join(', ')}
              </p>
              {hasCoords && (
                <iframe
                  title={`Map of ${b.name}`}
                  src={`https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`}
                  loading="lazy"
                  className="mt-3 h-44 w-full rounded-xl border-0"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              )}
              <a
                href={mapsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand-700 hover:underline"
              >
                <MapPin className="size-3.5" /> Open in Google Maps
              </a>
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
                    href={`/login?next=/spas/${slug}/${branch}`}
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
              <ClaimSpaCard
                providerId={b.provider.id}
                slug={`${slug}/${branch}`}
                state={claimState}
              />
            )}

            {/* Enquiry */}
            <div className="rounded-3xl border border-dashed border-ink-200 bg-white p-4 text-center">
              <p className="text-[13px] leading-relaxed text-ink-600">
                Still interested in this spa? Send your request and our team will help you{' '}
                {b.provider.ownerId ? 'get the most out of it.' : 'get it claimed and live.'}
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

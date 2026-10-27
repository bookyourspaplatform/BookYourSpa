import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { getDb } from '@/db';
import { products as productsTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getBranchDetail } from '@/lib/catalog';
import { redeemablePromotionsFor } from '@/lib/booking';
import { DELIVERY_TYPE_LABELS, GENRE_LABELS, SPA_TYPE_LABELS } from '@/lib/catalog';
import { branchOptionPrice } from '@/lib/pricing';
import { getCurrentUser } from '@/lib/auth/session';
import { stripHtml } from '@/lib/security';
import { getSettings } from '@/lib/settings';
import { pageMetadata, breadcrumbJsonLd, appUrl } from '@/lib/seo';
import { JsonLd } from '@/components/json-ld';
import { BookingWizard } from '@/components/booking/booking-wizard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string; branch: string }> }): Promise<Metadata> {
  const { slug, branch } = await params;
  return pageMetadata({
    title: `Book an appointment — ${slug} ${branch}`,
    description: 'Choose a treatment, therapist and time, then confirm your reservation.',
    path: `/spas/${slug}/${branch}/book`,
    noIndex: true,
  });
}

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; branch: string }>;
  searchParams: Promise<{
    treatment?: string;
    treatments?: string;
    option?: string;
    persons?: string;
    cancelled?: string;
  }>;
}) {
  const { slug, branch: branchSlug } = await params;
  const sp = await searchParams;

  const db = await getDb();
  const detail = await getBranchDetail(db, slug, branchSlug);
  if (!detail) notFound();

  const b = detail.branch;
  const user = await getCurrentUser();
  const settings = await getSettings();

  /*
   * Pre-picked treatments come from two links:
   *   ?treatment=id&option=n   — legacy single-treatment link (per-tier Book buttons)
   *   ?treatments=a,b,c        — the spa page's multi-select
   * Unknown ids are dropped; duplicates collapse; the wizard caps carts at 8.
   */
  const known = new Set(detail.treatments.map((t) => t.id));
  const spaPickedIds = (sp.treatments ?? '').split(',').filter(Boolean);
  const requestedIds = [
    ...spaPickedIds,
    ...(sp.treatment ? [sp.treatment] : []),
  ].filter((id) => known.has(id));
  // Guest counts travel alongside the id list (?persons=2,1) — same order.
  const personsParts = (sp.persons ?? '').split(',');
  const personsById = new Map<string, number>();
  spaPickedIds.forEach((id, i) => {
    const n = Number(personsParts[i]);
    if (Number.isInteger(n) && n >= 1 && n <= 8) personsById.set(id, n);
  });
  const optionIdx = sp.option === undefined ? Number.NaN : Number(sp.option);
  const preselectedItems = [...new Set(requestedIds)].slice(0, 8).map((id) => {
    const row = detail.treatments.find((t) => t.id === id)!;
    // The legacy ?option= hint only applies to the legacy ?treatment= link.
    const legacy = id === sp.treatment;
    const optionIndex =
      legacy && Number.isInteger(optionIdx) && optionIdx >= 0 && optionIdx < (row.priceOptions?.length ?? 0)
        ? optionIdx
        : null;
    return { treatmentId: id, optionIndex, persons: personsById.get(id) ?? 1 };
  });

  const base = `/spas/${slug}/${branchSlug}`;

  // Retail products sold at this branch — bookable alongside treatments.
  const productList = await db.query.products.findMany({
    where: eq(productsTable.branchId, b.id),
    columns: { id: true, name: true, description: true, price: true, active: true },
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  const branchProducts = productList.filter((p) => p.active);

  // Codes this customer can redeem at this spa: the supplier's own promotions,
  // admin promotions the spa has activated, and admin promo codes — each with
  // its effective treatment scope, so the wizard shows what the code covers.
  const availablePromotions = (
    await redeemablePromotionsFor(db, { providerId: b.providerId, branchId: b.id, now: new Date() })
  ).map((p) => ({
    id: p.id,
    title: p.title,
    summary: p.summary,
    code: p.code,
    discountLabel: p.discountLabel,
    treatmentIds: p.treatmentIds.length ? p.treatmentIds : null,
    validFromHour: p.validFromHour,
    validUntilHour: p.validUntilHour,
  }));

  const jsonLd = breadcrumbJsonLd(
    [
      { name: 'Home', path: '/' },
      { name: 'Spas', path: '/spas' },
      { name: b.name, path: base },
      { name: 'Book', path: `${base}/book` },
    ],
    await appUrl(''),
  );

  return (
    <>
      <JsonLd data={jsonLd} />

      <div className="border-b border-ink-100 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <nav className="text-[13px] text-ink-500" aria-label="Breadcrumb">
            <Link href="/spas" className="hover:underline">
              Spas
            </Link>{' '}
            ·{' '}
            <Link href={base} className="hover:underline">
              {b.name}
            </Link>{' '}
            · <span className="font-semibold text-ink-900">Booking</span>
          </nav>
          <h1 className="sr-only">Book at {b.name}</h1>
        </div>
      </div>

      {sp.cancelled && (
        <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-800">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <p>Payment was cancelled — pick a time again and you can retry. Any previous hold releases automatically.</p>
          </div>
        </div>
      )}

      <BookingWizard
        providerSlug={slug}
        branch={{
          id: b.id,
          slug: b.slug,
          name: b.name,
          city: b.city,
          timezone: b.timezone,
          currency: b.currency,
          paymentMethods: b.paymentMethods,
          onlinePaymentEnabled: b.onlinePaymentEnabled,
          cancellationHours: settings['booking.cancellationHours'],
          leadTimeMinutes: b.leadTimeMinutes,
          maxAdvanceDays: b.maxAdvanceDays,
        }}
        treatments={detail.treatments.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description ? stripHtml(t.description) : '',
          durationMin: t.durationMin,
          price: t.price,
          // Branch-priced duration tiers — identical to what the spa page shows.
          priceOptions: (t.priceOptions ?? []).map((o) => ({
            durationMin: o.durationMin,
            price: branchOptionPrice(o, t.listPrice, t.price),
            capacity: o.capacity ?? t.capacity,
          })),
          category: t.category,
          requiresTherapist: t.requiresTherapist,
          // Couples / four-hand treatments seat a team — shown as a chip and
          // handled by the availability engine + checkout.
          therapistsPerBooking: t.therapistsPerBooking ?? 1,
          capacity: t.capacity,
          benefits: t.benefits,
          // Chip labels resolved here so the wizard stays display-only.
          tags: t.tags
            .map((tag) => SPA_TYPE_LABELS[tag])
            .filter((label): label is string => Boolean(label))
            .slice(0, 4),
          genreLabel: t.genre === 'both' ? null : (GENRE_LABELS[t.genre] ?? t.genre),
          deliveryLabel:
            t.deliveryType === 'both' ? null : (DELIVERY_TYPE_LABELS[t.deliveryType] ?? t.deliveryType),
        }))}
        products={branchProducts.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price: p.price,
        }))}
        therapists={
          b.showTherapistOnline
            ? detail.therapistList.map((t) => ({
                id: t.id,
                name: t.name,
                specialties: t.specialties,
                avatarUrl: t.avatarUrl,
              }))
            : []
        }
        preselectedItems={preselectedItems}
        availablePromotions={availablePromotions}
        user={
          user
            ? { name: user.name, email: user.email, phone: user.phone ?? '', role: user.role }
            : null
        }
        guestCheckout={settings['features.guestCheckout']}
      />
    </>
  );
}

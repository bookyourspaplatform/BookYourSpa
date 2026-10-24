import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { getDb } from '@/db';
import { products as productsTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getBranchDetail } from '@/lib/catalog';
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
  searchParams: Promise<{ treatment?: string; option?: string; cancelled?: string }>;
}) {
  const { slug, branch: branchSlug } = await params;
  const sp = await searchParams;

  const db = await getDb();
  const detail = await getBranchDetail(db, slug, branchSlug);
  if (!detail) notFound();

  const b = detail.branch;
  const user = await getCurrentUser();
  const settings = await getSettings();

  const preselectedRow =
    sp.treatment && detail.treatments.some((t) => t.id === sp.treatment)
      ? detail.treatments.find((t) => t.id === sp.treatment)!
      : null;
  const preselected = preselectedRow?.id ?? null;
  const optionIdx = sp.option === undefined ? Number.NaN : Number(sp.option);
  const preselectedOptionIndex =
    preselectedRow &&
    Number.isInteger(optionIdx) &&
    optionIdx >= 0 &&
    optionIdx < (preselectedRow.priceOptions?.length ?? 0)
      ? optionIdx
      : null;

  const base = `/spas/${slug}/${branchSlug}`;

  // Retail products sold at this branch — bookable alongside treatments.
  const productList = await db.query.products.findMany({
    where: eq(productsTable.branchId, b.id),
    columns: { id: true, name: true, description: true, price: true, active: true },
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  const branchProducts = productList.filter((p) => p.active);

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
              }))
            : []
        }
        preselectedTreatmentId={preselected}
        preselectedOptionIndex={preselectedOptionIndex}
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

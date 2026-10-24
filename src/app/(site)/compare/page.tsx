import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { branchTreatments } from '@/db/schema';
import { CATEGORY_LABELS } from '@/lib/catalog';
import { pageMetadata, breadcrumbJsonLd, appUrl } from '@/lib/seo';
import { JsonLd } from '@/components/json-ld';
import { CompareClient } from '@/components/site/compare-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: 'Compare treatments & prices',
    description:
      'Compare massage, facial and wellness treatments across spas in Bali, Dubai and beyond — durations, prices and direct booking.',
    path: '/compare',
  });
}

export default async function ComparePage() {
  const db = await getDb();

  const rows = await db.query.branchTreatments.findMany({
    where: eq(branchTreatments.active, true),
    with: {
      treatment: true,
      branch: {
        columns: { id: true, name: true, slug: true, city: true, country: true, currency: true, status: true },
        with: { provider: { columns: { name: true, slug: true, status: true } } },
      },
    },
  });

  const offers = rows
    .filter(
      (r) =>
        r.treatment &&
        r.treatment.status === 'active' &&
        r.branch.status === 'active' &&
        r.branch.provider.status === 'approved',
    )
    .map((r) => ({
      treatmentId: r.treatment!.id,
      name: r.treatment!.name,
      category: r.treatment!.category,
      durationMin: r.treatment!.durationMin,
      requiresTherapist: r.treatment!.requiresTherapist,
      price: r.price,
      currency: r.branch.currency,
      branch: {
        name: r.branch.name,
        slug: r.branch.slug,
        city: r.branch.city,
        country: r.branch.country,
      },
      provider: { slug: r.branch.provider.slug },
    }))
    .sort((a, b) => a.price - b.price);

  const categories = [...new Set(offers.map((o) => o.category))].sort();
  const cities = [...new Set(offers.map((o) => o.branch.city))].sort();

  const jsonLd = breadcrumbJsonLd(
    [
      { name: 'Home', path: '/' },
      { name: 'Spas', path: '/spas' },
      { name: 'Compare treatments', path: '/compare' },
    ],
    await appUrl(''),
  );

  return (
    <>
      <JsonLd data={jsonLd} />
      <div className="border-b border-ink-100 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <h1 className="text-2xl sm:text-3xl">Compare treatments</h1>
          <p className="mt-1.5 max-w-2xl text-[15px] text-ink-500">
            {offers.length} treatments across our spa partners — sort by price or duration and jump
            straight into booking.
          </p>
        </div>
      </div>

      <CompareClient
        offers={offers}
        categories={categories.map((c) => ({ id: c, label: CATEGORY_LABELS[c] ?? c }))}
        cities={cities}
      />
    </>
  );
}

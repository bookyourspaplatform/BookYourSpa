import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { branchTreatments, branches, treatments } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { pageMetadata } from '@/lib/seo';
import { TreatmentManager, type TreatmentRow } from '@/components/provider/treatment-manager';
import { PriceMatrix } from '@/components/provider/price-matrix';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Treatments', description: 'Menu & prices.', path: '/provider/treatments', noIndex: true });
}

export default async function ProviderTreatmentsPage() {
  const user = (await getCurrentUser())!;
  const providerId = user.provider!.id;
  const db = await getDb();

  const [treatmentRows, branchRows, cellRows] = await Promise.all([
    db.query.treatments.findMany({
      where: eq(treatments.providerId, providerId),
      orderBy: [treatments.category, treatments.name],
    }),
    db.query.branches.findMany({
      where: eq(branches.providerId, providerId),
      orderBy: [branches.name],
      columns: { id: true, name: true, currency: true },
    }),
    db
      .select({
        id: branchTreatments.id,
        branchId: branchTreatments.branchId,
        treatmentId: branchTreatments.treatmentId,
        price: branchTreatments.price,
        active: branchTreatments.active,
      })
      .from(branchTreatments)
      .innerJoin(branches, eq(branchTreatments.branchId, branches.id))
      .where(eq(branches.providerId, providerId)),
  ]);

  // Branch-local counts per treatment (for the menu list).
  const branchCountByTreatment = new Map<string, number>();
  for (const c of cellRows) {
    if (!c.active) continue;
    branchCountByTreatment.set(c.treatmentId, (branchCountByTreatment.get(c.treatmentId) ?? 0) + 1);
  }

  const menuRows: TreatmentRow[] = treatmentRows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    durationMin: t.durationMin,
    listPrice: t.listPrice,
    currency: t.currency,
    requiresTherapist: t.requiresTherapist,
    capacity: t.capacity,
    agentApproved: t.agentApproved,
    tags: t.tags ?? [],
    genre: t.genre,
    deliveryType: t.deliveryType,
    priceOptions: t.priceOptions ?? [],
    status: t.status,
    branchCount: branchCountByTreatment.get(t.id) ?? 0,
  }));

  const currency = branchRows[0]?.currency ?? 'IDR';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl">Treatments & prices</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          One catalog, per-branch pricing. Every treatment needs a price at a branch before customers can book it there.
        </p>
      </div>

      <TreatmentManager treatments={menuRows} currency={currency} />

      <PriceMatrix
        branches={branchRows.map((b) => ({ id: b.id, name: b.name }))}
        treatments={treatmentRows.map((t) => ({ id: t.id, name: t.name, durationMin: t.durationMin, listPrice: t.listPrice }))}
        cells={cellRows}
        currency={currency}
      />
    </div>
  );
}

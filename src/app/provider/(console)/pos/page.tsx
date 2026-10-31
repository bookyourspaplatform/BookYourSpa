import type { Metadata } from 'next';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  bookings,
  branchTreatments,
  branches,
  products,
  therapists,
  treatments,
} from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { getSetting } from '@/lib/settings';
import { pageMetadata } from '@/lib/seo';
import {
  PosClient,
  type PosBranch,
  type PosProduct,
  type PosSaleRow,
  type PosStaff,
  type PosTreatment,
} from '@/components/provider/pos-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: 'Point of sale',
    description: 'Walk-in checkout for the front desk.',
    path: '/provider/pos',
    noIndex: true,
  });
}

export default async function PosPage() {
  const user = (await getCurrentUser())!;
  const providerId = user.provider!.id;
  const db = await getDb();

  const branchRows = await db.query.branches.findMany({
    where: eq(branches.providerId, providerId),
    orderBy: [branches.name],
    columns: { id: true, name: true, currency: true, timezone: true },
  });
  const branchIds = branchRows.map((b) => b.id);

  const [staffRows, treatmentRows, cellRows, productRows, saleRows, commissionBps] =
    await Promise.all([
      branchIds.length
        ? db.query.therapists.findMany({
            where: inArray(therapists.branchId, branchIds),
            columns: {
              id: true,
              branchId: true,
              name: true,
              avatarUrl: true,
              role: true,
              salaryType: true,
              salaryValue: true,
              incentiveType: true,
              incentiveValue: true,
              active: true,
            },
          })
        : Promise.resolve([]),
      db.query.treatments.findMany({
        where: and(eq(treatments.providerId, providerId), eq(treatments.status, 'active')),
        columns: {
          id: true,
          name: true,
          durationMin: true,
          listPrice: true,
          requiresTherapist: true,
          therapistsPerBooking: true,
          priceOptions: true,
        },
        orderBy: [treatments.name],
      }),
      branchIds.length
        ? db
            .select({
              branchId: branchTreatments.branchId,
              treatmentId: branchTreatments.treatmentId,
              price: branchTreatments.price,
              active: branchTreatments.active,
            })
            .from(branchTreatments)
            .where(inArray(branchTreatments.branchId, branchIds))
        : Promise.resolve([]),
      branchIds.length
        ? db.query.products.findMany({
            where: inArray(products.branchId, branchIds),
            columns: { id: true, branchId: true, name: true, price: true, active: true },
            orderBy: [products.name],
          })
        : Promise.resolve([]),
      db.query.bookings.findMany({
        where: and(eq(bookings.providerId, providerId), eq(bookings.channel, 'pos')),
        orderBy: [desc(bookings.startAt)],
        limit: 150,
        with: {
          treatment: { columns: { name: true, therapistsPerBooking: true } },
          therapist: { columns: { name: true } },
        },
      }),
      getSetting('finance.posCommissionBps'),
    ]);

  const branchList: PosBranch[] = branchRows;
  const staff: PosStaff[] = staffRows.filter((s) => s.active);
  const productList: PosProduct[] = productRows
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, branchId: p.branchId, name: p.name, price: p.price }));

  const treatmentList: PosTreatment[] = treatmentRows.map((t) => ({
    id: t.id,
    name: t.name,
    durationMin: t.durationMin,
    listPrice: t.listPrice,
    requiresTherapist: t.requiresTherapist,
    therapistsPerBooking: Math.max(1, t.therapistsPerBooking ?? 1),
    priceOptions: t.priceOptions ?? [],
    cells: cellRows.filter((c) => c.treatmentId === t.id),
  }));

  /* One sale can span several booking rows (one per therapist slot) — group them. */
  const groups = new Map<string, (typeof saleRows)[number]>();
  for (const b of saleRows) groups.set(b.groupId ?? b.id, b);

  const sales: PosSaleRow[] = [...groups.entries()].map(([key, first]) => {
    const rows = saleRows.filter((b) => (b.groupId ?? b.id) === key);
    const method = /POS · (\w+)/.exec(rows[0]?.notes ?? '')?.[1] ?? 'cash';
    return {
      id: first.id,
      code: first.code,
      branchId: first.branchId,
      guestName: first.guestName,
      treatmentName: (() => {
        // Rows are one per therapist slot — a 2-therapist treatment is 2 rows.
        const units = new Map<string, { rows: number; per: number }>();
        for (const r of rows) {
          const name = r.treatment?.name ?? 'Treatment';
          const per = Math.max(1, r.treatment?.therapistsPerBooking ?? 1);
          const found = units.get(name);
          if (found) found.rows += 1;
          else units.set(name, { rows: 1, per });
        }
        return [...units.entries()]
          .map(([name, u]) => {
            const qty = Math.max(1, Math.round(u.rows / u.per));
            return qty > 1 ? `${name} × ${qty}` : name;
          })
          .join(' + ');
      })(),
      staffName: rows.map((r) => r.therapist?.name).filter(Boolean).join(', ') || null,
      startAt: first.startAt.toISOString(),
      total: rows.reduce((sum, r) => sum + r.totalAmount, 0),
      platformFee: rows.reduce((sum, r) => sum + r.platformFee, 0),
      providerEarning: rows.reduce((sum, r) => sum + r.providerEarning, 0),
      currency: first.currency,
      method,
    };
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl">Point of sale</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Front desk and walk-in checkout — every sale is recorded as a paid booking, with{' '}
          {(commissionBps / 100).toFixed(1)}% platform commission.
        </p>
      </div>
      <PosClient
        branches={branchList}
        staff={staff}
        treatments={treatmentList}
        products={productList}
        sales={sales}
        commissionBps={commissionBps}
      />
    </div>
  );
}
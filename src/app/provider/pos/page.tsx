import type { Metadata } from 'next';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { bookings, branchTreatments, branches, therapists, treatments } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { getSetting } from '@/lib/settings';
import { pageMetadata } from '@/lib/seo';
import {
  PosClient,
  type PosBranch,
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

  const [staffRows, treatmentRows, cellRows, saleRows, commissionBps] = await Promise.all([
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
      columns: { id: true, name: true, durationMin: true },
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
    db.query.bookings.findMany({
      where: and(eq(bookings.providerId, providerId), eq(bookings.channel, 'pos')),
      orderBy: [desc(bookings.startAt)],
      limit: 50,
      with: {
        treatment: { columns: { name: true } },
        therapist: { columns: { name: true } },
      },
    }),
    getSetting('finance.posCommissionBps'),
  ]);

  const branches_: PosBranch[] = branchRows;
  const staff: PosStaff[] = staffRows.filter((s) => s.active);
  const treatmentList: PosTreatment[] = treatmentRows.map((t) => ({
    id: t.id,
    name: t.name,
    durationMin: t.durationMin,
    cells: cellRows.filter((c) => c.treatmentId === t.id),
  }));

  const sales: PosSaleRow[] = saleRows.map((b) => ({
    id: b.id,
    code: b.code,
    branchId: b.branchId,
    guestName: b.guestName,
    treatmentName: b.treatment?.name ?? 'Treatment',
    staffName: b.therapist?.name ?? null,
    startAt: b.startAt.toISOString(),
    total: b.totalAmount,
    platformFee: b.platformFee,
    providerEarning: b.providerEarning,
    currency: b.currency,
    method: ((): string => {
      const m = /POS · (\w+)/.exec(b.notes ?? '');
      return m?.[1] ?? 'cash';
    })(),
  }));

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
        branches={branches_}
        staff={staff}
        treatments={treatmentList}
        sales={sales}
        commissionBps={commissionBps}
      />
    </div>
  );
}

import type { Metadata } from 'next';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { branches, therapists, treatments, branchTreatments } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { pageMetadata } from '@/lib/seo';
import { BranchManager, type BranchRow } from '@/components/provider/branch-manager';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Branches', description: 'Manage your locations.', path: '/provider/branches', noIndex: true });
}

export default async function ProviderBranchesPage() {
  const user = (await getCurrentUser())!;
  const providerId = user.provider!.id;
  const db = await getDb();

  const [branchRows, treatmentCounts, therapistCounts] = await Promise.all([
    db.query.branches.findMany({
      where: eq(branches.providerId, providerId),
      orderBy: [branches.name],
    }),
    db
      .select({ branchId: branchTreatments.branchId, n: sql<number>`count(*)::int` })
      .from(branchTreatments)
      .innerJoin(branches, eq(branchTreatments.branchId, branches.id))
      .where(sql`${branches.providerId} = ${providerId} AND ${branchTreatments.active} = true`)
      .groupBy(branchTreatments.branchId),
    db
      .select({ branchId: therapists.branchId, n: sql<number>`count(*)::int` })
      .from(therapists)
      .innerJoin(branches, eq(therapists.branchId, branches.id))
      .where(sql`${branches.providerId} = ${providerId} AND ${therapists.active} = true`)
      .groupBy(therapists.branchId),
  ]);

  const rows: BranchRow[] = branchRows.map((b) => ({
    id: b.id,
    name: b.name,
    addressLine: b.addressLine,
    city: b.city,
    region: b.region,
    country: b.country,
    timezone: b.timezone,
    currency: b.currency,
    phone: b.phone,
    email: b.email,
    description: b.description,
    hours: b.hours,
    leadTimeMinutes: b.leadTimeMinutes,
    maxAdvanceDays: b.maxAdvanceDays,
    bufferMinutes: b.bufferMinutes,
    slotIntervalMinutes: b.slotIntervalMinutes,
    onlinePaymentEnabled: b.onlinePaymentEnabled,
    paymentMethods: b.paymentMethods,
    status: b.status,
    treatmentCount: treatmentCounts.find((t) => t.branchId === b.id)?.n ?? 0,
    therapistCount: therapistCounts.find((t) => t.branchId === b.id)?.n ?? 0,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl">Branches</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Your outlets on the marketplace — hours, booking rules and payment options live here.
        </p>
      </div>
      <BranchManager branches={rows} />
    </div>
  );
}

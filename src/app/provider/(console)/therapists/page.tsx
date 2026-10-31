import type { Metadata } from 'next';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { bookings, branches, schedules, therapists } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { pageMetadata } from '@/lib/seo';
import { TherapistManager, type TherapistRow } from '@/components/provider/therapist-manager';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Staff', description: 'Your team.', path: '/provider/therapists', noIndex: true });
}

export default async function ProviderTherapistsPage() {
  const user = (await getCurrentUser())!;
  const providerId = user.provider!.id;
  const db = await getDb();

  const branchRows = await db.query.branches.findMany({
    where: eq(branches.providerId, providerId),
    orderBy: [branches.name],
    columns: { id: true, name: true, currency: true },
  });

  const therapistRows = await db.query.therapists.findMany({
    where: inArray(therapists.branchId, branchRows.map((b) => b.id)),
    orderBy: [therapists.name],
  });

  const branchIds = branchRows.map((b) => b.id);
  const [shiftRows, upcomingRows] = await Promise.all([
    db
      .select({ therapistId: schedules.therapistId, n: sql<number>`count(*)::int` })
      .from(schedules)
      .innerJoin(therapists, eq(schedules.therapistId, therapists.id))
      .where(inArray(therapists.branchId, branchIds.length ? branchIds : ['__none__']))
      .groupBy(schedules.therapistId),
    db
      .select({ therapistId: bookings.therapistId, n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        and(
          eq(bookings.providerId, providerId),
          inArray(bookings.status, ['pending', 'confirmed']),
          gte(bookings.startAt, new Date()),
          sql`${bookings.startAt} <= now() + interval '7 days'`,
          sql`${bookings.therapistId} IS NOT NULL`,
        ),
      )
      .groupBy(bookings.therapistId),
  ]);

  const rows: TherapistRow[] = therapistRows.map((t) => ({
    id: t.id,
    branchId: t.branchId,
    name: t.name,
    bio: t.bio,
    specialties: t.specialties,
    avatarUrl: t.avatarUrl,
    role: t.role,
    salaryType: t.salaryType,
    salaryValue: t.salaryValue,
    incentiveType: t.incentiveType,
    incentiveValue: t.incentiveValue,
    active: t.active,
    shiftCount: shiftRows.find((s) => s.therapistId === t.id)?.n ?? 0,
    next7Count: upcomingRows.find((u) => u.therapistId === t.id)?.n ?? 0,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl">Staff</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {rows.length} team member{rows.length === 1 ? '' : 's'} across {branchRows.length} branch
          {branchRows.length === 1 ? '' : 'es'} — admins, workers and therapists.
        </p>
      </div>
      <TherapistManager therapists={rows} branches={branchRows} />
    </div>
  );
}

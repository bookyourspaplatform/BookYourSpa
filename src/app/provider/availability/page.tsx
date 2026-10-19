import type { Metadata } from 'next';
import Link from 'next/link';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb, type AppDb } from '@/db';
import { branches, schedules, scheduleExceptions, therapists } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { formatDate } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { ScheduleEditor } from '@/components/provider/schedule-editor';
import { ExceptionsPanel } from '@/components/provider/exceptions-panel';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Availability', description: 'Staff shifts and closures.', path: '/provider/availability', noIndex: true });
}

async function loadBranchAvailability(db: AppDb, branchId: string, today: string) {
  const therapistRows = await db.query.therapists.findMany({
    where: eq(therapists.branchId, branchId),
    orderBy: [therapists.name],
  });
  const therapistIds = therapistRows.map((t) => t.id);
  const [shiftRows, exceptionRows] = await Promise.all([
    db.query.schedules.findMany({
      where: therapistIds.length ? inArray(schedules.therapistId, therapistIds) : sql`false`,
      orderBy: [asc(schedules.weekday), asc(schedules.startTime)],
    }),
    db.query.scheduleExceptions.findMany({
      where: and(eq(scheduleExceptions.branchId, branchId), gte(scheduleExceptions.date, today)),
      orderBy: [scheduleExceptions.date],
      with: { therapist: { columns: { name: true } } },
    }),
  ]);
  return { therapistRows, shiftRows, exceptionRows };
}

type BranchAvailability = Awaited<ReturnType<typeof loadBranchAvailability>>;

const EMPTY: BranchAvailability = { therapistRows: [], shiftRows: [], exceptionRows: [] };

export default async function ProviderAvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const providerId = user.provider!.id;
  const db = await getDb();

  const branchRows = await db.query.branches.findMany({
    where: eq(branches.providerId, providerId),
    orderBy: [branches.name],
  });
  const branch = branchRows.find((b) => b.id === sp.branch) ?? branchRows[0] ?? null;

  const today = new Date().toISOString().slice(0, 10);

  const data: BranchAvailability = branch
    ? await loadBranchAvailability(db, branch.id, today)
    : EMPTY;
  const { therapistRows, shiftRows, exceptionRows } = data;

  const entriesByTherapist = new Map<string, { weekday: number; startTime: string; endTime: string }[]>();
  for (const s of shiftRows) {
    const list = entriesByTherapist.get(s.therapistId) ?? [];
    list.push({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime });
    entriesByTherapist.set(s.therapistId, list);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl">Availability</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Weekly shifts decide when customers can book; closures block specific dates.
        </p>
      </div>

      {!branch ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-14 text-center">
          <p className="text-[15px] font-medium">Add a branch first</p>
          <Link href="/provider/branches" className="mt-4 inline-block rounded-full bg-brand-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800">
            Manage branches
          </Link>
        </div>
      ) : (
        <>
          {branchRows.length > 1 && (
            <div className="no-scrollbar flex gap-2 overflow-x-auto">
              {branchRows.map((b) => (
                <Link
                  key={b.id}
                  href={`/provider/availability?branch=${b.id}`}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
                    b.id === branch.id ? 'bg-brand-700 text-white' : 'border border-ink-200 bg-white text-ink-600 hover:border-brand-300'
                  }`}
                >
                  {b.name}
                </Link>
              ))}
            </div>
          )}

          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[16px] font-semibold">Weekly shifts</h2>
              <span className="text-[13px] text-ink-400">{branch.timezone}</span>
            </div>
            {therapistRows.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-ink-200 bg-white px-5 py-8 text-center text-[13.5px] text-ink-500">
                Add therapists first — their shifts live here.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {therapistRows.map((t) => (
                  <ScheduleEditor
                    key={t.id}
                    therapist={{ id: t.id, name: t.name }}
                    entries={entriesByTherapist.get(t.id) ?? []}
                  />
                ))}
              </div>
            )}
          </section>

          <ExceptionsPanel
            branchId={branch.id}
            therapists={therapistRows.map((t) => ({ id: t.id, name: t.name }))}
            exceptions={exceptionRows.map((e) => ({
              id: e.id,
              date: e.date,
              startTime: e.startTime,
              endTime: e.endTime,
              kind: e.kind,
              reason: e.reason,
              therapistId: e.therapistId,
              therapistName: e.therapist?.name ?? null,
            }))}
          />

          <p className="text-[12.5px] text-ink-400">
            Today is {formatDate(new Date(), branch.timezone, { dateStyle: 'full' })} in {branch.city}.
          </p>
        </>
      )}
    </div>
  );
}

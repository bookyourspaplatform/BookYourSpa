import type { Metadata } from 'next';
import Link from 'next/link';
import { and, eq, gte, lt } from 'drizzle-orm';
import { CalendarOff, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { getDb, type AppDb } from '@/db';
import { bookings, branches, schedules, scheduleExceptions, therapists, type BranchHour } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { zonedToUtc } from '@/lib/availability';
import { formatDate, minutesOf, cn } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { Badge, BOOKING_STATUS_TONE, PAYMENT_STATUS_TONE, paymentStatusLabel } from '@/components/ui/badge';
import { BookingActions } from '@/components/dash/booking-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Calendar', description: 'Daily appointment calendar.', path: '/provider/calendar', noIndex: true });
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadDay(db: AppDb, branchId: string, date: string, timezone: string) {
  const start = zonedToUtc(date, 0, timezone);
  const end = zonedToUtc(date, 24 * 60, timezone);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();

  const [therapistRows, bookingRows, shiftRows, exceptionRows] = await Promise.all([
    db.query.therapists.findMany({
      where: eq(therapists.branchId, branchId),
      orderBy: [therapists.name],
    }),
    db.query.bookings.findMany({
      where: and(eq(bookings.branchId, branchId), gte(bookings.startAt, start), lt(bookings.startAt, end)),
      orderBy: [bookings.startAt],
      with: {
        treatment: { columns: { name: true, durationMin: true } },
        therapist: { columns: { name: true } },
      },
    }),
    db.query.schedules.findMany({ where: eq(schedules.weekday, weekday) }),
    db.query.scheduleExceptions.findMany({
      where: and(eq(scheduleExceptions.branchId, branchId), eq(scheduleExceptions.date, date)),
    }),
  ]);

  const shiftBy = new Map<string, { start: string; end: string }[]>();
  for (const s of shiftRows) {
    const list = shiftBy.get(s.therapistId) ?? [];
    list.push({ start: s.startTime, end: s.endTime });
    shiftBy.set(s.therapistId, list);
  }

  return { therapistRows, bookingRows, shiftBy, exceptionRows };
}

type DayData = Awaited<ReturnType<typeof loadDay>>;

const EMPTY: DayData = {
  therapistRows: [],
  bookingRows: [],
  shiftBy: new Map(),
  exceptionRows: [],
};

export default async function ProviderCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; branch?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const providerId = user.provider!.id;
  const db = await getDb();

  const today = new Date().toISOString().slice(0, 10);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;

  const branchRows = await db.query.branches.findMany({
    where: eq(branches.providerId, providerId),
    orderBy: [branches.name],
  });
  const branch = branchRows.find((b) => b.id === sp.branch) ?? branchRows[0] ?? null;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();

  const data: DayData = branch ? await loadDay(db, branch.id, date, branch.timezone) : EMPTY;

  const byTherapist = new Map<string, DayData['bookingRows']>();
  const unassigned: DayData['bookingRows'] = [];
  for (const b of data.bookingRows) {
    if (b.therapistId) {
      const list = byTherapist.get(b.therapistId) ?? [];
      list.push(b);
      byTherapist.set(b.therapistId, list);
    } else {
      unassigned.push(b);
    }
  }

  const dateLink = (nextDate: string) => {
    const params = new URLSearchParams({ date: nextDate });
    if (branch) params.set('branch', branch.id);
    return `/provider/calendar?${params.toString()}`;
  };

  const shiftsFor = (id: string) =>
    (data.shiftBy.get(id) ?? [])
      .slice()
      .sort((a, b) => minutesOf(a.start) - minutesOf(b.start));

  const todayHours: BranchHour | undefined = branch?.hours.find((h) => h.day === weekday);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl">Calendar</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {formatDate(date, branch?.timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {branch ? ` · ${branch.name}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href={dateLink(shiftDate(date, -1))} aria-label="Previous day" className="flex size-9 items-center justify-center rounded-full border border-ink-200 bg-white hover:bg-sand-50">
            <ChevronLeft className="size-4" />
          </Link>
          <Link href={dateLink(today)} className="h-9 rounded-full border border-ink-200 bg-white px-4 text-[13px] font-medium hover:bg-sand-50">
            Today
          </Link>
          <Link href={dateLink(shiftDate(date, 1))} aria-label="Next day" className="flex size-9 items-center justify-center rounded-full border border-ink-200 bg-white hover:bg-sand-50">
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>

      {!branch ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-14 text-center">
          <p className="text-[15px] font-medium">Add a branch first</p>
          <p className="mt-1 text-sm text-ink-500">The calendar needs at least one location.</p>
          <Link href="/provider/branches" className="mt-4 inline-block rounded-full bg-brand-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800">
            Manage branches
          </Link>
        </div>
      ) : (
        <>
          {branchRows.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {branchRows.map((b) => (
                <Link
                  key={b.id}
                  href={`/provider/calendar?date=${date}&branch=${b.id}`}
                  className={cn(
                    'rounded-full px-4 py-1.5 text-[13px] font-medium transition',
                    b.id === branch.id ? 'bg-brand-700 text-white' : 'border border-ink-200 bg-white text-ink-600 hover:border-brand-300',
                  )}
                >
                  {b.name}
                </Link>
              ))}
            </div>
          )}

          <p className="flex items-center gap-1.5 text-[13px] text-ink-500">
            <Clock className="size-3.5" />
            {!todayHours || todayHours.closed
              ? 'Closed today according to your opening hours'
              : `Opening hours ${todayHours.open}–${todayHours.close}`}
          </p>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {data.therapistRows.map((t) => {
              const list = byTherapist.get(t.id) ?? [];
              const shifts = shiftsFor(t.id);
              const exception = data.exceptionRows.find((e) => e.therapistId === t.id);
              const branchClosed = data.exceptionRows.some((e) => !e.therapistId && e.kind === 'closed');
              return (
                <section key={t.id} className="overflow-hidden rounded-3xl border border-ink-100 bg-white">
                  <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium">{t.name}</p>
                      <p className="text-[12.5px] text-ink-400">
                        {exception
                          ? exception.kind === 'closed'
                            ? `Off: ${exception.reason ?? 'time off'}`
                            : `Special hours ${exception.startTime}–${exception.endTime}`
                          : branchClosed
                            ? 'Branch closed today'
                            : shifts.length
                              ? shifts.map((s) => `${s.start}–${s.end}`).join(', ')
                              : 'No shift defined'}
                      </p>
                    </div>
                    {!t.active && <Badge tone="neutral">inactive</Badge>}
                  </div>
                  {list.length === 0 ? (
                    <p className="px-4 py-5 text-center text-[13px] text-ink-400">No appointments</p>
                  ) : (
                    <ul className="divide-y divide-ink-50">
                      {list.map((b) => (
                        <li key={b.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 text-[14px]">
                              <span className="font-semibold tabular-nums text-brand-800">
                                {formatDate(b.startAt, b.timezone, { timeStyle: 'short' })}
                              </span>
                              <span className="truncate font-medium">{b.treatment?.name}</span>
                            </p>
                            <p className="mt-0.5 truncate text-[13px] text-ink-500">
                              {b.guestName} · {b.treatment?.durationMin} min
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <Badge tone={BOOKING_STATUS_TONE[b.status] ?? 'neutral'}>{b.status.replace('_', '-')}</Badge>
                              <Badge tone={PAYMENT_STATUS_TONE[b.paymentStatus] ?? 'neutral'}>
                                {paymentStatusLabel(b.paymentStatus)}
                              </Badge>
                            </div>
                          </div>
                          <BookingActions bookingId={b.id} status={b.status} layout="stack" />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}

            <section className="overflow-hidden rounded-3xl border border-brand-100 bg-brand-50/40">
              <div className="border-b border-brand-100 px-4 py-3">
                <p className="text-[15px] font-medium text-brand-900">Facility / no therapist</p>
                <p className="text-[12.5px] text-brand-700">Shared rooms & self-guided treatments</p>
              </div>
              {unassigned.length === 0 ? (
                <p className="px-4 py-5 text-center text-[13px] text-ink-400">No appointments</p>
              ) : (
                <ul className="divide-y divide-brand-100/70">
                  {unassigned.map((b) => (
                    <li key={b.id} className="px-4 py-3">
                      <p className="flex items-center gap-2 text-[14px]">
                        <span className="font-semibold tabular-nums text-brand-800">
                          {formatDate(b.startAt, b.timezone, { timeStyle: 'short' })}
                        </span>
                        <span className="font-medium">{b.treatment?.name}</span>
                      </p>
                      <p className="mt-0.5 text-[13px] text-ink-500">{b.guestName}</p>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <Badge tone={BOOKING_STATUS_TONE[b.status] ?? 'neutral'}>{b.status.replace('_', '-')}</Badge>
                        <BookingActions bookingId={b.id} status={b.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {data.bookingRows.length === 0 && (
            <div className="flex items-center justify-center gap-2 rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-10 text-[14px] text-ink-500">
              <CalendarOff className="size-4" /> Nothing booked on this date.
            </div>
          )}
        </>
      )}
    </div>
  );
}

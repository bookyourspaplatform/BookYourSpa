import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { CalendarClock, ClipboardList, Coins, Store, Users } from 'lucide-react';
import { getDb } from '@/db';
import { bookings, branches, therapists, treatments } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { formatMoney } from '@/lib/money';
import { dateKeyInTz, formatDate, formatDateTime } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { StatCard, BarSeries } from '@/components/ui/stat';
import { Badge, BOOKING_STATUS_TONE } from '@/components/ui/badge';
import { BookingActions } from '@/components/dash/booking-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Spa console', description: 'Your spa dashboard.', path: '/provider', noIndex: true });
}

const ACTIVE = ['pending', 'confirmed'] as const;
const PAID = ['paid', 'venue'] as const;

export default async function ProviderOverview() {
  const user = (await getCurrentUser())!;
  const providerId = user.provider!.id;
  const db = await getDb();

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setUTCDate(1);
  sixMonthsAgo.setUTCHours(0, 0, 0, 0);
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 5);
  const now = new Date();

  const [upcoming, monthAgg, trend, counts, pendingCount] = await Promise.all([
    db.query.bookings.findMany({
      where: and(
        eq(bookings.providerId, providerId),
        inArray(bookings.status, [...ACTIVE]),
        gte(bookings.startAt, new Date(now.getTime() - 10 * 3600_000)),
      ),
      orderBy: [bookings.startAt],
      limit: 80,
      with: {
        branch: { columns: { name: true, timezone: true, city: true } },
        treatment: { columns: { name: true, durationMin: true } },
        therapist: { columns: { name: true } },
      },
    }),
    db
      .select({
        total: sql<string>`coalesce(sum(${bookings.providerEarning}), 0)`,
        count: sql<number>`count(*)::int`,
        currency: sql<string|null>`min(${bookings.currency})`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.providerId, providerId),
          inArray(bookings.paymentStatus, [...PAID]),
          gte(bookings.startAt, sixMonthsAgo),
          sql`${bookings.startAt} < now() + interval '1 day'`,
        ),
      ),
    db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${bookings.startAt}), 'MM')`,
        total: sql<string>`coalesce(sum(${bookings.providerEarning}), 0)`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.providerId, providerId),
          inArray(bookings.paymentStatus, [...PAID]),
          gte(bookings.startAt, sixMonthsAgo),
        ),
      )
      .groupBy(sql`date_trunc('month', ${bookings.startAt})`)
      .orderBy(sql`date_trunc('month', ${bookings.startAt})`),
    Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(branches).where(and(eq(branches.providerId, providerId), eq(branches.status, 'active'))),
      db.select({ n: sql<number>`count(*)::int` }).from(therapists).innerJoin(branches, eq(therapists.branchId, branches.id)).where(and(eq(branches.providerId, providerId), eq(therapists.active, true))),
      db.select({ n: sql<number>`count(*)::int` }).from(treatments).where(and(eq(treatments.providerId, providerId), eq(treatments.status, 'active'))),
    ]),
    db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(eq(bookings.providerId, providerId), eq(bookings.status, 'pending'))),
  ]);

  const todays = upcoming.filter((b) => dateKeyInTz(b.startAt, b.timezone) === dateKeyInTz(now, b.timezone));
  const upcoming7 = upcoming.filter((b) => b.startAt.getTime() < now.getTime() + 7 * 86400_000);
  const thisMonth = monthAgg[0];
  const monthTotal = Number(thisMonth?.total ?? 0);

  const trendData = trend.map((t) => ({ label: t.month, value: Number(t.total) }));
  const cur = thisMonth?.currency ?? 'IDR';

  const byDay = new Map<string, typeof upcoming>();
  for (const b of upcoming.slice(0, 40)) {
    const key = dateKeyInTz(b.startAt, b.timezone);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(b);
  }
  const days = [...byDay.entries()].slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl">Welcome back, {user.name.split(' ')[0]}</h1>
          <p className="mt-0.5 text-sm text-ink-500">Here&apos;s what is happening at your spa today.</p>
        </div>
        <Link
          href="/provider/bookings"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-brand-700 px-5 text-sm font-medium text-white hover:bg-brand-800"
        >
          <ClipboardList className="size-4" /> All bookings
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Today" value={String(todays.length)} hint="appointments" icon={<CalendarClock className="size-4" />} />
        <StatCard
          label="Next 7 days"
          value={String(upcoming7.length)}
          hint={`${pendingCount[0]?.n ?? 0} awaiting confirm`}
          icon={<ClipboardList className="size-4" />}
          tone={pendingCount[0]?.n ? 'warning' : 'brand'}
        />
        <StatCard label="This month" value={formatMoney(monthTotal, cur)} hint={`${thisMonth?.count ?? 0} paid visits`} icon={<Coins className="size-4" />} tone="success" />
        <StatCard
          label="Live inventory"
          value={`${counts[0][0]?.n ?? 0} branches`}
          hint={`${counts[1][0]?.n ?? 0} therapists · ${counts[2][0]?.n ?? 0} treatments`}
          icon={<Store className="size-4" />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Earnings trend */}
        <section className="rounded-3xl border border-ink-100 bg-white p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Earnings (last 6 months)</h2>
            <Link href="/provider/earnings" className="text-[13px] font-medium text-brand-700 hover:underline">
              Details
            </Link>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-400">Net after platform fee, paid visits only.</p>
          {trendData.length ? (
            <BarSeries className="mt-4" data={trendData} />
          ) : (
            <p className="mt-6 rounded-2xl border border-dashed border-ink-200 px-4 py-6 text-center text-[13px] text-ink-500">
              No paid bookings yet — your earnings chart will appear here.
            </p>
          )}
        </section>

        {/* Schedule */}
        <section className="rounded-3xl border border-ink-100 bg-white lg:col-span-3">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
            <h2 className="text-[15px] font-semibold">Upcoming schedule</h2>
            <Link href="/provider/calendar" className="text-[13px] font-medium text-brand-700 hover:underline">
              Open calendar
            </Link>
          </div>

          {days.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-medium text-ink-700">No upcoming appointments</p>
              <p className="mt-1 text-[13px] text-ink-500">New bookings will appear here in real time.</p>
            </div>
          ) : (
            <div className="divide-y divide-ink-100">
              {days.map(([day, list]) => (
                <div key={day} className="px-5 py-4">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">
                    {formatDate(`${day}T12:00:00Z`, undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
                  </p>
                  <ul className="mt-2.5 space-y-2.5">
                    {list.slice(0, 8).map((b) => (
                      <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border border-ink-100 bg-sand-50/60 px-3.5 py-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-medium">
                            <span className="tabular-nums text-brand-800">
                              {formatDateTime(b.startAt, b.timezone).split(',').slice(-1)[0]}
                            </span>
                            {b.treatment?.name ?? 'Treatment'}
                            <Badge tone={BOOKING_STATUS_TONE[b.status] ?? 'neutral'}>{b.status}</Badge>
                          </p>
                          <p className="mt-0.5 truncate text-[13px] text-ink-500">
                            {b.guestName} · {b.branch?.name}
                            {b.therapist ? ` · ${b.therapist.name}` : ''}
                          </p>
                        </div>
                        <BookingActions bookingId={b.id} status={b.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Quick links */}
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { href: '/provider/branches', label: 'Manage branches', icon: <Store className="size-4" /> },
          { href: '/provider/therapists', label: 'Team & shifts', icon: <Users className="size-4" /> },
          { href: '/provider/treatments', label: 'Menu & prices', icon: <Coins className="size-4" /> },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex items-center gap-2.5 rounded-2xl border border-ink-100 bg-white px-4 py-3.5 text-sm font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-800"
          >
            <span className="text-brand-600">{l.icon}</span>
            {l.label}
          </Link>
        ))}
      </section>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { bookings, commissions } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { formatMoney } from '@/lib/money';
import { formatDateTime, formatDate } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { StatCard } from '@/components/ui/stat';
import { Badge, BOOKING_STATUS_TONE, PAYMENT_STATUS_TONE } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Agent console', description: 'Reseller dashboard.', path: '/agent', noIndex: true });
}

const PAID = ['paid', 'venue'] as const;

export default async function AgentOverview() {
  const user = (await getCurrentUser())!;
  const agentId = user.agent!.id;
  const db = await getDb();

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [monthAgg, commissionAgg, upcoming, recent] = await Promise.all([
    db
      .select({
        total: sql<string>`coalesce(sum(${bookings.totalAmount}), 0)`,
        count: sql<number>`count(*)::int`,
        currency: sql<string|null>`min(${bookings.currency})`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.agentId, agentId),
          inArray(bookings.paymentStatus, [...PAID]),
          gte(bookings.createdAt, monthStart),
        ),
      ),
    db
      .select({
        total: sql<string>`coalesce(sum(${commissions.amount}), 0)`,
        pending: sql<string>`coalesce(sum(case when ${commissions.status} = 'pending' then ${commissions.amount} else 0 end), 0)`,
        paid: sql<string>`coalesce(sum(case when ${commissions.status} = 'paid' then ${commissions.amount} else 0 end), 0)`,
        currency: sql<string|null>`min(${commissions.currency})`,
      })
      .from(commissions)
      .where(and(eq(commissions.agentId, agentId), eq(commissions.party, 'agent'))),
    db.query.bookings.findMany({
      where: and(eq(bookings.agentId, agentId), inArray(bookings.status, ['pending', 'confirmed']), gte(bookings.startAt, new Date())),
      orderBy: [bookings.startAt],
      limit: 5,
      with: {
        treatment: { columns: { name: true } },
        branch: { columns: { name: true, city: true, timezone: true } },
        provider: { columns: { name: true } },
      },
    }),
    db.query.bookings.findMany({
      where: eq(bookings.agentId, agentId),
      orderBy: [desc(bookings.createdAt)],
      limit: 6,
      with: {
        treatment: { columns: { name: true } },
        provider: { columns: { name: true } },
        branch: { columns: { name: true } },
      },
    }),
  ]);

  const cur = commissionAgg[0]?.currency ?? monthAgg[0]?.currency ?? 'IDR';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl">Welcome, {user.name.split(' ')[0]}</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Your negotiated agent rates apply automatically whenever you book for a customer.
          </p>
        </div>
        <Link
          href="/agent/new"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-brand-700 px-5 text-sm font-medium text-white hover:bg-brand-800"
        >
          Book for a customer
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Sales this month" value={formatMoney(Number(monthAgg[0]?.total ?? 0), cur)} hint={`${monthAgg[0]?.count ?? 0} paid bookings`} icon={<BookOpenTextIcon />} />
        <StatCard label="Commission earned" value={formatMoney(Number(commissionAgg[0]?.total ?? 0), cur)} hint="all time" icon={<CoinsIcon />} tone="success" />
        <StatCard label="Pending payout" value={formatMoney(Number(commissionAgg[0]?.pending ?? 0), cur)} hint={`${formatMoney(Number(commissionAgg[0]?.paid ?? 0), cur)} already paid`} icon={<CoinsIcon />} tone="warning" />
        <StatCard label="Upcoming trips" value={String(upcoming.length)} hint="confirmed customer visits" icon={<CalendarIcon />} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-3xl border border-ink-100 bg-white">
          <div className="border-b border-ink-100 px-5 py-3.5">
            <h2 className="text-[15px] font-semibold">Upcoming for your customers</h2>
          </div>
          {upcoming.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13.5px] text-ink-500">No upcoming appointments.</p>
          ) : (
            <ul className="divide-y divide-ink-50">
              {upcoming.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-medium">{b.treatment?.name}</p>
                    <p className="truncate text-[13px] text-ink-500">
                      {formatDateTime(b.startAt, b.branch?.timezone ?? 'UTC')} · {b.provider?.name} ({b.branch?.name})
                    </p>
                    <p className="text-[12.5px] text-ink-400">Guest: {b.guestName}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={BOOKING_STATUS_TONE[b.status] ?? 'neutral'}>{b.status}</Badge>
                    <Link href={`/voucher/${b.code}`} className="font-mono text-[12px] text-brand-700 hover:underline">
                      {b.code}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-3xl border border-ink-100 bg-white">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
            <h2 className="text-[15px] font-semibold">Recent sales</h2>
            <Link href="/agent/sales" className="text-[13px] font-medium text-brand-700 hover:underline">
              View all
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-[14px] font-medium">No bookings yet</p>
              <p className="mt-1 text-[13px] text-ink-500">Start with “Book for a customer”.</p>
            </div>
          ) : (
            <ul className="divide-y divide-ink-50">
              {recent.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-medium">{b.treatment?.name}</p>
                    <p className="truncate text-[13px] text-ink-500">
                      {b.guestName} · {b.provider?.name} · {formatDate(b.startAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[13.5px] font-medium tabular-nums">{formatMoney(b.totalAmount, b.currency)}</span>
                    <Badge tone={PAYMENT_STATUS_TONE[b.paymentStatus] ?? 'neutral'}>
                      {b.paymentStatus === 'venue' ? 'at venue' : b.paymentStatus}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function BookOpenTextIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </svg>
  );
}
function CoinsIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

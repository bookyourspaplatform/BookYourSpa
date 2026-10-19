import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { AlertOctagon, ArrowRight, BookOpenText, Coins, Store, Users } from 'lucide-react';
import { getDb } from '@/db';
import { agents, bookings, commissions, providers, users } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { formatMoney } from '@/lib/money';
import { formatDateTime, formatDate } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { StatCard, BarSeries } from '@/components/ui/stat';
import { Badge, BOOKING_STATUS_TONE, PAYMENT_STATUS_TONE } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Platform admin', description: 'Super admin console.', path: '/admin', noIndex: true });
}

const PAID = ['paid', 'venue'] as const;

export default async function AdminOverview() {
  await getCurrentUser();
  const db = await getDb();

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const sixMonthsAgo = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 5, 1));

  const [gmvAgg, monthAgg, trend, pendingProviders, pendingAgents, recent, userCount, commissionPending] =
    await Promise.all([
      db
        .select({
          total: sql<string>`coalesce(sum(${bookings.totalAmount}), 0)`,
          fees: sql<string>`coalesce(sum(${bookings.platformFee}), 0)`,
          n: sql<number>`count(*)::int`,
          currency: sql<string|null>`min(${bookings.currency})`,
        })
        .from(bookings)
        .where(inArray(bookings.paymentStatus, [...PAID])),
      db
        .select({
          total: sql<string>`coalesce(sum(${bookings.totalAmount}), 0)`,
          fees: sql<string>`coalesce(sum(${bookings.platformFee}), 0)`,
          n: sql<number>`count(*)::int`,
          currency: sql<string|null>`min(${bookings.currency})`,
        })
        .from(bookings)
        .where(and(inArray(bookings.paymentStatus, [...PAID]), gte(bookings.startAt, monthStart))),
      db
        .select({
          m: sql<string>`to_char(date_trunc('month', ${bookings.startAt}), 'MM')`,
          total: sql<string>`coalesce(sum(${bookings.totalAmount}), 0)`,
        })
        .from(bookings)
        .where(and(inArray(bookings.paymentStatus, [...PAID]), gte(bookings.startAt, sixMonthsAgo)))
        .groupBy(sql`date_trunc('month', ${bookings.startAt})`)
        .orderBy(sql`date_trunc('month', ${bookings.startAt})`),
      db.query.providers.findMany({
        where: eq(providers.status, 'pending'),
        orderBy: [desc(providers.createdAt)],
        limit: 5,
      }),
      db.query.agents.findMany({
        where: eq(agents.status, 'pending'),
        orderBy: [desc(agents.createdAt)],
        limit: 5,
      }),
      db.query.bookings.findMany({
        orderBy: [desc(bookings.createdAt)],
        limit: 8,
        with: {
          provider: { columns: { name: true } },
          treatment: { columns: { name: true } },
          branch: { columns: { name: true, timezone: true } },
        },
      }),
      db.select({ n: sql<number>`count(*)::int` }).from(users),
      db
        .select({
          total: sql<string>`coalesce(sum(${commissions.amount}), 0)`,
          currency: sql<string|null>`min(${commissions.currency})`,
        })
        .from(commissions)
        .where(eq(commissions.status, 'pending')),
    ]);

  const cur = monthAgg[0]?.currency ?? gmvAgg[0]?.currency ?? 'IDR';
  const pendingTotal = pendingProviders.length + pendingAgents.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl">Platform overview</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {formatDate(new Date(), undefined, { dateStyle: 'full' })} · BookYourSpa marketplace health
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="GMV (all time)"
          value={formatMoney(Number(gmvAgg[0]?.total ?? 0), cur)}
          hint={`${gmvAgg[0]?.n ?? 0} paid bookings`}
          icon={<BookOpenText className="size-4" />}
        />
        <StatCard
          label="Platform revenue"
          value={formatMoney(Number(gmvAgg[0]?.fees ?? 0), cur)}
          hint={`${formatMoney(Number(monthAgg[0]?.fees ?? 0), cur)} this month`}
          icon={<Coins className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Bookings this month"
          value={String(monthAgg[0]?.n ?? 0)}
          hint={`${formatMoney(Number(monthAgg[0]?.total ?? 0), cur)} gross`}
          icon={<BookOpenText className="size-4" />}
        />
        <StatCard
          label="Awaiting approval"
          value={String(pendingTotal)}
          hint={`${pendingProviders.length} spas · ${pendingAgents.length} agents`}
          icon={<AlertOctagon className="size-4" />}
          tone={pendingTotal > 0 ? 'warning' : 'brand'}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <section className="rounded-3xl border border-ink-100 bg-white p-5 lg:col-span-2">
          <h2 className="text-[15px] font-semibold">GMV — last 6 months</h2>
          {trend.length ? (
            <BarSeries className="mt-4" data={trend.map((t) => ({ label: t.m, value: Number(t.total) }))} />
          ) : (
            <p className="mt-5 rounded-2xl border border-dashed border-ink-200 px-4 py-6 text-center text-[13px] text-ink-500">
              No settled bookings yet.
            </p>
          )}
          <div className="mt-4 space-y-1.5 border-t border-ink-100 pt-3 text-[13px] text-ink-500">
            <p className="flex justify-between">
              <span>Total users</span>
              <span className="font-medium tabular-nums text-ink-800">{userCount[0]?.n ?? 0}</span>
            </p>
            <p className="flex justify-between">
              <span>Pending commission payouts</span>
              <span className="font-medium tabular-nums text-ink-800">
                {formatMoney(Number(commissionPending[0]?.total ?? 0), commissionPending[0]?.currency ?? cur)}
              </span>
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-ink-100 bg-white lg:col-span-3">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <Store className="size-4 text-brand-600" /> Approval queue
            </h2>
            <Link href="/admin/providers" className="text-[13px] font-medium text-brand-700 hover:underline">
              Manage
            </Link>
          </div>
          {pendingTotal === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-medium text-emerald-700">Everything is approved</p>
              <p className="mt-1 text-[13px] text-ink-500">New spa and agent applications appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-ink-50">
              {pendingProviders.map((p) => (
                <Link key={p.id} href="/admin/providers" className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-sand-50">
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-medium">{p.name}</p>
                    <p className="text-[13px] text-ink-500">Spa application · {p.country} · {formatDate(p.createdAt)}</p>
                  </div>
                  <Badge tone="warning">pending</Badge>
                </Link>
              ))}
              {pendingAgents.map((a) => (
                <Link key={a.id} href="/admin/agents" className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-sand-50">
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-medium">{a.companyName}</p>
                    <p className="text-[13px] text-ink-500">Agent application · {a.country} · {formatDate(a.createdAt)}</p>
                  </div>
                  <Badge tone="warning">pending</Badge>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-3xl border border-ink-100 bg-white">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Latest bookings</h2>
          <Link href="/admin/bookings" className="flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline">
            All bookings <ArrowRight className="size-3.5" />
          </Link>
        </div>
        <ul className="divide-y divide-ink-50">
          {recent.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-medium">
                  <span className="font-mono text-[12.5px] text-brand-700">{b.code}</span>
                  <span>{b.treatment?.name}</span>
                  <Badge tone={BOOKING_STATUS_TONE[b.status] ?? 'neutral'}>{b.status.replace('_', '-')}</Badge>
                  <Badge tone={PAYMENT_STATUS_TONE[b.paymentStatus] ?? 'neutral'}>
                    {b.paymentStatus === 'venue' ? 'at venue' : b.paymentStatus}
                  </Badge>
                </p>
                <p className="mt-0.5 text-[13px] text-ink-500">
                  {b.guestName} · {b.provider?.name} ({b.branch?.name}) · {formatDateTime(b.startAt, b.branch?.timezone ?? 'UTC')}
                </p>
              </div>
              <span className="shrink-0 text-[14px] font-medium tabular-nums">
                {formatMoney(b.totalAmount, b.currency)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/admin/agents"
          className="flex items-center gap-2.5 rounded-2xl border border-ink-100 bg-white px-4 py-3.5 text-sm font-medium text-ink-700 hover:border-brand-300 hover:text-brand-800"
        >
          <Users className="size-4 text-brand-600" /> Review agents & commissions
        </Link>
        <Link
          href="/admin/settings"
          className="flex items-center gap-2.5 rounded-2xl border border-ink-100 bg-white px-4 py-3.5 text-sm font-medium text-ink-700 hover:border-brand-300 hover:text-brand-800"
        >
          <Coins className="size-4 text-brand-600" /> System & SEO configuration
        </Link>
      </div>
    </div>
  );
}

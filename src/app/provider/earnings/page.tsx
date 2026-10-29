import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { ChevronLeft, ChevronRight, Coins, Receipt } from 'lucide-react';
import { getDb } from '@/db';
import { bookings } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { formatMoney } from '@/lib/money';
import { formatDate, cn } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { StatCard, BarSeries } from '@/components/ui/stat';
import { Badge, PAYMENT_STATUS_TONE, paymentStatusLabel } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Earnings', description: 'Provider earnings and payouts.', path: '/provider/earnings', noIndex: true });
}

const PAID = ['paid', 'deposit_paid', 'venue'] as const;

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default async function ProviderEarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const providerId = user.provider!.id;
  const db = await getDb();

  const now = new Date();
  const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : current;
  const monthStart = new Date(`${month}-01T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));

  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

  const [aggRow, rows, trend] = await Promise.all([
    db
      .select({
        gross: sql<string>`coalesce(sum(${bookings.listPrice}), 0)`,
        discounts: sql<string>`coalesce(sum(${bookings.discountAmount}), 0)`,
        total: sql<string>`coalesce(sum(${bookings.totalAmount}), 0)`,
        fees: sql<string>`coalesce(sum(${bookings.platformFee}), 0)`,
        agentCom: sql<string>`coalesce(sum(${bookings.agentCommission}), 0)`,
        net: sql<string>`coalesce(sum(${bookings.providerEarning}), 0)`,
        count: sql<number>`count(*)::int`,
        currency: sql<string|null>`min(${bookings.currency})`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.providerId, providerId),
          inArray(bookings.paymentStatus, [...PAID]),
          gte(bookings.startAt, monthStart),
          lt(bookings.startAt, monthEnd),
        ),
      ),
    db.query.bookings.findMany({
      where: and(
        eq(bookings.providerId, providerId),
        inArray(bookings.paymentStatus, [...PAID]),
        gte(bookings.startAt, monthStart),
        lt(bookings.startAt, monthEnd),
      ),
      orderBy: [desc(bookings.startAt)],
      limit: 100,
      with: {
        treatment: { columns: { name: true } },
        branch: { columns: { name: true } },
        agent: { columns: { companyName: true } },
      },
    }),
    db
      .select({
        m: sql<string>`to_char(date_trunc('month', ${bookings.startAt}), 'YYYY-MM')`,
        net: sql<string>`coalesce(sum(${bookings.providerEarning}), 0)`,
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
  ]);

  const agg = aggRow[0] ?? { gross: '0', discounts: '0', total: '0', fees: '0', agentCom: '0', net: '0', count: 0, currency: null };
  const currency = agg.currency ?? 'IDR';

  const navFor = (m: string) => `/provider/earnings?month=${m}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl">Earnings</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {formatDate(`${month}-01`, undefined, { month: 'long', year: 'numeric' })} · paid &amp; pay-at-venue
            bookings only
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={navFor(shiftMonth(month, -1))} aria-label="Previous month" className="flex size-9 items-center justify-center rounded-full border border-ink-200 bg-white hover:bg-sand-50">
            <ChevronLeft className="size-4" />
          </Link>
          <Link href={navFor(current)} className="h-9 rounded-full border border-ink-200 bg-white px-4 text-[13px] font-medium hover:bg-sand-50">
            This month
          </Link>
          <Link href={navFor(shiftMonth(month, 1))} aria-label="Next month" className="flex size-9 items-center justify-center rounded-full border border-ink-200 bg-white hover:bg-sand-50">
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Bookings paid" value={String(agg.count ?? 0)} icon={<Receipt className="size-4" />} />
        <StatCard label="Gross sales" value={formatMoney(Number(agg.total ?? 0), currency)} hint={`before discounts ${formatMoney(Number(agg.discounts ?? 0), currency)}`} icon={<Coins className="size-4" />} />
        <StatCard label="Platform fee" value={formatMoney(Number(agg.fees ?? 0), currency)} hint="deducted by BookYourSpa" icon={<Coins className="size-4" />} tone="warning" />
        <StatCard label="Your net" value={formatMoney(Number(agg.net ?? 0), currency)} hint={`${formatMoney(Number(agg.agentCom ?? 0), currency)} agent commissions`} icon={<Coins className="size-4" />} tone="success" />
      </div>

      <section className="rounded-3xl border border-ink-100 bg-white p-5">
        <h2 className="text-[15px] font-semibold">Net earnings — last 6 months</h2>
        {trend.length ? (
          <BarSeries className="mt-4" data={trend.map((t) => ({ label: t.m.slice(5), value: Number(t.net) }))} />
        ) : (
          <p className="mt-5 rounded-2xl border border-dashed border-ink-200 px-4 py-6 text-center text-[13px] text-ink-500">
            No paid bookings in this period yet.
          </p>
        )}
      </section>

      <section className="rounded-3xl border border-ink-100 bg-white">
        <div className="border-b border-ink-100 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Ledger</h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-[14px] text-ink-500">No settled bookings for this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-[12px] uppercase tracking-wide text-ink-400">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Booking</th>
                  <th className="px-3 py-2.5 font-medium">Treatment</th>
                  <th className="px-3 py-2.5 font-medium text-right">Total</th>
                  <th className="px-3 py-2.5 font-medium text-right">Fee</th>
                  <th className="px-5 py-2.5 font-medium text-right">Your net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {rows.map((b) => (
                  <tr key={b.id} className="hover:bg-sand-50/60">
                    <td className="px-5 py-2.5 whitespace-nowrap text-ink-600">
                      {formatDate(b.startAt, b.timezone, { dateStyle: 'short' })}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link href={`/voucher/${b.code}`} className="font-mono text-[12.5px] text-brand-700 hover:underline">
                          {b.code}
                        </Link>
                        <Badge tone={PAYMENT_STATUS_TONE[b.paymentStatus] ?? 'neutral'}>
                          {paymentStatusLabel(b.paymentStatus)}
                        </Badge>
                      </div>
                      <p className="text-[12.5px] text-ink-500">
                        {b.guestName}
                        {b.agent ? ` · via ${b.agent.companyName}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-[13.5px]">{b.treatment?.name}</p>
                      <p className="text-[12px] text-ink-400">{b.branch?.name}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(b.totalAmount, b.currency)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-amber-600">−{formatMoney(b.platformFee, b.currency)}</td>
                    <td className="px-5 py-2.5 text-right font-medium tabular-nums text-brand-800">
                      {formatMoney(b.providerEarning, b.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className={cn('text-[12.5px] text-ink-400')}>
        Payouts are issued according to your agreement with BookYourSpa; this ledger shows every settled
        transaction in real time.
      </p>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { bookings, commissions } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { StatCard } from '@/components/ui/stat';
import { Badge, BOOKING_STATUS_TONE, PAYMENT_STATUS_TONE } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Sales', description: 'Your bookings and commissions.', path: '/agent/sales', noIndex: true });
}

const PAID = ['paid', 'venue'] as const;
const COMMISSION_TONE: Record<string, 'warning' | 'success' | 'neutral' | 'brand'> = {
  pending: 'warning',
  approved: 'brand',
  paid: 'success',
};

export default async function AgentSalesPage() {
  const user = (await getCurrentUser())!;
  const agentId = user.agent!.id;
  const db = await getDb();

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [bookingRows, commissionRows, monthAgg] = await Promise.all([
    db.query.bookings.findMany({
      where: eq(bookings.agentId, agentId),
      orderBy: [desc(bookings.startAt)],
      limit: 100,
      with: {
        treatment: { columns: { name: true, durationMin: true } },
        provider: { columns: { name: true } },
        branch: { columns: { name: true, timezone: true } },
        agent: { columns: { companyName: true } },
      },
    }),
    db.query.commissions.findMany({
      where: and(eq(commissions.agentId, agentId), eq(commissions.party, 'agent')),
      orderBy: [desc(commissions.createdAt)],
      limit: 60,
      with: { booking: { columns: { code: true, guestName: true, startAt: true } } },
    }),
    db
      .select({
        total: sql<string>`coalesce(sum(${bookings.totalAmount}), 0)`,
        commission: sql<string>`coalesce(sum(${bookings.agentCommission}), 0)`,
        count: sql<number>`count(*)::int`,
        currency: sql<string|null>`min(${bookings.currency})`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.agentId, agentId),
          inArray(bookings.paymentStatus, [...PAID]),
          gte(bookings.startAt, monthStart),
        ),
      ),
  ]);

  const cur = monthAgg[0]?.currency ?? 'IDR';

  const commissionTotals = commissionRows.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + c.amount;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl">Sales & commissions</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {bookingRows.length} booking{bookingRows.length === 1 ? '' : 's'} made through your account.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Sales this month" value={formatMoney(Number(monthAgg[0]?.total ?? 0), cur)} hint={`${monthAgg[0]?.count ?? 0} paid`} icon={<span className="text-sm">◆</span>} />
        <StatCard label="Commission this month" value={formatMoney(Number(monthAgg[0]?.commission ?? 0), cur)} hint="on paid bookings" icon={<span className="text-sm">◆</span>} tone="success" />
        <StatCard label="Awaiting payout" value={formatMoney(commissionTotals.pending ?? 0, cur)} hint="approved/pending ledger" icon={<span className="text-sm">◆</span>} tone="warning" />
        <StatCard label="Paid out" value={formatMoney(commissionTotals.paid ?? 0, cur)} hint="banked to date" icon={<span className="text-sm">◆</span>} />
      </div>

      <section className="rounded-3xl border border-ink-100 bg-white">
        <div className="border-b border-ink-100 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Commission ledger</h2>
        </div>
        {commissionRows.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13.5px] text-ink-500">
            Commissions appear here as soon as your bookings are paid.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-[12px] uppercase tracking-wide text-ink-400">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Booking</th>
                  <th className="px-3 py-2.5 font-medium text-right">Rate</th>
                  <th className="px-3 py-2.5 font-medium text-right">Amount</th>
                  <th className="px-5 py-2.5 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {commissionRows.map((c) => (
                  <tr key={c.id} className="hover:bg-sand-50/60">
                    <td className="px-5 py-2.5 whitespace-nowrap text-ink-600">
                      {new Date(c.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/voucher/${c.booking?.code}`} className="font-mono text-[12.5px] text-brand-700 hover:underline">
                        {c.booking?.code}
                      </Link>
                      <p className="text-[12.5px] text-ink-500">{c.booking?.guestName}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-500">{(c.rateBps / 100).toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatMoney(c.amount, c.currency)}</td>
                    <td className="px-5 py-2.5 text-right">
                      <Badge tone={COMMISSION_TONE[c.status] ?? 'neutral'}>{c.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-ink-100 bg-white">
        <div className="border-b border-ink-100 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">All bookings</h2>
        </div>
        {bookingRows.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[14.5px] font-medium">No bookings yet</p>
            <Link href="/agent/new" className="mt-3 inline-block rounded-full bg-brand-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800">
              Make your first booking
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-ink-50">
            {bookingRows.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-medium">
                    <span className="font-mono text-[12.5px] text-brand-700">{b.code}</span>
                    <span>{b.treatment?.name}</span>
                    <Badge tone={BOOKING_STATUS_TONE[b.status] ?? 'neutral'}>{b.status.replace('_', '-')}</Badge>
                  </p>
                  <p className="mt-0.5 text-[13px] text-ink-500">
                    {b.guestName} · {b.provider?.name} ({b.branch?.name}) ·{' '}
                    {formatDateTime(b.startAt, b.branch?.timezone ?? 'UTC')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-[14px] font-medium tabular-nums">{formatMoney(b.totalAmount, b.currency)}</span>
                  {b.agentCommission > 0 && (
                    <span className="text-[13px] tabular-nums text-clay-700">
                      +{formatMoney(b.agentCommission, b.currency)}
                    </span>
                  )}
                  <Badge tone={PAYMENT_STATUS_TONE[b.paymentStatus] ?? 'neutral'}>
                    {b.paymentStatus === 'venue' ? 'at venue' : b.paymentStatus}
                  </Badge>
                  <Link href={`/voucher/${b.code}`} className="text-[13px] font-medium text-brand-700 hover:underline">
                    Voucher
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

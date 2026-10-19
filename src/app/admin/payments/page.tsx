import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { CreditCard, ExternalLink } from 'lucide-react';
import { getDb } from '@/db';
import { bookings, payments } from '@/db/schema';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateTime } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { StatCard } from '@/components/ui/stat';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Payments', description: 'Gateway transactions.', path: '/admin/payments', noIndex: true });
}

const GATEWAY_TONE: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  succeeded: 'success',
  paid: 'success',
  captured: 'success',
  failed: 'danger',
  cancelled: 'danger',
  pending: 'warning',
  processing: 'info',
  refunded: 'neutral',
  partially_refunded: 'warning',
};

export default async function AdminPaymentsPage() {
  const db = await getDb();

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [monthAgg, byGateway, recent] = await Promise.all([
    db
      .select({
        total: sql<string>`coalesce(sum(${payments.amount}), 0)`,
        refunded: sql<string>`coalesce(sum(${payments.refundedAmount}), 0)`,
        n: sql<number>`count(*)::int`,
        succeeded: sql<number>`count(*) filter (where ${payments.status} in ('succeeded','paid','captured'))::int`,
        currency: sql<string|null>`min(${payments.currency})`,
      })
      .from(payments)
      .where(gte(payments.createdAt, monthStart)),
    db
      .select({
        gateway: payments.gateway,
        total: sql<string>`coalesce(sum(${payments.amount}), 0)`,
        n: sql<number>`count(*)::int`,
        ok: sql<number>`count(*) filter (where ${payments.status} in ('succeeded','paid','captured'))::int`,
        currency: sql<string|null>`min(${payments.currency})`,
      })
      .from(payments)
      .groupBy(payments.gateway)
      .orderBy(sql`count(*) desc`),
    db.query.payments.findMany({
      orderBy: [desc(payments.createdAt)],
      limit: 40,
      with: {
        booking: {
          columns: { code: true, guestName: true, status: true },
          with: { provider: { columns: { name: true } } },
        },
      },
    }),
  ]);

  const cur = monthAgg[0]?.currency ?? 'IDR';
  const successRate = monthAgg[0]?.n ? Math.round(((monthAgg[0]?.succeeded ?? 0) / monthAgg[0]!.n) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl">Payments</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Gateway attempts across Stripe, PayPal, Razorpay and pay-at-venue. Webhooks reconcile booking status
          automatically.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Collected this month" value={formatMoney(Number(monthAgg[0]?.total ?? 0), cur)} hint={`${monthAgg[0]?.n ?? 0} attempts`} icon={<CreditCard className="size-4" />} />
        <StatCard label="Success rate" value={`${successRate}%`} hint={`${monthAgg[0]?.succeeded ?? 0} succeeded`} icon={<CreditCard className="size-4" />} tone={successRate >= 80 ? 'success' : 'warning'} />
        <StatCard label="Refunded" value={formatMoney(Number(monthAgg[0]?.refunded ?? 0), cur)} hint="this month" icon={<CreditCard className="size-4" />} tone="warning" />
        <StatCard label="Gateways active" value={String(byGateway.length)} hint={byGateway.map((g) => g.gateway).join(', ') || '—'} icon={<CreditCard className="size-4" />} />
      </div>

      <section className="rounded-3xl border border-ink-100 bg-white">
        <div className="border-b border-ink-100 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">By gateway (all time)</h2>
        </div>
        {byGateway.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13.5px] text-ink-500">No payment attempts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-[12px] uppercase tracking-wide text-ink-400">
                  <th className="px-5 py-2.5 font-medium">Gateway</th>
                  <th className="px-3 py-2.5 font-medium text-right">Attempts</th>
                  <th className="px-3 py-2.5 font-medium text-right">Succeeded</th>
                  <th className="px-5 py-2.5 font-medium text-right">Volume</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {byGateway.map((g) => (
                  <tr key={g.gateway}>
                    <td className="px-5 py-2.5 font-medium capitalize">{g.gateway}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{g.n}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {g.n ? Math.round((g.ok / g.n) * 100) : 0}%
                    </td>
                    <td className="px-5 py-2.5 text-right font-medium tabular-nums">
                      {formatMoney(Number(g.total), g.currency ?? 'IDR')}
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
          <h2 className="text-[15px] font-semibold">Recent transactions</h2>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13.5px] text-ink-500">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-[12px] uppercase tracking-wide text-ink-400">
                  <th className="px-5 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Booking</th>
                  <th className="px-3 py-2.5 font-medium">Gateway</th>
                  <th className="px-3 py-2.5 font-medium text-right">Amount</th>
                  <th className="px-3 py-2.5 font-medium">External id</th>
                  <th className="px-5 py-2.5 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {recent.map((p) => (
                  <tr key={p.id} className="hover:bg-sand-50/60">
                    <td className="px-5 py-2.5 whitespace-nowrap text-ink-600">
                      {formatDateTime(p.createdAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/voucher/${p.booking?.code}`} className="font-mono text-[12.5px] text-brand-700 hover:underline">
                        {p.booking?.code}
                      </Link>
                      <p className="text-[12.5px] text-ink-500">
                        {p.booking?.guestName} · {p.booking?.provider?.name}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 capitalize">{p.gateway}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatMoney(p.amount, p.currency)}
                      {p.refundedAmount > 0 && (
                        <span className="block text-[12px] text-rose-600">−{formatMoney(p.refundedAmount, p.currency)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-1 font-mono text-[12px] text-ink-500">
                        {p.externalId ? `${p.externalId.slice(0, 18)}${p.externalId.length > 18 ? '…' : ''}` : '—'}
                        {p.paidAt && <span className="text-emerald-600">· paid {formatDate(p.paidAt, undefined, { dateStyle: 'short' })}</span>}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Badge tone={GATEWAY_TONE[p.status] ?? 'neutral'}>{p.status.replace(/_/g, ' ')}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="flex items-center gap-1.5 text-[12.5px] text-ink-400">
        <ExternalLink className="size-3.5" />
        Webhook endpoints: <code className="font-mono">/api/webhooks/stripe</code>,{' '}
        <code className="font-mono">/api/webhooks/paypal</code>,{' '}
        <code className="font-mono">/api/webhooks/razorpay</code>
      </p>
    </div>
  );
}

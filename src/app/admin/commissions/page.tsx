import type { Metadata } from 'next';
import Link from 'next/link';
import { desc, sql } from 'drizzle-orm';
import { Coins } from 'lucide-react';
import { getDb } from '@/db';
import { commissions } from '@/db/schema';
import { formatMoney } from '@/lib/money';
import { formatDate, cn } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { StatCard } from '@/components/ui/stat';
import { Badge } from '@/components/ui/badge';
import { CommissionActions } from '@/components/admin/commission-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Commissions', description: 'Commission ledger.', path: '/admin/commissions', noIndex: true });
}

const PARTY_TONE: Record<string, 'brand' | 'clay' | 'info'> = {
  agent: 'clay',
  provider: 'brand',
  platform: 'info',
};
const STATUS_TONE: Record<string, 'warning' | 'brand' | 'success'> = {
  pending: 'warning',
  approved: 'brand',
  paid: 'success',
};
const PARTIES = ['all', 'agent', 'provider', 'platform'] as const;
const STATUSES = ['all', 'pending', 'approved', 'paid'] as const;

export default async function AdminCommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ party?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const party = PARTIES.includes(sp.party as (typeof PARTIES)[number]) ? (sp.party ?? 'all') : 'all';
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? (sp.status ?? 'all') : 'all';
  const db = await getDb();

  const [rows, totals] = await Promise.all([
    db.query.commissions.findMany({
      orderBy: [desc(commissions.createdAt)],
      limit: 200,
      with: {
        booking: {
          columns: { code: true, guestName: true, startAt: true },
          with: { provider: { columns: { name: true } } },
        },
        agent: { columns: { companyName: true } },
      },
    }),
    db
      .select({
        party: commissions.party,
        status: commissions.status,
        total: sql<string>`coalesce(sum(${commissions.amount}), 0)`,
        n: sql<number>`count(*)::int`,
        currency: sql<string|null>`min(${commissions.currency})`,
      })
      .from(commissions)
      .groupBy(commissions.party, commissions.status),
  ]);

  // JS filter keeps this simple and correct for both dropdowns at once.
  const filtered = rows.filter(
    (c) => (party === 'all' || c.party === party) && (status === 'all' || c.status === status),
  );

  const sumFor = (p: string, s?: string) => {
    const matches = totals.filter((t) => t.party === p && (!s || t.status === s));
    return {
      amount: matches.reduce((acc, t) => acc + Number(t.total), 0),
      currency: matches[0]?.currency ?? 'IDR',
    };
  };

  const linkFor = (nextParty: string, nextStatus: string) => {
    const params = new URLSearchParams();
    if (nextParty !== 'all') params.set('party', nextParty);
    if (nextStatus !== 'all') params.set('status', nextStatus);
    const qs = params.toString();
    return qs ? `/admin/commissions?${qs}` : '/admin/commissions';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl">Commissions & payouts</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Agent commissions, provider shares and platform fees recorded per booking. Approve then mark paid as
          you settle.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {(['agent', 'provider', 'platform'] as const).map((p, i) => (
          <StatCard
            key={p}
            label={`${p} owed`}
            value={formatMoney(sumFor(p, 'pending').amount + sumFor(p, 'approved').amount, sumFor(p, 'pending').currency)}
            hint={`${formatMoney(sumFor(p, 'paid').amount, sumFor(p, 'paid').currency)} already paid`}
            icon={<Coins className="size-4" />}
            tone={i === 0 ? 'warning' : i === 1 ? 'brand' : 'neutral'}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {PARTIES.map((p) => (
            <Link
              key={p}
              href={linkFor(p, status)}
              className={cn(
                'shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition',
                party === p ? 'bg-brand-700 text-white' : 'border border-ink-200 bg-white text-ink-600 hover:border-brand-300',
              )}
            >
              {p}
            </Link>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto sm:ml-auto">
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={linkFor(party, s)}
              className={cn(
                'shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition',
                status === s ? 'bg-ink-800 text-white' : 'border border-ink-200 bg-white text-ink-600 hover:border-ink-400',
              )}
            >
              {s}
            </Link>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-14 text-center">
          <p className="text-[15px] font-medium">No commission entries</p>
          <p className="mt-1 text-sm text-ink-500">Entries are created automatically when bookings are paid.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-ink-100 bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-[12px] uppercase tracking-wide text-ink-400">
                <th className="px-5 py-2.5 font-medium">Created</th>
                <th className="px-3 py-2.5 font-medium">Party</th>
                <th className="px-3 py-2.5 font-medium">Booking</th>
                <th className="px-3 py-2.5 font-medium text-right">Rate</th>
                <th className="px-3 py-2.5 font-medium text-right">Amount</th>
                <th className="px-3 py-2.5 font-medium text-right">Status</th>
                <th className="px-5 py-2.5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-sand-50/60">
                  <td className="px-5 py-2.5 whitespace-nowrap text-ink-600">{formatDate(c.createdAt, undefined, { dateStyle: 'short' })}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={PARTY_TONE[c.party] ?? 'neutral'}>{c.party}</Badge>
                      <span className="text-[12.5px] text-ink-500">
                        {c.party === 'agent' ? c.agent?.companyName : c.booking?.provider?.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/voucher/${c.booking?.code}`} className="font-mono text-[12.5px] text-brand-700 hover:underline">
                      {c.booking?.code}
                    </Link>
                    <p className="text-[12.5px] text-ink-500">{c.booking?.guestName}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-500">{(c.rateBps / 100).toFixed(1)}%</td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatMoney(c.amount, c.currency)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status}</Badge>
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <CommissionActions id={c.id} status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

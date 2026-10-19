import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { agents, bookings, commissions, users } from '@/db/schema';
import { pageMetadata } from '@/lib/seo';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/money';
import { formatDate, cn } from '@/lib/utils';
import { StatusActions } from '@/components/admin/status-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Agents', description: 'Manage resellers.', path: '/admin/agents', noIndex: true });
}

const STATUSES = ['all', 'pending', 'approved', 'suspended'] as const;
const STATUS_TONE: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  suspended: 'danger',
};
const AGENT_TYPE_LABELS: Record<string, string> = {
  travel_agent: 'Travel agent',
  hotel_concierge: 'Hotel concierge',
  tour_operator: 'Tour operator',
  affiliate: 'Affiliate',
  reseller: 'Reseller',
  corporate: 'Corporate',
};

export default async function AdminAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? sp.status : 'all';
  const db = await getDb();

  const rows = await db.query.agents.findMany({
    where: status !== 'all' ? eq(agents.status, status as 'pending') : undefined,
    orderBy: [desc(agents.createdAt)],
    limit: 200,
    with: { user: { columns: { email: true, name: true } } },
  });

  const agentIds = rows.map((r) => r.id);
  const [salesRows, commissionRows] = await Promise.all([
    agentIds.length
      ? db
          .select({
            agentId: bookings.agentId,
            total: sql<string>`coalesce(sum(${bookings.totalAmount}), 0)`,
            n: sql<number>`count(*)::int`,
            currency: sql<string|null>`min(${bookings.currency})`,
          })
          .from(bookings)
          .where(inArray(bookings.agentId, agentIds))
          .groupBy(bookings.agentId)
      : Promise.resolve([]),
    agentIds.length
      ? db
          .select({
            agentId: commissions.agentId,
            total: sql<string>`coalesce(sum(${commissions.amount}), 0)`,
            pending: sql<string>`coalesce(sum(case when ${commissions.status} != 'paid' then ${commissions.amount} else 0 end), 0)`,
            currency: sql<string|null>`min(${commissions.currency})`,
          })
          .from(commissions)
          .where(inArray(commissions.agentId, agentIds))
          .groupBy(commissions.agentId)
      : Promise.resolve([]),
  ]);

  const salesBy = new Map(salesRows.map((s) => [s.agentId, s]));
  const comBy = new Map(commissionRows.map((c) => [c.agentId, c]));

  const linkFor = (s: string) => (s === 'all' ? '/admin/agents' : `/admin/agents?status=${s}`);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl">Agents & resellers</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {rows.length} agenc{rows.length === 1 ? 'y' : 'ies'} · commission percentages apply to booking gross
          unless a treatment-specific net rate exists.
        </p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={linkFor(s)}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition',
              status === s ? 'bg-brand-700 text-white' : 'border border-ink-200 bg-white text-ink-600 hover:border-brand-300',
            )}
          >
            {s}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-14 text-center">
          <p className="text-[15px] font-medium">No agents in this view</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((a) => {
            const sales = salesBy.get(a.id);
            const com = comBy.get(a.id);
            return (
              <li key={a.id} className="rounded-3xl border border-ink-100 bg-white p-4 sm:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[16px] font-medium">{a.companyName}</h2>
                      <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>
                      <Badge tone="clay">{AGENT_TYPE_LABELS[a.agentType] ?? a.agentType}</Badge>
                    </div>
                    <p className="mt-1 text-[13.5px] text-ink-500">
                      {a.country} · {a.user?.name} ({a.user?.email}){a.website ? ` · ${a.website}` : ''}
                    </p>
                    <p className="mt-1 text-[13px] text-ink-400">
                      referral {a.referralCode} · joined {formatDate(a.createdAt)}
                      {a.approvedAt ? ` · approved ${formatDate(a.approvedAt)}` : ''}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-4 text-[13.5px]">
                      <span>
                        Sales:{' '}
                        <span className="font-medium tabular-nums">
                          {sales ? formatMoney(Number(sales.total), sales.currency ?? 'IDR') : formatMoney(0, 'IDR')}
                        </span>{' '}
                        <span className="text-ink-400">({sales?.n ?? 0} bookings)</span>
                      </span>
                      <span>
                        Commission owed:{' '}
                        <span className="font-medium tabular-nums text-clay-700">
                          {com ? formatMoney(Number(com.pending), com.currency ?? 'IDR') : formatMoney(0, 'IDR')}
                        </span>{' '}
                        <span className="text-ink-400">
                          {com ? `of ${formatMoney(Number(com.total), com.currency ?? 'IDR')} earned` : ''}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-start gap-2 lg:items-end">
                    <StatusActions kind="agent" id={a.id} status={a.status} commissionBps={a.commissionBps} />
                    <Link href={`/admin/bookings?agent=${a.id}`} className="text-[13px] text-brand-700 hover:underline">
                      Their bookings
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

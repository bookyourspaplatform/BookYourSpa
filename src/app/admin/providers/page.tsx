import type { Metadata } from 'next';
import Link from 'next/link';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { bookings, branches, providerClaims, providers, treatments, users } from '@/db/schema';
import { pageMetadata } from '@/lib/seo';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/money';
import { formatDate, cn } from '@/lib/utils';
import { StatusActions } from '@/components/admin/status-actions';
import { AddSpaButton } from '@/components/admin/add-provider-form';
import { EditSpaButton } from '@/components/admin/edit-spa-button';
import { AdminTreatmentsButton } from '@/components/admin/treatments-button';
import { ClaimsQueue, type ClaimRow } from '@/components/admin/claims-queue';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Providers', description: 'Manage spa providers.', path: '/admin/providers', noIndex: true });
}

const STATUSES = ['all', 'pending', 'approved', 'suspended'] as const;
const STATUS_TONE: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  suspended: 'danger',
};

export default async function AdminProvidersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? sp.status : 'all';
  const db = await getDb();

  const where = status !== 'all' ? eq(providers.status, status as 'pending') : undefined;

  const rows = await db.query.providers.findMany({
    where,
    orderBy: [desc(providers.createdAt)],
    limit: 200,
    with: {
      owner: { columns: { email: true, name: true } },
      branches: { columns: { id: true, status: true } },
      treatments: { columns: { id: true, status: true } },
    },
  });

  const providerIds = rows.map((r) => r.id);
  const gmvRows = providerIds.length
    ? await db
        .select({
          providerId: bookings.providerId,
          total: sql<string>`coalesce(sum(${bookings.totalAmount}), 0)`,
          n: sql<number>`count(*)::int`,
          currency: sql<string|null>`min(${bookings.currency})`,
        })
        .from(bookings)
        .where(inArray(bookings.providerId, providerIds))
        .groupBy(bookings.providerId)
    : [];
  const gmvBy = new Map(gmvRows.map((g) => [g.providerId, g]));

  const claimRows = await db.query.providerClaims.findMany({
    where: eq(providerClaims.status, 'pending'),
    with: {
      provider: { columns: { name: true, slug: true } },
      user: { columns: { name: true, email: true } },
    },
    orderBy: [asc(providerClaims.createdAt)],
    limit: 25,
  });
  const claims: ClaimRow[] = claimRows.map((c) => ({
    id: c.id,
    providerName: c.provider.name,
    providerSlug: c.provider.slug,
    email: c.email,
    userName: c.user?.name ?? null,
    message: c.message,
    createdAt: c.createdAt,
  }));

  const linkFor = (s: string) => (s === 'all' ? '/admin/providers' : `/admin/providers?status=${s}`);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl">Spa providers</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {rows.length} listing{rows.length === 1 ? '' : 's'} · approve new applications or suspend listings that
          breach marketplace policy.
        </p>
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white p-4 sm:p-5">
        <AddSpaButton />
      </div>

      <ClaimsQueue claims={claims} />

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
          <p className="text-[15px] font-medium">No providers in this view</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((p) => {
            const gmv = gmvBy.get(p.id);
            const activeBranches = p.branches.filter((b) => b.status === 'active').length;
            return (
              <li key={p.id} className="rounded-3xl border border-ink-100 bg-white p-4 sm:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[16px] font-medium">{p.name}</h2>
                      <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status}</Badge>
                      {!p.ownerId && <Badge tone="warning">unclaimed</Badge>}
                      {p.featured && <Badge tone="brand">featured</Badge>}
                    </div>
                    <p className="mt-1 text-[13.5px] text-ink-500">
                      /spas/{p.slug} · {p.country} · {p.baseCurrency} ·{' '}
                      {p.owner ? `owner ${p.owner.name} (${p.owner.email})` : 'no owner yet — awaiting claim'}
                    </p>
                    <p className="mt-1 text-[13px] text-ink-400">
                      {activeBranches}/{p.branches.length} branches active ·{' '}
                      {p.treatments.filter((t) => t.status === 'active').length}/{p.treatments.length} treatments
                      live · joined {formatDate(p.createdAt)}
                      {p.commissionBps != null ? ` · ${(p.commissionBps / 100).toFixed(1)}% platform fee` : ''}
                    </p>
                    <p className="mt-1 text-[13.5px]">
                      <span className="font-medium tabular-nums">
                        {gmv ? formatMoney(Number(gmv.total), gmv.currency ?? 'IDR') : formatMoney(0, p.baseCurrency)}
                      </span>{' '}
                      <span className="text-ink-400">lifetime GMV across {gmv?.n ?? 0} bookings</span>
                    </p>
                  </div>

                  <div className="flex flex-col items-start gap-2 lg:items-end">
                    <div className="flex flex-wrap gap-2">
                      <EditSpaButton providerId={p.id} name={p.name} unclaimed={!p.ownerId} />
                      <AdminTreatmentsButton providerId={p.id} name={p.name} />
                    </div>
                    <StatusActions kind="provider" id={p.id} status={p.status} />
                    <div className="flex gap-3 text-[13px]">
                      <Link href={`/spas/${p.slug}`} className="text-brand-700 hover:underline">
                        View listing
                      </Link>
                      <span className="text-ink-300">·</span>
                      <Link href={`/admin/bookings?provider=${p.id}`} className="text-ink-500 hover:text-brand-700">
                        Bookings
                      </Link>
                    </div>
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

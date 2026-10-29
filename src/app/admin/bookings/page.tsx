import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { ChevronLeft, ChevronRight, Receipt, Search } from 'lucide-react';
import { getDb } from '@/db';
import { agents, bookings, providers } from '@/db/schema';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateTime, cn } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { Badge, BOOKING_STATUS_TONE, PAYMENT_STATUS_TONE, paymentStatusLabel } from '@/components/ui/badge';
import { AdminBookingActions } from '@/components/admin/booking-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Bookings', description: 'All platform bookings.', path: '/admin/bookings', noIndex: true });
}

const STATUSES = ['all', 'pending', 'confirmed', 'completed', 'cancelled', 'no_show'] as const;
const PAGE_SIZE = 25;

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; provider?: string; agent?: string; date?: string; page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const db = await getDb();

  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? (sp.status ?? 'all') : 'all';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const q = sp.q?.trim().toLowerCase() ?? '';

  const filters = [];
  if (status !== 'all') filters.push(eq(bookings.status, status as 'pending'));
  if (sp.provider) filters.push(eq(bookings.providerId, sp.provider));
  if (sp.agent) filters.push(eq(bookings.agentId, sp.agent));
  if (sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)) {
    filters.push(gte(bookings.startAt, new Date(`${sp.date}T00:00:00Z`)));
    filters.push(lte(bookings.startAt, new Date(`${sp.date}T23:59:59Z`)));
  }
  const where = filters.length ? and(...filters) : undefined;

  const [totalRow, rows, providerRow, agentRow] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(where),
    db.query.bookings.findMany({
      where,
      orderBy: [desc(bookings.createdAt)],
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      with: {
        provider: { columns: { name: true, slug: true } },
        branch: { columns: { name: true, timezone: true } },
        treatment: { columns: { name: true } },
        agent: { columns: { companyName: true } },
        payments: { columns: { gateway: true, status: true, createdAt: true }, limit: 1 },
      },
    }),
    sp.provider ? db.query.providers.findFirst({ where: eq(providers.id, sp.provider), columns: { name: true } }) : null,
    sp.agent ? db.query.agents.findFirst({ where: eq(agents.id, sp.agent), columns: { companyName: true } }) : null,
  ]);

  const total = totalRow[0]?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filtered = q
    ? rows.filter(
        (b) =>
          b.guestName.toLowerCase().includes(q) ||
          b.guestEmail.toLowerCase().includes(q) ||
          b.code.toLowerCase().includes(q) ||
          (b.provider?.name ?? '').toLowerCase().includes(q),
      )
    : rows;

  const linkFor = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { status: sp.status, provider: sp.provider, agent: sp.agent, date: sp.date, q: sp.q, page: sp.page, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/admin/bookings?${s}` : '/admin/bookings';
  };

  const scope = [providerRow?.name, agentRow?.companyName].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl">Bookings</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {total} booking{total === 1 ? '' : 's'}{scope ? ` · ${scope}` : ''} · all channels
        </p>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={linkFor({ status: s === 'all' ? undefined : s, page: undefined })}
              className={cn(
                'shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition',
                status === s ? 'bg-brand-700 text-white' : 'border border-ink-200 bg-white text-ink-600 hover:border-brand-300',
              )}
            >
              {s === 'all' ? 'All' : s.replace('_', '-')}
            </Link>
          ))}
        </div>

        <form action="/admin/bookings" method="GET" className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
            <input
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="Guest, email, code or spa…"
              aria-label="Search bookings"
              className="h-9 w-60 rounded-lg border border-ink-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-500"
            />
          </div>
          <input
            type="date"
            name="date"
            defaultValue={sp.date ?? ''}
            aria-label="Date"
            className="h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-[13px] outline-none focus:border-brand-500"
          />
          <input type="hidden" name="status" value={status} />
          <button type="submit" className="h-9 rounded-lg bg-ink-800 px-3.5 text-[13px] font-medium text-white hover:bg-ink-900">
            Search
          </button>
          {(sp.provider || sp.agent || sp.date) && (
            <Link href={linkFor({ provider: undefined, agent: undefined, date: undefined, page: undefined })} className="text-[13px] text-ink-500 underline hover:text-brand-700">
              Clear scope
            </Link>
          )}
        </form>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-14 text-center">
          <p className="text-[15px] font-medium">No bookings match</p>
          <p className="mt-1 text-sm text-ink-500">Try clearing filters.</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((b) => (
            <li key={b.id} className="rounded-2xl border border-ink-100 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12.5px] font-semibold text-brand-700">{b.code}</span>
                    <Badge tone={BOOKING_STATUS_TONE[b.status] ?? 'neutral'}>{b.status.replace('_', '-')}</Badge>
                    <Badge tone={PAYMENT_STATUS_TONE[b.paymentStatus] ?? 'neutral'}>
                      {paymentStatusLabel(b.paymentStatus)}
                    </Badge>
                    <Badge tone={b.channel === 'agent' ? 'clay' : b.channel === 'admin' ? 'info' : 'neutral'}>{b.channel}</Badge>
                  </div>
                  <p className="mt-1.5 text-[15px] font-medium">{b.treatment?.name ?? 'Treatment'}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[13.5px] text-ink-500">
                    <span>{formatDateTime(b.startAt, b.branch?.timezone ?? 'UTC')} · {b.provider?.name} ({b.branch?.name})</span>
                    <span>{b.guestName} · {b.guestEmail}</span>
                    {b.agent && <span className="text-clay-600">via {b.agent.companyName}</span>}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-[13px] tabular-nums text-ink-500">
                    <span>total {formatMoney(b.totalAmount, b.currency)}</span>
                    <span className="text-amber-600">fee {formatMoney(b.platformFee, b.currency)}</span>
                    <span className="text-brand-700">provider {formatMoney(b.providerEarning, b.currency)}</span>
                    {b.agentCommission > 0 && (
                      <span className="text-clay-600">agent {formatMoney(b.agentCommission, b.currency)}</span>
                    )}
                  </p>
                </div>

                <div className="flex flex-col items-start gap-2 lg:items-end">
                  <AdminBookingActions bookingId={b.id} status={b.status} />
                  <div className="flex items-center gap-3 text-[13px]">
                    <Link href={`/voucher/${b.code}`} className="flex items-center gap-1 text-ink-500 hover:text-brand-700">
                      <Receipt className="size-3.5" /> Voucher
                    </Link>
                    <span className="text-ink-300">·</span>
                    <span className="text-ink-400">{formatDate(b.createdAt, undefined, { dateStyle: 'short' })}</span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          <Link
            href={linkFor({ page: page > 1 ? String(page - 1) : undefined })}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white px-4 py-2 text-sm text-ink-700 hover:bg-sand-50',
              page <= 1 && 'pointer-events-none opacity-40',
            )}
          >
            <ChevronLeft className="size-4" /> Previous
          </Link>
          <span className="text-[13px] text-ink-500">Page {page} of {totalPages}</span>
          <Link
            href={linkFor({ page: page < totalPages ? String(page + 1) : undefined })}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white px-4 py-2 text-sm text-ink-700 hover:bg-sand-50',
              page >= totalPages && 'pointer-events-none opacity-40',
            )}
          >
            Next <ChevronRight className="size-4" />
          </Link>
        </nav>
      )}
    </div>
  );
}

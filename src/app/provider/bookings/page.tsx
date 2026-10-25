import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { CalendarDays, ChevronLeft, ChevronRight, Receipt, Search } from 'lucide-react';
import { getDb } from '@/db';
import { bookings, branches, therapists } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateTime, cn } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { Badge, BOOKING_STATUS_TONE, PAYMENT_STATUS_TONE } from '@/components/ui/badge';
import { BookingActions } from '@/components/dash/booking-actions';
import { BookingTherapist, type TherapistOption } from '@/components/dash/booking-therapist';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Bookings', description: 'Manage bookings.', path: '/provider/bookings', noIndex: true });
}

const STATUSES = ['all', 'pending', 'confirmed', 'completed', 'cancelled', 'no_show'] as const;
const PAGE_SIZE = 25;

export default async function ProviderBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; branch?: string; date?: string; page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const providerId = user.provider!.id;
  const db = await getDb();

  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? (sp.status ?? 'all') : 'all';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const q = sp.q?.trim().toLowerCase() ?? '';

  const branchRows = await db.query.branches.findMany({
    where: eq(branches.providerId, providerId),
    columns: { id: true, name: true },
    orderBy: [branches.name],
  });
  const branchIds = branchRows.map((b) => b.id);
  const selectedBranch = sp.branch && branchIds.includes(sp.branch) ? sp.branch : null;

  const therapistRows = branchIds.length
    ? await db.query.therapists.findMany({
        where: inArray(therapists.branchId, branchIds),
        columns: { id: true, name: true, branchId: true, active: true, role: true },
        orderBy: [therapists.name],
      })
    : [];
  const therapistsByBranch = new Map<string, TherapistOption[]>();
  for (const t of therapistRows) {
    if (t.role !== 'therapist') continue; // only bookable staff can be assigned
    const arr = therapistsByBranch.get(t.branchId) ?? [];
    arr.push({ id: t.id, name: t.name, active: t.active });
    therapistsByBranch.set(t.branchId, arr);
  }

  const filters = [eq(bookings.providerId, providerId)];
  if (status !== 'all') filters.push(eq(bookings.status, status as 'pending'));
  if (selectedBranch) filters.push(eq(bookings.branchId, selectedBranch));
  if (sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)) {
    const day = sp.date;
    filters.push(gte(bookings.startAt, new Date(`${day}T00:00:00Z`)));
    filters.push(lte(bookings.startAt, new Date(`${day}T23:59:59Z`)));
  }

  const where = and(...filters);

  const [totalRow, rows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(where),
    db.query.bookings.findMany({
      where,
      orderBy: [desc(bookings.startAt)],
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      with: {
        branch: { columns: { name: true, timezone: true } },
        treatment: { columns: { name: true, durationMin: true, requiresTherapist: true } },
        therapist: { columns: { name: true } },
        payments: { columns: { gateway: true, status: true }, limit: 1 },
      },
    }),
  ]);

  const total = totalRow[0]?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filtered = q
    ? rows.filter(
        (b) =>
          b.guestName.toLowerCase().includes(q) ||
          b.guestEmail.toLowerCase().includes(q) ||
          b.code.toLowerCase().includes(q),
      )
    : rows;

  const linkFor = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { status: sp.status, branch: sp.branch, date: sp.date, q: sp.q, page: sp.page, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/provider/bookings?${s}` : '/provider/bookings';
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl">Bookings</h1>
          <p className="mt-0.5 text-sm text-ink-500">{total} total booking{total === 1 ? '' : 's'}</p>
        </div>
        <form className="relative" action="/provider/bookings" method="GET">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Guest, email or code…"
            aria-label="Search bookings"
            className="h-10 w-56 rounded-full border border-ink-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
          {status !== 'all' && <input type="hidden" name="status" value={status} />}
        </form>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={linkFor({ status: s === 'all' ? undefined : s, page: undefined })}
              className={cn(
                'shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition',
                status === s ? 'bg-brand-700 text-white' : 'bg-white text-ink-600 border border-ink-200 hover:border-brand-300',
              )}
            >
              {s === 'all' ? 'All' : s.replace('_', '-')}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form action="/provider/bookings" method="GET" className="flex items-center gap-2">
            <select
              name="branch"
              defaultValue={selectedBranch ?? ''}
              aria-label="Filter by branch"
              className="h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-[13px] text-ink-700 outline-none focus:border-brand-500"
            >
              <option value="">All branches</option>
              {branchRows.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              name="date"
              defaultValue={sp.date ?? ''}
              aria-label="Filter by date"
              className="h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-[13px] text-ink-700 outline-none focus:border-brand-500"
            />
            <input type="hidden" name="status" value={status} />
            <button type="submit" className="h-9 rounded-lg bg-ink-800 px-3.5 text-[13px] font-medium text-white hover:bg-ink-900">
              Apply
            </button>
            {(selectedBranch || sp.date) && (
              <Link href={linkFor({ branch: undefined, date: undefined, page: undefined })} className="text-[13px] text-ink-500 underline hover:text-brand-700">
                Clear
              </Link>
            )}
          </form>
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-14 text-center">
          <p className="text-[15px] font-medium">No bookings match these filters</p>
          <p className="mt-1 text-sm text-ink-500">Try clearing a filter or search for another guest.</p>
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
                      {b.paymentStatus === 'venue' ? 'pay at venue' : b.paymentStatus}
                    </Badge>
                    <Badge tone={b.channel === 'agent' ? 'clay' : b.channel === 'admin' ? 'info' : 'neutral'}>{b.channel}</Badge>
                  </div>
                  <p className="mt-1.5 text-[15px] font-medium">{b.treatment?.name ?? 'Treatment'}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[13.5px] text-ink-500">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="size-3.5" />
                      {formatDateTime(b.startAt, b.timezone)} ({b.branch?.name})
                    </span>
                    <span>{b.guestName} · {b.guestEmail}</span>
                    {b.treatment?.requiresTherapist && !b.therapistId ? (
                      <span className="font-medium text-amber-700">no therapist yet</span>
                    ) : (
                      b.therapist && <span>with {b.therapist.name}</span>
                    )}
                  </p>
                  <p className="mt-1 text-[13px] tabular-nums text-ink-500">
                    {formatMoney(b.totalAmount, b.currency)}
                    {b.agentCommission > 0 && <span className="text-clay-600"> · agent commission {formatMoney(b.agentCommission, b.currency)}</span>}
                  </p>
                </div>

                <div className="flex flex-col items-start gap-2 lg:items-end">
                  {b.treatment?.requiresTherapist && !['cancelled', 'completed', 'no_show'].includes(b.status) && (
                    <BookingTherapist
                      bookingId={b.id}
                      therapistId={b.therapistId}
                      options={therapistsByBranch.get(b.branchId) ?? []}
                    />
                  )}
                  <BookingActions bookingId={b.id} status={b.status} />
                  <div className="flex items-center gap-3 text-[13px]">
                    <Link href={`/voucher/${b.code}`} className="flex items-center gap-1 text-ink-500 hover:text-brand-700">
                      <Receipt className="size-3.5" /> Voucher
                    </Link>
                    <span className="text-ink-300">·</span>
                    <span className="text-ink-400">booked {formatDate(b.createdAt, undefined, { dateStyle: 'short' })}</span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          <Link
            href={linkFor({ page: page > 1 ? String(page - 1) : undefined })}
            aria-disabled={page <= 1}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white px-4 py-2 text-sm text-ink-700 hover:bg-sand-50',
              page <= 1 && 'pointer-events-none opacity-40',
            )}
          >
            <ChevronLeft className="size-4" /> Previous
          </Link>
          <span className="text-[13px] text-ink-500">
            Page {page} of {totalPages} · {total} bookings
          </span>
          <Link
            href={linkFor({ page: page < totalPages ? String(page + 1) : undefined })}
            aria-disabled={page >= totalPages}
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

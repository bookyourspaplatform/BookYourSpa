import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, MapPin } from 'lucide-react';
import { getDb } from '@/db';
import { getCurrentUser } from '@/lib/auth/session';
import { getSettings } from '@/lib/settings';
import { getMyBookings, bookingSummary, canCancelCustomer } from '@/lib/account';
import { formatDateTime, cn } from '@/lib/utils';
import { formatMoney } from '@/lib/money';
import { pageMetadata } from '@/lib/seo';
import { Badge, BOOKING_STATUS_TONE, PAYMENT_STATUS_TONE, paymentStatusLabel } from '@/components/ui/badge';
import { CancelBookingButton } from '@/components/account/cancel-booking-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: 'My bookings',
    description: 'All your spa bookings and vouchers.',
    path: '/account/bookings',
    noIndex: true,
  });
}

const TABS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

export default async function AccountBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as (typeof TABS)[number]['key']) : 'upcoming';

  const user = (await getCurrentUser())!;
  const db = await getDb();
  const settings = await getSettings();
  const s = bookingSummary(await getMyBookings(db, user));
  const list = s[tab];

  return (
    <div>
      <div className="flex gap-1" role="tablist" aria-label="Booking status">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/account/bookings?tab=${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition',
              tab === t.key ? 'bg-brand-700 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200/70',
            )}
          >
            {t.label}
            <span className="ml-1.5 tabular-nums opacity-70">{s[t.key].length}</span>
          </Link>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
          <p className="text-[15px] font-medium">Nothing here yet</p>
          <p className="mt-1 text-sm text-ink-500">
            {tab === 'upcoming' ? 'Your next reservation will appear here.' : 'No bookings in this list.'}
          </p>
          {tab === 'upcoming' && (
            <Link href="/spas" className="mt-4 inline-block">
              <span className="inline-flex h-11 items-center rounded-full bg-brand-700 px-6 text-sm font-medium text-white hover:bg-brand-800">
                Explore spas
              </span>
            </Link>
          )}
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {list.map((b) => {
            const cancel = canCancelCustomer(b, settings['booking.cancellationHours']);
            return (
              <li key={b.id} className="rounded-2xl border border-ink-100 bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[15.5px] font-medium">{b.treatmentName}</h3>
                      <Badge tone={BOOKING_STATUS_TONE[b.status] ?? 'neutral'}>{b.status}</Badge>
                      <Badge tone={PAYMENT_STATUS_TONE[b.paymentStatus] ?? 'neutral'}>
                        {paymentStatusLabel(b.paymentStatus)}
                      </Badge>
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-[13.5px] text-ink-500">
                      <CalendarDays className="size-3.5 shrink-0" />
                      {formatDateTime(b.startAt, b.timezone)} ({b.timezone})
                      {b.durationMin ? ` · ${b.durationMin} min` : ''}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-[13.5px] text-ink-500">
                      <MapPin className="size-3.5 shrink-0" />
                      {b.branch?.name}, {b.branch?.city}
                    </p>
                    {b.status === 'cancelled' && b.cancelReason && (
                      <p className="mt-1.5 text-[13px] text-rose-600">Reason: {b.cancelReason}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2.5">
                    <div className="text-right">
                      <p className="text-[15px] font-semibold tabular-nums">{formatMoney(b.totalAmount, b.currency)}</p>
                      <p className="font-mono text-[12px] text-ink-400">{b.code}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {b.status !== 'cancelled' && (
                        <Link
                          href={`/voucher/${b.code}`}
                          className="inline-flex h-9 items-center rounded-full border border-ink-200 bg-white px-4 text-[13px] font-medium text-ink-700 hover:border-brand-400 hover:text-brand-800"
                        >
                          Voucher
                        </Link>
                      )}
                      <CancelBookingButton bookingId={b.id} disabled={!cancel.allowed} disabledReason={cancel.reason} />
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

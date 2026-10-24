import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarCheck2, Clock3, Sparkles, Wallet } from 'lucide-react';
import { getDb } from '@/db';
import { getCurrentUser } from '@/lib/auth/session';
import { getSettings } from '@/lib/settings';
import { getMyBookings, bookingSummary, canCancelCustomer } from '@/lib/account';
import { listConfirmableClaims } from '@/lib/claims';
import { ClaimBanner } from '@/components/site/claim-banner';
import { formatDateTime, formatDate } from '@/lib/utils';
import { formatMoney } from '@/lib/money';
import { pageMetadata } from '@/lib/seo';
import { Badge, BOOKING_STATUS_TONE } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat';
import { Button } from '@/components/ui/button';
import { CancelBookingButton } from '@/components/account/cancel-booking-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: 'My account',
    description: 'Your bookings and profile.',
    path: '/account',
    noIndex: true,
  });
}

export default async function AccountOverviewPage() {
  const user = (await getCurrentUser())!;
  const db = await getDb();
  const settings = await getSettings();
  const rows = await getMyBookings(db, user);
  const s = bookingSummary(rows);
  const next = s.next;
  const claimInvites = await listConfirmableClaims(db, user.email);

  return (
    <div className="space-y-7">
      <p className="text-[15px] text-ink-500">
        Welcome back, <span className="font-medium text-ink-800">{user.name.split(' ')[0]}</span>.{' '}
        {next
          ? `Your next treatment is ${formatDate(next.startAt, next.timezone)}.`
          : 'Ready for some relaxation?'}
      </p>

      <ClaimBanner claims={claimInvites} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Upcoming" value={String(s.upcoming.length)} icon={<CalendarCheck2 className="size-4" />} />
        <StatCard label="Completed visits" value={String(s.past.length)} icon={<Clock3 className="size-4" />} />
        <StatCard
          label="Total spent"
          value={formatMoney(s.totalSpend, next?.currency ?? rows[0]?.currency ?? 'IDR')}
          icon={<Wallet className="size-4" />}
        />
        <StatCard label="Member" value="Yes" icon={<Sparkles className="size-4" />} />
      </div>

      {/* Next appointment */}
      {next ? (
        <section className="overflow-hidden rounded-3xl border border-ink-100 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 bg-brand-50/60 px-5 py-3">
            <h2 className="text-[15px] font-semibold">Next appointment</h2>
            <Badge tone={BOOKING_STATUS_TONE[next.status] ?? 'neutral'}>{next.status}</Badge>
          </div>
          <div className="px-5 py-5">
            <p className="text-lg font-medium">{next.treatmentName}</p>
            <p className="mt-0.5 text-sm text-ink-500">
              {next.branch?.name}, {next.branch?.city}
            </p>
            <p className="mt-2 text-sm text-ink-700">
              {formatDateTime(next.startAt, next.timezone)} ({next.timezone})
              {next.therapistName ? ` · with ${next.therapistName}` : ''}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <Link href={`/voucher/${next.code}`}>
                <Button variant="outline" size="sm">
                  View voucher
                </Button>
              </Link>
              <CancelBookingButton
                bookingId={next.id}
                disabled={!canCancelCustomer(next, settings['booking.cancellationHours']).allowed}
                disabledReason={canCancelCustomer(next, settings['booking.cancellationHours']).reason}
              />
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-10 text-center">
          <h2 className="text-lg font-medium">No upcoming appointments</h2>
          <p className="mt-1 text-sm text-ink-500">Book a treatment and your voucher appears here instantly.</p>
          <Link href="/spas" className="mt-4 inline-block">
            <Button size="md">Explore spas</Button>
          </Link>
        </section>
      )}

      {/* Recent */}
      {rows.length > 0 && (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Recent bookings</h2>
            <Link href="/account/bookings" className="text-sm font-medium text-brand-700 hover:underline">
              View all
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100 bg-white">
            {rows.slice(0, 4).map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{b.treatmentName}</p>
                  <p className="truncate text-[13px] text-ink-500">
                    {formatDate(b.startAt, b.timezone)} · {b.branch?.name ?? b.providerName}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium tabular-nums">{formatMoney(b.totalAmount, b.currency)}</span>
                  <Badge tone={BOOKING_STATUS_TONE[b.status] ?? 'neutral'}>{b.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

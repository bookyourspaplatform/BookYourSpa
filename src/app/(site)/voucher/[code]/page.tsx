import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarPlus, CheckCircle2, Clock, Mail, MapPin, Phone, ShieldCheck, XCircle } from 'lucide-react';
import { getDb } from '@/db';
import { bookings } from '@/db/schema';
import { asc, eq } from 'drizzle-orm';
import { getSettings } from '@/lib/settings';
import { formatMoney } from '@/lib/money';
import { cn, formatDate } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { JsonLd } from '@/components/json-ld';
import { Badge, BOOKING_STATUS_TONE, PAYMENT_STATUS_TONE, paymentStatusLabel } from '@/components/ui/badge';
import { Logo } from '@/components/logo';
import { PrintButton } from '@/components/booking/print-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  return pageMetadata({
    title: `Voucher ${code.toUpperCase()}`,
    description: 'Your booking voucher.',
    path: `/voucher/${code}`,
    noIndex: true,
  });
}

function compactUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export default async function VoucherPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const db = await getDb();

  const booking = await db.query.bookings.findFirst({
    where: eq(bookings.code, code.toUpperCase().trim()),
    with: {
      branch: true,
      treatment: true,
      therapist: true,
      payments: true,
      bookingProducts: true,
    },
  });
  if (!booking || !booking.branch || !booking.treatment) notFound();

  // Multi-treatment checkouts share a group id — show every line on one voucher.
  const groupRows = booking.groupId
    ? await db.query.bookings.findMany({
        where: eq(bookings.groupId, booking.groupId),
        with: { treatment: true, therapist: true },
        orderBy: asc(bookings.createdAt),
      })
    : [booking];
  const productLines = booking.bookingProducts ?? [];
  const grandTotal = groupRows.reduce((sum, row) => sum + row.totalAmount, 0);
  const isGroup = groupRows.length > 1;
  // Captured online (the checkout attaches its payment to the first line).
  const paidOnline = (booking.payments ?? [])
    .filter((p) => p.status === 'succeeded')
    .reduce((sum, p) => sum + p.amount - p.refundedAmount, 0);
  const balanceDue = Math.max(0, grandTotal - paidOnline);

  const settings = await getSettings();
  const b = booking.branch;
  const tz = booking.timezone || b.timezone;
  const cancelled = booking.status === 'cancelled';
  const awaitingPayment = booking.paymentStatus === 'unpaid' && booking.status === 'pending';

  const googleCal = (() => {
    const title = `${booking.treatment.name} at ${b.name}`;
    const details = `Voucher ${booking.code}. Present this voucher at reception.`;
    const location = `${b.addressLine}, ${b.city}, ${b.country}`.trim();
    const url = process.env.NEXT_PUBLIC_SITE_URL
      ? `${process.env.NEXT_PUBLIC_SITE_URL}/voucher/${booking.code}`
      : '';
    const q = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      details,
      location,
      dates: `${compactUtc(booking.startAt)}/${compactUtc(booking.endAt)}`,
      ...(url ? { trp: 'false' } : {}),
    });
    return `https://calendar.google.com/calendar/render?${q.toString()}`;
  })();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: `${booking.treatment.name} — ${b.name}`,
    startDate: booking.startAt.toISOString(),
    endDate: booking.endAt.toISOString(),
    eventStatus: cancelled
      ? 'https://schema.org/EventCancelled'
      : 'https://schema.org/EventScheduled',
    location: {
      '@type': 'Place',
      name: b.name,
      address: `${b.addressLine}, ${b.city}, ${b.country}`.trim(),
    },
    performer: { '@type': 'Organization', name: b.name },
    offers: {
      '@type': 'Offer',
      price: String(booking.totalAmount),
      priceCurrency: booking.currency,
      availability: cancelled
        ? 'https://schema.org/OutOfStock'
        : 'https://schema.org/InStock',
    },
  };

  return (
    <>
      <JsonLd data={jsonLd} />

      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 no-print">
        <div className="print:hidden">
          <Logo className="h-8 w-auto" />
        </div>

        {/* Status banner */}
        {cancelled ? (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
            <XCircle className="mt-0.5 size-5 shrink-0 text-rose-600" />
            <div>
              <p className="font-semibold text-rose-800">Booking cancelled</p>
              <p className="text-sm text-rose-700">
                {booking.cancelReason ?? 'This reservation was cancelled.'} Refunds, if any, are processed to the
                original payment method.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            <div>
              <p className="font-semibold text-emerald-800">
                {booking.status === 'completed' ? 'Visit completed' : 'Booking confirmed'}
              </p>
              <p className="text-sm text-emerald-700">
                Present this voucher at reception — {b.name}, {b.city}.
              </p>
            </div>
          </div>
        )}

        {/* Voucher card */}
        <article className="mt-5 overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-sm">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-dashed border-ink-200 bg-sand-50 px-6 py-5">
            <div>
              <p className="text-[12px] uppercase tracking-[0.18em] text-ink-400">Voucher</p>
              <p className="mt-0.5 font-mono text-2xl font-bold tracking-wider text-brand-800">{booking.code}</p>
              <p className="mt-1 text-[13px] text-ink-500">
                Booked on {formatDate(booking.createdAt, undefined, { dateStyle: 'medium' })}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge tone={BOOKING_STATUS_TONE[booking.status] ?? 'neutral'}>{booking.status}</Badge>
              <Badge tone={PAYMENT_STATUS_TONE[booking.paymentStatus] ?? 'neutral'}>
                {paymentStatusLabel(booking.paymentStatus)}
              </Badge>
            </div>
          </header>

          <dl className="grid gap-x-6 gap-y-5 px-6 py-6 sm:grid-cols-2">
            <VoucherField icon={<MapPin className="size-4" />} term="Spa">
              <span className="font-medium">{b.name}</span>
              <span className="block text-[13px] text-ink-500">
                {b.addressLine}, {b.city}, {b.country}
              </span>
            </VoucherField>
            <VoucherField icon={<Clock className="size-4" />} term="Date & time">
              <span className="font-medium">{formatDate(booking.startAt, tz, { dateStyle: 'full' })}</span>
              <span className="block text-[13px] tabular-nums text-ink-500">
                {formatDate(booking.startAt, tz, { timeStyle: 'short' })} –{' '}
                {formatDate(booking.endAt, tz, { timeStyle: 'short' })} ({tz})
              </span>
            </VoucherField>
            <VoucherField icon={<ShieldCheck className="size-4" />} term={isGroup ? 'Treatments' : 'Treatment'}>
              <span className="font-medium">
                {isGroup ? `${groupRows.length} treatments booked` : booking.treatment.name}
              </span>
              <span className="block text-[13px] text-ink-500">
                {isGroup ? 'Each appointment has its own time and therapist below' : `${booking.treatment.durationMin} min`}
                {!isGroup && booking.therapist ? ` · Therapist: ${booking.therapist.name}` : ''}
                {!isGroup && booking.guestCount > 1 ? ` · ${booking.guestCount} persons` : ''}
              </span>
            </VoucherField>
            <VoucherField icon={<Mail className="size-4" />} term="Guest">
              <span className="font-medium">{booking.guestName}</span>
              <span className="block text-[13px] text-ink-500">{booking.guestEmail}{booking.guestPhone ? ` · ${booking.guestPhone}` : ''}</span>
            </VoucherField>
          </dl>

          {(isGroup || productLines.length > 0) && (
            <section className="border-t border-ink-100 px-6 py-5">
              <p className="text-[12px] uppercase tracking-[0.18em] text-ink-400">Your booking</p>
              <ul className="mt-3 divide-y divide-ink-100">
                {groupRows.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-4 py-2.5">
                    <div>
                      <p className="text-[14.5px] font-medium text-ink-800">{row.treatment?.name ?? 'Treatment'}</p>
                      <p className="text-[13px] tabular-nums text-ink-500">
                        {formatDate(row.startAt, tz, { dateStyle: 'medium', timeStyle: 'short' })} –{' '}
                        {formatDate(row.endAt, tz, { timeStyle: 'short' })}
                        {row.therapist ? ` · ${row.therapist.name}` : ''}
                        {row.guestCount > 1 ? ` · ${row.guestCount} persons` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-[14.5px] font-semibold tabular-nums text-ink-800">
                      {formatMoney(row.totalAmount, row.currency)}
                    </span>
                  </li>
                ))}
                {productLines.map((line) => (
                  <li key={line.id} className="flex items-start justify-between gap-4 py-2.5">
                    <div>
                      <p className="text-[14.5px] font-medium text-ink-800">{line.name}</p>
                      <p className="text-[13px] tabular-nums text-ink-500">
                        {line.quantity} × {formatMoney(line.unitPrice, line.currency)}
                      </p>
                    </div>
                    <span className="shrink-0 text-[14.5px] font-semibold tabular-nums text-ink-800">
                      {formatMoney(line.unitPrice * line.quantity, line.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-ink-100 bg-sand-50 px-6 py-4">
            <div>
              <p className="text-[12px] uppercase tracking-wide text-ink-400">
                {booking.paymentStatus === 'deposit_paid' ? 'Total' : 'Total paid'}
              </p>
              <p className="text-lg font-semibold tabular-nums text-brand-800">
                {formatMoney(grandTotal, booking.currency)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a href={googleCal} target="_blank" rel="noopener noreferrer" className="no-print">
                <span className="inline-flex h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 text-sm font-medium text-ink-700 transition hover:border-brand-400 hover:text-brand-800">
                  <CalendarPlus className="size-4" /> Add to calendar
                </span>
              </a>
              <div className="no-print">
                <PrintButton />
              </div>
            </div>
          </footer>
        </article>

        {/* Notices */}
        <div className="mt-5 space-y-3 text-[13px] leading-relaxed text-ink-500">
          {awaitingPayment && booking.expiresAt && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
              Payment is due by{' '}
              {formatDate(booking.expiresAt, tz, { dateStyle: 'medium', timeStyle: 'short' })} ({tz}). Unpaid online
              reservations release the slot automatically.
            </p>
          )}
          {booking.paymentStatus === 'deposit_paid' && (
            <p className="rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-brand-800">
              Deposit paid online — {formatMoney(balanceDue, booking.currency)} is due at the spa when you arrive.
            </p>
          )}
          <p>
            Free cancellation up to {settings['booking.cancellationHours']} hours before the appointment. Please
            arrive 10 minutes early.
          </p>
          {b.phone && (
            <p className="flex items-center gap-1.5">
              <Phone className="size-3.5" /> Reception: <a className="underline" href={`tel:${b.phone}`}>{b.phone}</a>
            </p>
          )}
          <p>
            Need help? <Link className="underline" href="/account/bookings">Manage your bookings</Link> or contact
            support via your account.
          </p>
        </div>
      </div>
    </>
  );
}

function VoucherField({ icon, term, children }: { icon: React.ReactNode; term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[12px] uppercase tracking-wide text-ink-400">
        <span className={cn('text-brand-600')}>{icon}</span>
        {term}
      </dt>
      <dd className="mt-1 text-[14.5px] text-ink-800">{children}</dd>
    </div>
  );
}

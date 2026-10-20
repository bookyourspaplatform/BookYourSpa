'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Loader2,
  MapPin,
  Tag,
  UserRound,
} from 'lucide-react';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/money';
import { cn, formatDate } from '@/lib/utils';
import { CATEGORY_LABELS } from '@/lib/catalog';
import { useToast } from '@/components/ui/toast';
import type { Role } from '@/db/schema';

type Treatment = {
  id: string;
  name: string;
  description: string;
  durationMin: number;
  price: number;
  category: string;
  requiresTherapist: boolean;
};

type SlotDto = { start: string; end: string; therapistId: string | null; therapistName: string | null };
type DayDto = { date: string; count: number; slots: SlotDto[] };

type QuoteDto = {
  pricing: {
    listPrice: number;
    discountAmount: number;
    couponCode: string | null;
    total: number;
    platformFee: number;
    agentCommission: number;
    providerEarning: number;
  };
  currency: string;
  branch: { name: string; city: string; currency: string; cancellationHours: number };
  treatment: { name: string; durationMin: number };
  payment: { online: boolean; venue: boolean; methods: string[] };
};

const STEPS = ['Treatment', 'Date & time', 'Your details', 'Review'] as const;

const GATEWAY_LABELS: Record<string, string> = {
  stripe: 'Pay by card (Stripe)',
  paypal: 'Pay with PayPal',
  razorpay: 'Pay with Razorpay',
  venue: 'Pay at the venue',
};

export function BookingWizard({
  providerSlug,
  branch,
  treatments,
  therapists,
  preselectedTreatmentId,
  user,
  guestCheckout,
}: {
  providerSlug: string;
  branch: {
    id: string;
    slug: string;
    name: string;
    city: string;
    timezone: string;
    currency: string;
    paymentMethods: string[];
    onlinePaymentEnabled: boolean;
    cancellationHours: number;
    leadTimeMinutes: number;
    maxAdvanceDays: number;
  };
  treatments: Treatment[];
  therapists: { id: string; name: string; specialties: string[] }[];
  preselectedTreatmentId: string | null;
  user: { name: string; email: string; phone: string; role: Role } | null;
  guestCheckout: boolean;
}) {
  const toast = useToast();

  const [step, setStep] = useState(preselectedTreatmentId ? 1 : 0);
  const [treatmentId, setTreatmentId] = useState<string | null>(preselectedTreatmentId);
  const [therapistFilter, setTherapistFilter] = useState<string>('any');
  const [availability, setAvailability] = useState<DayDto[] | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  // Loading is DERIVED from the key of the request we're waiting on instead of
  // being setState'd inside the fetch effect: the key changes during render the
  // moment treatment/therapist changes, and settles when the response lands.
  const [availLoadedKey, setAvailLoadedKey] = useState<string | null>(null);
  const availKey = treatmentId ? `${treatmentId}|${therapistFilter}` : null;
  const slotsLoading = availKey !== null && availLoadedKey !== availKey;
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotDto | null>(null);

  const [details, setDetails] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    notes: '',
    coupon: '',
  });
  const [couponInput, setCouponInput] = useState('');
  const [couponApplied, setCouponApplied] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  // Same derived-loading pattern as availability above.
  const [quoteLoadedKey, setQuoteLoadedKey] = useState<string | null>(null);
  const quoteKey = step >= 2 && treatmentId ? `${treatmentId}|${couponApplied ?? ''}` : null;
  const quoteLoading = quoteKey !== null && quoteLoadedKey !== quoteKey;

  const [gatewayChoice, setGatewayChoice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

  const treatment = useMemo(() => treatments.find((t) => t.id === treatmentId) ?? null, [treatments, treatmentId]);

  /* --------------------------- availability -------------------------- */
  // Tracks the most recently started request so a slow stale response can never
  // overwrite a newer one (or strand the derived loading flag).
  const availReqRef = useRef<string | null>(null);

  const loadAvailability = useCallback(
    (therapistId: string) => {
      if (!treatmentId) return;
      const key = `${treatmentId}|${therapistId}`;
      availReqRef.current = key;
      const params = new URLSearchParams({ branchId: branch.id, treatmentId, days: '14' });
      if (therapistId !== 'any') params.set('therapistId', therapistId);
      fetch(`/api/availability?${params.toString()}`, { cache: 'no-store' })
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? 'Could not load availability');
          if (availReqRef.current !== key) return; // superseded by a newer request
          const days: DayDto[] = json.days;
          setAvailability(days);
          setDate((current) => {
            if (current && days.some((d) => d.date === current && d.count > 0)) return current;
            return days.find((d) => d.count > 0)?.date ?? days[0]?.date ?? null;
          });
          setSlot(null);
          setAvailabilityError(null);
          setAvailLoadedKey(key);
        })
        .catch((err: unknown) => {
          if (availReqRef.current !== key) return;
          setAvailabilityError(err instanceof Error ? err.message : 'Availability unavailable');
          setAvailability(null);
          setAvailLoadedKey(key);
        });
    },
    [branch.id, treatmentId],
  );

  // Load availability when the treatment or therapist filter changes — NOT on
  // every step change, which would wipe the selected slot while moving forward.
  useEffect(() => {
    if (treatmentId) void loadAvailability(therapistFilter);
  }, [treatmentId, therapistFilter, loadAvailability]);

  /* ------------------------------ quote ------------------------------ */
  const quoteReqRef = useRef<string | null>(null);

  const loadQuote = useCallback(
    (coupon: string | null) => {
      if (!treatmentId) return;
      const key = `${treatmentId}|${coupon ?? ''}`;
      quoteReqRef.current = key;
      fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: branch.id, treatmentId, couponCode: coupon }),
      })
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? 'Could not price this booking');
          if (quoteReqRef.current !== key) return; // superseded by a newer request
          setQuote(json.quote);
          setQuoteError(null);
          setQuoteLoadedKey(key);
        })
        .catch((err: unknown) => {
          if (quoteReqRef.current !== key) return;
          setQuote(null);
          setQuoteError(err instanceof Error ? err.message : 'Pricing failed');
          setQuoteLoadedKey(key);
        });
    },
    [branch.id, treatmentId],
  );

  useEffect(() => {
    if (step >= 2 && treatmentId) void loadQuote(couponApplied);
  }, [step, treatmentId, couponApplied, loadQuote]);

  // The effective payment method: an explicit user choice wins, otherwise it is
  // derived from the quote — pure state derivation, no effect needed.
  const gateway = useMemo(() => {
    if (gatewayChoice) return gatewayChoice;
    if (!quote) return null;
    const onlineMethod = branch.paymentMethods.find((m) => m !== 'venue');
    if (quote.payment.online && onlineMethod) return onlineMethod;
    if (quote.payment.venue) return 'venue';
    return null;
  }, [gatewayChoice, quote, branch.paymentMethods]);

  /* ----------------------------- selection --------------------------- */
  const daySlots = useMemo(() => availability?.find((d) => d.date === date)?.slots ?? [], [availability, date]);

  const visibleSlots = useMemo(() => {
    if (therapistFilter !== 'any') return daySlots;
    const seen = new Set<string>();
    return daySlots.filter((s) => {
      if (seen.has(s.start)) return false;
      seen.add(s.start);
      return true;
    });
  }, [daySlots, therapistFilter]);

  const chosenTherapistId =
    therapistFilter === 'any' ? null : slot?.therapistId ?? therapistFilter;

  const detailsValid =
    details.name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim());
  const canReview = Boolean(treatment && slot && detailsValid);
  const paymentReady = Boolean(gateway);

  /* ----------------------------- submit ------------------------------ */
  async function submit() {
    if (!treatment || !slot || !canReview || !paymentReady) return;
    setSubmitting(true);
    setSubmitError(null);
    const paymentMode = gateway === 'venue' ? 'venue' : 'online';
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: branch.id,
          treatmentId: treatment.id,
          startAt: slot.start,
          therapistId: chosenTherapistId,
          customer: {
            name: details.name.trim(),
            email: details.email.trim().toLowerCase(),
            phone: details.phone.trim() || null,
          },
          couponCode: couponApplied,
          notes: details.notes.trim() || null,
          paymentMode,
          ...(paymentMode === 'online' && gateway && gateway !== 'venue' ? { gateway } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setSubmitting(false);
          toast.error('That slot was taken', 'Please choose another time.');
          setStep(1);
          setSlot(null);
          setAvailLoadedKey(null); // same-key refetch: flag it as in-flight again
          void loadAvailability(therapistFilter);
          return;
        }
        throw new Error(json.error ?? 'Booking failed');
      }
      const target: string =
        json.payment?.type === 'redirect' ? json.payment.checkoutUrl : json.voucherUrl;
      window.location.assign(target);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Booking failed';
      setSubmitError(message);
      toast.error('Could not complete booking', message);
      setSubmitting(false);
    }
  }

  function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    setCouponApplied(code || null);
  }

  const gatewayOptions = branch.paymentMethods.filter((m) =>
    m === 'venue' ? true : branch.onlinePaymentEnabled && quote?.payment.online,
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Stepper */}
      <ol className="no-scrollbar mb-6 flex items-center gap-1 overflow-x-auto" aria-label="Booking progress">
        {STEPS.map((label, i) => {
          const state = i < step ? 'done' : i === step ? 'current' : 'todo';
          return (
            <li key={label} className="flex items-center">
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                className={cn(
                  'flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium transition',
                  state === 'current' && 'bg-brand-700 text-white',
                  state === 'done' && 'text-brand-700 hover:bg-brand-50',
                  state === 'todo' && 'text-ink-400',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full text-[11px]',
                    state === 'current' ? 'bg-white/20' : state === 'done' ? 'bg-brand-100 text-brand-700' : 'bg-ink-100',
                  )}
                >
                  {state === 'done' ? <Check className="size-3" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>
              {i < STEPS.length - 1 && <ChevronRight className="mx-0.5 size-3.5 text-ink-300" />}
            </li>
          );
        })}
      </ol>

      <div className="gap-7 lg:flex lg:items-start">
        {/* Main column */}
        <div className="min-w-0 flex-1">
          {/* ---------------- Step 1: treatment ---------------- */}
          {step === 0 && (
            <section>
              <h2 className="text-xl">Choose your treatment</h2>
              <p className="mt-1 text-sm text-ink-500">Prices shown for {branch.name} in {branch.currency}.</p>
              <div className="mt-4 space-y-3">
                {treatments.map((t) => {
                  const active = treatmentId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTreatmentId(t.id)}
                      className={cn(
                        'flex w-full flex-col gap-3 rounded-2xl border bg-white p-4 text-left transition sm:flex-row sm:items-center sm:justify-between',
                        active ? 'border-brand-500 ring-2 ring-brand-200' : 'border-ink-100 hover:border-brand-200',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[16px] font-medium">{t.name}</h3>
                          <Badge tone="brand">{CATEGORY_LABELS[t.category] ?? t.category}</Badge>
                          {!t.requiresTherapist && <Badge tone="info">Shared facility</Badge>}
                        </div>
                        {t.description && <p className="mt-1 line-clamp-2 text-[13.5px] text-ink-500">{t.description}</p>}
                        <p className="mt-1.5 flex items-center gap-1 text-[13px] text-ink-400">
                          <Clock className="size-3.5" /> {t.durationMin} min
                        </p>
                      </div>
                      <p className="shrink-0 text-lg font-semibold text-brand-800 sm:text-right">
                        {formatMoney(t.price, branch.currency)}
                      </p>
                    </button>
                  );
                })}
                {treatments.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
                    No treatments published for this branch yet.
                  </p>
                )}
              </div>
              <div className="mt-5">
                <Button size="lg" disabled={!treatment} onClick={() => setStep(1)}>
                  Continue <ChevronRight className="size-4" />
                </Button>
              </div>
            </section>
          )}

          {/* ---------------- Step 2: date & time ---------------- */}
          {step === 1 && treatment && (
            <section>
              <h2 className="text-xl">Pick a date & time</h2>
              <p className="mt-1 text-sm text-ink-500">
                {treatment.name} · {treatment.durationMin} min · times in {branch.city} ({branch.timezone})
              </p>

              {therapists.length > 0 && treatment.requiresTherapist && (
                <div className="mt-4">
                  <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Therapist</p>
                  <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
                    <TherapistChip
                      label="Any therapist"
                      active={therapistFilter === 'any'}
                      onClick={() => setTherapistFilter('any')}
                    />
                    {therapists.map((t) => (
                      <TherapistChip
                        key={t.id}
                        label={t.name}
                        sub={t.specialties[0]}
                        active={therapistFilter === t.id}
                        onClick={() => setTherapistFilter(t.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Date strip */}
              <div className="mt-5">
                <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Date</p>
                {slotsLoading && !availability ? (
                  <div className="flex gap-2">
                    {Array.from({ length: 7 }).map((_, i) => (
                      <div key={i} className="skeleton h-16 w-16 rounded-xl" />
                    ))}
                  </div>
                ) : availabilityError ? (
                  <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{availabilityError}</span>
                  </div>
                ) : (
                  <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                    {(availability ?? []).map((d) => {
                      const active = date === d.date;
                      const disabled = d.count === 0;
                      return (
                        <button
                          key={d.date}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setDate(d.date);
                            setSlot(null);
                          }}
                          className={cn(
                            'flex w-16 shrink-0 flex-col items-center rounded-xl border px-2 py-2.5 text-center transition',
                            active ? 'border-brand-600 bg-brand-700 text-white' : 'border-ink-200 bg-white text-ink-700',
                            disabled && 'cursor-not-allowed opacity-40',
                          )}
                        >
                          <span className="text-[11px] uppercase">{formatDate(d.date, undefined, { weekday: 'short' })}</span>
                          <span className="text-[17px] font-semibold leading-tight">{d.date.slice(8, 10)}</span>
                          <span className={cn('text-[10px]', active ? 'text-white/80' : 'text-ink-400')}>
                            {disabled ? '—' : `${d.count} free`}
                          </span>
                        </button>
                      );
                    })}
                    {(availability ?? []).length === 0 && (
                      <p className="text-sm text-ink-500">No dates available for this treatment.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Slots */}
              <div className="mt-5">
                <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Available times</p>
                {slotsLoading ? (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div key={i} className="skeleton h-10 rounded-lg" />
                    ))}
                  </div>
                ) : visibleSlots.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-ink-200 bg-white px-5 py-8 text-center">
                    <p className="text-sm font-medium text-ink-700">No free times on this date</p>
                    <p className="mt-1 text-[13px] text-ink-500">Try another day{therapistFilter !== 'any' ? ' or therapist' : ''}.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                    {visibleSlots.map((s) => {
                      const active = slot?.start === s.start;
                      return (
                        <button
                          key={s.start}
                          type="button"
                          onClick={() => setSlot(s)}
                          className={cn(
                            'rounded-lg border px-2 py-2.5 text-center text-[14px] font-medium transition',
                            active
                              ? 'border-brand-600 bg-brand-700 text-white'
                              : 'border-ink-200 bg-white text-ink-800 hover:border-brand-400 hover:text-brand-800',
                          )}
                        >
                          {new Intl.DateTimeFormat('en-GB', {
                            timeZone: branch.timezone,
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          }).format(new Date(s.start))}
                          {active && s.therapistName && therapistFilter === 'any' && (
                            <span className="mt-0.5 block text-[10.5px] font-normal text-white/80">{s.therapistName}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-6 flex items-center justify-between gap-3">
                <button type="button" onClick={() => setStep(0)} className={buttonClasses('ghost', 'md')}>
                  <ChevronLeft className="size-4" /> Back
                </button>
                <Button size="lg" disabled={!slot} onClick={() => setStep(2)}>
                  Continue <ChevronRight className="size-4" />
                </Button>
              </div>
            </section>
          )}

          {/* ---------------- Step 3: details + payment ---------------- */}
          {step === 2 && treatment && (
            <section>
              <h2 className="text-xl">{user?.role === 'agent' ? 'Client details' : 'Your details'}</h2>

              {!user && !guestCheckout && (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Guest checkout is disabled — please{' '}
                  <Link className="font-semibold underline" href={`/login?next=${encodeURIComponent(`/spas/${providerSlug}/${branch.slug}/book`)}`}>
                    sign in
                  </Link>{' '}
                  to continue.
                </div>
              )}
              {user && (
                <p className="mt-1 text-[13.5px] text-ink-500">
                  Booking as <span className="font-medium text-ink-800">{user.name}</span> ({user.email})
                </p>
              )}

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Full name" required error={details.name.trim().length >= 2 ? null : undefined}>
                  {({ id, invalid }) => (
                    <Input
                      id={id}
                      value={details.name}
                      onChange={(e) => setDetails((d) => ({ ...d, name: e.target.value }))}
                      autoComplete="name"
                      placeholder="Guest name"
                      disabled={Boolean(user)}
                      invalid={invalid}
                      required
                    />
                  )}
                </Field>
                <Field label="Email (voucher sent here)" required>
                  {({ id }) => (
                    <Input
                      id={id}
                      type="email"
                      value={details.email}
                      onChange={(e) => setDetails((d) => ({ ...d, email: e.target.value }))}
                      autoComplete="email"
                      placeholder="you@example.com"
                      disabled={Boolean(user)}
                      required
                    />
                  )}
                </Field>
                <Field label="Phone (optional)">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="tel"
                      value={details.phone}
                      onChange={(e) => setDetails((d) => ({ ...d, phone: e.target.value }))}
                      autoComplete="tel"
                      placeholder="+62 …"
                    />
                  )}
                </Field>
                <Field label="Promo code">
                  {({ id }) => (
                    <div className="flex gap-2">
                      <Input
                        id={id}
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        placeholder="WELCOME10"
                      />
                      <button type="button" onClick={applyCoupon} className={buttonClasses('outline', 'md', 'shrink-0')}>
                        Apply
                      </button>
                    </div>
                  )}
                </Field>
                <Field label="Notes for the spa (optional)" className="sm:col-span-2">
                  {({ id }) => (
                    <Textarea
                      id={id}
                      value={details.notes}
                      onChange={(e) => setDetails((d) => ({ ...d, notes: e.target.value }))}
                      placeholder="Pressure preference, allergies, arrival time…"
                      maxLength={500}
                    />
                  )}
                </Field>
              </div>

              {/* Payment method */}
              <div className="mt-6">
                <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Payment</p>
                <div className="space-y-2">
                  {gatewayOptions.map((m) => (
                    <label
                      key={m}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-2xl border bg-white px-4 py-3 text-sm transition',
                        gateway === m ? 'border-brand-500 ring-2 ring-brand-200' : 'border-ink-100 hover:border-brand-200',
                      )}
                    >
                      <input
                        type="radio"
                        name="gateway"
                        className="size-4 accent-[#20524c]"
                        checked={gateway === m}
                        onChange={() => setGatewayChoice(m)}
                      />
                      <span className="flex items-center gap-2 font-medium text-ink-800">
                        {m === 'venue' ? <MapPin className="size-4 text-brand-600" /> : <CreditCard className="size-4 text-brand-600" />}
                        {GATEWAY_LABELS[m] ?? m}
                      </span>
                      {m === 'venue' && <span className="ml-auto text-[12.5px] text-ink-500">at reception</span>}
                    </label>
                  ))}
                  {gatewayOptions.length === 0 && (
                    <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      No payment options are available for this branch right now.
                    </p>
                  )}
                </div>
                <p className="mt-2 text-[12.5px] text-ink-500">
                  Free cancellation up to {branch.cancellationHours}h before your appointment.
                </p>
              </div>

              {quoteError && !quoteLoading && (
                <div className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{quoteError}</span>
                </div>
              )}

              <div className="mt-6 flex items-center justify-between gap-3">
                <button type="button" onClick={() => setStep(1)} className={buttonClasses('ghost', 'md')}>
                  <ChevronLeft className="size-4" /> Back
                </button>
                <Button size="lg" disabled={!detailsValid || !paymentReady} onClick={() => setStep(3)}>
                  Review booking <ChevronRight className="size-4" />
                </Button>
              </div>
            </section>
          )}

          {/* ---------------- Step 4: review ---------------- */}
          {step === 3 && treatment && slot && (
            <section ref={reviewRef}>
              <h2 className="text-xl">Review & confirm</h2>

              <div className="mt-4 overflow-hidden rounded-2xl border border-ink-100 bg-white">
                <ReviewRow icon={<UserRound className="size-4" />} label="Guest" value={`${details.name} · ${details.email}`} />
                <ReviewRow icon={<Tag className="size-4" />} label="Treatment" value={`${treatment.name} · ${treatment.durationMin} min`} />
                <ReviewRow
                  icon={<CalendarDays className="size-4" />}
                  label="When"
                  value={`${formatDate(slot.start, branch.timezone)} at ${new Intl.DateTimeFormat('en-GB', {
                    timeZone: branch.timezone,
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  }).format(new Date(slot.start))} (${branch.city} time)`}
                />
                <ReviewRow
                  icon={<MapPin className="size-4" />}
                  label="Where"
                  value={`${branch.name}, ${branch.city}`}
                />
                <ReviewRow
                  icon={<Clock className="size-4" />}
                  label="Therapist"
                  value={
                    chosenTherapistId
                      ? (slot.therapistName ?? therapists.find((t) => t.id === chosenTherapistId)?.name ?? 'Assigned at venue')
                      : slot.therapistName ?? 'First available therapist'
                  }
                />
                <ReviewRow
                  icon={<CreditCard className="size-4" />}
                  label="Payment"
                  value={GATEWAY_LABELS[gateway ?? 'venue'] ?? gateway ?? ''}
                />
              </div>

              {/* Price breakdown */}
              <div className="mt-4 rounded-2xl border border-ink-100 bg-white p-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-500">Price</span>
                  <span className="tabular-nums">{formatMoney(quote?.pricing.listPrice ?? treatment.price, branch.currency)}</span>
                </div>
                {(quote?.pricing.discountAmount ?? 0) > 0 && (
                  <div className="mt-1.5 flex items-center justify-between text-sm">
                    <span className="text-ink-500">
                      Discount {quote?.pricing.couponCode ? `(${quote.pricing.couponCode})` : ''}
                    </span>
                    <span className="tabular-nums text-emerald-600">
                      −{formatMoney(quote!.pricing.discountAmount, branch.currency)}
                    </span>
                  </div>
                )}
                <div className="mt-2.5 flex items-center justify-between border-t border-ink-100 pt-2.5">
                  <span className="font-semibold">Total</span>
                  <span className="text-lg font-semibold tabular-nums text-brand-800">
                    {quoteLoading ? '…' : formatMoney(quote?.pricing.total ?? treatment.price, branch.currency)}
                  </span>
                </div>
                {(quote?.pricing.agentCommission ?? 0) > 0 && (
                  <div className="mt-1.5 flex items-center justify-between text-sm text-clay-700">
                    <span>Your commission (agent rate)</span>
                    <span className="tabular-nums">
                      +{formatMoney(quote!.pricing.agentCommission, branch.currency)}
                    </span>
                  </div>
                )}
                <p className="mt-3 text-[12.5px] leading-relaxed text-ink-400">
                  Paid via {GATEWAY_LABELS[gateway ?? 'venue'] ?? gateway}. Voucher is issued instantly after
                  confirmation and sent to {details.email}.
                </p>
              </div>

              {submitError && (
                <div className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={() => setStep(2)} className={buttonClasses('ghost', 'md')} disabled={submitting}>
                  <ChevronLeft className="size-4" /> Back
                </button>
                <Button size="lg" onClick={submit} loading={submitting} disabled={!canReview || !paymentReady}>
                  {gateway === 'venue' ? 'Confirm reservation' : 'Confirm & pay'}
                </Button>
              </div>
            </section>
          )}
        </div>

        {/* Sticky summary */}
        <aside className="mt-7 w-full shrink-0 lg:mt-0 lg:w-80">
          <div className="sticky top-20 rounded-2xl border border-ink-100 bg-white p-5">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">Your booking</p>
            <p className="mt-2 text-[15px] font-medium">{branch.name}</p>
            <p className="text-[13px] text-ink-500">{branch.city}</p>

            <div className="mt-3 space-y-1.5 border-t border-ink-100 pt-3 text-sm">
              <p className="flex justify-between gap-3">
                <span className="text-ink-500">Treatment</span>
                <span className="text-right font-medium">{treatment ? treatment.name : '—'}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-ink-500">Date</span>
                <span className="text-right font-medium">{slot ? formatDate(slot.start, branch.timezone) : date ? formatDate(date, undefined) : '—'}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-ink-500">Time</span>
                <span className="text-right font-medium tabular-nums">
                  {slot
                    ? new Intl.DateTimeFormat('en-GB', {
                        timeZone: branch.timezone,
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      }).format(new Date(slot.start))
                    : '—'}
                </span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-ink-500">Therapist</span>
                <span className="text-right font-medium">{slot?.therapistName ?? (chosenTherapistId ? 'Selected' : 'Any available')}</span>
              </p>
            </div>

            <div className="mt-3 border-t border-ink-100 pt-3">
              <p className="flex items-center justify-between">
                <span className="text-sm font-semibold">Total</span>
                <span className="text-lg font-semibold tabular-nums text-brand-800">
                  {quote ? formatMoney(quote.pricing.total, branch.currency) : treatment ? formatMoney(treatment.price, branch.currency) : '—'}
                </span>
              </p>
              {quote && quote.pricing.discountAmount > 0 && (
                <p className="mt-0.5 text-right text-[12.5px] text-emerald-600">
                  You save {formatMoney(quote.pricing.discountAmount, branch.currency)}
                </p>
              )}
            </div>

            <p className="mt-3 text-[12px] leading-relaxed text-ink-400">
              {quoteLoading ? 'Updating price…' : `Free cancellation up to ${branch.cancellationHours}h before.`}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TherapistChip({ label, sub, active, onClick }: { label: string; sub?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 flex-col items-start rounded-xl border px-3.5 py-2 text-left transition',
        active ? 'border-brand-600 bg-brand-50 text-brand-900' : 'border-ink-200 bg-white text-ink-700 hover:border-brand-300',
      )}
    >
      <span className="text-[13.5px] font-medium">{label}</span>
      {sub && <span className="text-[11.5px] text-ink-400">{sub}</span>}
    </button>
  );
}

function ReviewRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-ink-100 px-4 py-3 last:border-0">
      <span className="mt-0.5 text-brand-600">{icon}</span>
      <div className="min-w-0">
        <p className="text-[12px] uppercase tracking-wide text-ink-400">{label}</p>
        <p className="text-[14.5px] text-ink-800">{value}</p>
      </div>
    </div>
  );
}

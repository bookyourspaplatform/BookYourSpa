'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  MapPin,
  Minus,
  Plus,
  ShoppingBag,
  UserRound,
  Users,
} from 'lucide-react';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { GREEN_BTN } from '@/components/ui/classes';
import { formatMoney } from '@/lib/money';
import { cn, formatDate } from '@/lib/utils';
import { CATEGORY_LABELS } from '@/lib/catalog';
import { useToast } from '@/components/ui/toast';
import type { Role } from '@/db/schema';

type PriceTier = { durationMin: number; price: number; capacity?: number | null };

type Treatment = {
  id: string;
  name: string;
  description: string;
  durationMin: number;
  price: number;
  /** Duration/price tiers for this branch — first entry is the default. */
  priceOptions: PriceTier[];
  category: string;
  requiresTherapist: boolean;
  /** Concurrent guests this treatment seats (per tier when given). */
  capacity: number;
  benefits: string[];
  /** Pre-resolved spa-type chip labels. */
  tags: string[];
  /** 'Man Only' / 'Woman Only' — null when the treatment suits everyone. */
  genreLabel: string | null;
  /** 'Doorstep' / 'In Spa' — null when both deliveries are offered. */
  deliveryLabel: string | null;
};

type Product = { id: string; name: string; description: string | null; price: number };

type SlotDto = { start: string; end: string; therapistId: string | null; therapistName: string | null };
type DayDto = { date: string; count: number; slots: SlotDto[] };
type TogetherSlotDto = {
  start: string;
  end: string;
  therapists: { itemIndex: number; therapistId: string | null; therapistName: string | null }[];
};
type TogetherDayDto = { date: string; count: number; slots: TogetherSlotDto[] };

/** One selected treatment: which tier, how many guests. */
type CartLine = { treatmentId: string; optionIndex: number; persons: number };
type LineTime = { date: string | null; slot: SlotDto | null };
type ScheduleMode = 'together' | 'split';

type QuoteDto = {
  branch: { name: string; city: string; currency: string; cancellationHours: number };
  lines: {
    treatmentId: string;
    name: string;
    optionIndex: number | null;
    durationMin: number;
    unitPrice: number;
    persons: number;
    lineTotal: number;
    requiresTherapist: boolean;
  }[];
  products: { productId: string | null; name: string; unitPrice: number; quantity: number; lineTotal: number }[];
  treatmentsTotal: number;
  productsTotal: number;
  listPrice: number;
  currency: string;
  pricing: {
    listPrice: number;
    discountAmount: number;
    couponCode: string | null;
    total: number;
    platformFee: number;
    agentCommission: number;
    providerEarning: number;
  };
  couponCode: string | null;
  payment: { online: boolean; venue: boolean; methods: string[] };
};

const STEPS = ['Treatment', 'Date & time', 'Your details', 'Review'] as const;

const GATEWAY_LABELS: Record<string, string> = {
  stripe: 'Pay by card (Stripe)',
  paypal: 'Pay with PayPal',
  razorpay: 'Pay with Razorpay',
  venue: 'Pay at the venue',
};

const MAX_CART = 8;

function tiersOf(t: Treatment): PriceTier[] {
  return t.priceOptions.length
    ? t.priceOptions
    : [{ durationMin: t.durationMin, price: t.price, capacity: t.capacity }];
}

export function BookingWizard({
  providerSlug,
  branch,
  treatments,
  products,
  therapists,
  preselectedTreatmentId,
  preselectedOptionIndex = null,
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
  products: Product[];
  therapists: { id: string; name: string; specialties: string[]; avatarUrl: string | null }[];
  preselectedTreatmentId: string | null;
  /** Which duration/price tier to preselect (from the spa page's per-option Book links). */
  preselectedOptionIndex?: number | null;
  user: { name: string; email: string; phone: string; role: Role } | null;
  guestCheckout: boolean;
}) {
  const toast = useToast();

  const [step, setStep] = useState(preselectedTreatmentId ? 1 : 0);
  const [cart, setCart] = useState<CartLine[]>(() =>
    preselectedTreatmentId
      ? [{ treatmentId: preselectedTreatmentId, optionIndex: preselectedOptionIndex ?? 0, persons: 1 }]
      : [],
  );
  const [productQty, setProductQty] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<ScheduleMode>('together');
  const [therapistFilter, setTherapistFilter] = useState<string>('any');

  // Shared scheduling (single-line cart, or Together mode).
  const [singleDays, setSingleDays] = useState<DayDto[] | null>(null);
  const [togetherDays, setTogetherDays] = useState<TogetherDayDto[] | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [availLoadedKey, setAvailLoadedKey] = useState<string | null>(null);
  const [availNonce, setAvailNonce] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotDto | null>(null);
  const [togetherSlot, setTogetherSlot] = useState<TogetherSlotDto | null>(null);

  // Split mode: each cart line keeps its own date + slot.
  const [lineTimes, setLineTimes] = useState<Record<string, LineTime>>({});
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

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
  const [quoteLoadedKey, setQuoteLoadedKey] = useState<string | null>(null);

  const [gatewayChoice, setGatewayChoice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const treatmentById = useMemo(() => new Map(treatments.map((t) => [t.id, t])), [treatments]);

  /* --------------------------- cart helpers --------------------------- */
  const togetherMode = cart.length > 1 && mode === 'together';
  const isSplit = cart.length > 1 && mode === 'split';
  const activeLine: CartLine | null = isSplit
    ? (cart.find((l) => l.treatmentId === activeLineId) ?? cart[0] ?? null)
    : null;
  const primaryLine: CartLine | null = cart[0] ?? null;

  function patchLine(id: string, patch: Partial<CartLine>) {
    setCart((current) =>
      current.map((l) => {
        if (l.treatmentId !== id) return l;
        const next = { ...l, ...patch };
        const t = treatmentById.get(id);
        if (t) {
          const tiers = tiersOf(t);
          const tier = tiers[Math.min(Math.max(next.optionIndex, 0), tiers.length - 1)]!;
          const max = Math.max(1, Math.min(8, tier.capacity ?? t.capacity));
          next.persons = Math.min(Math.max(1, next.persons), max);
        }
        return next;
      }),
    );
  }

  function toggleTreatment(id: string) {
    const exists = cart.some((l) => l.treatmentId === id);
    if (exists) {
      setCart((c) => c.filter((l) => l.treatmentId !== id));
      setActiveLineId((cur) => (cur === id ? null : cur));
      setLineTimes((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
      if (primaryLine?.treatmentId === id) {
        setSlot(null);
        setTogetherSlot(null);
      }
      return;
    }
    if (cart.length >= MAX_CART) {
      toast.error('Cart is full', `A single booking can hold up to ${MAX_CART} treatments.`);
      return;
    }
    setCart((c) => [...c, { treatmentId: id, optionIndex: 0, persons: 1 }]);
  }

  /** Pick a duration tier — also selects the treatment if it isn't in the cart yet. */
  function selectTier(id: string, optionIndex: number) {
    if (!cart.some((l) => l.treatmentId === id)) {
      if (cart.length >= MAX_CART) {
        toast.error('Cart is full', `A single booking can hold up to ${MAX_CART} treatments.`);
        return;
      }
      setCart((c) => [...c, { treatmentId: id, optionIndex, persons: 1 }]);
      return;
    }
    patchLine(id, { optionIndex });
  }

  function bumpPersons(id: string, delta: number) {
    const line = cart.find((l) => l.treatmentId === id);
    const t = treatmentById.get(id);
    if (!line || !t) return;
    const tiers = tiersOf(t);
    const tier = tiers[Math.min(Math.max(line.optionIndex, 0), tiers.length - 1)]!;
    const max = Math.max(1, Math.min(8, tier.capacity ?? t.capacity));
    patchLine(id, { persons: Math.min(max, Math.max(1, line.persons + delta)) });
  }

  function bumpProduct(id: string, delta: number) {
    setProductQty((m) => {
      const next = Math.min(99, Math.max(0, (m[id] ?? 0) + delta));
      const copy = { ...m };
      if (next === 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });
  }

  const productLines = useMemo(
    () =>
      Object.entries(productQty)
        .filter(([, qty]) => qty > 0)
        .map(([productId, quantity]) => ({ productId, quantity })),
    [productQty],
  );

  const cartEstimate = useMemo(
    () =>
      cart.reduce((sum, l) => {
        const t = treatmentById.get(l.treatmentId);
        if (!t) return sum;
        const tiers = tiersOf(t);
        const tier = tiers[Math.min(Math.max(l.optionIndex, 0), tiers.length - 1)]!;
        return sum + tier.price * l.persons;
      }, 0) +
      productLines.reduce((sum, l) => {
        const p = products.find((x) => x.id === l.productId);
        return sum + (p?.price ?? 0) * l.quantity;
      }, 0),
    [cart, treatmentById, productLines, products],
  );

  /* --------------------------- availability --------------------------- */
  // One descriptor per distinct request; the effect refetches when it changes
  // (or when the nonce bumps after a 409 conflict).
  const availReq = useMemo<{
    key: string;
    kind: 'single' | 'together';
    url: string | null;
    body: unknown;
    splitLineId: string | null;
  } | null>(() => {
    if (!cart.length) return null;
    const paramsOf = (line: CartLine) => {
      const params = new URLSearchParams({
        branchId: branch.id,
        treatmentId: line.treatmentId,
        days: '14',
        persons: String(line.persons),
        optionIndex: String(line.optionIndex),
      });
      if (therapistFilter !== 'any') params.set('therapistId', therapistFilter);
      return `/api/availability?${params.toString()}`;
    };
    if (isSplit && activeLine) {
      return {
        key: `sp|${activeLine.treatmentId}|${activeLine.optionIndex}|${activeLine.persons}|${therapistFilter}|${availNonce}`,
        kind: 'single',
        url: paramsOf(activeLine),
        body: null,
        splitLineId: activeLine.treatmentId,
      };
    }
    if (togetherMode) {
      return {
        key: `tg|${cart.map((l) => `${l.treatmentId}:${l.optionIndex}:${l.persons}`).join(',')}|${availNonce}`,
        kind: 'together',
        url: null,
        body: {
          branchId: branch.id,
          items: cart.map((l) => ({
            treatmentId: l.treatmentId,
            optionIndex: l.optionIndex,
            persons: l.persons,
          })),
          days: 14,
        },
        splitLineId: null,
      };
    }
    const line = cart[0]!;
    return {
      key: `si|${line.treatmentId}|${line.optionIndex}|${line.persons}|${therapistFilter}|${availNonce}`,
      kind: 'single',
      url: paramsOf(line),
      body: null,
      splitLineId: null,
    };
  }, [cart, isSplit, togetherMode, activeLine, therapistFilter, availNonce, branch.id]);

  const availReqRef = useRef<string | null>(null);
  const slotsLoading = availReq !== null && availLoadedKey !== availReq.key;

  useEffect(() => {
    if (!availReq) return;
    const req = availReq;
    availReqRef.current = req.key;
    const run =
      req.kind === 'together'
        ? fetch('/api/availability/together', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body),
            cache: 'no-store',
          })
        : fetch(req.url!, { cache: 'no-store' });
    run
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Could not load availability');
        if (availReqRef.current !== req.key) return; // superseded by a newer request
        const pickDate = (current: string | null, days: { date: string; count: number }[]) =>
          current && days.some((d) => d.date === current && d.count > 0)
            ? current
            : (days.find((d) => d.count > 0)?.date ?? days[0]?.date ?? null);
        if (req.kind === 'together') {
          const days = json.days as TogetherDayDto[];
          setTogetherDays(days);
          setDate((current) => pickDate(current, days));
          setTogetherSlot(null);
        } else {
          const days = json.days as DayDto[];
          setSingleDays(days);
          if (req.splitLineId) {
            const lineId = req.splitLineId;
            setLineTimes((m) => ({
              ...m,
              [lineId]: { date: pickDate(m[lineId]?.date ?? null, days), slot: null },
            }));
          } else {
            setDate((current) => pickDate(current, days));
            setSlot(null);
          }
        }
        setAvailabilityError(null);
        setAvailLoadedKey(req.key);
      })
      .catch((err: unknown) => {
        if (availReqRef.current !== req.key) return;
        setAvailabilityError(err instanceof Error ? err.message : 'Availability unavailable');
        setSingleDays(null);
        setTogetherDays(null);
        setAvailLoadedKey(req.key);
      });
  }, [availReq]);

  /* ------------------------------ quote ------------------------------ */
  const quoteBody = useMemo(
    () =>
      cart.length
        ? { branchId: branch.id, items: cart, products: productLines, couponCode: couponApplied }
        : null,
    [cart, productLines, couponApplied, branch.id],
  );
  const quoteKey = step >= 2 && quoteBody ? JSON.stringify(quoteBody) : null;
  const quoteLoading = quoteKey !== null && quoteLoadedKey !== quoteKey;

  useEffect(() => {
    if (step < 2 || !quoteBody) return;
    const key = JSON.stringify(quoteBody);
    fetch('/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quoteBody),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Could not price this booking');
        setQuote(json.quote);
        setQuoteError(null);
        setQuoteLoadedKey(key);
      })
      .catch((err: unknown) => {
        setQuote(null);
        setQuoteError(err instanceof Error ? err.message : 'Pricing failed');
        setQuoteLoadedKey(key);
      });
  }, [step, quoteBody]);

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
  const shownDays: { date: string; count: number }[] = togetherMode
    ? (togetherDays ?? [])
    : (singleDays ?? []);
  const selectedDate = isSplit && activeLine
    ? (lineTimes[activeLine.treatmentId]?.date ?? null)
    : date;
  const selectedSingleSlot =
    isSplit && activeLine ? (lineTimes[activeLine.treatmentId]?.slot ?? null) : slot;

  const visibleSlots = useMemo(() => {
    const rawDaySlots: SlotDto[] = singleDays?.find((d) => d.date === selectedDate)?.slots ?? [];
    if (therapistFilter !== 'any') return rawDaySlots;
    const seen = new Set<string>();
    return rawDaySlots.filter((s) => {
      if (seen.has(s.start)) return false;
      seen.add(s.start);
      return true;
    });
  }, [singleDays, selectedDate, therapistFilter]);
  const togetherDaySlots = togetherDays?.find((d) => d.date === selectedDate)?.slots ?? [];

  function pickDate(next: string) {
    if (isSplit && activeLine) {
      setLineTimes((m) => ({ ...m, [activeLine.treatmentId]: { date: next, slot: null } }));
    } else if (togetherMode) {
      setDate(next);
      setTogetherSlot(null);
    } else {
      setDate(next);
      setSlot(null);
    }
  }

  const scheduleReady = togetherMode
    ? Boolean(togetherSlot)
    : isSplit
      ? cart.every((l) => Boolean(lineTimes[l.treatmentId]?.slot))
      : Boolean(slot);

  const detailsValid =
    details.name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim());
  const canReview = cart.length > 0 && scheduleReady && detailsValid;
  const paymentReady = Boolean(gateway);

  const fmtTime = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: branch.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));

  const lineTherapist = (line: CartLine, index: number): string | null => {
    if (togetherMode && togetherSlot) {
      return togetherSlot.therapists.find((a) => a.itemIndex === index)?.therapistName ?? null;
    }
    if (isSplit) return lineTimes[line.treatmentId]?.slot?.therapistName ?? null;
    if (slot) return slot.therapistName ?? null;
    return null;
  };

  const lineTimeIso = (line: CartLine): string | null => {
    if (togetherMode) return togetherSlot?.start ?? null;
    if (isSplit) return lineTimes[line.treatmentId]?.slot?.start ?? null;
    return slot?.start ?? null;
  };

  /* ----------------------------- submit ------------------------------ */
  async function submit() {
    if (!cart.length || !scheduleReady || !canReview || !paymentReady) return;
    setSubmitting(true);
    setSubmitError(null);
    const paymentMode = gateway === 'venue' ? 'venue' : 'online';

    const items = cart.map((line, index) => {
      if (togetherMode && togetherSlot) {
        const assigned = togetherSlot.therapists.find((a) => a.itemIndex === index);
        return {
          treatmentId: line.treatmentId,
          optionIndex: line.optionIndex,
          persons: line.persons,
          startAt: togetherSlot.start,
          therapistId: assigned?.therapistId ?? null,
        };
      }
      if (isSplit) {
        const t = lineTimes[line.treatmentId]?.slot;
        return {
          treatmentId: line.treatmentId,
          optionIndex: line.optionIndex,
          persons: line.persons,
          startAt: t?.start ?? '',
          therapistId: t?.therapistId ?? null,
        };
      }
      return {
        treatmentId: line.treatmentId,
        optionIndex: line.optionIndex,
        persons: line.persons,
        startAt: slot?.start ?? '',
        therapistId: chosenTherapistId,
      };
    });

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: branch.id,
          items,
          products: productLines,
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
          setTogetherSlot(null);
          setLineTimes({});
          setAvailLoadedKey(null);
          setAvailNonce((n) => n + 1); // same-key refetch of availability
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

  const chosenTherapistId =
    therapistFilter === 'any' ? (slot?.therapistId ?? null) : therapistFilter;

  const total = quote?.pricing.total ?? cartEstimate;

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
            <section className="rounded-3xl border border-ink-100 bg-white p-5 sm:p-6">
              <StepHeading>Choose your treatment</StepHeading>
              <p className="mt-1 text-sm text-ink-500">
                Pick one or more treatments — prices for {branch.name} in {branch.currency}.
              </p>

              <div className="mt-4 space-y-3">
                {treatments.map((t) => {
                  const active = cart.some((l) => l.treatmentId === t.id);
                  const line = cart.find((l) => l.treatmentId === t.id);
                  const tiers = tiersOf(t);
                  const tierIdx = Math.min(Math.max(line?.optionIndex ?? 0, 0), tiers.length - 1);
                  const tier = tiers[tierIdx]!;
                  const maxPersons = Math.max(1, Math.min(8, tier.capacity ?? t.capacity));
                  const shownPrice = active ? tier.price : Math.min(...tiers.map((x) => x.price));
                  const toggle = () => toggleTreatment(t.id);
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        'rounded-3xl border bg-white p-5 transition',
                        active ? 'border-brand-500 ring-2 ring-brand-200' : 'border-ink-100 hover:border-brand-200',
                      )}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div
                          className="min-w-0 max-w-2xl flex-1 cursor-pointer"
                          onClick={toggle}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-[17px] font-semibold text-ink-900">{t.name}</h3>
                            {t.tags.length > 0 ? (
                              t.tags.map((tag) => (
                                <Badge key={tag} tone="brand">{tag}</Badge>
                              ))
                            ) : (
                              <Badge tone="brand">{CATEGORY_LABELS[t.category] ?? t.category}</Badge>
                            )}
                          </div>
                          {t.description && (
                            <div
                              className="mt-1.5 [&:has(details[open])_p]:line-clamp-none"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <p className="text-[13.5px] leading-relaxed text-ink-600 line-clamp-2">{t.description}</p>
                              <details className="group mt-1">
                                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-brand-700 transition hover:text-brand-800 [&::-webkit-details-marker]:hidden">
                                  <span className="group-open:hidden">View more ↓</span>
                                  <span className="hidden group-open:inline">Show less ↑</span>
                                </summary>
                              </details>
                            </div>
                          )}
                          {t.benefits.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {t.benefits.slice(0, 2).map((ben) => (
                                <span
                                  key={ben}
                                  className="rounded-md bg-sand-100 px-2 py-0.5 text-[11.5px] text-ink-600"
                                >
                                  {ben}
                                </span>
                              ))}
                            </div>
                          )}
                          {/* Duration tiers — the same pills the spa page shows; tapping one
                              selects the treatment at that tier. */}
                          <div
                            className="mt-3 flex flex-wrap items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {tiers.map((o, i) => (
                              <button
                                key={`${o.durationMin}-${i}`}
                                type="button"
                                onClick={() => selectTier(t.id, i)}
                                aria-pressed={active && i === tierIdx}
                                className={cn(
                                  'rounded-lg px-2.5 py-1 text-[12.5px] font-medium transition',
                                  active && i === tierIdx
                                    ? 'bg-brand-700 text-white'
                                    : 'bg-ink-100 text-ink-600 hover:bg-ink-200',
                                )}
                              >
                                {o.durationMin} min
                              </button>
                            ))}
                            {t.genreLabel && <Badge tone="info">{t.genreLabel}</Badge>}
                            {t.deliveryLabel && (
                              <Badge tone={t.deliveryLabel === 'Doorstep' ? 'clay' : 'neutral'}>
                                {t.deliveryLabel}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
                          <p className="text-[15px] text-ink-500">
                            {tiers.length > 1 && <span>From </span>}
                            <span className="text-xl font-bold tabular-nums text-ink-900">
                              {formatMoney(shownPrice, branch.currency)}
                            </span>
                          </p>
                          <button
                            type="button"
                            onClick={toggle}
                            aria-pressed={active}
                            className={`${GREEN_BTN} h-10 px-5 text-[13.5px]`}
                          >
                            {active ? (
                              <>
                                <Check className="size-4" strokeWidth={3} />
                                Selected
                              </>
                            ) : (
                              'Select'
                            )}
                          </button>
                        </div>
                      </div>

                      {active && line && (
                        <div
                          className="mt-3 space-y-3 border-t border-ink-100 pt-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <div className="flex items-center gap-1.5">
                              <span className="mr-1 text-[13px] text-ink-500">Persons</span>
                              <button
                                type="button"
                                aria-label={`Fewer persons for ${t.name}`}
                                onClick={() => bumpPersons(t.id, -1)}
                                disabled={line.persons <= 1}
                                className="flex size-7 items-center justify-center rounded-lg border border-ink-200 text-ink-700 transition hover:border-brand-400 hover:text-brand-800 disabled:opacity-40"
                              >
                                <Minus className="size-3.5" />
                              </button>
                              <span className="w-6 text-center text-[15px] font-semibold tabular-nums">
                                {line.persons}
                              </span>
                              <button
                                type="button"
                                aria-label={`More persons for ${t.name}`}
                                onClick={() => bumpPersons(t.id, 1)}
                                disabled={line.persons >= maxPersons}
                                className="flex size-7 items-center justify-center rounded-lg border border-ink-200 text-ink-700 transition hover:border-brand-400 hover:text-brand-800 disabled:opacity-40"
                              >
                                <Plus className="size-3.5" />
                              </button>
                              {maxPersons > 1 && (
                                <span className="ml-1 text-[12px] text-ink-400">max {maxPersons}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {treatments.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
                    No treatments published for this branch yet.
                  </p>
                )}
              </div>

              {/* Retail products */}
              {products.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-ink-400">
                    <ShoppingBag className="size-3.5" /> Add products
                  </p>
                  <div className="space-y-2">
                    {products.map((p) => {
                      const qty = productQty[p.id] ?? 0;
                      return (
                        <div
                          key={p.id}
                          className={cn(
                            'flex items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3 transition',
                            qty > 0 ? 'border-brand-500 ring-1 ring-brand-200' : 'border-ink-100',
                          )}
                        >
                          <div className="min-w-0">
                            <p className="text-[14.5px] font-medium text-ink-900">{p.name}</p>
                            {p.description && (
                              <p className="truncate text-[13px] text-ink-500">{p.description}</p>
                            )}
                            <p className="text-[13px] font-semibold tabular-nums text-brand-800">
                              {formatMoney(p.price, branch.currency)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              aria-label={`Remove one ${p.name}`}
                              onClick={() => bumpProduct(p.id, -1)}
                              disabled={qty === 0}
                              className="flex size-7 items-center justify-center rounded-lg border border-ink-200 text-ink-700 transition hover:border-brand-400 hover:text-brand-800 disabled:opacity-40"
                            >
                              <Minus className="size-3.5" />
                            </button>
                            <span className="w-6 text-center text-[15px] font-semibold tabular-nums">
                              {qty}
                            </span>
                            <button
                              type="button"
                              aria-label={`Add one ${p.name}`}
                              onClick={() => bumpProduct(p.id, 1)}
                              disabled={qty >= 99}
                              className="flex size-7 items-center justify-center rounded-lg border border-ink-200 text-ink-700 transition hover:border-brand-400 hover:text-brand-800 disabled:opacity-40"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] text-ink-500">
                  {cart.length === 0
                    ? 'Select at least one treatment to continue.'
                    : `${cart.length} treatment${cart.length > 1 ? 's' : ''} selected`}
                  {productLines.length > 0 && ` · ${productLines.length} product line${productLines.length > 1 ? 's' : ''}`}
                </p>
                <Button size="lg" disabled={cart.length === 0} onClick={() => setStep(1)}>
                  Continue <ChevronRight className="size-4" />
                </Button>
              </div>
            </section>
          )}

          {/* ---------------- Step 2: date & time ---------------- */}
          {step === 1 && cart.length > 0 && (
            <section className="rounded-3xl border border-ink-100 bg-white p-5 sm:p-6">
              <StepHeading>Pick a date & time</StepHeading>
              <p className="mt-1 text-sm text-ink-500">
                {togetherMode
                  ? 'All treatments start at the same time'
                  : isSplit
                    ? 'Each treatment gets its own time'
                    : primaryLine && treatmentById.get(primaryLine.treatmentId)
                      ? `${treatmentById.get(primaryLine.treatmentId)!.name} · ${
                          tiersOf(treatmentById.get(primaryLine.treatmentId)!)[
                            Math.min(primaryLine.optionIndex, tiersOf(treatmentById.get(primaryLine.treatmentId)!).length - 1)
                          ]!.durationMin
                        } min · ${primaryLine.persons} ${primaryLine.persons > 1 ? 'persons' : 'person'}`
                      : ''}{' '}
                · times in {branch.city} ({branch.timezone})
              </p>

              {/* Schedule mode — only meaningful with more than one treatment */}
              {cart.length > 1 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <ModeCard
                    title="Together"
                    desc="All treatments start at the same time"
                    icon={<Users className="size-4" />}
                    active={mode === 'together'}
                    onClick={() => setMode('together')}
                  />
                  <ModeCard
                    title="Split time"
                    desc="Pick a different time for each treatment"
                    icon={<CalendarDays className="size-4" />}
                    active={mode === 'split'}
                    onClick={() => {
                      setMode('split');
                      setActiveLineId((cur) => cur ?? cart[0]?.treatmentId ?? null);
                    }}
                  />
                </div>
              )}

              {/* Split mode: per-line picker */}
              {isSplit && (
                <div className="mt-4">
                  <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-400">
                    Treatment
                  </p>
                  <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
                    {cart.map((l, i) => {
                      const t = treatmentById.get(l.treatmentId);
                      const done = lineTimes[l.treatmentId]?.slot;
                      const active = activeLine?.treatmentId === l.treatmentId;
                      return (
                        <button
                          key={l.treatmentId}
                          type="button"
                          onClick={() => setActiveLineId(l.treatmentId)}
                          className={cn(
                            'flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-left text-[13.5px] font-medium transition',
                            active
                              ? 'border-brand-600 bg-brand-50 text-brand-900'
                              : 'border-ink-200 bg-white text-ink-700 hover:border-brand-300',
                          )}
                        >
                          {done ? (
                            <Check className="size-3.5 shrink-0 text-brand-600" strokeWidth={3} />
                          ) : (
                            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[10px] text-ink-500">
                              {i + 1}
                            </span>
                          )}
                          <span className="max-w-40 truncate">{t?.name ?? 'Treatment'}</span>
                          {done && (
                            <span className="tabular-nums text-ink-500">{fmtTime(done.start)}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Therapist — single treatment only (groups get distinct auto-assignments) */}
              {therapists.length > 0 && cart.length === 1 && primaryLine &&
                treatmentById.get(primaryLine.treatmentId)?.requiresTherapist && (
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
                        avatar={t.avatarUrl}
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
                {slotsLoading && shownDays.length === 0 ? (
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
                    {shownDays.map((d) => {
                      const active = selectedDate === d.date;
                      const disabled = d.count === 0;
                      return (
                        <button
                          key={d.date}
                          type="button"
                          disabled={disabled}
                          onClick={() => pickDate(d.date)}
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
                    {shownDays.length === 0 && !availabilityError && (
                      <p className="text-sm text-ink-500">
                        No dates available for {isSplit ? 'this treatment' : 'these treatments'}.
                      </p>
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
                ) : togetherMode ? (
                  togetherDaySlots.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ink-200 bg-white px-5 py-8 text-center">
                      <p className="text-sm font-medium text-ink-700">No shared times on this date</p>
                      <p className="mt-1 text-[13px] text-ink-500">Try another day, or switch to Split time.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                      {togetherDaySlots.map((s) => {
                        const active = togetherSlot?.start === s.start;
                        return (
                          <button
                            key={s.start}
                            type="button"
                            onClick={() => setTogetherSlot(s)}
                            className={cn(
                              'rounded-lg border px-2 py-2.5 text-center text-[14px] font-medium transition',
                              active
                                ? 'border-brand-600 bg-brand-700 text-white'
                                : 'border-ink-200 bg-white text-ink-800 hover:border-brand-400 hover:text-brand-800',
                            )}
                          >
                            {fmtTime(s.start)}
                          </button>
                        );
                      })}
                    </div>
                  )
                ) : visibleSlots.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-ink-200 bg-white px-5 py-8 text-center">
                    <p className="text-sm font-medium text-ink-700">No free times on this date</p>
                    <p className="mt-1 text-[13px] text-ink-500">Try another day{therapistFilter !== 'any' ? ' or therapist' : ''}.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                    {visibleSlots.map((s) => {
                      const active = selectedSingleSlot?.start === s.start;
                      return (
                        <button
                          key={s.start}
                          type="button"
                          onClick={() => {
                            if (isSplit && activeLine) {
                              setLineTimes((m) => ({
                                ...m,
                                [activeLine.treatmentId]: { date: selectedDate, slot: s },
                              }));
                            } else {
                              setSlot(s);
                            }
                          }}
                          className={cn(
                            'rounded-lg border px-2 py-2.5 text-center text-[14px] font-medium transition',
                            active
                              ? 'border-brand-600 bg-brand-700 text-white'
                              : 'border-ink-200 bg-white text-ink-800 hover:border-brand-400 hover:text-brand-800',
                          )}
                        >
                          {fmtTime(s.start)}
                          {active && s.therapistName && therapistFilter === 'any' && !isSplit && (
                            <span className="mt-0.5 block text-[10.5px] font-normal text-white/80">{s.therapistName}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {isSplit && (
                <p className="mt-4 text-[13px] text-ink-500">
                  {cart.filter((l) => lineTimes[l.treatmentId]?.slot).length} of {cart.length} treatments
                  scheduled — select each treatment above to set its time.
                </p>
              )}

              <div className="mt-6 flex items-center justify-between gap-3">
                <button type="button" onClick={() => setStep(0)} className={buttonClasses('ghost', 'md')}>
                  <ChevronLeft className="size-4" /> Back
                </button>
                <Button size="lg" disabled={!scheduleReady} onClick={() => setStep(2)}>
                  Continue <ChevronRight className="size-4" />
                </Button>
              </div>
            </section>
          )}

          {/* ---------------- Step 3: details + payment ---------------- */}
          {step === 2 && cart.length > 0 && (
            <section className="rounded-3xl border border-ink-100 bg-white p-5 sm:p-6">
              <StepHeading>{user?.role === 'agent' ? 'Client details' : 'Your details'}</StepHeading>

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
          {step === 3 && cart.length > 0 && scheduleReady && (
            <section className="rounded-3xl border border-ink-100 bg-white p-5 sm:p-6">
              <StepHeading>Review & confirm</StepHeading>

              <div className="mt-4 overflow-hidden rounded-2xl border border-ink-100 bg-white">
                <ReviewRow icon={<UserRound className="size-4" />} label="Guest" value={`${details.name} · ${details.email}`} />

                {/* Cart lines — each with its own (or the shared) time */}
                <div className="divide-y divide-ink-100 border-b border-ink-100">
                  {cart.map((l, i) => {
                    const t = treatmentById.get(l.treatmentId);
                    const tiers = t ? tiersOf(t) : [];
                    const tier = tiers[Math.min(Math.max(l.optionIndex, 0), Math.max(tiers.length - 1, 0))];
                    const iso = lineTimeIso(l);
                    const therapist = lineTherapist(l, i);
                    const lineQuote = quote?.lines[i];
                    return (
                      <div key={l.treatmentId} className="flex items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-[14.5px] font-medium text-ink-800">{t?.name ?? 'Treatment'}</p>
                          <p className="text-[13px] tabular-nums text-ink-500">
                            {tier ? `${tier.durationMin} min` : ''} · {l.persons}{' '}
                            {l.persons > 1 ? 'persons' : 'person'}
                            {iso ? ` · ${formatDate(iso, branch.timezone, { dateStyle: 'medium' })} ${fmtTime(iso)}` : ''}
                            {therapist ? ` · ${therapist}` : ''}
                          </p>
                        </div>
                        <span className="shrink-0 text-[14.5px] font-semibold tabular-nums text-ink-800">
                          {formatMoney(lineQuote?.lineTotal ?? 0, branch.currency)}
                        </span>
                      </div>
                    );
                  })}
                  {(quote?.products ?? []).map((p) => (
                    <div key={`${p.productId}-${p.quantity}`} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[14.5px] font-medium text-ink-800">{p.name}</p>
                        <p className="text-[13px] tabular-nums text-ink-500">
                          {p.quantity} × {formatMoney(p.unitPrice, branch.currency)}
                        </p>
                      </div>
                      <span className="shrink-0 text-[14.5px] font-semibold tabular-nums text-ink-800">
                        {formatMoney(p.lineTotal, branch.currency)}
                      </span>
                    </div>
                  ))}
                </div>

                <ReviewRow
                  icon={<CalendarDays className="size-4" />}
                  label={isSplit ? 'Schedule' : 'When'}
                  value={
                    isSplit
                      ? `${cart.filter((l) => lineTimes[l.treatmentId]?.slot).length} treatments at separate times`
                      : lineTimeIso(cart[0]!)
                          ? `${formatDate(lineTimeIso(cart[0]!)!, branch.timezone)} at ${fmtTime(lineTimeIso(cart[0]!)!)} (${branch.city} time)`
                          : '—'
                  }
                />
                <ReviewRow
                  icon={<MapPin className="size-4" />}
                  label="Where"
                  value={`${branch.name}, ${branch.city}`}
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
                  <span className="tabular-nums">{formatMoney(quote?.pricing.listPrice ?? cartEstimate, branch.currency)}</span>
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
                    {quoteLoading ? '…' : formatMoney(total, branch.currency)}
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
                <span className="text-ink-500">Treatments</span>
                <span className="text-right font-medium">
                  {cart.length === 0
                    ? '—'
                    : cart.length === 1
                      ? (treatmentById.get(cart[0]!.treatmentId)?.name ?? '—')
                      : `${treatmentById.get(cart[0]!.treatmentId)?.name ?? 'Treatment'} +${cart.length - 1}`}
                </span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-ink-500">Persons</span>
                <span className="text-right font-medium tabular-nums">
                  {cart.length === 0 ? '—' : cart.reduce((s, l) => s + l.persons, 0)}
                </span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-ink-500">Date</span>
                <span className="text-right font-medium">
                  {cart.length === 0
                    ? '—'
                    : selectedDate
                      ? formatDate(selectedDate, undefined)
                      : '—'}
                </span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-ink-500">Time</span>
                <span className="text-right font-medium tabular-nums">
                  {togetherMode && togetherSlot
                    ? fmtTime(togetherSlot.start)
                    : isSplit
                      ? `${
                          cart.filter((l) => lineTimes[l.treatmentId]?.slot).length
                        }/${cart.length} set`
                      : slot
                        ? fmtTime(slot.start)
                        : '—'}
                </span>
              </p>
              {cart.length === 1 && (
                <p className="flex justify-between gap-3">
                  <span className="text-ink-500">Therapist</span>
                  <span className="text-right font-medium">
                    {slot?.therapistName ?? (chosenTherapistId ? 'Selected' : 'Any available')}
                  </span>
                </p>
              )}
              {productLines.length > 0 && (
                <p className="flex justify-between gap-3">
                  <span className="text-ink-500">Products</span>
                  <span className="text-right font-medium tabular-nums">
                    {productLines.reduce((s, l) => s + l.quantity, 0)}
                  </span>
                </p>
              )}
            </div>

            <div className="mt-3 border-t border-ink-100 pt-3">
              <p className="flex items-center justify-between">
                <span className="text-sm font-semibold">Total</span>
                <span className="text-lg font-semibold tabular-nums text-brand-800">
                  {formatMoney(total, branch.currency)}
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

function StepHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white">
        <Check className="size-4" strokeWidth={3} />
      </span>
      <h2 className="text-xl font-semibold text-ink-900">{children}</h2>
    </div>
  );
}

function ModeCard({
  title,
  desc,
  icon,
  active,
  onClick,
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition',
        active ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-300' : 'border-ink-200 bg-white hover:border-brand-300',
      )}
    >
      <span className="flex items-center gap-2 text-[14.5px] font-semibold text-ink-900">
        <span className={cn('flex size-6 items-center justify-center rounded-full', active ? 'bg-brand-700 text-white' : 'bg-ink-100 text-ink-500')}>
          {icon}
        </span>
        {title}
      </span>
      <span className="text-[13px] text-ink-500">{desc}</span>
    </button>
  );
}

function TherapistChip({
  label,
  sub,
  avatar,
  active,
  onClick,
}: {
  label: string;
  sub?: string;
  /** Staff photo — a resized data URL from the spa's Staff list. */
  avatar?: string | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 flex-row items-center gap-2 rounded-xl border px-3 py-2 text-left transition',
        active ? 'border-brand-600 bg-brand-50 text-brand-900' : 'border-ink-200 bg-white text-ink-700 hover:border-brand-300',
      )}
    >
      {avatar && (
        // eslint-disable-next-line @next/next/no-img-element -- staff photo uploaded by the spa
        <img
          src={avatar}
          alt=""
          className="size-7 shrink-0 rounded-full border border-ink-100 object-cover"
        />
      )}
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-medium">{label}</span>
        {sub && <span className="block truncate text-[11.5px] text-ink-400">{sub}</span>}
      </span>
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
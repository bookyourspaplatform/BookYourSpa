'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Minus, Package, Plus, Receipt, X } from 'lucide-react';
import { createPosSale, type PosSaleResult } from '@/lib/actions/provider';
import { branchOptionPrice } from '@/lib/pricing';
import { clamp, cn, dateKeyInTz } from '@/lib/utils';
import { formatMoney } from '@/lib/money';
import type { StaffPayType, StaffRole } from '@/db/schema';
import { MoneyInput } from '@/components/ui/money-input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';

export type PosBranch = { id: string; name: string; currency: string; timezone: string };

export type PosStaff = {
  id: string;
  branchId: string;
  name: string;
  role: StaffRole;
  avatarUrl: string | null;
  salaryType: StaffPayType;
  salaryValue: number;
  incentiveType: StaffPayType;
  incentiveValue: number;
};

export type PosTreatment = {
  id: string;
  name: string;
  durationMin: number;
  listPrice: number;
  requiresTherapist: boolean;
  /** Therapists working one session (2 = couples / four-hand). */
  therapistsPerBooking: number;
  priceOptions: { durationMin: number; price: number; capacity?: number | null }[];
  cells: { branchId: string; price: number; active: boolean }[];
};

export type PosProduct = { id: string; branchId: string; name: string; price: number };

export type PosSaleRow = {
  id: string;
  code: string;
  branchId: string;
  guestName: string;
  treatmentName: string;
  staffName: string | null;
  startAt: string;
  total: number;
  platformFee: number;
  providerEarning: number;
  currency: string;
  method: string;
};

type MenuTreatment = {
  id: string;
  name: string;
  requiresTherapist: boolean;
  per: number;
  options: { durationMin: number; price: number }[];
};

/** One treatment in the till: a tier, a quantity, a start time and its staff. */
type CartLine = {
  key: string;
  treatmentId: string;
  optionIdx: number;
  qty: number;
  time: string;
  therapists: string[];
};

type ProductLine = { key: string; productId: string; qty: number };

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
] as const;

const SELECT_CLS =
  'h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15';

const SMALL_SELECT_CLS =
  'h-9 rounded-lg border border-ink-200 bg-white px-2 text-[13px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15';

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function todayKey(): string {
  return dateKeyInTz(new Date(), 'UTC');
}

/** Therapists paid by percentage (salary + job fee), in basis points. */
function shareBps(s: PosStaff): number {
  return (
    (s.salaryType === 'percent' ? s.salaryValue : 0) +
    (s.incentiveType === 'percent' ? s.incentiveValue : 0)
  );
}

export function PosClient({
  branches,
  staff,
  treatments,
  products,
  sales,
  commissionBps,
}: {
  branches: PosBranch[];
  staff: PosStaff[];
  treatments: PosTreatment[];
  products: PosProduct[];
  sales: PosSaleRow[];
  commissionBps: number;
}) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [date, setDate] = useState(todayKey);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cart, setCart] = useState<ProductLine[]>([]);
  const [discountPct, setDiscountPct] = useState(0);
  const [amountEdit, setAmountEdit] = useState('');
  const [method, setMethod] = useState<'cash' | 'card' | 'other'>('cash');
  const [pending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<PosSaleResult | null>(null);
  const keyRef = useRef(0);
  const router = useRouter();
  const toast = useToast();

  const nextKey = () => `l${++keyRef.current}`;

  const branch = branches.find((b) => b.id === branchId) ?? branches[0];
  const currency = branch?.currency ?? 'IDR';
  const branchStaff = useMemo(() => staff.filter((s) => s.branchId === branchId), [staff, branchId]);

  /** Treatments this branch actually sells, with branch-rebased duration tiers. */
  const onMenu = useMemo<MenuTreatment[]>(() => {
    const out: MenuTreatment[] = [];
    for (const t of treatments) {
      const cell = t.cells.find((c) => c.branchId === branchId && c.active);
      if (!cell) continue;
      const raw = t.priceOptions?.length
        ? t.priceOptions
        : [{ durationMin: t.durationMin, price: t.listPrice }];
      out.push({
        id: t.id,
        name: t.name,
        requiresTherapist: t.requiresTherapist,
        per: Math.max(1, t.therapistsPerBooking),
        options: raw.map((o) => ({
          durationMin: o.durationMin,
          price: branchOptionPrice(o, t.listPrice, cell.price),
        })),
      });
    }
    return out;
  }, [treatments, branchId]);

  const onShelf = useMemo(() => products.filter((p) => p.branchId === branchId), [products, branchId]);

  /* Drop rows the newly selected branch cannot sell. */
  const menuOf = (line: CartLine) => onMenu.find((t) => t.id === line.treatmentId) ?? null;
  const optOf = (line: CartLine) => {
    const m = menuOf(line);
    if (!m) return null;
    return m.options[clamp(line.optionIdx, 0, m.options.length - 1)] ?? null;
  };
  const slotsOf = (line: CartLine) => {
    const m = menuOf(line);
    return m ? (m.requiresTherapist ? line.qty * m.per : 0) : 0;
  };
  const fitSlots = (line: CartLine) => {
    const slots = slotsOf(line);
    const next = line.therapists.slice(0, slots);
    while (next.length < slots) next.push('');
    return { ...line, therapists: next };
  };

  const detailed = lines.map((l) => ({ line: l, menu: menuOf(l), opt: optOf(l) }));
  const treatmentsGross = detailed.reduce(
    (sum, d) => sum + (d.opt ? d.opt.price * d.line.qty : 0),
    0,
  );
  const productsGross = cart.reduce((sum, l) => {
    const p = onShelf.find((x) => x.id === l.productId);
    return sum + (p ? p.price * l.qty : 0);
  }, 0);
  const gross = treatmentsGross + productsGross;
  const pctOff = Math.round((gross * clamp(discountPct, 0, 100)) / 100);
  const discounted = Math.max(0, gross - pctOff);
  const amount = amountEdit === '' ? discounted : Math.max(0, Number(amountEdit) || 0);
  const listPrice = Math.max(gross, amount);
  const discountAmount = Math.max(0, listPrice - amount);
  const platformFee = Math.round((amount * commissionBps) / 10_000);

  /* Therapist shares: each unit's price is split between its therapists, then
     each therapist earns their percentage of what they personally served. */
  const shares = useMemo(() => {
    const ratio = gross > 0 ? amount / gross : 0;
    const acc = new Map<string, { name: string; bps: number; amount: number }>();
    for (const d of detailed) {
      if (!d.menu || !d.opt) continue;
      const per = d.menu.requiresTherapist ? d.menu.per : 1;
      for (let s = 0; s < d.line.therapists.length; s++) {
        const id = d.line.therapists[s]!;
        if (!id) continue;
        const unit = Math.floor(s / per);
        if (unit >= d.line.qty) continue;
        const j = s % per;
        const slice =
          Math.round((d.opt.price * (j + 1)) / per) - Math.round((d.opt.price * j) / per);
        const found = acc.get(id);
        const person = branchStaff.find((x) => x.id === id);
        if (found) found.amount += slice * ratio;
        else
          acc.set(id, {
            name: person?.name ?? 'Staff',
            bps: person ? shareBps(person) : 0,
            amount: slice * ratio,
          });
      }
    }
    return [...acc.values()].map((s) => ({
      name: s.name,
      bps: s.bps,
      amount: Math.round((s.amount * s.bps) / 10_000),
    }));
  }, [detailed, branchStaff, gross, amount]);

  const sharesTotal = shares.reduce((sum, s) => sum + s.amount, 0);
  const spaIncome = Math.max(0, amount - platformFee - sharesTotal);

  /* ------------------------------- editing ------------------------------- */

  function addLine(treatmentId: string) {
    const m = onMenu.find((t) => t.id === treatmentId);
    if (!m) return;
    setLines((prev) => {
      if (prev.some((l) => l.treatmentId === treatmentId)) return prev;
      const line: CartLine = {
        key: nextKey(),
        treatmentId,
        optionIdx: 0,
        qty: 1,
        time: nowTime(),
        therapists: new Array(m.requiresTherapist ? m.per : 0).fill(''),
      };
      return [...prev, line];
    });
    setAmountEdit('');
  }

  function patchLine(key: string, patch: Partial<CartLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? fitSlots({ ...l, ...patch }) : l)));
    setAmountEdit('');
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
    setAmountEdit('');
  }

  function setSlot(key: string, index: number, therapistId: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const next = [...l.therapists];
        next[index] = therapistId;
        return { ...l, therapists: next };
      }),
    );
  }

  function addProduct(productId: string) {
    if (!productId) return;
    setCart((prev) => {
      const found = prev.find((l) => l.productId === productId);
      if (found) return prev.map((l) => (l === found ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { key: nextKey(), productId, qty: 1 }];
    });
    setAmountEdit('');
  }

  function patchProduct(key: string, qty: number) {
    setCart((prev) =>
      qty <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, qty } : l)),
    );
    setAmountEdit('');
  }

  /* ------------------------------- submit -------------------------------- */

  function submit() {
    if (!branch) return;
    if (!lines.length) {
      toast.error('Add a treatment first', 'Pick one from “Add another treatment…”.');
      return;
    }
    if (!guestName.trim()) {
      toast.error('Add the guest name', 'Walk-ins can be recorded as “Guest”.');
      return;
    }
    for (const d of detailed) {
      if (!d.menu || !d.opt) continue;
      const wanted = d.line.therapists.slice(0, d.line.qty * d.menu.per);
      if (d.menu.requiresTherapist && wanted.some((t) => !t)) {
        toast.error('Assign every therapist', `${d.menu.name} needs ${wanted.length} staff member(s).`);
        return;
      }
      const unique = new Set(wanted.filter(Boolean));
      if (unique.size !== wanted.filter(Boolean).length) {
        toast.error('Duplicate therapist', `${d.menu.name} lists the same person twice.`);
        return;
      }
    }
    const seen = new Set<string>();
    for (const d of detailed) {
      for (const t of d.line.therapists) {
        if (!t) continue;
        const key = `${t}|${d.line.time}`;
        if (seen.has(key)) {
          const who = branchStaff.find((s) => s.id === t)?.name ?? 'That therapist';
          toast.error('Same start time', `${who} is on two treatments at ${d.line.time} — change one time.`);
          return;
        }
        seen.add(key);
      }
    }

    startTransition(async () => {
      const res = await createPosSale({
        branchId: branch.id,
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim() || null,
        guestPhone: guestPhone.trim() || null,
        date,
        items: detailed.map((d) => ({
          treatmentId: d.line.treatmentId,
          optionIndex: d.line.optionIdx,
          qty: d.line.qty,
          time: d.line.time,
          therapistIds: d.line.therapists.filter(Boolean),
        })),
        products: cart.map((l) => ({ productId: l.productId, quantity: l.qty })),
        discountPercent: clamp(discountPct, 0, 100),
        amount,
        paymentMethod: method,
      });
      if (res.ok && res.data) {
        setReceipt(res.data);
        setGuestName('');
        setGuestEmail('');
        setGuestPhone('');
        setLines([]);
        setCart([]);
        setDiscountPct(0);
        setAmountEdit('');
        toast.success('Payment taken', `${formatMoney(res.data.total, res.data.currency)} · ${res.data.code}`);
        router.refresh();
      } else {
        toast.error('Could not complete the sale', res.ok ? 'Unexpected response.' : res.error);
      }
    });
  }

  /* ------------------------------- history ------------------------------- */

  const todaySales = sales.filter((s) => {
    const b = branches.find((x) => x.id === s.branchId);
    if (!b) return false;
    const now = new Date();
    return dateKeyInTz(new Date(s.startAt), b.timezone) === dateKeyInTz(now, b.timezone);
  });
  const todayGross = todaySales.reduce((sum, s) => sum + s.total, 0);
  const todayFees = todaySales.reduce((sum, s) => sum + s.platformFee, 0);
  const todayNet = todaySales.reduce((sum, s) => sum + s.providerEarning, 0);

  if (branches.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
        <p className="text-[15px] font-medium">Add a branch first</p>
        <p className="mt-1 text-sm text-ink-500">The till sells from a location.</p>
      </div>
    );
  }

  const availableTreatments = onMenu.filter((t) => !lines.some((l) => l.treatmentId === t.id));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ------------------------------- till ------------------------------- */}
        <div className="rounded-3xl border border-ink-100 bg-white p-5">
          <div className="flex flex-wrap items-center gap-2">
            {branches.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setBranchId(b.id);
                  setLines([]);
                  setCart([]);
                  setAmountEdit('');
                }}
                className={
                  b.id === branchId
                    ? 'rounded-full bg-brand-700 px-4 py-1.5 text-[13px] font-medium text-white'
                    : 'rounded-full border border-ink-200 bg-white px-4 py-1.5 text-[13px] font-medium text-ink-600 hover:border-brand-300'
                }
              >
                {b.name}
              </button>
            ))}
          </div>

          {/* ------------------------------ guest ----------------------------- */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-700">Guest name *</span>
              <input
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="e.g. Sarah W."
                className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-700">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-700">Email (optional)</span>
              <input
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                placeholder="guest@example.com"
                className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-700">Phone (optional)</span>
              <input
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="+971 …"
                className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              />
            </label>
          </div>

          {/* ---------------------------- treatments --------------------------- */}
          <div className="mt-4 rounded-2xl border border-ink-100 bg-sand-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">
                💆 Treatment
              </p>
              <select
                value=""
                onChange={(e) => addLine(e.target.value)}
                disabled={availableTreatments.length === 0}
                aria-label="Add another treatment"
                className={cn(SMALL_SELECT_CLS, 'w-auto min-w-[220px]')}
              >
                <option value="">
                  {availableTreatments.length ? '+ Add another treatment…' : 'All treatments added'}
                </option>
                {availableTreatments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.options[0]?.durationMin} min
                  </option>
                ))}
              </select>
            </div>

            {lines.length === 0 && (
              <p className="mt-3 text-[13px] text-ink-500">
                Nothing added yet — choose a treatment above.
              </p>
            )}

            <div className="mt-3 space-y-3">
              {detailed.map(({ line, menu, opt }) => {
                if (!menu || !opt) return null;
                const slots = line.qty * menu.per;
                const assigned = line.therapists.slice(0, slots).filter(Boolean);
                const names = assigned
                  .map((id) => branchStaff.find((s) => s.id === id)?.name ?? 'Staff')
                  .join(', ');
                const lineTotal = opt.price * line.qty;
                const duplicated = new Set(assigned).size !== assigned.length;

                return (
                  <div key={line.key} className="rounded-xl border border-ink-100 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2 text-[14px]">
                      <span className="font-medium text-brand-700">+</span>
                      <span className="font-medium text-ink-900">{menu.name}</span>
                      <span className="text-ink-500">({opt.durationMin} min)</span>
                      {names && <span className="text-ink-500">( {names} )</span>}

                      <span className="relative ml-1 inline-flex items-center">
                        <Clock className="pointer-events-none absolute left-2 size-3.5 text-ink-400" />
                        <input
                          type="time"
                          value={line.time}
                          onChange={(e) => patchLine(line.key, { time: e.target.value })}
                          aria-label={`Start time for ${menu.name}`}
                          className="h-8 rounded-lg border border-ink-200 bg-white pl-7 pr-2 text-[13px] tabular-nums outline-none focus:border-brand-500"
                        />
                      </span>

                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Fewer ${menu.name}`}
                          onClick={() => patchLine(line.key, { qty: Math.max(1, line.qty - 1) })}
                          disabled={line.qty <= 1}
                          className="flex size-7 items-center justify-center rounded-lg border border-ink-200 text-ink-700 transition hover:border-brand-400 hover:text-brand-800 disabled:opacity-40"
                        >
                          <Minus className="size-3.5" />
                        </button>
                        <span className="w-8 text-center text-[13px] font-semibold tabular-nums">
                          ×{line.qty}
                        </span>
                        <button
                          type="button"
                          aria-label={`More ${menu.name}`}
                          onClick={() => patchLine(line.key, { qty: Math.min(20, line.qty + 1) })}
                          className="flex size-7 items-center justify-center rounded-lg border border-brand-600 text-brand-700 transition hover:bg-brand-50"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </span>

                      <span className="ml-auto tabular-nums font-semibold text-ink-900">
                        {formatMoney(lineTotal, currency)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${menu.name}`}
                        onClick={() => removeLine(line.key)}
                        className="rounded-md p-1 text-rose-500 transition hover:bg-rose-50"
                      >
                        <X className="size-4" />
                      </button>
                    </div>

                    {menu.options.length > 1 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-[12.5px] text-ink-500">Duration/Package:</span>
                        {menu.options.map((o, i) => (
                          <button
                            key={`${o.durationMin}-${i}`}
                            type="button"
                            onClick={() => patchLine(line.key, { optionIdx: i })}
                            className={cn(
                              'rounded-lg px-2.5 py-1 text-[12.5px] font-medium transition',
                              i === line.optionIdx
                                ? 'bg-brand-800 text-white'
                                : 'border border-ink-200 bg-white text-ink-600 hover:border-brand-300',
                            )}
                          >
                            {o.durationMin} min
                          </button>
                        ))}
                      </div>
                    )}

                    {menu.requiresTherapist && slots > 0 && (
                      <div className="mt-2 space-y-2">
                        {Array.from({ length: Math.ceil(slots / menu.per) }).map((_, unit) => (
                          <div key={unit} className="flex flex-wrap items-center gap-2">
                            <span className="text-[12.5px] text-ink-500">
                              {menu.per > 1 ? `Guest ${unit + 1}:` : 'Therapist:'}
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {Array.from({ length: menu.per }).map((__, j) => {
                                const idx = unit * menu.per + j;
                                if (idx >= slots) return null;
                                return (
                                  <select
                                    key={idx}
                                    value={line.therapists[idx] ?? ''}
                                    onChange={(e) => setSlot(line.key, idx, e.target.value)}
                                    aria-label={`${menu.name} therapist ${idx + 1}`}
                                    className={cn(
                                      SMALL_SELECT_CLS,
                                      'min-w-[150px]',
                                      duplicated && 'border-rose-400',
                                    )}
                                  >
                                    <option value="">Choose therapist…</option>
                                    {branchStaff.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.name}
                                      </option>
                                    ))}
                                  </select>
                                );
                              })}
                            </div>
                            {menu.per > 1 && (
                              <span className="text-[12px] text-ink-400">
                                price splits {formatMoney(Math.round(opt.price / menu.per), currency)} each
                              </span>
                            )}
                          </div>
                        ))}
                        {duplicated && (
                          <p className="text-[12.5px] text-rose-600">
                            The same therapist is listed twice — pick someone else.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ------------------------------ products ------------------------- */}
            <div className="mt-4 border-t border-ink-100 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">
                  <Package className="mr-1 inline size-3.5" /> Products
                </p>
                <select
                  value=""
                  onChange={(e) => addProduct(e.target.value)}
                  disabled={onShelf.length === 0}
                  aria-label="Add a product"
                  className={cn(SMALL_SELECT_CLS, 'w-auto min-w-[220px]')}
                >
                  <option value="">{onShelf.length ? '+ Add a product…' : 'No products yet'}</option>
                  {onShelf.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {formatMoney(p.price, currency)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-2 space-y-2">
                {cart.map((l) => {
                  const p = onShelf.find((x) => x.id === l.productId);
                  if (!p) return null;
                  return (
                    <div
                      key={l.key}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-100 bg-white p-3 text-[14px]"
                    >
                      <Package className="size-4 text-ink-400" />
                      <span className="font-medium text-ink-900">{p.name}</span>
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Fewer ${p.name}`}
                          onClick={() => patchProduct(l.key, l.qty - 1)}
                          disabled={l.qty <= 1}
                          className="flex size-7 items-center justify-center rounded-lg border border-ink-200 text-ink-700 transition hover:border-brand-400 hover:text-brand-800 disabled:opacity-40"
                        >
                          <Minus className="size-3.5" />
                        </button>
                        <span className="w-8 text-center text-[13px] font-semibold tabular-nums">
                          ×{l.qty}
                        </span>
                        <button
                          type="button"
                          aria-label={`More ${p.name}`}
                          onClick={() => patchProduct(l.key, l.qty + 1)}
                          className="flex size-7 items-center justify-center rounded-lg border border-brand-600 text-brand-700 transition hover:bg-brand-50"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </span>
                      <span className="ml-auto tabular-nums font-semibold text-ink-900">
                        {formatMoney(p.price * l.qty, currency)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${p.name}`}
                        onClick={() => patchProduct(l.key, 0)}
                        className="rounded-md p-1 text-rose-500 transition hover:bg-rose-50"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ---------------------- amount / discount / payment ----------------- */}
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-700">
                Amount ({currency}){' '}
                <span className="font-normal text-ink-400">— editable for walk-in deals</span>
              </span>
              <MoneyInput
                value={amount}
                currency={currency}
                onValueChange={(minor) => setAmountEdit(String(minor))}
                aria-label="Sale amount"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-700">Discount (optional)</span>
              <div className="flex gap-2">
                <select
                  value={discountPct}
                  onChange={(e) => {
                    setDiscountPct(Number(e.target.value));
                    setAmountEdit('');
                  }}
                  aria-label="Discount percent"
                  className={cn(SMALL_SELECT_CLS, 'h-11 w-24')}
                >
                  {[0, 5, 10, 15, 20, 25, 30, 50].map((p) => (
                    <option key={p} value={p}>
                      {p} %
                    </option>
                  ))}
                </select>
              <div className="flex h-11 flex-1 items-center rounded-xl border border-ink-200 bg-white px-3 text-sm tabular-nums text-ink-700">
                −{formatMoney(discountAmount, currency)}
              </div>
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-700">Payment</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
                className={SELECT_CLS}
              >
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* ------------------------------ summary ---------------------------- */}
          <div className="mt-4 rounded-2xl border border-ink-100 bg-sand-50 p-4">
            <div className="space-y-1.5 text-[14px]">
              {detailed.map(({ line, menu, opt }, i) =>
                menu && opt ? (
                  <div key={line.key} className="flex items-center justify-between gap-3">
                    <span className="text-ink-700">
                      {i > 0 ? '+ ' : ''}
                      {menu.name} ({opt.durationMin} min) × {line.qty}
                    </span>
                    <span className="tabular-nums text-ink-900">
                      {formatMoney(opt.price * line.qty, currency)}
                    </span>
                  </div>
                ) : null,
              )}
              {cart.map((l) => {
                const p = onShelf.find((x) => x.id === l.productId);
                if (!p) return null;
                return (
                  <div key={l.key} className="flex items-center justify-between gap-3">
                    <span className="text-ink-700">
                      🧴 {p.name} ×{l.qty}
                    </span>
                    <span className="tabular-nums text-ink-900">
                      {formatMoney(p.price * l.qty, currency)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-ink-200 pt-3">
              <span className="font-semibold text-ink-900">Total price</span>
              <span className="text-lg font-bold tabular-nums text-ink-900">
                {formatMoney(amount, currency)}
              </span>
            </div>

            <div className="mt-1.5 flex items-center justify-between text-[14px] text-ink-600">
              <span>Platform commission ({(commissionBps / 100).toFixed(1)}%)</span>
              <span className="tabular-nums text-rose-500">− {formatMoney(platformFee, currency)}</span>
            </div>

            {shares.map((s) => (
              <div
                key={s.name}
                className="mt-1 flex items-center justify-between text-[14px] text-ink-600"
              >
                <span>
                  {s.name} share ({s.bps / 100}%)
                </span>
                <span className="tabular-nums text-ink-800">{formatMoney(s.amount, currency)}</span>
              </div>
            ))}

            <div className="mt-3 flex items-center justify-between border-t border-ink-200 pt-3">
              <span className="text-[15px] font-semibold text-ink-900">Spa Income</span>
              <span className="text-lg font-bold tabular-nums text-brand-800">
                {formatMoney(spaIncome, currency)}
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-ink-400">
              Walk-in sales are recorded as paid appointments on the calendar and bookings list —
              one row per therapist.
            </p>
            <Button size="md" onClick={submit} loading={pending} disabled={!lines.length || pending}>
              Take payment
            </Button>
          </div>
        </div>

        {/* ----------------------------- receipt ----------------------------- */}
        <div className="rounded-3xl border border-ink-100 bg-white p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Receipt className="size-4 text-brand-600" /> Last receipt
          </h2>
          {receipt ? (
            <div className="mt-3 rounded-2xl border border-ink-100 bg-sand-50 p-4 text-[13.5px]">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink-800">{receipt.code}</span>
                <Badge tone="success">paid</Badge>
              </div>
              <div className="mt-2 space-y-1 text-ink-600">
                {receipt.items.map((it, i) => (
                  <div key={`${it.name}-${i}`} className="flex justify-between gap-2">
                    <span>
                      {it.name} ×{it.qty}
                    </span>
                    <span className="tabular-nums">{formatMoney(it.amount, receipt.currency)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1 border-t border-ink-100 pt-3 text-ink-500">
                <div className="flex justify-between">
                  <span>Total</span>
                  <span className="tabular-nums font-medium text-ink-800">
                    {formatMoney(receipt.total, receipt.currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Platform fee</span>
                  <span className="tabular-nums text-amber-600">
                    −{formatMoney(receipt.platformFee, receipt.currency)}
                  </span>
                </div>
                {receipt.shares.map((s) => (
                  <div key={s.name} className="flex justify-between">
                    <span>
                      {s.name} ({s.bps / 100}%)
                    </span>
                    <span className="tabular-nums text-brand-700">
                      {formatMoney(s.amount, receipt.currency)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between font-medium">
                  <span>Spa income</span>
                  <span className="tabular-nums text-ink-800">
                    {formatMoney(receipt.spaIncome, receipt.currency)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[13.5px] text-ink-500">
              No sale yet in this session — take a payment and the receipt shows here.
            </p>
          )}

          <div className="mt-5 rounded-2xl border border-ink-100 p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">Today</p>
            <p className="mt-1 text-2xl font-semibold text-brand-800">
              {formatMoney(todayGross, currency)}
            </p>
            <p className="mt-1 text-[13px] text-ink-500">
              {todaySales.length} sale{todaySales.length === 1 ? '' : 's'} · fee{' '}
              <span className="tabular-nums text-amber-600">{formatMoney(todayFees, currency)}</span>{' '}
              · net <span className="tabular-nums">{formatMoney(todayNet, currency)}</span>
            </p>
          </div>
        </div>
      </div>

      {/* ------------------------------ history ------------------------------ */}
      <div className="overflow-hidden rounded-3xl border border-ink-100 bg-white">
        <div className="border-b border-ink-100 px-5 py-4">
          <h2 className="text-[15px] font-semibold">Recent POS sales</h2>
          <p className="text-[13px] text-ink-500">Newest first — each one is a booking on the calendar.</p>
        </div>
        {sales.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13.5px] text-ink-500">No walk-in sales yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-ink-100 text-[12px] uppercase tracking-wide text-ink-400">
                  <th className="px-5 py-2.5 font-medium">Time</th>
                  <th className="px-3 py-2.5 font-medium">Receipt</th>
                  <th className="px-3 py-2.5 font-medium">Guest</th>
                  <th className="px-3 py-2.5 font-medium">Treatment</th>
                  <th className="px-3 py-2.5 font-medium">Staff</th>
                  <th className="px-3 py-2.5 font-medium">Paid by</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th className="px-5 py-2.5 text-right font-medium">Platform fee</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="border-b border-ink-50 last:border-0">
                    <td className="px-5 py-2.5 tabular-nums text-ink-500">
                      {new Date(s.startAt).toLocaleString([], {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2.5 font-medium">{s.code}</td>
                    <td className="px-3 py-2.5">{s.guestName}</td>
                    <td className="px-3 py-2.5">{s.treatmentName}</td>
                    <td className="px-3 py-2.5 text-ink-500">{s.staffName ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone="neutral">{s.method}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                      {formatMoney(s.total, s.currency)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-amber-600">
                      −{formatMoney(s.platformFee, s.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
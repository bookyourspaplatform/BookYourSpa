'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, CreditCard, Receipt, Smartphone } from 'lucide-react';
import { createPosSale, type PosSaleResult } from '@/lib/actions/provider';
import { dateKeyInTz } from '@/lib/utils';
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
  cells: { branchId: string; price: number; active: boolean }[];
};

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

const METHODS = [
  { value: 'cash', label: 'Cash', icon: <Banknote className="size-3.5" /> },
  { value: 'card', label: 'Card', icon: <CreditCard className="size-3.5" /> },
  { value: 'other', label: 'Other', icon: <Smartphone className="size-3.5" /> },
] as const;

const ROLE_LABELS: Record<StaffRole, string> = { admin: 'Admin', worker: 'Worker', therapist: 'Therapist' };

export function PosClient({
  branches,
  staff,
  treatments,
  sales,
  commissionBps,
}: {
  branches: PosBranch[];
  staff: PosStaff[];
  treatments: PosTreatment[];
  sales: PosSaleRow[];
  commissionBps: number;
}) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [treatmentId, setTreatmentId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<'cash' | 'card' | 'other'>('cash');
  const [pending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<PosSaleResult | null>(null);
  const router = useRouter();
  const toast = useToast();

  const branch = branches.find((b) => b.id === branchId) ?? branches[0];
  const currency = branch?.currency ?? 'IDR';

  /** Treatments this branch actually offers, with their local price. */
  const onMenu = useMemo(() => {
    return treatments
      .map((t) => ({ ...t, cell: t.cells.find((c) => c.branchId === branchId && c.active) }))
      .filter((t) => Boolean(t.cell))
      .map((t) => ({ id: t.id, name: t.name, durationMin: t.durationMin, price: t.cell!.price }));
  }, [treatments, branchId]);

  const branchStaff = useMemo(() => staff.filter((s) => s.branchId === branchId), [staff, branchId]);
  const selected = onMenu.find((t) => t.id === treatmentId) ?? null;
  const selectedStaff = branchStaff.find((s) => s.id === staffId) ?? null;

  const total = amount > 0 ? amount : (selected?.price ?? 0);
  const platformFee = Math.round((total * commissionBps) / 10_000);
  const net = Math.max(0, total - platformFee);
  const staffBps =
    (selectedStaff?.salaryType === 'percent' ? selectedStaff.salaryValue : 0) +
    (selectedStaff?.incentiveType === 'percent' ? selectedStaff.incentiveValue : 0);
  const staffShare = staffBps > 0 ? Math.round((total * Math.min(staffBps, 10_000)) / 10_000) : 0;

  // Default the amount whenever the picked treatment (or branch) changes.
  useEffect(() => {
    setAmount(selected ? selected.price : 0);
  }, [selected?.id, selected?.price]);

  // Reset branch-scoped picks when the branch changes.
  useEffect(() => {
    setStaffId('');
    setTreatmentId((prev) => {
      const still = treatments.find((t) => t.id === prev && t.cells.some((c) => c.branchId === branchId && c.active));
      return still ? prev : '';
    });
  }, [branchId, treatments]);

  const todaySales = sales.filter((s) => {
    const b = branches.find((x) => x.id === s.branchId);
    if (!b) return false;
    const now = new Date();
    return dateKeyInTz(new Date(s.startAt), b.timezone) === dateKeyInTz(now, b.timezone);
  });
  const todayGross = todaySales.reduce((sum, s) => sum + s.total, 0);
  const todayFees = todaySales.reduce((sum, s) => sum + s.platformFee, 0);
  const todayNet = todaySales.reduce((sum, s) => sum + s.providerEarning, 0);

  function submit() {
    if (!selected || !branch) {
      toast.error('Pick a treatment first');
      return;
    }
    if (!guestName.trim()) {
      toast.error('Add the guest name', 'Walk-ins can be recorded as “Guest”.');
      return;
    }
    startTransition(async () => {
      const res = await createPosSale({
        branchId: branch.id,
        treatmentId: selected.id,
        therapistId: staffId || null,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || null,
        amount: total,
        paymentMethod: method,
      });
      if (res.ok && res.data) {
        setReceipt(res.data);
        setGuestName('');
        setGuestPhone('');
        setAmount(0);
        toast.success('Payment taken', `${formatMoney(res.data.total, res.data.currency)} · ${res.data.code}`);
        router.refresh();
      } else {
        toast.error('Could not complete the sale', res.ok ? 'Unexpected response.' : res.error);
      }
    });
  }

  if (branches.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
        <p className="text-[15px] font-medium">Add a branch first</p>
        <p className="mt-1 text-sm text-ink-500">The till sells from a location.</p>
      </div>
    );
  }

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
                onClick={() => setBranchId(b.id)}
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

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-700">Treatment *</span>
              <select
                value={treatmentId}
                onChange={(e) => setTreatmentId(e.target.value)}
                className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              >
                <option value="">Choose a treatment…</option>
                {onMenu.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.durationMin} min · {formatMoney(t.price, currency)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-700">Staff (optional)</span>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              >
                <option value="">No one assigned</option>
                {branchStaff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {ROLE_LABELS[s.role]}
                  </option>
                ))}
              </select>
            </label>

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
              <span className="text-[13px] font-medium text-ink-700">Phone (optional)</span>
              <input
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="+62 …"
                className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-700">
                Amount ({currency}) <span className="font-normal text-ink-400">— editable for walk-in deals</span>
              </span>
              <MoneyInput value={amount} currency={currency} onValueChange={setAmount} aria-label="Sale amount" />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-700">Payment</span>
              <div className="flex gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMethod(m.value)}
                    aria-pressed={method === m.value}
                    className={
                      method === m.value
                        ? 'inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-brand-600 bg-brand-50 text-[13px] font-medium text-brand-800'
                        : 'inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink-200 bg-white text-[13px] font-medium text-ink-500 hover:border-ink-300'
                    }
                  >
                    {m.icon} {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-ink-100 bg-sand-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
              <span className="text-ink-500">Total</span>
              <span className="text-lg font-semibold text-brand-800">{formatMoney(total, currency)}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-500">
              <span>
                Platform commission {(commissionBps / 100).toFixed(1)}%
              </span>
              <span className="tabular-nums text-amber-600">−{formatMoney(platformFee, currency)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-500">
              <span>You keep</span>
              <span className="tabular-nums font-medium text-ink-800">{formatMoney(net, currency)}</span>
            </div>
            {selectedStaff && staffShare > 0 && (
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-500">
                <span>
                  {selectedStaff.name} share ({staffBps / 100}%)
                </span>
                <span className="tabular-nums text-brand-700">{formatMoney(staffShare, currency)}</span>
              </div>
            )}
            {selected && (
              <p className="mt-1.5 text-[12.5px] text-ink-400">
                {selected.name} · {selected.durationMin} min · ends{' '}
                {new Date(Date.now() + selected.durationMin * 60_000).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-ink-400">
              Walk-in sales are recorded as paid appointments on the calendar and bookings list.
            </p>
            <Button size="md" onClick={submit} loading={pending} disabled={!selected || pending}>
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
              <p className="mt-2 text-ink-600">{receipt.treatmentName}</p>
              {receipt.staffName && <p className="text-ink-500">with {receipt.staffName}</p>}
              <div className="mt-3 space-y-1 border-t border-ink-100 pt-3 text-ink-500">
                <div className="flex justify-between">
                  <span>Total</span>
                  <span className="tabular-nums font-medium text-ink-800">
                    {formatMoney(receipt.total, receipt.currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Platform fee</span>
                  <span className="tabular-nums text-amber-600">−{formatMoney(receipt.platformFee, receipt.currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Net</span>
                  <span className="tabular-nums">{formatMoney(receipt.providerEarning, receipt.currency)}</span>
                </div>
                {receipt.staffShare > 0 && (
                  <div className="flex justify-between">
                    <span>Staff share</span>
                    <span className="tabular-nums text-brand-700">{formatMoney(receipt.staffShare, receipt.currency)}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[13.5px] text-ink-500">
              No sale yet in this session — take a payment and the receipt shows here.
            </p>
          )}

          <div className="mt-5 rounded-2xl border border-ink-100 p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">Today</p>
            <p className="mt-1 text-2xl font-semibold text-brand-800">{formatMoney(todayGross, currency)}</p>
            <p className="mt-1 text-[13px] text-ink-500">
              {todaySales.length} sale{todaySales.length === 1 ? '' : 's'} · fee{' '}
              <span className="tabular-nums text-amber-600">{formatMoney(todayFees, currency)}</span> · net{' '}
              <span className="tabular-nums">{formatMoney(todayNet, currency)}</span>
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

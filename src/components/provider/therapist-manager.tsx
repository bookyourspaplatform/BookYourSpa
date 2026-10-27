'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Pencil, Plus, UserRound } from 'lucide-react';
import { saveTherapist, setTherapistActive } from '@/lib/actions/provider';
import { fileToDataUrl, isRenderableImage } from '@/lib/image';
import { formatMoney } from '@/lib/money';
import type { StaffPayType, StaffRole } from '@/db/schema';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { MoneyInput } from '@/components/ui/money-input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';

export type TherapistRow = {
  id: string;
  branchId: string;
  name: string;
  bio: string | null;
  specialties: string[];
  avatarUrl: string | null;
  role: StaffRole;
  salaryType: StaffPayType;
  salaryValue: number;
  incentiveType: StaffPayType;
  incentiveValue: number;
  active: boolean;
  shiftCount: number;
  next7Count: number;
};

const ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'Admin',
  worker: 'Worker',
  therapist: 'Therapist',
};

const ROLE_HINTS: Record<StaffRole, string> = {
  admin: 'Runs the front desk and the POS till (/provider/pos). Paid a fixed salary and bonus.',
  worker: 'General staff — housekeeping, reception, support. Paid a fixed salary and bonus.',
  therapist: 'Serves guests and appears in the booking wizard. Paid a monthly salary plus a share of every job done.',
};

/** Everyone is paid a fixed monthly salary; therapists also earn a share per job. */
function payTypesForRole(role: StaffRole): { salaryType: StaffPayType; incentiveType: StaffPayType } {
  return role === 'therapist'
    ? { salaryType: 'fixed', incentiveType: 'percent' }
    : { salaryType: 'fixed', incentiveType: 'fixed' };
}

function describePay(
  t: Pick<TherapistRow, 'salaryType' | 'salaryValue' | 'incentiveType' | 'incentiveValue'>,
  currency: string,
): string {
  const money = (v: number) => formatMoney(v, currency);
  const pct = (bps: number) => `${bps / 100}%`;
  const salary = t.salaryType === 'percent' ? `${pct(t.salaryValue)} per job` : t.salaryValue > 0 ? `${money(t.salaryValue)}/mo` : 'no salary set';
  const fee = t.incentiveType === 'percent' ? `${pct(t.incentiveValue)} per job` : t.incentiveValue > 0 ? `${money(t.incentiveValue)} bonus` : 'no bonus set';
  return `Salary ${salary} · Job fee ${fee}`;
}

type Draft = {
  id?: string;
  branchId: string;
  name: string;
  bio: string;
  specialties: string;
  avatarUrl: string;
  role: StaffRole;
  salaryType: StaffPayType;
  salaryValue: number;
  incentiveType: StaffPayType;
  incentiveValue: number;
  active: boolean;
};

export function TherapistManager({
  therapists,
  branches,
}: {
  therapists: TherapistRow[];
  branches: { id: string; name: string; currency: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => blankDraft(branches[0]?.id ?? ''));
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  function blankDraft(branchId: string): Draft {
    const pay = payTypesForRole('therapist');
    return {
      branchId,
      name: '',
      bio: '',
      specialties: '',
      avatarUrl: '',
      role: 'therapist',
      ...pay,
      salaryValue: 0,
      incentiveValue: 0,
      active: true,
    };
  }

  if (branches.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
        <p className="text-[15px] font-medium">Add a branch first</p>
        <p className="mt-1 text-sm text-ink-500">Staff belong to a location.</p>
      </div>
    );
  }

  function openCreate() {
    setDraft(blankDraft(branches[0]!.id));
    setOpen(true);
  }

  function openEdit(t: TherapistRow) {
    setDraft({
      id: t.id,
      branchId: t.branchId,
      name: t.name,
      bio: t.bio ?? '',
      specialties: t.specialties.join(', '),
      avatarUrl: t.avatarUrl ?? '',
      role: t.role,
      salaryType: t.salaryType,
      salaryValue: t.salaryValue,
      incentiveType: t.incentiveType,
      incentiveValue: t.incentiveValue,
      active: t.active,
    });
    setOpen(true);
  }

  function setRole(role: StaffRole) {
    // Keep the pay model consistent with what the role is paid by.
    setDraft((d) => ({ ...d, role, ...payTypesForRole(role) }));
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      // Avatars render at ≤64px — downscale hard so the upload stays small
      // enough to save and doesn't bloat the page as an inline data URL.
      const url = await fileToDataUrl(file, 512, 0.82);
      if (!isRenderableImage(url)) {
        toast.error('Unsupported image', 'Use a JPG, PNG, WebP or GIF file.');
        return;
      }
      setDraft((d) => ({ ...d, avatarUrl: url }));
    } catch (err) {
      toast.error(
        'Could not read that photo',
        err instanceof Error ? err.message : 'Try a JPG, PNG or WebP file.',
      );
    }
  }

  function save() {
    startTransition(async () => {
      try {
        const res = await saveTherapist({
          ...(draft.id ? { id: draft.id } : {}),
          branchId: draft.branchId,
          name: draft.name.trim(),
          bio: draft.bio.trim() || null,
          specialties: draft.specialties
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 12),
          avatarUrl: draft.avatarUrl.trim() || null,
          role: draft.role,
          salaryType: draft.salaryType,
          salaryValue: Math.max(0, Math.round(draft.salaryValue)),
          incentiveType: draft.incentiveType,
          incentiveValue: Math.max(0, Math.round(draft.incentiveValue)),
          active: draft.active,
        });
        if (res.ok) {
          toast.success(draft.id ? 'Staff updated' : 'Staff added');
          setOpen(false);
          router.refresh();
        } else {
          toast.error('Could not save', res.error);
        }
      } catch (err) {
        // A failed action (network, oversized photo) must not look like a save.
        // Production React hides the real failure behind "Minified React
        // error #441" — show a message a person can act on instead.
        const raw = err instanceof Error ? err.message : '';
        const minified = /Minified React error #\d+/.test(raw);
        toast.error(
          'Could not save',
          minified
            ? 'The server could not finish saving, so nothing was saved — your form is still here; please try again.'
            : raw || 'Something went wrong — please try again.',
        );
      }
    });
  }

  function toggle(t: TherapistRow) {
    startTransition(async () => {
      const res = await setTherapistActive(t.id, !t.active);
      if (res.ok) {
        toast.success(t.active ? 'Deactivated' : 'Activated');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  const byBranch = new Map<string, TherapistRow[]>();
  for (const t of therapists) {
    const list = byBranch.get(t.branchId) ?? [];
    list.push(t);
    byBranch.set(t.branchId, list);
  }

  const draftCurrency = branches.find((b) => b.id === draft.branchId)?.currency ?? branches[0]?.currency ?? 'IDR';
  const isPercent = draft.salaryType === 'percent';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">
          Your team — admins run the POS till, therapists take bookings, shifts are edited under Availability.
        </p>
        <button type="button" onClick={openCreate} className={buttonClasses('primary', 'md')}>
          <Plus className="size-4" /> Add staff
        </button>
      </div>

      {branches.map((b) => {
        const list = byBranch.get(b.id) ?? [];
        return (
          <div key={b.id} className="rounded-3xl border border-ink-100 bg-white">
            <div className="border-b border-ink-100 px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">{b.name}</h2>
            </div>

            {list.length === 0 ? (
              <p className="px-5 py-6 text-center text-[13.5px] text-ink-500">No staff at this branch yet.</p>
            ) : (
              <ul className="divide-y divide-ink-50">
                {list.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5">
                    <div className="flex min-w-0 items-center gap-3">
                      {t.avatarUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element -- accepts staff uploads and links */
                        <img
                          src={t.avatarUrl}
                          alt={t.name}
                          className="size-10 shrink-0 rounded-full border border-ink-100 object-cover"
                        />
                      ) : (
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sand-100 text-[13px] font-semibold text-ink-500">
                          {t.name
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((w) => w[0])
                            .join('')
                            .toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[15px] font-medium">{t.name}</p>
                          <Badge tone={t.role === 'admin' ? 'clay' : t.role === 'worker' ? 'info' : 'brand'}>
                            {ROLE_LABELS[t.role]}
                          </Badge>
                          {!t.active && <Badge tone="neutral">inactive</Badge>}
                          {t.specialties.slice(0, 3).map((s) => (
                            <Badge key={s} tone="brand">
                              {s}
                            </Badge>
                          ))}
                        </div>
                        {t.bio && <p className="mt-0.5 line-clamp-1 text-[13px] text-ink-500">{t.bio}</p>}
                        <p className="mt-0.5 text-[12.5px] text-ink-400">
                          {describePay(t, b.currency)} · {t.shiftCount} weekly shift
                          {t.shiftCount === 1 ? '' : 's'} · {t.next7Count} appointment{t.next7Count === 1 ? '' : 's'} in
                          next 7 days
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => openEdit(t)} className={buttonClasses('outline', 'sm')}>
                        <Pencil className="size-3.5" /> Edit
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => toggle(t)}
                        className={buttonClasses('ghost', 'sm', t.active ? 'text-rose-600 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50')}
                      >
                        {t.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={draft.id ? 'Edit staff' : 'Add staff'}
        description="Choose the role first — pay fields follow how that role is paid. Admins can sign in at /provider/pos."
      >
        <div className="space-y-4">
          <Field label="Name" required>
            {({ id }) => (
              <Input
                id={id}
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Ayu Lestari"
                required
              />
            )}
          </Field>

          <Field label="Role" required hint={ROLE_HINTS[draft.role]}>
            {({ id }) => (
              <select
                id={id}
                value={draft.role}
                onChange={(e) => setRole(e.target.value as StaffRole)}
                className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              >
                <option value="admin">Admin — front desk / POS</option>
                <option value="worker">Worker — regular staff</option>
                <option value="therapist">Therapist — treats guests</option>
              </select>
            )}
          </Field>

          <Field label="Photo" hint="Therapists show this picture on your spa page. Upload from your device or paste a link.">
            {() => (
              <div className="flex flex-wrap items-center gap-3">
                {draft.avatarUrl ? (
                  <span className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- accepts staff uploads and links */}
                    <img
                      src={draft.avatarUrl}
                      alt="Staff preview"
                      className="size-16 rounded-full border border-ink-100 object-cover"
                    />
                  </span>
                ) : (
                  <span className="flex size-16 items-center justify-center rounded-full bg-sand-100 text-ink-400">
                    <UserRound className="size-6" />
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
                  <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <Camera className="size-3.5" /> Upload from device
                  </Button>
                  {draft.avatarUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDraft((d) => ({ ...d, avatarUrl: '' }))}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <Input
                  value={draft.avatarUrl.startsWith('data:') ? '' : draft.avatarUrl}
                  onChange={(e) => setDraft((d) => ({ ...d, avatarUrl: e.target.value }))}
                  placeholder="https://… photo link"
                  aria-label="Photo link"
                  className="w-full sm:w-64"
                />
              </div>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={isPercent ? 'Salary (per job)' : 'Salary (monthly)'}
              hint={isPercent ? `${draftSalaryPct()}% of every job this staff member performs.` : 'Fixed monthly amount.'}
            >
              {() =>
                isPercent ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={draft.salaryValue / 100}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, salaryValue: Math.round(Number(e.target.value) * 100) }))
                      }
                      aria-label="Salary percent"
                      className="h-11 w-28 rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                    />
                    <span className="text-sm text-ink-500">% of job value</span>
                  </div>
                ) : (
                  <MoneyInput
                    value={draft.salaryValue}
                    currency={draftCurrency}
                    onValueChange={(minor) => setDraft((d) => ({ ...d, salaryValue: minor }))}
                    aria-label="Salary amount"
                  />
                )
              }
            </Field>

            <Field
              label={draft.incentiveType === 'percent' ? 'Job fee / incentive (per job)' : 'Job fee / incentive (bonus)'}
              hint={
                draft.incentiveType === 'percent'
                  ? `${draftIncentivePct()}% extra on every job this staff member performs.`
                  : 'Fixed bonus amount.'
              }
            >
              {() =>
                draft.incentiveType === 'percent' ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={draft.incentiveValue / 100}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, incentiveValue: Math.round(Number(e.target.value) * 100) }))
                      }
                      aria-label="Incentive percent"
                      className="h-11 w-28 rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                    />
                    <span className="text-sm text-ink-500">% of job value</span>
                  </div>
                ) : (
                  <MoneyInput
                    value={draft.incentiveValue}
                    currency={draftCurrency}
                    onValueChange={(minor) => setDraft((d) => ({ ...d, incentiveValue: minor }))}
                    aria-label="Incentive amount"
                  />
                )
              }
            </Field>
          </div>

          <Field label="Branch" required>
            {({ id }) => (
              <select
                id={id}
                value={draft.branchId}
                onChange={(e) => setDraft((d) => ({ ...d, branchId: e.target.value }))}
                className="h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Specialties" hint="Comma separated — e.g. boreh, deep tissue, reflexology">
            {({ id }) => (
              <Input
                id={id}
                value={draft.specialties}
                onChange={(e) => setDraft((d) => ({ ...d, specialties: e.target.value }))}
                placeholder="boreh, deep tissue"
              />
            )}
          </Field>

          <Field label="Short bio">
            {({ id }) => (
              <Textarea
                id={id}
                value={draft.bio}
                onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
                maxLength={1000}
                placeholder="Years of experience, languages…"
              />
            )}
          </Field>

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
              className="size-4 accent-[#20524c]"
            />
            Available for booking
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" size="md" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="md" onClick={save} loading={pending}>
            {draft.id ? 'Save changes' : 'Add staff'}
          </Button>
        </div>
      </Modal>
    </div>
  );

  function draftSalaryPct(): string {
    return String(draft.salaryValue / 100);
  }
  function draftIncentivePct(): string {
    return String(draft.incentiveValue / 100);
  }
}

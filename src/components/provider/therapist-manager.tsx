'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, UserRound } from 'lucide-react';
import { saveTherapist, setTherapistActive } from '@/lib/actions/provider';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';

export type TherapistRow = {
  id: string;
  branchId: string;
  name: string;
  bio: string | null;
  specialties: string[];
  active: boolean;
  shiftCount: number;
  next7Count: number;
};

type Draft = {
  id?: string;
  branchId: string;
  name: string;
  bio: string;
  specialties: string;
  active: boolean;
};

export function TherapistManager({
  therapists,
  branches,
}: {
  therapists: TherapistRow[];
  branches: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ branchId: branches[0]?.id ?? '', name: '', bio: '', specialties: '', active: true });
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  if (branches.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
        <p className="text-[15px] font-medium">Add a branch first</p>
        <p className="mt-1 text-sm text-ink-500">Therapists belong to a location.</p>
      </div>
    );
  }

  function openCreate() {
    setDraft({ branchId: branches[0].id, name: '', bio: '', specialties: '', active: true });
    setOpen(true);
  }

  function openEdit(t: TherapistRow) {
    setDraft({
      id: t.id,
      branchId: t.branchId,
      name: t.name,
      bio: t.bio ?? '',
      specialties: t.specialties.join(', '),
      active: t.active,
    });
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
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
        active: draft.active,
      });
      if (res.ok) {
        toast.success(draft.id ? 'Therapist updated' : 'Therapist added');
        setOpen(false);
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">Your team — shifts are edited under Availability.</p>
        <button type="button" onClick={openCreate} className={buttonClasses('primary', 'md')}>
          <Plus className="size-4" /> Add therapist
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
              <p className="px-5 py-6 text-center text-[13.5px] text-ink-500">No therapists at this branch yet.</p>
            ) : (
              <ul className="divide-y divide-ink-50">
                {list.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[15px] font-medium">{t.name}</p>
                        {!t.active && <Badge tone="neutral">inactive</Badge>}
                        {t.specialties.slice(0, 3).map((s) => (
                          <Badge key={s} tone="brand">
                            {s}
                          </Badge>
                        ))}
                      </div>
                      {t.bio && <p className="mt-0.5 line-clamp-1 text-[13px] text-ink-500">{t.bio}</p>}
                      <p className="mt-0.5 text-[12.5px] text-ink-400">
                        {t.shiftCount} weekly shift{t.shiftCount === 1 ? '' : 's'} · {t.next7Count} appointment
                        {t.next7Count === 1 ? '' : 's'} in next 7 days
                      </p>
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
        title={draft.id ? 'Edit therapist' : 'Add therapist'}
        description="Therapists appear in the booking wizard when customers pick a specialist."
      >
        <div className="space-y-4">
          <Field label="Name" required>
            {({ id }) => (
              <Input id={id} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Ayu Lestari" required />
            )}
          </Field>
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
              <Input id={id} value={draft.specialties} onChange={(e) => setDraft((d) => ({ ...d, specialties: e.target.value }))} placeholder="boreh, deep tissue" />
            )}
          </Field>
          <Field label="Short bio">
            {({ id }) => (
              <Textarea id={id} value={draft.bio} onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))} maxLength={1000} placeholder="Years of experience, languages…" />
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
            {draft.id ? 'Save changes' : 'Add therapist'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

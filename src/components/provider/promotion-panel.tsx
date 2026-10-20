'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import { deletePromotion, saveBranchPromotion, setPromotionActive } from '@/lib/actions/provider';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field, Input, Textarea, inputCls } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export type PromotionRow = {
  id: string;
  title: string;
  summary: string | null;
  position: string;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
};

type Draft = {
  id?: string;
  title: string;
  summary: string;
  position: string;
  startsAt: string;
  endsAt: string;
};

const EMPTY_DRAFT: Draft = { title: '', summary: '', position: 'banner', startsAt: '', endsAt: '' };
const POSITIONS = [
  { id: 'hero', label: 'Hero' },
  { id: 'banner', label: 'Banner' },
  { id: 'deal', label: 'Deal' },
];

function isoDate(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

export function PromotionPanel({ branchId, rows }: { branchId: string; rows: PromotionRow[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function save() {
    if (!draft) return;
    startTransition(async () => {
      const res = await saveBranchPromotion({
        ...(draft.id ? { id: draft.id } : {}),
        branchId,
        title: draft.title.trim(),
        summary: draft.summary.trim() || null,
        position: draft.position as 'hero' | 'banner' | 'deal',
        startsAt: draft.startsAt || null,
        endsAt: draft.endsAt || null,
        active: true,
      });
      if (res.ok) {
        toast.success(draft.id ? 'Promotion updated' : 'Promotion created');
        setDraft(null);
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
      }
    });
  }

  function toggle(p: PromotionRow) {
    startTransition(async () => {
      const res = await setPromotionActive(p.id, !p.active);
      if (res.ok) {
        toast.success(p.active ? 'Promotion unpublished' : 'Promotion published');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  function remove(p: PromotionRow) {
    startTransition(async () => {
      const res = await deletePromotion(p.id);
      if (res.ok) {
        toast.success('Promotion deleted');
        router.refresh();
      } else {
        toast.error('Could not delete', res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">Promotions for this branch — shown on your listing and the deals page.</p>
        <button type="button" onClick={() => setDraft(EMPTY_DRAFT)} className={buttonClasses('primary', 'md')}>
          <Plus className="size-4" /> New promotion
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
          <Megaphone className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 text-[15px] font-medium">No promotions yet</p>
          <p className="mt-1 text-sm text-ink-500">Run a seasonal offer or feature a package at this location.</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((p) => (
            <li key={p.id} className="rounded-2xl border border-ink-100 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[15px] font-medium">{p.title}</p>
                    <Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'published' : 'unpublished'}</Badge>
                    <Badge tone="clay">{p.position}</Badge>
                  </div>
                  {p.summary && <p className="mt-0.5 max-w-prose text-[13px] text-ink-500">{p.summary}</p>}
                  <p className="mt-0.5 text-[13px] text-ink-400">
                    {p.startsAt || p.endsAt
                      ? `${p.startsAt ? isoDate(p.startsAt) : 'now'} → ${p.endsAt ? isoDate(p.endsAt) : 'no end date'}`
                      : 'always on'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        id: p.id,
                        title: p.title,
                        summary: p.summary ?? '',
                        position: p.position,
                        startsAt: isoDate(p.startsAt),
                        endsAt: isoDate(p.endsAt),
                      })
                    }
                    className={buttonClasses('ghost', 'sm')}
                  >
                    <Pencil className="size-3.5" /> Edit
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => toggle(p)}
                    className={buttonClasses('ghost', 'sm', p.active ? 'text-rose-600 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50')}
                  >
                    {p.active ? 'Unpublish' : 'Publish'}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(p)}
                    className={buttonClasses('ghost', 'sm', 'text-rose-600 hover:bg-rose-50')}
                    aria-label={`Delete ${p.title}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={draft !== null}
        onClose={() => !pending && setDraft(null)}
        title={draft?.id ? 'Edit promotion' : 'New promotion'}
        description="Customers see this on your branch page and the marketplace deals page."
      >
        {draft && (
          <>
            <Field label="Title" required>
              {({ id }) => (
                <Input id={id} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="20% off weekday massages" required />
              )}
            </Field>
            <Field label="Summary" className="mt-4">
              {({ id }) => (
                <Textarea id={id} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} maxLength={400} />
              )}
            </Field>
            <Field label="Placement" className="mt-4">
              {({ id }) => (
                <select id={id} value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} className={inputCls()}>
                  {POSITIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Starts">
                {({ id }) => (
                  <Input id={id} type="date" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
                )}
              </Field>
              <Field label="Ends">
                {({ id }) => (
                  <Input id={id} type="date" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
                )}
              </Field>
            </div>
            <div className={cn('mt-6 flex justify-end gap-3')}>
              <Button variant="ghost" size="md" onClick={() => setDraft(null)} disabled={pending}>
                Cancel
              </Button>
              <Button size="md" onClick={save} loading={pending}>
                {draft.id ? 'Save changes' : 'Create promotion'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

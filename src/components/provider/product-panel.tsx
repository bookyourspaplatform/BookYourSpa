'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { deleteProduct, saveProduct, setProductActive } from '@/lib/actions/provider';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { MoneyInput } from '@/components/ui/money-input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';

export type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  active: boolean;
};

type Draft = { id?: string; name: string; description: string; price: number };

const EMPTY_DRAFT: Draft = { name: '', description: '', price: 0 };

export function ProductPanel({ branchId, currency, rows }: { branchId: string; currency: string; rows: ProductRow[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function save() {
    if (!draft) return;
    startTransition(async () => {
      const res = await saveProduct({
        ...(draft.id ? { id: draft.id } : {}),
        branchId,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        price: Number(draft.price),
        active: true,
      });
      if (res.ok) {
        toast.success(draft.id ? 'Product updated' : 'Product added');
        setDraft(null);
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
      }
    });
  }

  function toggle(p: ProductRow) {
    startTransition(async () => {
      const res = await setProductActive(p.id, !p.active);
      if (res.ok) {
        toast.success(p.active ? 'Product hidden' : 'Product published');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  function remove(p: ProductRow) {
    startTransition(async () => {
      const res = await deleteProduct(p.id);
      if (res.ok) {
        toast.success('Product deleted');
        router.refresh();
      } else {
        toast.error('Could not delete', res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">Retail products customers can buy at this branch.</p>
        <button type="button" onClick={() => setDraft(EMPTY_DRAFT)} className={buttonClasses('primary', 'md')}>
          <Plus className="size-4" /> Add product
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
          <Package className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 text-[15px] font-medium">No products yet</p>
          <p className="mt-1 text-sm text-ink-500">Retail items, gift sets or take-home products sold at this location.</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((p) => (
            <li key={p.id} className="rounded-2xl border border-ink-100 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[15px] font-medium">{p.name}</p>
                    <Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'published' : 'unpublished'}</Badge>
                  </div>
                  {p.description && <p className="mt-0.5 max-w-prose text-[13px] text-ink-500">{p.description}</p>}
                  <p className="mt-0.5 text-[13px] tabular-nums text-ink-500">
                    {p.currency} {p.price.toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setDraft({ id: p.id, name: p.name, description: p.description ?? '', price: p.price })}
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
                    aria-label={`Delete ${p.name}`}
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
        title={draft?.id ? 'Edit product' : 'Add product'}
        description="Products show on your branch page for customers to buy in person."
      >
        {draft && (
          <>
            <Field label="Name" required>
              {({ id }) => (
                <Input id={id} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Loose leaf tea set" required />
              )}
            </Field>
            <Field label="Description" className="mt-4">
              {({ id }) => (
                <Textarea id={id} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={1000} />
              )}
            </Field>
            <Field label="Price" className="mt-4">
              {({ id }) => (
                <MoneyInput id={id} value={draft.price} currency={currency} onValueChange={(minor) => setDraft({ ...draft, price: minor })} />
              )}
            </Field>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="ghost" size="md" onClick={() => setDraft(null)} disabled={pending}>
                Cancel
              </Button>
              <Button size="md" onClick={save} loading={pending}>
                {draft.id ? 'Save changes' : 'Add product'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { adminGetSpa, adminSaveSpa, type AdminSpaBranch } from '@/lib/actions/admin';
import { BranchEditor, type BranchRow } from '@/components/provider/branch-editor';
import { AdminSpaExtras } from '@/components/admin/add-provider-form';
import { Modal } from '@/components/ui/modal';
import { buttonClasses } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

type SpaData = {
  provider: { id: string; name: string; status: string; ownerId: string | null; slug: string };
  branches: AdminSpaBranch[];
};

/**
 * Admin DB → Providers → "Edit". Loads the listing's branches and opens the
 * supplier's full spa business form (BranchEditor) for one of them — this is
 * how admins manage unclaimed spas end-to-end. Providers with several
 * locations get a picker first; providers with none go straight to creating
 * their first location.
 */
export function EditSpaButton({
  providerId,
  name,
  unclaimed,
}: {
  providerId: string;
  name: string;
  unclaimed: boolean;
}) {
  const [loading, startLoad] = useTransition();
  const [data, setData] = useState<SpaData | null>(null);
  const [view, setView] = useState<'picker' | 'editor'>('picker');
  const [chosen, setChosen] = useState<BranchRow | null>(null);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [publish, setPublish] = useState(true);
  const toast = useToast();

  function load() {
    startLoad(async () => {
      const res = await adminGetSpa(providerId);
      if (!res.ok) {
        toast.error('Could not load the spa', res.error);
        return;
      }
      if (!res.data) return;
      setData(res.data);
      setOwnerEmail('');
      setPublish(res.data.provider.status === 'approved');
      if (res.data.branches.length === 1) {
        setChosen(res.data.branches[0]!);
        setView('editor');
      } else {
        setChosen(null);
        setView(res.data.branches.length === 0 ? 'editor' : 'picker');
      }
    });
  }

  if (!data) {
    return (
      <button
        type="button"
        onClick={load}
        disabled={loading}
        title={unclaimed ? 'Edit this unclaimed listing — you manage everything guests see' : undefined}
        className={buttonClasses('outline', 'sm')}
      >
        <Pencil className="size-3.5" /> Edit listing
      </button>
    );
  }

  const close = () => setData(null);

  if (view === 'editor') {
    return (
      <BranchEditor
        key={chosen?.id ?? 'new'}
        branch={chosen}
        onClose={close}
        saveBranch={(input) => adminSaveSpa({ ...input, providerId, ownerEmail, publish })}
        extras={
          <AdminSpaExtras
            ownerEmail={ownerEmail}
            onOwnerEmail={setOwnerEmail}
            publish={publish}
            onPublish={setPublish}
            unclaimed={data.provider.ownerId === null}
          />
        }
      />
    );
  }

  return (
    <Modal
      open
      onClose={close}
      title={`Edit ${name}`}
      description="This spa has several locations — pick the one to edit."
      size="md"
    >
      <ul className="space-y-2">
        {data.branches.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => {
                setChosen(b);
                setView('editor');
              }}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 text-left transition hover:border-brand-400 hover:bg-brand-50/40"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink-800">{b.name}</span>
                <span className="block text-[12.5px] text-ink-500">
                  {b.city}, {b.country} · {b.treatmentCount} treatments · {b.therapistCount} therapists
                </span>
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  b.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
                )}
              >
                {b.status}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          setChosen(null);
          setView('editor');
        }}
        className={buttonClasses('outline', 'sm', 'mt-4')}
      >
        <Plus className="size-4" /> Add another location
      </button>
    </Modal>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { deleteBranch, setBranchStatus } from '@/lib/actions/provider';
import { BranchEditor, type BranchRow } from '@/components/provider/branch-editor';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export function BranchHeaderActions({ branch }: { branch: BranchRow }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const published = branch.status === 'active';

  function togglePublish() {
    startTransition(async () => {
      const res = await setBranchStatus(branch.id, published ? 'suspended' : 'active');
      if (res.ok) {
        toast.success(published ? 'Branch unpublished' : 'Branch published');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteBranch(branch.id);
      if (res.ok) {
        toast.success('Branch deleted');
        router.push('/provider/branches');
        router.refresh();
      } else {
        toast.error('Could not delete', res.error);
        setConfirmDelete(false);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        <Pencil className="size-3.5" /> Edit
      </Button>
      <button
        type="button"
        disabled={pending}
        onClick={togglePublish}
        className={buttonClasses('ghost', 'sm', published ? 'text-rose-600 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50')}
      >
        {published ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        {published ? 'Unpublish' : 'Publish'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirmDelete(true)}
        className={buttonClasses('ghost', 'sm', 'text-rose-600 hover:bg-rose-50')}
        aria-label="Delete branch"
      >
        <Trash2 className="size-3.5" />
      </button>

      {editing && <BranchEditor branch={branch} onClose={() => setEditing(false)} />}

      <Modal
        open={confirmDelete}
        onClose={() => !pending && setConfirmDelete(false)}
        title={`Delete ${branch.name}?`}
        description="This removes the branch and everything inside it. Branches with bookings cannot be deleted — suspend them instead."
      >
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="md" onClick={() => setConfirmDelete(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="md" onClick={remove} loading={pending} className="bg-rose-600 hover:bg-rose-700">
            Delete branch
          </Button>
        </div>
      </Modal>
    </div>
  );
}

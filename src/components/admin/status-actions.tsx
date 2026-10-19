'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Ban, RotateCcw, Percent } from 'lucide-react';
import { setProviderStatus, setAgentStatus, setAgentCommission } from '@/lib/actions/admin';
import { buttonClasses } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export function StatusActions({
  kind,
  id,
  status,
  commissionBps,
}: {
  kind: 'provider' | 'agent';
  id: string;
  status: string;
  commissionBps?: number;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [bps, setBps] = useState(commissionBps ?? 1000);
  const router = useRouter();
  const toast = useToast();

  function run(next: 'approved' | 'suspended' | 'pending') {
    startTransition(async () => {
      const res = kind === 'provider' ? await setProviderStatus(id, next) : await setAgentStatus(id, next);
      if (res.ok) {
        toast.success(next === 'approved' ? 'Approved' : next === 'suspended' ? 'Suspended' : 'Set to pending');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  function saveCommission() {
    startTransition(async () => {
      const res = await setAgentCommission(id, bps);
      if (res.ok) {
        toast.success('Commission updated');
        setEditing(false);
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-1.5">
        {status !== 'approved' && (
          <button type="button" disabled={pending} onClick={() => run('approved')} className={buttonClasses('primary', 'sm')}>
            <Check className="size-3.5" /> Approve
          </button>
        )}
        {status !== 'suspended' && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run('suspended')}
            className={buttonClasses('ghost', 'sm', 'text-rose-600 hover:bg-rose-50')}
          >
            <Ban className="size-3.5" /> Suspend
          </button>
        )}
        {status === 'suspended' && (
          <button type="button" disabled={pending} onClick={() => run('pending')} className={buttonClasses('outline', 'sm')}>
            <RotateCcw className="size-3.5" /> Reinstate
          </button>
        )}
        {kind === 'agent' && commissionBps !== undefined && (
          <button type="button" onClick={() => setEditing((v) => !v)} className={buttonClasses('outline', 'sm')}>
            <Percent className="size-3.5" /> Commission
          </button>
        )}
      </div>

      {editing && commissionBps !== undefined && (
        <div className="flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-2 py-1.5">
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={bps / 100}
            onChange={(e) => setBps(Math.round(Number(e.target.value) * 100))}
            aria-label="Commission percent"
            className="h-8 w-20 rounded-lg border border-ink-200 px-2 text-sm tabular-nums outline-none focus:border-brand-500"
          />
          <span className="text-[13px] text-ink-500">%</span>
          <button
            type="button"
            disabled={pending}
            onClick={saveCommission}
            className={buttonClasses('primary', 'sm')}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

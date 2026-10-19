'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, Banknote } from 'lucide-react';
import { setCommissionStatus } from '@/lib/actions/admin';
import { buttonClasses } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export function CommissionActions({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function run(next: 'approved' | 'paid') {
    startTransition(async () => {
      const res = await setCommissionStatus(id, next);
      if (res.ok) {
        toast.success(next === 'approved' ? 'Commission approved' : 'Marked as paid');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  if (status === 'paid') return <span className="text-[13px] text-emerald-600">settled</span>;

  return (
    <div className="flex justify-end gap-1.5">
      {status === 'pending' && (
        <button type="button" disabled={pending} onClick={() => run('approved')} className={buttonClasses('outline', 'sm')}>
          <BadgeCheck className="size-3.5" /> Approve
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => run('paid')}
        className={buttonClasses('primary', 'sm')}
      >
        <Banknote className="size-3.5" /> Mark paid
      </button>
    </div>
  );
}

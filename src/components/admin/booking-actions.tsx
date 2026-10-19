'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CheckCheck, Ban, UserX } from 'lucide-react';
import { adminBookingAction } from '@/lib/actions/admin';
import { buttonClasses } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

type Action = 'confirm' | 'complete' | 'noshow' | 'cancel';

const LABELS: Record<Action, string> = {
  confirm: 'Confirm',
  complete: 'Complete',
  noshow: 'No-show',
  cancel: 'Cancel',
};

export function AdminBookingActions({ bookingId, status }: { bookingId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const actions: Action[] =
    status === 'pending' ? ['confirm', 'cancel'] : status === 'confirmed' ? ['complete', 'noshow', 'cancel'] : [];

  if (actions.length === 0) return null;

  function run(action: Action) {
    startTransition(async () => {
      const res = await adminBookingAction(bookingId, action);
      if (res.ok) {
        toast.success('Booking updated');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {actions.map((a) => (
        <button
          key={a}
          type="button"
          disabled={pending}
          onClick={() => run(a)}
          className={buttonClasses(
            a === 'cancel' ? 'ghost' : 'outline',
            'sm',
            a === 'cancel'
              ? 'text-rose-600 hover:bg-rose-50'
              : a === 'noshow'
                ? 'text-amber-700 hover:bg-amber-50'
                : 'text-brand-700 hover:bg-brand-50',
          )}
        >
          {a === 'confirm' && <Check className="size-3.5" />}
          {a === 'complete' && <CheckCheck className="size-3.5" />}
          {a === 'noshow' && <UserX className="size-3.5" />}
          {a === 'cancel' && <Ban className="size-3.5" />}
          {LABELS[a]}
        </button>
      ))}
    </div>
  );
}

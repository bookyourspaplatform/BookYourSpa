'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CheckCheck, Ban, UserX } from 'lucide-react';
import { updateBookingStatus } from '@/lib/actions/provider';
import { buttonClasses } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

type Action = 'confirm' | 'complete' | 'noshow' | 'cancel';

const LABELS: Record<Action, string> = {
  confirm: 'Confirm',
  complete: 'Complete',
  noshow: 'No-show',
  cancel: 'Cancel',
};

export function BookingActions({
  bookingId,
  status,
  layout = 'row',
}: {
  bookingId: string;
  status: string;
  layout?: 'row' | 'stack';
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const actions: Action[] =
    status === 'pending'
      ? ['confirm', 'cancel']
      : status === 'confirmed'
        ? ['complete', 'noshow', 'cancel']
        : [];

  if (actions.length === 0) return null;

  const icons: Record<Action, React.ReactNode> = {
    confirm: <Check className="size-3.5" />,
    complete: <CheckCheck className="size-3.5" />,
    noshow: <UserX className="size-3.5" />,
    cancel: <Ban className="size-3.5" />,
  };

  function run(action: Action) {
    startTransition(async () => {
      const res = await updateBookingStatus(bookingId, action);
      if (res.ok) {
        toast.success(`Booking ${action === 'noshow' ? 'marked no-show' : `${action}${action === 'confirm' ? 'ed' : action === 'complete' ? 'd' : ''}`}`);
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  return (
    <div className={layout === 'stack' ? 'flex flex-col gap-1.5' : 'flex flex-wrap gap-1.5'}>
      {actions.map((a) => (
        <button
          key={a}
          type="button"
          disabled={pending}
          onClick={() => run(a)}
          className={buttonClasses(
            a === 'confirm' || a === 'complete' ? 'outline' : a === 'cancel' ? 'ghost' : 'ghost',
            'sm',
            a === 'cancel'
              ? 'text-rose-600 hover:bg-rose-50'
              : a === 'noshow'
                ? 'text-amber-700 hover:bg-amber-50'
                : 'text-brand-700 hover:bg-brand-50',
          )}
        >
          {icons[a]}
          {LABELS[a]}
        </button>
      ))}
    </div>
  );
}

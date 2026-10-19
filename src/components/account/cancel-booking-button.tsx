'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { XCircle } from 'lucide-react';
import { cancelMyBooking } from '@/lib/actions/account';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export function CancelBookingButton({
  bookingId,
  disabled,
  disabledReason,
}: {
  bookingId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function confirmCancel() {
    startTransition(async () => {
      const res = await cancelMyBooking(bookingId);
      setOpen(false);
      if (res.ok) {
        toast.success('Booking cancelled', 'Your slot has been released.');
        router.refresh();
      } else {
        toast.error('Could not cancel', res.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        className={buttonClasses('ghost', 'sm', 'text-rose-600 hover:bg-rose-50 disabled:opacity-40')}
      >
        <XCircle className="size-4" /> Cancel
      </button>

      <Modal open={open} onClose={() => !pending && setOpen(false)} title="Cancel this booking?">
        <p className="text-sm text-ink-600">
          This releases your slot immediately. Free cancellation applies up to the policy window before the
          appointment. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" size="md" onClick={() => setOpen(false)} disabled={pending}>
            Keep booking
          </Button>
          <Button variant="danger" size="md" onClick={confirmCancel} loading={pending}>
            Yes, cancel it
          </Button>
        </div>
      </Modal>
    </>
  );
}

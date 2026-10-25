'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UserRound } from 'lucide-react';
import { setBookingTherapist } from '@/lib/actions/provider';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export type TherapistOption = { id: string; name: string; active: boolean };

/**
 * Therapist picker for one booking row. Staff can assign somebody when the
 * customer booked without a preference, swap to another therapist, or clear it
 * back to "not assigned".
 */
export function BookingTherapist({
  bookingId,
  therapistId,
  options,
  disabled = false,
}: {
  bookingId: string;
  therapistId: string | null;
  options: TherapistOption[];
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  // Never lose the current assignment from the list, even if staff went inactive.
  const list = therapistId && !options.some((o) => o.id === therapistId)
    ? [{ id: therapistId, name: 'Previous therapist', active: false }, ...options]
    : options;

  if (list.length === 0 && !therapistId) return null;

  function change(next: string) {
    const id = next || null;
    if (id === therapistId) return;
    startTransition(async () => {
      const res = await setBookingTherapist(bookingId, id);
      if (res.ok) {
        toast.success(id ? 'Therapist assigned' : 'Therapist cleared');
        router.refresh();
      } else {
        toast.error('Could not update therapist', res.error);
      }
    });
  }

  return (
    <label className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-[13px] text-ink-500">
        <UserRound className="size-3.5" />
        Therapist
      </span>
      <select
        value={therapistId ?? ''}
        disabled={disabled || pending}
        onChange={(e) => change(e.target.value)}
        aria-label="Assign therapist"
        className={cn(
          'h-9 max-w-52 rounded-lg border border-ink-200 bg-white px-2.5 text-[13px] text-ink-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15',
          'disabled:opacity-60',
          !therapistId && 'border-dashed border-amber-400 text-amber-700',
        )}
      >
        <option value="">Not assigned yet</option>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.active ? '' : ' (inactive)'}
          </option>
        ))}
      </select>
    </label>
  );
}
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'brand' | 'clay' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-100 text-ink-700 border-ink-200',
  brand: 'bg-brand-50 text-brand-800 border-brand-200',
  clay: 'bg-clay-50 text-clay-700 border-clay-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger: 'bg-rose-50 text-rose-700 border-rose-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...rest
}: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export const BOOKING_STATUS_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  confirmed: 'brand',
  completed: 'success',
  cancelled: 'danger',
  no_show: 'danger',
};

export const PAYMENT_STATUS_TONE: Record<string, BadgeTone> = {
  unpaid: 'warning',
  processing: 'info',
  paid: 'success',
  refunded: 'neutral',
  partially_refunded: 'warning',
  venue: 'info',
};

import { cn } from '@/lib/utils';

/**
 * Field/input class helpers live outside field.tsx (a client module) so
 * server components can compose their own form controls with the same look.
 */
export const inputCls = (invalid?: boolean) =>
  cn(
    'w-full rounded-xl border bg-white px-3.5 text-sm text-ink-900 outline-none transition',
    'placeholder:text-ink-400 h-11',
    'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15',
    invalid ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/15' : 'border-ink-200',
  );

export const selectCls = inputCls;

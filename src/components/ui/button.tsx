import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'warning'
  | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 shadow-sm',
  secondary: 'bg-clay-500 text-white hover:bg-clay-600 active:bg-clay-700 shadow-sm',
  outline: 'border border-ink-200 bg-white text-ink-800 hover:border-ink-300 hover:bg-sand-50',
  ghost: 'text-ink-700 hover:bg-ink-100',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
  warning: 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm',
  link: 'text-brand-700 hover:text-brand-800 underline-offset-4 hover:underline px-0',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-[13px]',
  md: 'h-11 px-5 text-sm',
  lg: 'h-12 px-7 text-[15px]',
};

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors select-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
    'disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
    VARIANTS[variant],
    variant !== 'link' && SIZES[size],
    className,
  );
}

type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading && (
        <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
          <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  );
}

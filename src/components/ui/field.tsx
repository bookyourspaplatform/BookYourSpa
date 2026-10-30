'use client';

import { useId } from 'react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/ui/classes';

export { inputCls } from '@/components/ui/classes';

type FieldProps = {
  label?: string;
  /** Rendered opposite the label — used for things like "Forgot password?". */
  labelExtra?: React.ReactNode;
  error?: string | string[] | null;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: (props: { id: string; invalid: boolean }) => React.ReactNode;
};

export function Field({ label, labelExtra, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const message = Array.isArray(error) ? error[0] : error;
  const invalid = Boolean(message);
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || labelExtra) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && (
            <label htmlFor={id} className="text-[13px] font-medium text-ink-700">
              {label}
              {required && <span className="text-clay-600"> *</span>}
            </label>
          )}
          {labelExtra}
        </div>
      )}
      {children({ id, invalid })}
      {message && (
        <p role="alert" className="text-[12.5px] text-rose-600">
          {message}
        </p>
      )}
      {!message && hint && <p className="text-[12.5px] text-ink-500">{hint}</p>}
    </div>
  );
}

export function Input({ className, invalid, ...rest }: ComponentProps<'input'> & { invalid?: boolean }) {
  return <input className={inputCls(invalid)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Textarea({ className, invalid, ...rest }: ComponentProps<'textarea'> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn(inputCls(invalid), 'min-h-28 h-auto py-2.5 leading-relaxed', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export function Select({ className, invalid, children, ...rest }: ComponentProps<'select'> & { invalid?: boolean }) {
  return (
    <select
      className={cn(inputCls(invalid), 'appearance-none pr-9 bg-no-repeat', className)}
      aria-invalid={invalid || undefined}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%2366746f' stroke-width='2' viewBox='0 0 24 24'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundPosition: 'right 0.75rem center',
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Checkbox({ label, className, ...rest }: ComponentProps<'input'> & { label?: React.ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('flex items-start gap-2.5 text-sm text-ink-700 cursor-pointer', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 rounded border-ink-300 text-brand-700 focus:ring-brand-500/30"
        {...rest}
      />
      <span>{label}</span>
    </label>
  );
}

'use client';

import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { inputCls } from '@/components/ui/classes';

/**
 * Password field with the padlock prefix and a show/hide eye toggle, as in the
 * login mock. The toggle is a real button so it stays keyboard reachable, and
 * `aria-pressed` reports the current visibility to screen readers.
 */
export function PasswordInput({
  id,
  name,
  invalid,
  autoComplete,
  placeholder,
  required,
  defaultValue,
}: {
  id?: string;
  name: string;
  invalid?: boolean;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Lock
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
      />
      <input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        aria-invalid={invalid || undefined}
        className={inputCls(invalid) + ' pl-9 pr-11'}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? 'Hide password' : 'Show password'}
        tabIndex={0}
        className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-400 transition-colors hover:text-ink-700 focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

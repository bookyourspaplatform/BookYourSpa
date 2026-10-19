'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { loginAction, type AuthFormState } from '@/lib/actions/auth';
import type { Role } from '@/db/schema';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

export function LoginForm({ role, next }: { role: Role; next?: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(loginAction, null);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="next" value={next ?? ''} />

      <Field label="Email address" error={state?.fieldErrors?.email} required>
        {({ id, invalid }) => (
          <Input
            id={id}
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            invalid={invalid}
            required
          />
        )}
      </Field>

      <Field label="Password" error={state?.fieldErrors?.password} required>
        {({ id, invalid }) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            invalid={invalid}
            required
          />
        )}
      </Field>

      {state?.error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          {state.error}
        </div>
      )}

      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Sign in
      </Button>

      <p className="text-center text-[13px] text-ink-500">
        Forgot your password?{' '}
        <Link href="/contact" className="font-medium text-brand-700 hover:underline">
          Contact support
        </Link>
      </p>
    </form>
  );
}

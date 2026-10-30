'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Mail } from 'lucide-react';
import { forgotPasswordAction, type AuthFormState } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

export function ForgotPasswordForm({ loginPath }: { loginPath: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    forgotPasswordAction,
    null,
  );

  if (state?.success) {
    return (
      <div className="space-y-5">
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800"
        >
          {state.success}
        </div>
        <p className="text-[13px] leading-relaxed text-ink-500">
          The link works once and expires in 1 hour. Didn&apos;t arrive? Check spam, then{' '}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="font-medium text-brand-700 hover:underline"
          >
            send it again
          </button>
          .
        </p>
        <Link
          href={loginPath}
          className="inline-block text-sm font-medium text-brand-700 hover:underline"
        >
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field label="Email address" error={state?.fieldErrors?.email} required>
        {({ id, invalid }) => (
          <div className="relative">
            <Input
              id={id}
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@yoursap.com"
              invalid={invalid}
              required
              className="pl-9"
            />
            <Mail
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
            />
          </div>
        )}
      </Field>

      {state?.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
        >
          {state.error}
        </div>
      )}

      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Send reset link
      </Button>

      <p className="text-center text-[13px] text-ink-500">
        <Link href={loginPath} className="font-medium text-brand-700 hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </form>
  );
}

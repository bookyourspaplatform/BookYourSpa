'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { resetPasswordAction, type AuthFormState } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { PasswordInput } from '@/components/auth/password-input';

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    resetPasswordAction,
    null,
  );
  const router = useRouter();

  // Derive "done" straight from the action result — no setState in an effect.
  const done = Boolean(state?.success);

  // Server actions can't redirect mid-render for useActionState, so move the
  // user on once the confirmation has been visible for a beat.
  useEffect(() => {
    if (!state?.success) return;
    const target = state.redirectTo ?? '/login';
    const t = setTimeout(() => router.push(target), 2200);
    return () => clearTimeout(t);
  }, [state, router]);

  if (done) {
    return (
      <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
        {state?.success} Taking you to sign in…
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />

      <Field label="New password" error={state?.fieldErrors?.password} required hint={
        <span className="text-[12.5px] text-ink-500">At least 8 characters with a letter and a number.</span>
      }>
        {({ id, invalid }) => (
          <PasswordInput
            id={id}
            name="password"
            autoComplete="new-password"
            placeholder="••••••••"
            invalid={invalid}
            required
          />
        )}
      </Field>

      <Field label="Confirm new password" error={state?.fieldErrors?.confirm} required>
        {({ id, invalid }) => (
          <PasswordInput
            id={id}
            name="confirm"
            autoComplete="new-password"
            placeholder="••••••••"
            invalid={invalid}
            required
          />
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
        Set new password
      </Button>
    </form>
  );
}

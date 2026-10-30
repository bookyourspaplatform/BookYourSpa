import type { Metadata } from 'next';
import Link from 'next/link';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { passwordResetTokens } from '@/db/schema';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = {
  title: 'Choose a new password',
  description: 'Set a new password for your BookYourSpa account.',
  robots: { index: false, follow: false },
};

/** Token validity is decided server-side in the action too — this only picks the copy. */
async function tokenState(token: string) {
  try {
    const db = await getDb();
    const row = await db.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.tokenHash, hash(token)),
    });
    if (!row) return 'invalid';
    if (row.usedAt) return 'used';
    if (row.expiresAt <= new Date()) return 'expired';
    return 'ok';
  } catch {
    return 'ok'; // let the action produce the authoritative error
  }
}

// Mirrors hashResetToken in the server action (sha256 hex of the raw token).
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <AuthShell role="customer" title="Link missing" subtitle="This reset link is incomplete.">
        <p className="text-sm text-ink-600">
          Open the link from your email again, or{' '}
          <Link href="/forgot-password" className="font-medium text-brand-700 hover:underline">
            request a new one
          </Link>
          .
        </p>
      </AuthShell>
    );
  }

  const state = await tokenState(token);

  if (state !== 'ok') {
    const copy =
      state === 'used'
        ? 'This reset link has already been used.'
        : state === 'expired'
          ? 'This reset link has expired.'
          : 'This reset link is not valid.';
    return (
      <AuthShell role="customer" title="Link no longer valid" subtitle={copy}>
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            For your security each link works once and expires after an hour.
          </p>
          <Link
            href="/forgot-password"
            className="inline-flex h-11 items-center rounded-full bg-brand-700 px-6 text-sm font-medium text-white hover:bg-brand-800"
          >
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      role="customer"
      title="Choose a new password"
      subtitle="Pick something you haven't used here before."
      footer={
        <p>
          Changed your mind?{' '}
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}

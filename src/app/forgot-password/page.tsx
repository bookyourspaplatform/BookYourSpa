import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata: Metadata = {
  title: 'Forgot password',
  description: 'Request a link to reset your BookYourSpa password.',
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role } = await searchParams;
  // The link comes off a login screen, so land the user back on that portal.
  const portal =
    role === 'provider' || role === 'agent' || role === 'super_admin' ? role : 'customer';
  const loginPath = portal === 'customer' ? '/login' : `/login/${portal === 'super_admin' ? 'admin' : portal}`;

  return (
    <AuthShell
      role={portal}
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a link to choose a new one."
      footer={
        <p>
          Remembered it?{' '}
          <Link href={loginPath} className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm loginPath={loginPath} />
    </AuthShell>
  );
}

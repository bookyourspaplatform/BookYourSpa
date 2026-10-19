import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = {
  title: 'Supplier sign in',
  description: 'Sign in to the BookYourSpa supplier and POS console.',
  robots: { index: false, follow: false },
};

export default async function ProviderLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthShell
      role="provider"
      title="Supplier console"
      subtitle="Branches, menus, therapists, calendars and earnings."
      demo={process.env.NODE_ENV !== 'production' ? { email: 'owner@aranjaya.com', password: 'Provider1234!' } : null}
      footer={
        <p>
          Own a spa?{' '}
          <Link href="/register/provider" className="font-medium text-brand-700 hover:underline">
            Apply as a supplier
          </Link>{' '}
          · <Link href="/login" className="hover:underline">Customer sign in</Link>
        </p>
      }
    >
      <LoginForm role="provider" next={next} />
    </AuthShell>
  );
}

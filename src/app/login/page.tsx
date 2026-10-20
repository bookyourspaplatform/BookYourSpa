import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your BookYourSpa customer account.',
  robots: { index: false, follow: false },
};

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthShell
      role="customer"
      title="Welcome back"
      subtitle="Sign in to manage your bookings, vouchers and details."
      demo={process.env.NODE_ENV !== 'production' ? { email: 'appsdaeng@gmail.com', password: 'apps154@bys' } : null}
      footer={
        <p>
          New to BookYourSpa?{' '}
          <Link href="/register" className="font-medium text-brand-700 hover:underline">
            Create an account
          </Link>{' '}
          · or book as a guest at checkout.
        </p>
      }
    >
      <LoginForm role="customer" next={next} />
    </AuthShell>
  );
}

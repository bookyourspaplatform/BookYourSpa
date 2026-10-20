import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = {
  title: 'Admin sign in',
  description: 'Restricted BookYourSpa platform administration.',
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthShell
      role="super_admin"
      title="Platform administration"
      subtitle="Restricted area — authorised operators only."
      demo={process.env.NODE_ENV !== 'production' ? { email: 'portal@bookyourspa.net', password: 'BYS154@bys' } : null}
      footer={
        <p>
          Not an administrator?{' '}
          <Link href="/" className="font-medium text-brand-700 hover:underline">
            Back to bookyourspa.net
          </Link>
        </p>
      }
    >
      <LoginForm role="super_admin" next={next} />
    </AuthShell>
  );
}

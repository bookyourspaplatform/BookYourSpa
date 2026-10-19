import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterProviderForm } from '@/components/auth/register-forms';

export const metadata: Metadata = {
  title: 'Become a supplier',
  description: 'List your spa on BookYourSpa and take online reservations.',
  robots: { index: false, follow: false },
};

export default function RegisterProviderPage() {
  return (
    <AuthShell
      role="provider"
      title="Become a supplier"
      subtitle="List your branches, publish your treatment menu and start taking bookings."
      footer={
        <p>
          Already a supplier?{' '}
          <Link href="/login/provider" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>{' '}
          · <Link href="/login" className="hover:underline">Customer sign in</Link>
        </p>
      }
    >
      <RegisterProviderForm />
    </AuthShell>
  );
}

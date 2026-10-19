import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterCustomerForm } from '@/components/auth/register-forms';

export const metadata: Metadata = {
  title: 'Create your account',
  description: 'Join BookYourSpa to manage bookings and vouchers.',
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return (
    <AuthShell
      role="customer"
      title="Create your account"
      subtitle="Save your details, track bookings and re-download vouchers."
      footer={
        <p>
          Already a member?{' '}
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>{' '}
          · Prefer to browse first? <Link href="/spas" className="font-medium text-brand-700 hover:underline">Explore spas</Link>
        </p>
      }
    >
      <RegisterCustomerForm />
    </AuthShell>
  );
}

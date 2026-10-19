import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterAgentForm } from '@/components/auth/register-forms';

export const metadata: Metadata = {
  title: 'Become an agent',
  description: 'Resell approved spa treatments at your negotiated rates.',
  robots: { index: false, follow: false },
};

export default function RegisterAgentPage() {
  return (
    <AuthShell
      role="agent"
      title="Become an agent or reseller"
      subtitle="Get access to approved spa products, special rates and commission."
      footer={
        <p>
          Already an agent?{' '}
          <Link href="/login/agent" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>{' '}
          · <Link href="/login" className="hover:underline">Customer sign in</Link>
        </p>
      }
    >
      <RegisterAgentForm />
    </AuthShell>
  );
}

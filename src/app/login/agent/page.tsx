import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = {
  title: 'Agent sign in',
  description: 'Sign in to the BookYourSpa agent and reseller portal.',
  robots: { index: false, follow: false },
};

export default async function AgentLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthShell
      role="agent"
      title="Agent portal"
      subtitle="Approved products, your negotiated rates and client bookings."
      demo={process.env.NODE_ENV !== 'production' ? { email: 'agent@balibliss.com', password: 'Agent1234!' } : null}
      footer={
        <p>
          Sell spas with us?{' '}
          <Link href="/register/agent" className="font-medium text-brand-700 hover:underline">
            Apply as an agent
          </Link>{' '}
          · <Link href="/login" className="hover:underline">Customer sign in</Link>
        </p>
      }
    >
      <LoginForm role="agent" next={next} />
    </AuthShell>
  );
}

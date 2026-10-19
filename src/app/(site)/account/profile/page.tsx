import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth/session';
import { pageMetadata } from '@/lib/seo';
import { ProfileForm } from '@/components/account/profile-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: 'Profile',
    description: 'Your account details.',
    path: '/account/profile',
    noIndex: true,
  });
}

export default async function ProfilePage() {
  const user = (await getCurrentUser())!;

  return (
    <div>
      <p className="mb-4 text-sm text-ink-500">
        Your email is used for vouchers and booking updates and cannot be changed here.
      </p>
      <ProfileForm user={{ name: user.name, email: user.email, phone: user.phone }} />
    </div>
  );
}

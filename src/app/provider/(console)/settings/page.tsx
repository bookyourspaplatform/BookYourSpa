import type { Metadata } from 'next';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { providers } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { pageMetadata } from '@/lib/seo';
import { Badge } from '@/components/ui/badge';
import { ProviderProfileForm } from '@/components/provider/provider-profile-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Settings', description: 'Spa profile settings.', path: '/provider/settings', noIndex: true });
}

export default async function ProviderSettingsPage() {
  const user = (await getCurrentUser())!;
  const db = await getDb();
  const provider = await db.query.providers.findFirst({ where: eq(providers.id, user.provider!.id) });
  if (!provider) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl">Settings</h1>
        <p className="mt-0.5 text-sm text-ink-500">Your public company profile and account details.</p>
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 pb-4">
          <h2 className="text-[16px] font-semibold">Public profile</h2>
          <div className="flex items-center gap-2">
            <Badge tone={provider.status === 'approved' ? 'success' : provider.status === 'suspended' ? 'danger' : 'warning'}>
              {provider.status}
            </Badge>
            <Link href={`/spas/${provider.slug}`} className="text-[13px] font-medium text-brand-700 hover:underline">
              View listing →
            </Link>
          </div>
        </div>
        <ProviderProfileForm
          profile={{
            name: provider.name,
            tagline: provider.tagline,
            description: provider.description,
            phone: provider.phone,
            email: provider.email,
            website: provider.website,
          }}
        />
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white p-5">
        <h2 className="text-[16px] font-semibold">Account</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Signed in as</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Listing slug</dt>
            <dd className="font-mono text-[13px]">/spas/{provider.slug}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Base currency</dt>
            <dd className="font-medium">{provider.baseCurrency}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Platform commission</dt>
            <dd className="font-medium">{provider.commissionBps != null ? `${provider.commissionBps / 100}%` : 'standard rate'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Member since</dt>
            <dd className="font-medium">{new Date(provider.createdAt).toISOString().slice(0, 10)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

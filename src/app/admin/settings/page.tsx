import type { Metadata } from 'next';
import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { getDb } from '@/db';
import { settings as settingsTable } from '@/db/schema';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { pageMetadata } from '@/lib/seo';
import { SettingsForm } from '@/components/admin/settings-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'System settings', description: 'Platform configuration.', path: '/admin/settings', noIndex: true });
}

const GROUPS: { title: string; hint: string; keys: string[] }[] = [
  {
    title: 'Branding & site',
    hint: 'Used in metadata, emails and the header/footer.',
    keys: [
      'site.name',
      'site.tagline',
      'site.url',
      'site.description',
      'site.keywords',
      'site.announcement',
      'site.supportEmail',
      'site.phone',
    ],
  },
  {
    title: 'Booking policy',
    hint: 'Global defaults — branches can set tighter rules.',
    keys: [
      'booking.cancellationHours',
      'booking.leadTimeMinutes',
      'booking.pendingHoldMinutes',
      'booking.defaultIntervalMinutes',
      'features.guestCheckout',
      'features.providerSignup',
      'features.agentPortal',
      'features.onlinePayments',
    ],
  },
  {
    title: 'Monetization',
    hint: 'Commission rates applied when no override exists.',
    keys: [
      'finance.defaultPlatformCommissionBps',
      'finance.defaultAgentCommissionBps',
      'finance.defaultCurrency',
      'booking.feePercent',
      'booking.depositPercent',
    ],
  },
  {
    title: 'Payments',
    hint: 'Gateways customers may pay with — branch choices still apply.',
    keys: ['features.stripe', 'features.paypal'],
  },
  {
    title: 'SEO',
    hint: 'Social previews and Google verification.',
    keys: ['seo.ogImage', 'seo.googleVerification', 'seo.indexing'],
  },
];

export default async function AdminSettingsPage() {
  const db = await getDb();
  const rows = await db.query.settings.findMany({ orderBy: [asc(settingsTable.key)] });
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) merged[r.key] = r.value;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl">System configuration</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Live platform settings — changes apply immediately to the public site.
          </p>
        </div>
        <Link href="/admin/bookings" className="text-sm font-medium text-brand-700 hover:underline">
          Review bookings →
        </Link>
      </div>

      {GROUPS.map((group) => {
        const entries = group.keys
          .filter((k) => k in DEFAULT_SETTINGS)
          .map((k) => ({ key: k, value: merged[k] }));
        if (!entries.length) return null;
        return (
          <section key={group.title} className="space-y-3">
            <div>
              <h2 className="text-[16px] font-semibold">{group.title}</h2>
              <p className="text-[13px] text-ink-500">{group.hint}</p>
            </div>
            <SettingsForm entries={entries} />
          </section>
        );
      })}

      <section className="rounded-3xl border border-ink-100 bg-white p-5">
        <h2 className="text-[16px] font-semibold">SEO surfaces</h2>
        <p className="mt-1 text-[13.5px] text-ink-500">Generated automatically — verify after changing the site URL:</p>
        <ul className="mt-3 space-y-1.5 text-[13.5px]">
          <li>
            <Link href="/sitemap.xml" className="text-brand-700 hover:underline">/sitemap.xml</Link>{' '}
            <span className="text-ink-400">— providers, branches, pages</span>
          </li>
          <li>
            <Link href="/robots.txt" className="text-brand-700 hover:underline">/robots.txt</Link>{' '}
            <span className="text-ink-400">— admin & API disallowed</span>
          </li>
          <li>
            <Link href="/opengraph-image" className="text-brand-700 hover:underline">/opengraph-image</Link>{' '}
            <span className="text-ink-400">— auto-generated social cards</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

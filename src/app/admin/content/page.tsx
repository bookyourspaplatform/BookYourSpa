import type { Metadata } from 'next';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { pages, settings as settingsTable } from '@/db/schema';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { pageMetadata } from '@/lib/seo';
import { PagesManager } from '@/components/admin/pages-manager';
import { SettingsForm } from '@/components/admin/settings-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Content', description: 'Static pages CMS.', path: '/admin/content', noIndex: true });
}

export default async function AdminContentPage() {
  const db = await getDb();
  const [rows, announcementRow] = await Promise.all([
    db.query.pages.findMany({ orderBy: [asc(pages.title)] }),
    db.query.settings.findFirst({ where: eq(settingsTable.key, 'site.announcement') }),
  ]);
  const announcement =
    typeof announcementRow?.value === 'string'
      ? announcementRow.value
      : (DEFAULT_SETTINGS['site.announcement'] as string);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl">Content</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          The informational pages of the marketplace — these feed the footer, sitemap and metadata.
        </p>
      </div>

      <section className="rounded-3xl border border-ink-100 bg-white p-5">
        <div className="mb-4">
          <h2 className="text-[16px] font-semibold">Announcement bar</h2>
          <p className="text-[13px] text-ink-500">
            Shown in the dark strip at the very top of every public page — leave empty to hide it.
          </p>
        </div>
        <SettingsForm entries={[{ key: 'site.announcement', value: announcement }]} />
      </section>

      <PagesManager
        pages={rows.map((p) => ({
          id: p.id,
          slug: p.slug,
          title: p.title,
          body: p.body,
          metaTitle: p.metaTitle,
          metaDescription: p.metaDescription,
          published: p.published,
          updatedAt: p.updatedAt,
        }))}
      />
      <p className="text-[12.5px] text-ink-400">
        Pages are served at <code className="font-mono">/{rows[0]?.slug ?? 'about'}</code> and included in
        <code className="font-mono"> /sitemap.xml</code> only when published.
      </p>
    </div>
  );
}

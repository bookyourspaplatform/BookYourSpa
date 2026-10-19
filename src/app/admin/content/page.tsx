import type { Metadata } from 'next';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { pages } from '@/db/schema';
import { pageMetadata } from '@/lib/seo';
import { PagesManager } from '@/components/admin/pages-manager';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Content', description: 'Static pages CMS.', path: '/admin/content', noIndex: true });
}

export default async function AdminContentPage() {
  const db = await getDb();
  const rows = await db.query.pages.findMany({ orderBy: [asc(pages.title)] });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl">Content</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          The informational pages of the marketplace — these feed the footer, sitemap and metadata.
        </p>
      </div>
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

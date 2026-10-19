import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { pages } from '@/db/schema';
import { pageMetadata, breadcrumbJsonLd, appUrl } from '@/lib/seo';
import { JsonLd } from '@/components/json-ld';

export const dynamic = 'force-dynamic';

const RESERVED = new Set(['account', 'spas', 'voucher']);

async function getPage(slug: string) {
  if (RESERVED.has(slug)) return null;
  const db = await getDb();
  return db.query.pages.findFirst({
    where: eq(pages.slug, slug.toLowerCase()),
  });
}

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }): Promise<Metadata> {
  const { page } = await params;
  const row = await getPage(page);
  if (!row || !row.published) return { robots: { index: false } };
  return pageMetadata({
    title: row.metaTitle ?? row.title,
    description: row.metaDescription ?? row.body.slice(0, 160).replace(/\s+/g, ' '),
    path: `/${row.slug}`,
  });
}

export default async function StaticPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  const row = await getPage(page);
  if (!row || !row.published) notFound();

  const jsonLd = breadcrumbJsonLd(
    [
      { name: 'Home', path: '/' },
      { name: row.title, path: `/${row.slug}` },
    ],
    await appUrl(''),
  );

  const paragraphs = row.body.split(/\n{2,}/).filter((p) => p.trim());

  return (
    <>
      <JsonLd data={jsonLd} />
      <div className="border-b border-ink-100 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <h1 className="text-2xl sm:text-3xl">{row.title}</h1>
        </div>
      </div>
      <article className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-4 text-[15px] leading-relaxed text-ink-700">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </article>
    </>
  );
}

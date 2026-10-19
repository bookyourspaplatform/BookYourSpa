import type { MetadataRoute } from 'next';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { branches, pages, providers } from '@/db/schema';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (await getSettings())['site.url'].replace(/\/$/, '');
  const now = new Date();

  const db = await getDb();
  const [providerRows, branchRows, pageRows] = await Promise.all([
    db
      .select({ slug: providers.slug, updatedAt: providers.updatedAt })
      .from(providers)
      .where(eq(providers.status, 'approved')),
    db
      .select({ slug: branches.slug, providerSlug: providers.slug, updatedAt: branches.updatedAt })
      .from(branches)
      .innerJoin(providers, eq(branches.providerId, providers.id))
      .where(and(eq(branches.status, 'active'), eq(providers.status, 'approved'))),
    db.select({ slug: pages.slug, updatedAt: pages.updatedAt }).from(pages).where(eq(pages.published, true)),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/spas`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    ...pageRows.map((p) => ({
      url: `${base}/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    })),
  ];

  const providerRoutes: MetadataRoute.Sitemap = providerRows.map((p) => ({
    url: `${base}/spas/${p.slug}`,
    lastModified: p.updatedAt,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));

  const branchRoutes: MetadataRoute.Sitemap = branchRows.map((b) => ({
    url: `${base}/spas/${b.providerSlug}/${b.slug}`,
    lastModified: b.updatedAt,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  return [...staticRoutes, ...providerRoutes, ...branchRoutes];
}

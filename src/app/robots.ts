import type { MetadataRoute } from 'next';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = (await getSettings())['site.url'].replace(/\/$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/provider', '/agent', '/account', '/api/', '/login', '/register'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}

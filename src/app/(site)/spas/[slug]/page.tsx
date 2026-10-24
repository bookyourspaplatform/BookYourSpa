import { notFound, permanentRedirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { branches, providers } from '@/db/schema';

export const dynamic = 'force-dynamic';

/**
 * Supplier profiles are no longer rendered publicly — every spa shown on the
 * site is an individual outlet (spa business). Old supplier links land here, so
 * we permanently redirect to the supplier's first active outlet instead of
 * showing a supplier-branded page.
 */
export default async function SpaDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();

  const provider = await db.query.providers.findFirst({
    where: and(eq(providers.slug, slug), eq(providers.status, 'approved')),
    columns: { id: true },
  });
  if (!provider) notFound();

  const first = await db.query.branches.findFirst({
    where: and(eq(branches.providerId, provider.id), eq(branches.status, 'active')),
    columns: { slug: true },
    orderBy: [asc(branches.name)],
  });
  if (!first) notFound();

  permanentRedirect(`/spas/${slug}/${first.slug}`);
}

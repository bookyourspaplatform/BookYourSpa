import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Star } from 'lucide-react';
import { getDb } from '@/db';
import { branches } from '@/db/schema';
import { pageMetadata } from '@/lib/seo';
import { ReviewForm } from '@/components/admin/review-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: 'Add review',
    description: 'Add a review to a location.',
    path: '/admin/reviews/new',
    noIndex: true,
  });
}

/**
 * Opened from the spa form's "Add Review" button (its own window, so the
 * location being edited stays open). The admin layout guards the route.
 */
export default async function NewReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const { branch: branchId } = await searchParams;
  const db = await getDb();
  const row = branchId
    ? await db.query.branches.findFirst({
        where: eq(branches.id, branchId),
        with: { provider: true },
      })
    : undefined;
  if (!row) notFound();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl">Add review</h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-500">
          <Star className="size-4 fill-amber-400 text-amber-400" />
          {row.provider.name} · {row.name}
        </p>
      </div>

      <ReviewForm branchId={row.id} branchName={row.name} providerName={row.provider.name} />

      <p className="text-[12.5px] text-ink-400">
        Reviews publish straight away and appear 10 at a time on the location page. Suppliers can still
        hide or delete them from their own Reviews tab.
      </p>
    </div>
  );
}

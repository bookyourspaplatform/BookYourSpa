import type { Metadata } from 'next';
import { asc, desc } from 'drizzle-orm';
import { getDb } from '@/db';
import { promotions } from '@/db/schema';
import { pageMetadata } from '@/lib/seo';
import { PromotionsManager } from '@/components/admin/promotions-manager';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Promotions', description: 'Promotions and banners.', path: '/admin/promotions', noIndex: true });
}

export default async function AdminPromotionsPage() {
  const db = await getDb();

  const promoRows = await db.query.promotions.findMany({
    orderBy: [asc(promotions.sortOrder), desc(promotions.createdAt)],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl">Promotions</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Every promotion carries its own code — it shows on home, deals and the supplier dashboard from
          one place.
        </p>
      </div>

      <PromotionsManager
        promotions={promoRows.map((p) => ({
          id: p.id,
          title: p.title,
          summary: p.summary,
          linkUrl: p.linkUrl,
          position: p.position,
          startsAt: p.startsAt?.toISOString() ?? null,
          endsAt: p.endsAt?.toISOString() ?? null,
          active: p.active,
          sortOrder: p.sortOrder,
          code: p.code,
          discountType: p.discountType,
          discountValue: p.discountValue,
          currency: p.currency,
          minAmount: p.minAmount,
          maxUses: p.maxUses ?? 0,
          usedCount: p.usedCount,
          appliesTo: p.appliesTo,
          validFromHour: p.validFromHour,
          validUntilHour: p.validUntilHour,
        }))}
      />

      <p className="text-[12.5px] text-ink-400">
        Promotions marked “active” with a valid window show automatically on home, /deals and the supplier
        dashboard.
      </p>
    </div>
  );
}

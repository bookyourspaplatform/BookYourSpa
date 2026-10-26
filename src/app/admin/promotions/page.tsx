import type { Metadata } from 'next';
import { asc, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { coupons, promotions, providers, treatments } from '@/db/schema';
import { pageMetadata } from '@/lib/seo';
import { PromotionsManager, CouponsManager } from '@/components/admin/promotions-manager';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Promotions', description: 'Promotions and promo codes.', path: '/admin/promotions', noIndex: true });
}

export default async function AdminPromotionsPage() {
  const db = await getDb();

  const [promoRows, couponRows, treatmentRows] = await Promise.all([
    db.query.promotions.findMany({ orderBy: [asc(promotions.sortOrder), desc(promotions.createdAt)] }),
    db.query.coupons.findMany({ orderBy: [asc(coupons.code)] }),
    db
      .select({
        id: treatments.id,
        name: treatments.name,
        providerName: providers.name,
      })
      .from(treatments)
      .innerJoin(providers, eq(treatments.providerId, providers.id))
      .orderBy(asc(providers.name), asc(treatments.name))
      .limit(500),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl">Promotions</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Seasonal campaigns appear across home and deals; promo codes apply at checkout.
        </p>
      </div>

      <PromotionsManager
        treatmentOptions={treatmentRows}
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
          treatmentIds: p.treatmentIds,
        }))}
      />

      <CouponsManager
        coupons={couponRows.map((c) => ({
          id: c.id,
          code: c.code,
          description: c.description,
          discountType: c.discountType,
          discountValue: c.discountValue,
          currency: c.currency,
          minAmount: c.minAmount,
          maxUses: c.maxUses ?? 0,
          usedCount: c.usedCount,
          startsAt: c.startsAt?.toISOString() ?? null,
          endsAt: c.endsAt?.toISOString() ?? null,
          active: c.active,
        }))}
      />

      <p className="text-[12.5px] text-ink-400">Promotions marked “active” with a valid window show automatically on /deals.</p>
    </div>
  );
}

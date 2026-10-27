import type { Metadata } from 'next';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { Megaphone, Sparkles } from 'lucide-react';
import { getDb } from '@/db';
import { branchTreatments, branches, promotions, providerPromotions, treatments } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { pageMetadata } from '@/lib/seo';
import {
  PlatformPromotions,
  type PlatformPromoRow,
} from '@/components/provider/platform-promotions';
import { PromotionPanel, type PromotionRow } from '@/components/provider/promotion-panel';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: 'Promotions',
    description: 'Platform offers and your own campaigns.',
    path: '/provider/promotions',
    noIndex: true,
  });
}

export default async function ProviderPromotionsPage() {
  const user = (await getCurrentUser())!;
  const providerId = user.provider!.id;
  const db = await getDb();
  const now = new Date();

  const branchRows = await db.query.branches.findMany({
    where: eq(branches.providerId, providerId),
    orderBy: [asc(branches.name)],
    columns: { id: true, name: true },
  });
  const branchIds = branchRows.map((b) => b.id);

  const [generalRows, choiceRows, treatmentRows, linkRows] = await Promise.all([
    db.query.promotions.findMany({
      where: and(
        isNull(promotions.providerId),
        isNull(promotions.branchId),
        eq(promotions.active, true),
        or(isNull(promotions.endsAt), gte(promotions.endsAt, now)),
        or(isNull(promotions.startsAt), lte(promotions.startsAt, now)),
      ),
      orderBy: [asc(promotions.sortOrder), desc(promotions.createdAt)],
    }),
    db.query.providerPromotions.findMany({
      where: eq(providerPromotions.providerId, providerId),
    }),
    db.query.treatments.findMany({
      where: eq(treatments.providerId, providerId),
      orderBy: [asc(treatments.name)],
      columns: { id: true, name: true },
    }),
    branchIds.length
      ? db.query.branchTreatments.findMany({
          where: inArray(branchTreatments.branchId, branchIds),
          columns: { branchId: true, treatmentId: true },
        })
      : Promise.resolve([]),
  ]);

  const choiceBy = new Map(choiceRows.map((c) => [c.promotionId, c]));
  const enabledBy = new Map(choiceRows.map((c) => [c.promotionId, c.active]));
  const platformRows: PlatformPromoRow[] = generalRows.map((p) => ({
    id: p.id,
    title: p.title,
    summary: p.summary,
    startsAt: p.startsAt?.toISOString() ?? null,
    endsAt: p.endsAt?.toISOString() ?? null,
    code: p.code,
    discountType: p.discountType,
    discountValue: p.discountValue,
    appliesTo: p.appliesTo,
    treatmentIds: p.treatmentIds,
    validFromHour: p.validFromHour,
    validUntilHour: p.validUntilHour,
    // This spa's own choice — for a “selected” promotion it also carries the
    // treatments this spa picked when activating the offer.
    selectedTreatmentIds: choiceBy.get(p.id)?.treatmentIds ?? null,
    enabled: enabledBy.get(p.id) ?? true,
  }));

  const ownRows = await db.query.promotions.findMany({
    where: branchIds.length
      ? or(eq(promotions.providerId, providerId), inArray(promotions.branchId, branchIds))
      : eq(promotions.providerId, providerId),
    orderBy: [asc(promotions.sortOrder), desc(promotions.createdAt)],
  });

  const ownByBranch = new Map<string, PromotionRow[]>();
  for (const p of ownRows) {
    if (!p.branchId) continue;
    const list = ownByBranch.get(p.branchId) ?? [];
    list.push({
      id: p.id,
      title: p.title,
      summary: p.summary,
      position: p.position,
      startsAt: p.startsAt?.toISOString() ?? null,
      endsAt: p.endsAt?.toISOString() ?? null,
      active: p.active,
      linkUrl: p.linkUrl,
      sortOrder: p.sortOrder,
      code: p.code,
      discountType: p.discountType,
      discountValue: p.discountValue,
      currency: p.currency,
      minAmount: p.minAmount,
      maxUses: p.maxUses ?? 0,
      usedCount: p.usedCount,
      appliesTo: p.appliesTo,
      treatmentIds: p.treatmentIds,
      validFromHour: p.validFromHour,
      validUntilHour: p.validUntilHour,
    });
    ownByBranch.set(p.branchId, list);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl">Promotions</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Platform-wide offers you accept for this spa, plus the campaigns you run yourself.
        </p>
      </div>

      <section className="rounded-3xl border border-ink-100 bg-white p-4 sm:p-5">
        <div className="mb-3">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold">
            <Sparkles className="size-4 text-clay-500" /> Platform promotions
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-500">
            General promotions the platform runs for every spa — valid here automatically. Switch any off for your
            spa only; switch it back on whenever you like.
          </p>
        </div>
        <PlatformPromotions
          rows={platformRows}
          treatments={treatmentRows}
        />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-[16px] font-semibold">
            <Megaphone className="size-4 text-brand-600" /> Your promotions
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-500">
            Campaigns you create — shown on your listing, your spa page and the deals page.
          </p>
        </div>

        {branchRows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-10 text-center">
            <p className="text-[15px] font-medium">Add a location first</p>
            <p className="mt-1 text-sm text-ink-500">
              Promotions belong to a spa business — create one under Spa Business, then run campaigns here.
            </p>
          </div>
        ) : (
          branchRows.map((b) => (
            <div key={b.id} className="rounded-3xl border border-ink-100 bg-white p-4 sm:p-5">
              <p className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-400">{b.name}</p>
              <PromotionPanel
                branchId={b.id}
                rows={ownByBranch.get(b.id) ?? []}
                treatmentOptions={treatmentRows.filter((t) =>
                  linkRows.some((l) => l.branchId === b.id && l.treatmentId === t.id),
                )}
              />
            </div>
          ))
        )}
      </section>
    </div>
  );
}
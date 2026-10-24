import type { Metadata } from 'next';
import Link from 'next/link';
import { and, or, sql, isNull, lte, gte, asc } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { BadgePercent, Sparkles, Tag, Timer } from 'lucide-react';
import { getDb } from '@/db';
import { coupons, promotions } from '@/db/schema';
import { getSettings } from '@/lib/settings';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import { pageMetadata, breadcrumbJsonLd, appUrl } from '@/lib/seo';
import { JsonLd } from '@/components/json-ld';
import { Badge } from '@/components/ui/badge';
import { CopyCode } from '@/components/site/copy-code';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: 'Deals & offers',
    description: 'Active promo codes and seasonal spa deals across Bali, Dubai and beyond.',
    path: '/deals',
  });
}

const notExpired = (col: AnyPgColumn) => or(isNull(col), gte(col, new Date()));
const notStarted = (col: AnyPgColumn) => or(isNull(col), lte(col, new Date()));

export default async function DealsPage() {
  const db = await getDb();
  const settings = await getSettings();

  const [promoRows, couponRows] = await Promise.all([
    db.query.promotions.findMany({
      where: and(
        sql`${promotions.active} = true`,
        sql`${promotions.position} IN ('banner','deal')`,
        notExpired(promotions.endsAt),
        notStarted(promotions.startsAt),
      ),
      orderBy: [asc(promotions.sortOrder)],
      with: {
        branch: { columns: { name: true, slug: true, providerId: true }, with: { provider: { columns: { slug: true } } } },
      },
    }),
    db.query.coupons.findMany({
      where: and(
        sql`${coupons.active} = true`,
        notExpired(coupons.endsAt),
        notStarted(coupons.startsAt),
        or(sql`${coupons.maxUses} = 0`, sql`${coupons.usedCount} < ${coupons.maxUses}`),
      ),
      orderBy: [asc(coupons.endsAt)],
      limit: 12,
    }),
  ]);

  const jsonLd = breadcrumbJsonLd(
    [
      { name: 'Home', path: '/' },
      { name: 'Deals', path: '/deals' },
    ],
    await appUrl(''),
  );

  return (
    <>
      <JsonLd data={jsonLd} />
      <div className="border-b border-ink-100 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <h1 className="text-2xl sm:text-3xl">Deals & offers</h1>
          <p className="mt-1.5 text-[15px] text-ink-500">
            Seasonal promotions from our spa partners, plus platform-wide promo codes. Apply the code at
            checkout inside the booking wizard.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Coupons */}
        <section>
          <h2 className="flex items-center gap-2 text-lg">
            <Tag className="size-5 text-brand-600" /> Promo codes
          </h2>
          {couponRows.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-ink-200 bg-white px-5 py-8 text-center text-sm text-ink-500">
              No active codes right now — check back soon.
            </p>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {couponRows.map((c) => (
                <li key={c.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[15px] font-semibold text-brand-900">
                        {c.discountType === 'percent'
                          ? `${(c.discountValue / 100).toFixed(c.discountValue % 100 ? 1 : 0)}% off`
                          : `${formatMoney(c.discountValue, c.currency ?? 'IDR')} off`}
                      </p>
                      <Badge tone="brand">
                        {c.scope === 'global' ? 'all spas' : c.scope === 'provider' ? 'selected spa' : 'selected branch'}
                      </Badge>
                    </div>
                    {c.description && <p className="mt-1 text-[13.5px] text-ink-600">{c.description}</p>}
                    {c.minAmount > 0 && (
                      <p className="mt-1 text-[12.5px] text-ink-400">
                        Min. spend {formatMoney(c.minAmount, c.currency ?? 'IDR')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <CopyCode code={c.code} />
                    <span className="flex items-center gap-1 text-[12px] text-ink-400">
                      <Timer className="size-3.5" />
                      {c.endsAt ? `until ${formatDate(c.endsAt, undefined, { dateStyle: 'medium' })}` : 'no expiry'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Promo banners */}
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg">
            <Sparkles className="size-5 text-clay-500" /> Seasonal offers
          </h2>
          {promoRows.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-ink-200 bg-white px-5 py-8 text-center text-sm text-ink-500">
              No seasonal offers right now.
            </p>
          ) : (
            <ul className="mt-4 grid gap-4 md:grid-cols-2">
              {promoRows.map((p) => (
                <li key={p.id} className="overflow-hidden rounded-3xl border border-ink-100 bg-white">
                  <div className="bg-gradient-to-br from-clay-500 to-clay-700 px-5 py-4 text-white">
                    <div className="flex items-center gap-2">
                      <BadgePercent className="size-4" />
                      <h3 className="text-[16px] font-semibold">{p.title}</h3>
                    </div>
                  </div>
                  <div className="px-5 py-4">
                    {p.summary && <p className="text-[14px] leading-relaxed text-ink-600">{p.summary}</p>}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                      <span className="text-ink-400">
                        {p.branch?.name ?? 'Platform-wide'}
                        {p.endsAt ? ` · ends ${formatDate(p.endsAt, undefined, { dateStyle: 'medium' })}` : ''}
                      </span>
                      <Link
                        href={
                          p.linkUrl ??
                          (p.branch ? `/spas/${p.branch.provider.slug}/${p.branch.slug}` : '/spas')
                        }
                        className="font-medium text-brand-700 hover:underline"
                      >
                        View offer →
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-10 rounded-3xl border border-brand-100 bg-brand-50 px-6 py-6 text-center">
          <p className="text-[15px] font-medium text-brand-900">
            Ready to book? Apply your code in the last step of checkout.
          </p>
          <Link href="/spas" className="mt-3 inline-block">
            <span className="inline-flex h-11 items-center rounded-full bg-brand-700 px-6 text-sm font-medium text-white hover:bg-brand-800">
              Browse spas
            </span>
          </Link>
        </div>
      </div>
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { and, or, sql, isNull, gte, asc } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { BadgePercent, Sparkles } from 'lucide-react';
import { getDb } from '@/db';
import { promotions } from '@/db/schema';
import { getSettings } from '@/lib/settings';
import { formatDate } from '@/lib/utils';
import { pageMetadata, breadcrumbJsonLd, appUrl } from '@/lib/seo';
import { JsonLd } from '@/components/json-ld';
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

export default async function DealsPage() {
  const db = await getDb();
  const settings = await getSettings();

  const [promoRows] = await Promise.all([
    db.query.promotions.findMany({
      where: and(sql`${promotions.active} = true`, notExpired(promotions.endsAt)),
      orderBy: [asc(promotions.sortOrder)],
      with: {
        branch: { columns: { name: true, slug: true, providerId: true }, with: { provider: { columns: { slug: true } } } },
      },
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
            Seasonal promotions from our spa partners and the platform. Apply the code at checkout inside
            the booking wizard — promotions can only be used by registered customers.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Promo banners */}
        <section>
          <h2 className="flex items-center gap-2 text-lg">
            <Sparkles className="size-5 text-clay-500" /> All promotions
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
                    {p.code && (
                      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-brand-200 bg-brand-50 px-3 py-2">
                        <CopyCode code={p.code} />
                        {p.discountType && p.discountValue != null && (
                          <span className="text-[13px] font-semibold text-brand-800">
                            {p.discountType === 'percent' ? `${p.discountValue / 100}% off` : `${p.discountValue} off`}
                          </span>
                        )}
                        <span className="text-[12px] text-ink-500">Registered members only</span>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                      <span className="text-ink-400">
                        {p.branch?.name ?? 'Platform-wide'}
                        {p.treatmentIds?.length ? ` · ${p.treatmentIds.length} selected treatments` : ''}
                        {p.startsAt && p.startsAt > new Date()
                          ? ` · from ${formatDate(p.startsAt, undefined, { dateStyle: 'medium' })}`
                          : ''}
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

import type { Metadata } from 'next';
import Link from 'next/link';
import { Search, SlidersHorizontal, MapPin } from 'lucide-react';
import { getDb } from '@/db';
import { CATEGORY_LABELS, SPA_CATEGORY_LABELS, SPA_TYPE_LABELS, listSpas } from '@/lib/catalog';
import { pageMetadata, breadcrumbJsonLd, searchResultsJsonLd, appUrl } from '@/lib/seo';
import { JsonLd } from '@/components/json-ld';
import { SpaCard } from '@/components/site/spa-card';
import { SortSelect } from '@/components/site/sort-select';
import { EmptyState } from '@/components/ui/spinner';
import { buttonClasses } from '@/components/ui/button';
import { inputCls } from '@/components/ui/classes';
import { Pagination } from '@/components/ui/stat';

export const dynamic = 'force-dynamic';

type Search = {
  q?: string;
  city?: string;
  category?: string;
  spa?: string;
  type?: string;
  sort?: string;
  page?: string;
  maxPrice?: string;
};

function buildHref(base: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const sp = await searchParams;
  const city = sp.city?.trim();
  const category = sp.category?.trim();
  const spa = sp.spa?.trim();
  const bits = [
    city ? `in ${city}` : '',
    spa ? SPA_CATEGORY_LABELS[spa]?.toLowerCase() ?? spa : '',
    category ? CATEGORY_LABELS[category]?.toLowerCase() ?? category : '',
    'spas',
  ].filter(Boolean);
  const title = sp.q ? `“${sp.q}” — spa search` : bits.join(' ').replace(/^./, (c) => c.toUpperCase());
  const description = `Browse, compare and book ${bits.join(' ')} with instant vouchers. Transparent prices, live availability and vetted venues.`;
  return pageMetadata({
    title: sp.page && sp.page !== '1' ? `${title} (page ${sp.page})` : title,
    description,
    path: `/spas?${new URLSearchParams(Object.fromEntries(Object.entries(sp).filter(([, v]) => v) as [string, string][])).toString()}`,
    noIndex: Boolean(sp.q),
  });
}

export default async function SpasPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const db = await getDb();

  const results = await listSpas(db, {
    q: sp.q,
    city: sp.city,
    category: sp.category,
    spa: sp.spa,
    type: sp.type,
    sort: (sp.sort as 'featured' | 'price_asc' | 'price_desc' | 'name') ?? 'featured',
    page: Number(sp.page ?? 1) || 1,
    maxPrice: sp.maxPrice ? Number(sp.maxPrice) : undefined,
  });

  const base = await appUrl('/spas');
  const activeFilters = [
    sp.city ? { key: 'city', label: sp.city } : null,
    sp.spa ? { key: 'spa', label: SPA_CATEGORY_LABELS[sp.spa] ?? sp.spa } : null,
    sp.type ? { key: 'type', label: SPA_TYPE_LABELS[sp.type] ?? sp.type } : null,
    sp.category ? { key: 'category', label: CATEGORY_LABELS[sp.category] ?? sp.category } : null,
    sp.maxPrice ? { key: 'maxPrice', label: `Up to ${sp.maxPrice}` } : null,
    sp.q ? { key: 'q', label: `“${sp.q}”` } : null,
  ].filter(Boolean) as { key: string; label: string }[];

  const pageTitle = sp.city
    ? `Spas in ${sp.city}`
    : sp.spa
      ? `${SPA_CATEGORY_LABELS[sp.spa] ?? sp.spa} spas`
      : sp.category
        ? `${CATEGORY_LABELS[sp.category] ?? sp.category} spas`
        : 'Find your spa';

  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd(
            [{ name: 'Home', path: '/' }, { name: 'Spas', path: '/spas' }],
            await appUrl(''),
          ),
          searchResultsJsonLd(
            base,
            pageTitle,
            results.items.map((s) => ({ name: s.name, url: `${base.replace('/spas', '')}/spas/${s.slug}` })),
          ),
        ]}
      />

      <div className="border-b border-ink-100 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
          <h1 className="text-3xl">{pageTitle}</h1>
          <p className="mt-1.5 text-sm text-ink-500">
            {results.total} {results.total === 1 ? 'spa' : 'spas'} · {results.totalAll} on the platform
          </p>

          <form action="/spas" method="get" className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="q">
              Search
            </label>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
              <input
                id="q"
                name="q"
                defaultValue={sp.q ?? ''}
                placeholder="Search spa name, city or treatment…"
                className={inputCls() + ' pl-10'}
              />
            </div>
            {sp.city && <input type="hidden" name="city" value={sp.city} />}
            {sp.category && <input type="hidden" name="category" value={sp.category} />}
            {sp.spa && <input type="hidden" name="spa" value={sp.spa} />}
            {sp.type && <input type="hidden" name="type" value={sp.type} />}
            <button type="submit" className={buttonClasses('primary', 'md')}>
              Search
            </button>
          </form>
        </div>
      </div>

      <div className="mx-auto max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:flex lg:px-8">
        {/* Filter rail */}
        <aside className="lg:w-64 lg:shrink-0">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink-700 lg:mb-5">
            <SlidersHorizontal className="size-4" /> Filters
          </div>

          <div className="space-y-6">
            <div>
              <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Spa category</h2>
              <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible">
                <FilterChip label="All spa categories" href={buildHref('/spas', { city: sp.city, category: sp.category, type: sp.type, q: sp.q })} active={!sp.spa} />
                {results.facets.spaCategories.map((c) => (
                  <FilterChip
                    key={c.value}
                    label={`${c.label} (${c.count})`}
                    href={buildHref('/spas', { spa: c.value, city: sp.city, category: sp.category, type: sp.type, q: sp.q })}
                    active={sp.spa === c.value}
                  />
                ))}
              </div>
            </div>

            {results.facets.spaTypes.length > 0 && (
              <div>
                <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Spa type</h2>
                <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible">
                  <FilterChip label="Any spa type" href={buildHref('/spas', { city: sp.city, spa: sp.spa, category: sp.category, q: sp.q })} active={!sp.type} />
                  {results.facets.spaTypes.map((t) => (
                    <FilterChip
                      key={t.value}
                      label={`${t.label} (${t.count})`}
                      href={buildHref('/spas', { type: t.value, city: sp.city, spa: sp.spa, category: sp.category, q: sp.q })}
                      active={sp.type === t.value}
                    />
                  ))}
                </div>
              </div>
            )}

            <div>
              <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Treatment</h2>
              <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible">
                <FilterChip label="All treatments" href={buildHref('/spas', { city: sp.city, spa: sp.spa, type: sp.type, q: sp.q })} active={!sp.category} />
                {results.facets.categories.map((c) => (
                  <FilterChip
                    key={c.value}
                    label={`${c.label} (${c.count})`}
                    href={buildHref('/spas', { category: c.value, spa: sp.spa, type: sp.type, city: sp.city, q: sp.q })}
                    active={sp.category === c.value}
                  />
                ))}
              </div>
            </div>

            <div>
              <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Destination</h2>
              <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible">
                <FilterChip label="Anywhere" href={buildHref('/spas', { category: sp.category, spa: sp.spa, type: sp.type, q: sp.q })} active={!sp.city} />
                {results.facets.cities.slice(0, 12).map((c) => (
                  <FilterChip
                    key={c.city}
                    label={`${c.city} (${c.count})`}
                    href={buildHref('/spas', { city: c.city, category: sp.category, spa: sp.spa, type: sp.type, q: sp.q })}
                    active={sp.city === c.city}
                  />
                ))}
              </div>
            </div>

            <div className="hidden lg:block">
              <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-ink-400">Max price</h2>
              <div className="flex flex-col gap-1.5">
                {[0, 400000, 700000, 1000000].map((p) => (
                  <FilterChip
                    key={p}
                    label={p === 0 ? 'Any price' : `From provider list · ${p.toLocaleString()}`}
                    href={buildHref('/spas', { city: sp.city, category: sp.category, spa: sp.spa, type: sp.type, q: sp.q, maxPrice: p ? String(p) : undefined })}
                    active={Number(sp.maxPrice ?? 0) === p}
                  />
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* Results */}
        <div className="mt-6 min-w-0 flex-1 lg:mt-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {activeFilters.map((f) => (
                <Link
                  key={f.key}
                  href={buildHref('/spas', {
                    ...sp,
                    [f.key]: undefined,
                  })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[13px] text-brand-800 hover:bg-brand-100"
                >
                  {f.label} <span aria-hidden>×</span>
                </Link>
              ))}
            </div>
            <SortSelect />
          </div>

          {results.items.length === 0 ? (
            <EmptyState
              icon={<MapPin className="size-8" />}
              title="No spas match those filters"
              description="Try a different city or treatment category — or browse everything."
              action={
                <Link href="/spas" className={buttonClasses('primary', 'md')}>
                  Clear filters
                </Link>
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {results.items.map((spa, i) => (
                <SpaCard key={spa.id} spa={spa} index={i} />
              ))}
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-ink-100 bg-white">
            <Pagination page={results.page} totalPages={results.totalPages} basePath="/spas" params={sp as Record<string, string>} />
          </div>
        </div>
      </div>
    </>
  );
}

function FilterChip({ label, href, active }: { label: string; href: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'whitespace-nowrap rounded-full bg-brand-700 px-3.5 py-1.5 text-[13px] font-medium text-white'
          : 'whitespace-nowrap rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-[13px] text-ink-600 hover:border-brand-300 hover:text-brand-800'
      }
      aria-current={active ? 'true' : undefined}
    >
      {label}
    </Link>
  );
}

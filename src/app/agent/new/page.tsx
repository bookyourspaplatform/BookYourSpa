import type { Metadata } from 'next';
import Link from 'next/link';
import { and, asc, eq, sql } from 'drizzle-orm';
import { ArrowRight, MapPin, Search, Sparkles } from 'lucide-react';
import { getDb } from '@/db';
import { branches, providers, treatments, branchTreatments } from '@/db/schema';
import { formatMoney } from '@/lib/money';
import { pageMetadata } from '@/lib/seo';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'New booking', description: 'Book on behalf of a customer.', path: '/agent/new', noIndex: true });
}

export default async function AgentNewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim().toLowerCase() ?? '';
  const db = await getDb();

  const rows = await db
    .select({
      branchId: branches.id,
      branchName: branches.name,
      slug: branches.slug,
      city: branches.city,
      country: branches.country,
      currency: branches.currency,
      providerName: providers.name,
      providerSlug: providers.slug,
      minPrice: sql<string|null>`min(${branchTreatments.price})`,
      treatmentCount: sql<number>`count(${branchTreatments.id})::int`,
    })
    .from(branches)
    .innerJoin(providers, eq(branches.providerId, providers.id))
    .leftJoin(
      branchTreatments,
      and(
        eq(branchTreatments.branchId, branches.id),
        eq(branchTreatments.active, true),
        sql`exists (select 1 from treatments t where t.id = ${branchTreatments.treatmentId} and t.status = 'active' and t.agent_approved = true)`,
      ),
    )
    .where(and(eq(branches.status, 'active'), eq(providers.status, 'approved')))
    .groupBy(
      branches.id,
      branches.name,
      branches.slug,
      branches.city,
      branches.country,
      branches.currency,
      providers.name,
      providers.slug,
    )
    .orderBy(asc(providers.name), asc(branches.name));

  const filtered = q
    ? rows.filter(
        (r) =>
          r.providerName.toLowerCase().includes(q) ||
          r.branchName.toLowerCase().includes(q) ||
          r.city.toLowerCase().includes(q),
      )
    : rows;

  const totalTreatments = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(treatments)
    .where(and(eq(treatments.status, 'active'), eq(treatments.agentApproved, true)));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl">Book for a customer</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-ink-500">
          Pick a location and continue into the standard booking flow — your negotiated agent rate and
          commission are applied automatically, and the voucher can be forwarded to your client.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-clay-100 bg-clay-50 px-4 py-3 text-[13.5px] text-clay-800">
        <Sparkles className="size-4 shrink-0" />
        <span>
          {totalTreatments[0]?.n ?? 0} agent-approved treatments across {rows.length} location
          {rows.length === 1 ? '' : 's'} — rates are resolved from your session, never shared with guests.
        </span>
      </div>

      <form action="/agent/new" method="GET" className="relative max-w-lg">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
        <input
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Search spa, branch or city…"
          aria-label="Search locations"
          className="h-11 w-full rounded-xl border border-ink-200 bg-white pl-10 pr-3.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
        />
      </form>

      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
          <p className="text-[15px] font-medium">No matching locations</p>
          <p className="mt-1 text-sm text-ink-500">Clear the search to browse everything available to agents.</p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {filtered.map((r) => (
            <li key={r.branchId} className="flex items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-white p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-medium">{r.providerName}</p>
                  <Badge tone="brand">{r.city}</Badge>
                </div>
                <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ink-500">
                  <MapPin className="size-3.5" /> {r.branchName}
                  {r.country !== 'ID' ? `, ${r.country}` : ''}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-400">
                  {r.treatmentCount > 0
                    ? `${r.treatmentCount} treatments · from ${formatMoney(Number(r.minPrice ?? 0), r.currency)}`
                    : 'No agent-approved treatments yet'}
                </p>
              </div>
              <Link
                href={`/spas/${r.providerSlug}/${r.slug}/book`}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand-700 px-4 text-[13px] font-medium text-white hover:bg-brand-800"
              >
                Book <ArrowRight className="size-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

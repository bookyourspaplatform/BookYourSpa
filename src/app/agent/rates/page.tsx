import type { Metadata } from 'next';
import { and, eq, asc, sql, inArray } from 'drizzle-orm';
import { Percent, Tags } from 'lucide-react';
import { getDb } from '@/db';
import { agentRates, providers, treatments, users } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { formatMoney } from '@/lib/money';
import { pageMetadata } from '@/lib/seo';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'My rates', description: 'Negotiated agent rates.', path: '/agent/rates', noIndex: true });
}

export default async function AgentRatesPage() {
  const user = (await getCurrentUser())!;
  const agentId = user.agent!.id;
  const db = await getDb();

  const rateRows = await db
    .select({
      id: agentRates.id,
      netPrice: agentRates.netPrice,
      active: agentRates.active,
      treatmentId: treatments.id,
      treatmentName: treatments.name,
      category: treatments.category,
      durationMin: treatments.durationMin,
      listPrice: treatments.listPrice,
      currency: treatments.currency,
      status: treatments.status,
      agentApproved: treatments.agentApproved,
      providerName: providers.name,
    })
    .from(agentRates)
    .innerJoin(treatments, eq(agentRates.treatmentId, treatments.id))
    .innerJoin(providers, eq(treatments.providerId, providers.id))
    .where(and(eq(agentRates.agentId, agentId), eq(agentRates.active, true)))
    .orderBy(asc(providers.name), asc(treatments.name));

  const approvedIds = rateRows.filter((r) => r.agentApproved && r.status === 'active').map((r) => r.treatmentId);

  const publicTreatments = await db.query.treatments.findMany({
    where: approvedIds.length
      ? inArray(treatments.id, approvedIds)
      : sql`false`,
    columns: { id: true, listPrice: true, currency: true },
  });
  const publicById = new Map(publicTreatments.map((t) => [t.id, t]));

  const groups = new Map<string, typeof rateRows>();
  for (const r of rateRows) {
    const list = groups.get(r.providerName) ?? [];
    list.push(r);
    groups.set(r.providerName, list);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl">My negotiated rates</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-ink-500">
          Net prices your agency pays for these treatments. When you book, this rate and your commission are
          applied automatically — guests never see these numbers.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3 text-[13.5px] text-brand-900">
        <Tags className="size-4 shrink-0" />
        <span>
          Default commission: <strong>{(user.agent!.commissionBps / 100).toFixed(1)}%</strong> on booking
          gross, unless a treatment-specific rate overrides it.
        </span>
      </div>

      {rateRows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-14 text-center">
          <Percent className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 text-[15px] font-medium">No negotiated rates yet</p>
          <p className="mt-1 text-sm text-ink-500">
            Once our team approves your agency, treatment-specific net rates appear here.
          </p>
        </div>
      ) : (
        [...groups.entries()].map(([providerName, list]) => (
          <section key={providerName} className="rounded-3xl border border-ink-100 bg-white">
            <div className="border-b border-ink-100 px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">{providerName}</h2>
            </div>
            <ul className="divide-y divide-ink-50">
              {list.map((r) => {
                const pub = publicById.get(r.treatmentId);
                const saving = pub ? pub.listPrice - r.netPrice : 0;
                const savingPct = pub && pub.listPrice > 0 ? Math.round((saving / pub.listPrice) * 100) : 0;
                const publishable = r.agentApproved && r.status === 'active';
                return (
                  <li key={r.id} className="grid grid-cols-2 items-center gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[1fr_auto_auto]">
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-medium">
                        {r.treatmentName}
                        {!publishable && <Badge tone="warning">not bookable</Badge>}
                      </p>
                      <p className="text-[13px] text-ink-500">
                        {r.durationMin} min · {r.category.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[15px] font-semibold tabular-nums text-brand-800">
                        {formatMoney(r.netPrice, r.currency)}
                      </p>
                      {saving > 0 && (
                        <p className="text-[12.5px] tabular-nums text-emerald-600">
                          save {savingPct}% vs {formatMoney(pub!.listPrice, r.currency)}
                        </p>
                      )}
                    </div>
                    <div className="col-span-2 sm:col-span-1 sm:text-right">
                      <Badge tone="clay">commission {(user.agent!.commissionBps / 100).toFixed(1)}%</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

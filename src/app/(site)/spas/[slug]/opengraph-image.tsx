import { ImageResponse } from 'next/og';
import { notFound } from 'next/navigation';
import { and, eq, min } from 'drizzle-orm';
import { getDb } from '@/db';
import { branchTreatments, branches, providers } from '@/db/schema';

export const runtime = 'nodejs';
export const alt = 'Spa details';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = await getDb();
  const provider = await db.query.providers.findFirst({ where: eq(providers.slug, slug) });
  if (!provider || provider.status !== 'approved') notFound();

  const [branchRows, agg] = await Promise.all([
    db
      .select({ city: branches.city })
      .from(branches)
      .where(and(eq(branches.providerId, provider.id), eq(branches.status, 'active'))),
    db
      .select({ minPrice: min(branchTreatments.price) })
      .from(branchTreatments)
      .innerJoin(branches, eq(branchTreatments.branchId, branches.id))
      .where(and(eq(branches.providerId, provider.id), eq(branchTreatments.active, true), eq(branches.status, 'active'))),
  ]);

  const cities = [...new Set(branchRows.map((b) => b.city))].slice(0, 3);
  const minPrice = agg[0]?.minPrice != null ? Number(agg[0].minPrice) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(140deg, #fbf9f6 0%, #ece5db 100%)',
          color: '#17201d',
          padding: '64px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: 30, color: '#20524c' }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: '#20524c',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
            }}
          >
            B
          </div>
          BOOKYOURSPA
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05 }}>{provider.name}</div>
          <div style={{ display: 'flex', gap: '8px', fontSize: 32, color: '#36443f' }}>
            <span>{cities.length ? cities.join(' · ') : 'Spa & wellness'}</span>
            {minPrice ? <span>· from {minPrice.toLocaleString('id-ID')}</span> : null}
          </div>
          {provider.tagline && (
            <div style={{ fontSize: 28, color: '#5b6b65' }}>{provider.tagline}</div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: 26,
            color: '#20524c',
            background: '#ffffff',
            borderRadius: 999,
            padding: '12px 28px',
            alignSelf: 'flex-start',
            border: '1px solid #ece5db',
          }}
        >
          View treatments & book →
        </div>
      </div>
    ),
    { ...size },
  );
}

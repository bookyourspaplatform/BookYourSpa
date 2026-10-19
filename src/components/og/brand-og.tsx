import { ImageResponse } from 'next/og';

export const BRAND_OG_SIZE = { width: 1200, height: 630 };

/** Full-bleed brand card used when a route has no bespoke image. */
export async function brandOgImage(siteName: string): Promise<ImageResponse> {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #20524c 0%, #2f6b62 55%, #c9a227 140%)',
          color: '#ffffff',
          padding: '72px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', fontSize: 34, letterSpacing: 2 }}>
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 16,
              background: '#c9a227',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 30,
              color: '#17201d',
            }}
          >
            B
          </div>
          <span>{siteName.toUpperCase()}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>
            Book the world&apos;s best spas
          </div>
          <div style={{ fontSize: 34, opacity: 0.85 }}>
            Bali · Dubai · and growing — compare treatments, book instantly, get a voucher
          </div>
        </div>

        <div style={{ display: 'flex', gap: '14px', fontSize: 26 }}>
          {['Instant confirmation', 'Agent rates', 'Pay online or at venue'].map((t) => (
            <div
              key={t}
              style={{
                display: 'flex',
                padding: '10px 22px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.25)',
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...BRAND_OG_SIZE },
  );
}

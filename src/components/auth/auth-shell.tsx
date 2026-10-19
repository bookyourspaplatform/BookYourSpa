import { Logo, LogoMark } from '@/components/logo';

const PORTAL_COPY: Record<string, { kicker: string; headline: string; bullets: string[] }> = {
  customer: {
    kicker: 'Customer portal',
    headline: 'Your wellness, booked in seconds.',
    bullets: ['Instant e-vouchers', 'Compare treatments & prices', 'Free cancellation window'],
  },
  provider: {
    kicker: 'Supplier & POS portal',
    headline: 'Run every branch from one calendar.',
    bullets: ['Multi-branch menus & pricing', 'Therapist availability & rosters', 'Earnings and payouts'],
  },
  agent: {
    kicker: 'Agent & reseller portal',
    headline: 'Sell spas at your negotiated rates.',
    bullets: ['Approved product catalogue', 'Net rates or commission', 'Book on behalf of clients'],
  },
  super_admin: {
    kicker: 'Super admin console',
    headline: 'Full control of the marketplace.',
    bullets: ['Providers, agents & bookings', 'Payments, commissions, payouts', 'Content, promotions & SEO'],
  },
};

export function AuthShell({
  role,
  title,
  subtitle,
  children,
  footer,
  demo,
}: {
  role: keyof typeof PORTAL_COPY;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  demo?: { email: string; password: string } | null;
}) {
  const copy = PORTAL_COPY[role];
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-brand-900 px-10 py-12 lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-brand-700/40 blur-2xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 size-[26rem] rounded-full bg-clay-600/20 blur-3xl"
          aria-hidden
        />
        <div className="relative flex items-center gap-2.5">
          <LogoMark />
          <span className="font-display text-lg text-white">BookYourSpa</span>
        </div>
        <div className="relative max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-200">{copy.kicker}</p>
          <h1 className="mt-3 text-4xl leading-[1.1] text-white">{copy.headline}</h1>
          <ul className="mt-7 space-y-3">
            {copy.bullets.map((b) => (
              <li key={b} className="flex items-start gap-3 text-[15px] text-brand-100/90">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-clay-400" aria-hidden />
                {b}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[13px] text-brand-200/70">
          bookyourspa.net · Bali · Dubai · International
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-col justify-center bg-sand-50 px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">{copy.kicker}</p>
          <h2 className="mt-2 text-3xl">{title}</h2>
          {subtitle && <p className="mt-2 text-[15px] text-ink-500">{subtitle}</p>}

          <div className="mt-7">{children}</div>

          {footer && <div className="mt-6 text-sm text-ink-500">{footer}</div>}

          {demo && (
            <div className="mt-8 rounded-2xl border border-dashed border-brand-300 bg-brand-50/70 p-4 text-[13px] text-brand-900">
              <p className="font-semibold">Demo credentials (non-production only)</p>
              <p className="mt-1 font-mono text-[12.5px] leading-relaxed">
                {demo.email} · {demo.password}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

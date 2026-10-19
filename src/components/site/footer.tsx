import Link from 'next/link';
import { Logo } from '@/components/logo';
import { getSettings } from '@/lib/settings';

export async function SiteFooter() {
  const settings = await getSettings();
  const year = new Date().getFullYear();

  const columns: { title: string; links: { href: string; label: string }[] }[] = [
    {
      title: 'Discover',
      links: [
        { href: '/spas', label: 'All spas' },
        { href: '/spas?city=Seminyak', label: 'Spas in Seminyak' },
        { href: '/spas?city=Ubud', label: 'Spas in Ubud' },
        { href: '/spas?city=Dubai', label: 'Spas in Dubai' },
        { href: '/compare', label: 'Compare treatments' },
        { href: '/deals', label: 'Deals & promotions' },
      ],
    },
    {
      title: 'Treatments',
      links: [
        { href: '/spas?category=massage', label: 'Massage' },
        { href: '/spas?category=facial', label: 'Facials' },
        { href: '/spas?category=body', label: 'Body rituals' },
        { href: '/spas?category=bath', label: 'Hammam & baths' },
        { href: '/spas?category=wellness', label: 'Wellness' },
        { href: '/spas?category=package', label: 'Packages' },
      ],
    },
    {
      title: 'Company',
      links: [
        { href: '/about', label: 'About us' },
        { href: '/contact', label: 'Contact' },
        { href: '/register/provider', label: 'Become a supplier' },
        { href: '/register/agent', label: 'Become an agent' },
        { href: '/terms', label: 'Terms of service' },
        { href: '/privacy', label: 'Privacy policy' },
      ],
    },
  ];

  return (
    <footer className="no-print mt-auto border-t border-ink-100 bg-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_repeat(3,1fr)] lg:px-8">
        <div>
          <Logo size="sm" />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-500">
            {settings['site.tagline']}. Vetted spas, transparent prices and instant vouchers — booked
            directly with the venue.
          </p>
          <p className="mt-4 text-sm text-ink-500">
            {settings['site.supportEmail']}
            <br />
            {settings['site.phone']}
          </p>
        </div>

        {columns.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-ink-400 font-sans">
              {col.title}
            </h3>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-sm text-ink-600 transition-colors hover:text-brand-700">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-ink-100">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-[13px] text-ink-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {year} BookYourSpa — bookyourspa.net</p>
          <p>Bali · Dubai · International</p>
        </div>
      </div>
    </footer>
  );
}

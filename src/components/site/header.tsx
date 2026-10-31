import Link from 'next/link';
import { UserRound } from 'lucide-react';
import { Logo } from '@/components/logo';
import { getCurrentUser } from '@/lib/auth/session';
import { getSettings } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { getLang } from '@/lib/lang-cookie';
import { getDisplayCurrency } from '@/lib/currency-cookie';
import { HeaderMenu } from '@/components/site/header-menu';
import { MyBookingsButton } from '@/components/site/my-bookings-button';
import { PrefsSwitchers } from '@/components/site/prefs-switchers';
import { buttonClasses } from '@/components/ui/button';

export async function SiteHeader() {
  const [user, settings, lang, currency] = await Promise.all([
    getCurrentUser(),
    getSettings(),
    getLang(),
    getDisplayCurrency(),
  ]);
  const announcement = settings['site.announcement'];

  const home = user
    ? user.role === 'provider'
      ? '/provider'
      : user.role === 'agent'
        ? '/agent'
        : user.role === 'super_admin'
          ? '/admin'
          : '/account'
    : null;

  const links = [
    { href: '/spas', label: t(lang, 'nav.explore') },
    { href: '/spas?near=me', label: t(lang, 'nav.near') },
    { href: '/#destinations', label: t(lang, 'nav.destinations') },
    { href: '/#categories', label: t(lang, 'nav.treatments') },
    { href: '/spas?sort=rating', label: t(lang, 'nav.topRated') },
    { href: '/deals', label: t(lang, 'nav.deals') },
    { href: '/spas?spa=doorstep_spa', label: t(lang, 'nav.doorstep') },
  ];

  return (
    <header className="no-print sticky top-0 z-50 border-b border-ink-100 bg-white/95 backdrop-blur-md">
      {/* Announcement bar — editable in Admin → Content */}
      <div className="bg-ink-900 text-white">
        <div className="mx-auto flex h-9 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <p className="truncate text-[12.5px] text-ink-100/90">
            {announcement || 'Book trusted spas worldwide — instant confirmation, transparent prices.'}
          </p>
          <PrefsSwitchers currency={currency} lang={lang} compact />
        </div>
      </div>

      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-7">
          <Logo size="sm" />
          <nav className="hidden items-center gap-0.5 xl:flex" aria-label="Main">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-full px-3 py-2 text-sm font-medium text-ink-600 transition-colors hover:bg-sand-100 hover:text-ink-900"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <MyBookingsButton
                label={t(lang, 'nav.myBookings')}
                signedIn
                memberHref={user.role === 'customer' ? '/account/bookings' : home!}
                className="hidden sm:inline-flex"
              />
              <Link href={home!} className={`${buttonClasses('outline', 'sm')} hidden lg:inline-flex`}>
                <UserRound className="size-4" />
                {user.name.split(' ')[0]}
              </Link>
              <HeaderMenu user={{ name: user.name, role: user.role, email: user.email }} />
            </>
          ) : (
            <>
              <Link href="/login" className={`${buttonClasses('outline', 'sm')} hidden sm:inline-flex`}>
                Sign in
              </Link>
              <MyBookingsButton
                label={t(lang, 'nav.myBookings')}
                signedIn={false}
                memberHref="/account/bookings"
                className="hidden sm:inline-flex"
              />
              <HeaderMenu user={null} />
            </>
          )}
        </div>
      </div>
    </header>
  );
}

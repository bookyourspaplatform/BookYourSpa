import Link from 'next/link';
import { Compass, Menu, UserRound } from 'lucide-react';
import { Logo } from '@/components/logo';
import { getCurrentUser } from '@/lib/auth/session';
import { HeaderMenu } from '@/components/site/header-menu';
import { buttonClasses } from '@/components/ui/button';

export async function SiteHeader() {
  const user = await getCurrentUser();
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
    { href: '/spas', label: 'Find a spa' },
    { href: '/compare', label: 'Compare treatments' },
    { href: '/deals', label: 'Deals' },
    { href: '/about', label: 'About' },
  ];

  return (
    <header className="no-print sticky top-0 z-50 border-b border-ink-100 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Logo size="sm" />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
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
              <Link href={home!} className={`${buttonClasses('outline', 'sm')} hidden sm:inline-flex`}>
                <UserRound className="size-4" />
                {user.name.split(' ')[0]}
              </Link>
              <HeaderMenu user={{ name: user.name, role: user.role, email: user.email }} />
            </>
          ) : (
            <>
              <Link
                href="/login/provider"
                className="hidden rounded-full px-3 py-2 text-sm font-medium text-ink-600 hover:bg-sand-100 hover:text-ink-900 md:block"
              >
                List your spa
              </Link>
              <Link href="/login" className={`${buttonClasses('outline', 'sm')} hidden sm:inline-flex`}>
                Sign in
              </Link>
              <Link href="/register" className={`${buttonClasses('primary', 'sm')} hidden sm:inline-flex`}>
                Join
              </Link>
              <HeaderMenu user={null} />
            </>
          )}
        </div>
      </div>
    </header>
  );
}

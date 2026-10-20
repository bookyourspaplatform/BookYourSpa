'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { LogOut, Home } from 'lucide-react';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';

export type DashNavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

/**
 * Role dashboard chrome: top bar + desktop sidebar + mobile tab strip.
 * Mobile-first — on small screens the sidebar becomes a scrolling tab row.
 * `signOut` is the server action (logoutAction) passed from the layout.
 */
export function DashShell({
  nav,
  title,
  user,
  signOut,
  children,
}: {
  nav: DashNavItem[];
  title: string;
  user: { name: string };
  signOut: () => Promise<void>;
  children: ReactNode;
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === pathname || (href !== '/provider' && href !== '/agent' && href !== '/admin' && pathname.startsWith(href + '/'));

  return (
    <div className="min-h-screen bg-sand-50">
      {/* Top bar */}
      <header className="no-print sticky top-0 z-40 border-b border-ink-100 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            {/* Logo renders its own <Link href="/"> — do not wrap it in another link (invalid nested <a>). */}
            <Logo className="h-7 w-auto" />
            <span className="hidden rounded-full bg-brand-50 px-2.5 py-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-brand-700 sm:inline">
              {title}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <Link
              href="/"
              className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-800 sm:flex"
            >
              <Home className="size-3.5" /> View site
            </Link>
            <span className="max-w-32 truncate text-[13px] font-medium text-ink-700">{user.name}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-[13px] font-medium text-ink-600 hover:bg-sand-50"
              >
                <LogOut className="size-3.5" /> Sign out
              </button>
            </form>
          </div>
        </div>

        {/* Mobile tabs */}
        <nav className="no-scrollbar flex gap-1 overflow-x-auto border-t border-ink-100 px-3 py-1.5 lg:hidden" aria-label="Dashboard">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition',
                isActive(item.href) ? 'bg-brand-700 text-white' : 'text-ink-600 hover:bg-ink-100',
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Desktop sidebar */}
        <aside className="no-print hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-20 space-y-0.5" aria-label="Dashboard">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium transition',
                  isActive(item.href)
                    ? 'bg-brand-700 text-white shadow-sm'
                    : 'text-ink-600 hover:bg-white hover:text-ink-900',
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

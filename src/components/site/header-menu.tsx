'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import type { Role } from '@/db/schema';
import { logoutAction } from '@/lib/actions/auth';
import { buttonClasses } from '@/components/ui/button';

const HOME: Record<Role, string> = {
  customer: '/account',
  provider: '/provider',
  agent: '/agent',
  super_admin: '/admin',
};

export function HeaderMenu({ user }: { user: { name: string; role: Role; email: string } | null }) {
  const [open, setOpen] = useState(false);

  const nav = [
    { href: '/spas', label: 'Explore Spas' },
    { href: '/spas?near=me', label: 'Spa Near Me' },
    { href: '/#destinations', label: 'Destinations' },
    { href: '/#categories', label: 'Treatments' },
    { href: '/spas?sort=rating', label: 'Top Rated' },
    { href: '/deals', label: 'Deals' },
    { href: '/spas?spa=doorstep_spa', label: 'Doorstep Spa' },
    { href: '/compare', label: 'Compare treatments' },
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
  ];

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        className="rounded-full border border-ink-200 bg-white p-2 text-ink-700 hover:bg-sand-50"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {open && (
        <div className="absolute inset-x-0 top-16 border-b border-ink-100 bg-white px-4 pb-5 pt-3 shadow-lg">
          <nav className="flex flex-col" aria-label="Mobile">
            {nav.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-2.5 text-[15px] font-medium text-ink-700 hover:bg-sand-100"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="mt-4 flex flex-col gap-2 border-t border-ink-100 pt-4">
            {user ? (
              <>
                <Link
                  href={HOME[user.role]}
                  onClick={() => setOpen(false)}
                  className={buttonClasses('primary', 'md', 'w-full')}
                >
                  Go to my dashboard
                </Link>
                <form action={logoutAction}>
                  <button type="submit" className={buttonClasses('outline', 'md', 'w-full')}>
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link href="/login" onClick={() => setOpen(false)} className={buttonClasses('outline', 'md', 'w-full')}>
                  Sign in
                </Link>                <Link
                  href="/register"
                  onClick={() => setOpen(false)}
                  className={buttonClasses('primary', 'md', 'w-full')}
                >
                  Create account
                </Link>
                <Link
                  href="/login/agent"
                  onClick={() => setOpen(false)}
                  className={buttonClasses('ghost', 'md', 'w-full')}
                >
                  Agent / reseller login
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

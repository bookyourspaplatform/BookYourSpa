import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/auth/session';

export default async function AccountLayout({ children }: { children: ReactNode }) {
  await requireUser(['customer']);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl sm:text-3xl">My account</h1>
      <nav className="mt-4 flex gap-1 border-b border-ink-100 pb-px" aria-label="Account">
        <AccountTab href="/account/bookings">Bookings</AccountTab>
        <AccountTab href="/account/profile">Profile</AccountTab>
      </nav>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function AccountTab({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-t-xl px-4 py-2.5 text-sm font-medium text-ink-500 transition hover:bg-sand-50 hover:text-brand-800"
    >
      {children}
    </Link>
  );
}

'use client';

import { useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarCheck, Mail, Receipt, UserRound } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { buttonClasses } from '@/components/ui/button';
import { findMyBooking } from '@/lib/actions/account';
import { cn } from '@/lib/utils';

type Tab = 'voucher' | 'member';

/**
 * Header "My Bookings" button — instead of jumping straight to a page it opens
 * a small window with two ways in: guests look up a voucher with their code +
 * booking email, members sign in (or jump to their dashboard when they already
 * are).
 */
export function MyBookingsButton({
  label,
  signedIn,
  memberHref,
  className,
}: {
  label: string;
  /** Signed-in visitors skip the sign-in links and go straight to their list. */
  signedIn: boolean;
  memberHref: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('voucher');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function openWindow() {
    setTab('voucher');
    setError(null);
    setOpen(true);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await findMyBooking({ code, email });
      if (res.ok) {
        setOpen(false);
        router.push(`/voucher/${res.code}`);
      } else {
        setError(res.error);
      }
    });
  }

  const inputCls =
    'h-11 w-full rounded-xl border border-ink-200 bg-white pr-3.5 text-sm outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15';

  return (
    <>
      <button
        type="button"
        onClick={openWindow}
        className={cn(buttonClasses('secondary', 'sm'), className)}
      >
        <CalendarCheck className="size-4" />
        {label}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        description="Continue as a guest with your voucher code, or sign in to your member account."
      >
        {/* Two ways in — pick one. */}
        <div className="flex rounded-2xl bg-ink-100 p-1" role="tablist" aria-label="Booking lookup">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'voucher'}
            onClick={() => setTab('voucher')}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[13.5px] font-medium transition',
              tab === 'voucher'
                ? 'bg-white text-ink-900 shadow-sm'
                : 'text-ink-500 hover:text-ink-700',
            )}
          >
            <Receipt className="size-4" />
            Book as guest
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'member'}
            onClick={() => setTab('member')}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[13.5px] font-medium transition',
              tab === 'member'
                ? 'bg-white text-ink-900 shadow-sm'
                : 'text-ink-500 hover:text-ink-700',
            )}
          >
            <UserRound className="size-4" />
            Member login
          </button>
        </div>

        {tab === 'voucher' ? (
          <form onSubmit={submit} className="mt-4 space-y-3.5">
            <div>
              <label htmlFor="mb-code" className="mb-1.5 block text-[13px] font-medium text-ink-700">
                Voucher / booking code
              </label>
              <input
                id="mb-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="BYS-XXXXXXX"
                autoComplete="off"
                autoCapitalize="characters"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="mb-email" className="mb-1.5 block text-[13px] font-medium text-ink-700">
                Email used for the booking
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
                <input
                  id="mb-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className={`${inputCls} pl-10`}
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-[13px] text-rose-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className={buttonClasses('primary', 'md', 'w-full disabled:opacity-60')}
            >
              {pending ? 'Finding your booking…' : 'Find my booking'}
            </button>
            <p className="text-center text-[12.5px] text-ink-400">
              The code is in your confirmation email (starts with BYS-).
            </p>
          </form>
        ) : (
          <div className="mt-4 space-y-2.5">
            {signedIn ? (
              <>
                <p className="text-sm leading-relaxed text-ink-500">
                  You are signed in — your bookings, vouchers and receipts live in your account.
                </p>
                <Link
                  href={memberHref}
                  onClick={() => setOpen(false)}
                  className={buttonClasses('primary', 'md', 'w-full')}
                >
                  Open my bookings
                </Link>
              </>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-ink-500">
                  Sign in to see every booking, voucher and receipt in one place.
                </p>
                <Link href="/login?next=/account/bookings" className={buttonClasses('primary', 'md', 'w-full')}>
                  Sign in
                </Link>
                <Link href="/register" className={buttonClasses('outline', 'md', 'w-full')}>
                  Create account
                </Link>
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

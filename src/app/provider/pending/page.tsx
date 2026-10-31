import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Clock, Mail, ShieldAlert } from 'lucide-react';
import { getCurrentUser, HOME_PAGES } from '@/lib/auth/session';
import { getDb } from '@/db';
import { eq } from 'drizzle-orm';
import { providers } from '@/db/schema';
import { getSettings } from '@/lib/settings';
import { logoutAction } from '@/lib/actions/auth';
import { buttonClasses } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

/**
 * The supplier "we're not in yet" screen. It must be reachable *without*
 * requireUser(), because requireUser() is what redirects unapproved suppliers
 * here — calling it from this page sent the browser into a redirect loop.
 * Approved suppliers are bounced straight to the console instead of being told
 * they are awaiting approval.
 */
export default async function ProviderPendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login/provider?next=/provider/pending');
  if (user.role !== 'provider') redirect(HOME_PAGES[user.role]);
  if (user.provider) redirect('/provider');

  const db = await getDb();
  const provider = await db.query.providers.findFirst({ where: eq(providers.ownerId, user.id) });
  const supportEmail = (await getSettings())['site.supportEmail'];

  const suspended = provider?.status === 'suspended';
  const awaiting = provider?.status === 'pending';
  const title = suspended ? 'Account suspended' : awaiting ? 'Application under review' : 'No spa linked yet';
  const message = suspended ? (
    <>
      This spa account has been suspended. Please contact our support team at{' '}
      <span className="font-medium text-ink-700">{supportEmail}</span> — we will get you back up and running as
      soon as we can.
    </>
  ) : awaiting ? (
    <>
      Your spa listing <span className="font-medium text-ink-700">{provider!.name}</span> is awaiting approval by
      our team. You will get access to the console as soon as it is approved — usually within one business day.
    </>
  ) : (
    <>
      This account is not linked to a spa listing yet. Send us a line at{' '}
      <span className="font-medium text-ink-700">{supportEmail}</span> and we will set your spa up, or claim your
      listing from its page on the site.
    </>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-sand-50 px-4">
      <div className="w-full max-w-md rounded-3xl border border-ink-100 bg-white p-8 text-center shadow-sm">
        <div
          className={`mx-auto flex size-14 items-center justify-center rounded-2xl ${
            suspended ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'
          }`}
        >
          {suspended ? <ShieldAlert className="size-7" /> : <Clock className="size-7" />}
        </div>
        <h1 className="mt-4 text-xl">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">{message}</p>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-[13px] text-ink-400">
          <Mail className="size-3.5" /> Updates go to {user.email}
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          <Link href="/" className={buttonClasses('primary', 'md', 'w-full')}>
            Back to the site
          </Link>
          <form action={logoutAction}>
            <button type="submit" className={buttonClasses('outline', 'md', 'w-full')}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

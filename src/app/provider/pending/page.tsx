import Link from 'next/link';
import { Clock, Mail } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getDb } from '@/db';
import { eq } from 'drizzle-orm';
import { providers } from '@/db/schema';
import { logoutAction } from '@/lib/actions/auth';
import { buttonClasses } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function ProviderPendingPage() {
  const user = await requireUser(['provider']);
  const db = await getDb();
  const provider = await db.query.providers.findFirst({ where: eq(providers.id, user.provider!.id) });

  return (
    <div className="flex min-h-screen items-center justify-center bg-sand-50 px-4">
      <div className="w-full max-w-md rounded-3xl border border-ink-100 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
          <Clock className="size-7" />
        </div>
        <h1 className="mt-4 text-xl">Application under review</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          Thanks, <span className="font-medium text-ink-700">{user.name}</span>!{' '}
          {provider?.status === 'suspended'
            ? 'This spa account has been suspended. Please contact our support team.'
            : 'Your spa listing is awaiting approval by our team. You will be able to access the console as soon as it is approved — usually within one business day.'}
        </p>
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

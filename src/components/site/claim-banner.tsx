'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Store } from 'lucide-react';
import { confirmProviderClaim } from '@/lib/actions/claims';
import { buttonClasses } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

/** Admin invited this signed-in email to claim a spa — confirm it to unlock admin approval. */
export function ClaimBanner({
  claims,
}: {
  claims: { id: string; providerName: string; providerSlug: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  if (claims.length === 0) return null;

  function confirm(id: string) {
    startTransition(async () => {
      const res = await confirmProviderClaim(id);
      if (res.ok) {
        toast.success('Claim confirmed', 'Our team will approve the handover — you will get an email.');
        router.refresh();
      } else {
        toast.error('Could not confirm the claim', res.error);
      }
    });
  }

  return (
    <section className="rounded-3xl border border-brand-200 bg-brand-50/60 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Store className="size-4 text-brand-700" />
        <h2 className="text-[15px] font-semibold">Spa business waiting for your claim</h2>
      </div>
      <ul className="mt-3 space-y-2.5">
        {claims.map((c) => (
          <li
            key={c.id}
            className="flex flex-col gap-3 rounded-2xl border border-ink-100 bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-[14.5px] font-medium">{c.providerName}</p>
              <p className="text-[13px] text-ink-500">
                Confirm it is yours and our team will approve the handover.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => confirm(c.id)}
                className={buttonClasses('primary', 'sm')}
              >
                Confirm my claim
              </button>
              <Link href={`/spas/${c.providerSlug}`} className={buttonClasses('outline', 'sm')}>
                View listing
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

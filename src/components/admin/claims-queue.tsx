'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Clock3, X } from 'lucide-react';
import { approveProviderClaim, rejectProviderClaim, type ActionResult } from '@/lib/actions/admin';
import { buttonClasses } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';

export type ClaimRow = {
  id: string;
  providerName: string;
  providerSlug: string;
  email: string;
  userName: string | null;
  message: string | null;
  createdAt: Date;
};

export function ClaimsQueue({ claims }: { claims: ClaimRow[] }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  if (claims.length === 0) return null;

  function run(action: (id: string) => Promise<ActionResult>, id: string, verb: string) {
    startTransition(async () => {
      const res = await action(id);
      if (res.ok) {
        toast.success(verb);
        router.refresh();
      } else {
        toast.error(`Could not ${verb.toLowerCase()}`, res.error);
      }
    });
  }

  return (
    <section className="rounded-3xl border border-brand-200 bg-brand-50/60 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Clock3 className="size-4 text-brand-700" />
        <h2 className="text-[16px] font-medium">Claim requests</h2>
        <span className="rounded-full bg-white px-2 py-0.5 text-[12px] font-medium text-brand-700">
          {claims.length}
        </span>
      </div>
      <p className="mt-0.5 text-[13px] text-ink-500">
        Approve a claim to hand the spa over to its owner — the listing goes live if it is still
        hidden.
      </p>

      <ul className="mt-3 space-y-3">
        {claims.map((c) => (
          <li key={c.id} className="flex flex-col gap-3 rounded-2xl border border-ink-100 bg-white p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <a href={`/spas/${c.providerSlug}`} className="text-[15px] font-medium hover:text-brand-700">
                  {c.providerName}
                </a>
                <span className="text-[13px] text-ink-400">·</span>
                <a href={`/spas/${c.providerSlug}`} className="text-[13px] text-brand-700 hover:underline">
                  view listing →
                </a>
              </div>
              <p className="mt-1 text-[13.5px] text-ink-600">
                Claimed by{' '}
                {c.userName ? (
                  <span className="font-medium">{c.userName} · </span>
                ) : null}
                <span className="underline decoration-ink-300">{c.email}</span>
                {!c.userName && (
                  <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11.5px] font-medium text-amber-800">
                    not confirmed yet
                  </span>
                )}
              </p>
              {c.message && <p className="mt-1 text-[13px] text-ink-500">“{c.message}”</p>}
              <p className="mt-1 text-[12.5px] text-ink-400">Requested {formatDate(c.createdAt)}</p>
              {!c.userName && (
                <p className="mt-1 text-[12.5px] text-amber-700">
                  Waiting for {c.email} to sign in and confirm — they see a claim banner on their
                  dashboard.
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                disabled={pending || !c.userName}
                title={!c.userName ? 'The claimant must confirm their claim first' : undefined}
                onClick={() => run(approveProviderClaim, c.id, 'Claim approved')}
                className={buttonClasses('primary', 'sm')}
              >
                <Check className="size-3.5" /> Approve
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(rejectProviderClaim, c.id, 'Claim rejected')}
                className={buttonClasses('ghost', 'sm', 'text-rose-600 hover:bg-rose-50')}
              >
                <X className="size-3.5" /> Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

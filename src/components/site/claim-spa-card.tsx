'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BadgeCheck, Check, Hand } from 'lucide-react';
import { requestProviderClaim } from '@/lib/actions/claims';
import { useToast } from '@/components/ui/toast';

export type ClaimSpaState = 'signed_out' | 'ready' | 'pending';

const PERKS = ['Manage your profile', 'Accept bookings', 'POS management', 'Respond to reviews'];

/** White pill button on the dark green card — kept as literal classes (no variant override). */
const WHITE_BTN =
  'inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-white px-4 text-[13.5px] font-semibold text-brand-800 shadow-sm transition hover:bg-sand-50 disabled:opacity-60';

export function ClaimSpaCard({
  providerId,
  slug,
  state,
}: {
  providerId: string;
  slug: string;
  state: ClaimSpaState;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function claim() {
    startTransition(async () => {
      const res = await requestProviderClaim(providerId);
      if (res.ok) {
        toast.success('Claim submitted', 'Our team will review it and email you once it is approved.');
        router.refresh();
      } else {
        toast.error('Could not submit the claim', res.error);
      }
    });
  }

  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 p-5 text-white">
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-14 size-36 rounded-full bg-white/10"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-16 -left-10 size-40 rounded-full bg-emerald-300/10"
      />

      <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide">
        <BadgeCheck className="size-3.5" /> For business owners
      </p>
      <h3 className="mt-3 text-xl font-semibold">Is this your spa?</h3>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/85">
        Take control of your listing on Book Your Spa. Claim your spa to manage bookings, update
        your services, respond to reviews, and grow your business.
      </p>

      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px] text-white/90">
        {PERKS.map((perk) => (
          <li key={perk} className="flex items-center gap-1.5">
            <Check className="size-3.5 shrink-0 text-emerald-300" /> {perk}
          </li>
        ))}
      </ul>

      <div className="mt-4">
        {state === 'pending' ? (
          <div className="rounded-2xl bg-white/15 px-4 py-3 text-[13.5px]">
            <p className="font-semibold">Claim under review</p>
            <p className="mt-0.5 text-white/80">
              Thanks — our team is checking your request and will email you once it is approved.
            </p>
          </div>
        ) : state === 'signed_out' ? (
          <Link href={`/login?next=/spas/${slug}`} className={WHITE_BTN}>
            <Hand className="size-4" /> Sign in to claim this spa
          </Link>
        ) : (
          <button type="button" disabled={pending} onClick={claim} className={WHITE_BTN}>
            <Hand className="size-4" /> Claim This Spa →
          </button>
        )}
      </div>
      <p className="mt-2.5 text-[12px] text-white/70">Free · No credit card required</p>
    </section>
  );
}

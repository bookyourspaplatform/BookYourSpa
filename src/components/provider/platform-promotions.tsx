'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Tag } from 'lucide-react';
import { setProviderPromotionActive } from '@/lib/actions/provider';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';

export type PlatformPromoRow = {
  id: string;
  title: string;
  summary: string | null;
  startsAt: string | null;
  endsAt: string | null;
  code: string | null;
  discountType: string | null;
  discountValue: number | null;
  treatmentIds: string[] | null;
  /** Per-promotion choice for this spa — absent means "on" (valid by default). */
  enabled: boolean;
};

function discountLabel(p: PlatformPromoRow): string | null {
  if (!p.discountType || p.discountValue == null) return null;
  return p.discountType === 'percent' ? `${p.discountValue / 100}% off` : `${p.discountValue} off`;
}

/**
 * General platform promotions — valid automatically at every spa, with each
 * supplier able to switch any of them off (and back on) for itself.
 */
export function PlatformPromotions({ rows }: { rows: PlatformPromoRow[] }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function toggle(p: PlatformPromoRow) {
    const next = !p.enabled;
    startTransition(async () => {
      const res = await setProviderPromotionActive(p.id, next);
      if (res.ok) {
        toast.success(next ? 'Promotion activated for your spa' : 'Promotion deactivated for your spa');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-10 text-center">
        <Sparkles className="mx-auto size-7 text-ink-300" />
        <p className="mt-3 text-[15px] font-medium">No platform promotions right now</p>
        <p className="mt-1 text-sm text-ink-500">
          Offers the platform runs for every spa will appear here so you can switch them on or off.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2.5">
      {rows.map((p) => {
        const discount = discountLabel(p);
        return (
          <li key={p.id} className="rounded-2xl border border-ink-100 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-medium">{p.title}</p>
                  <Badge tone="neutral">platform</Badge>
                  {p.code && (
                    <Badge tone="brand">
                      <Tag className="size-3" /> {p.code}
                    </Badge>
                  )}
                  {discount && <Badge tone="success">{discount}</Badge>}
                </div>
                {p.summary && <p className="mt-1 line-clamp-2 text-[13.5px] text-ink-600">{p.summary}</p>}
                <p className="mt-1 text-[12.5px] text-ink-400">
                  {p.treatmentIds?.length
                    ? `Applies to ${p.treatmentIds.length} selected treatment${p.treatmentIds.length === 1 ? '' : 's'}`
                    : 'Applies to all treatments'}
                  {p.startsAt ? ` · from ${new Date(p.startsAt).toISOString().slice(0, 10)}` : ''}
                  {p.endsAt ? ` · until ${new Date(p.endsAt).toISOString().slice(0, 10)}` : ''}
                  {p.code && ' · registered customers only'}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2.5">
                <span className="text-[13px] font-medium text-ink-600">{p.enabled ? 'Active' : 'Inactive'}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={p.enabled}
                  aria-label={`${p.enabled ? 'Deactivate' : 'Activate'} ${p.title}`}
                  disabled={pending}
                  onClick={() => toggle(p)}
                  className={
                    p.enabled
                      ? 'relative h-6 w-11 rounded-full bg-brand-700 transition disabled:opacity-60'
                      : 'relative h-6 w-11 rounded-full bg-ink-300 transition disabled:opacity-60'
                  }
                >
                  <span
                    className={
                      p.enabled
                        ? 'absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform translate-x-5'
                        : 'absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform'
                    }
                  />
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
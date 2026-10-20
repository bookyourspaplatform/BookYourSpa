'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Star, Trash2 } from 'lucide-react';
import { deleteReview, setReviewStatus } from '@/lib/actions/provider';
import { buttonClasses } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { cn, formatDate } from '@/lib/utils';

export type ReviewRow = {
  id: string;
  guestName: string;
  rating: number;
  comment: string | null;
  status: string;
  createdAt: string;
};

export function ReviewPanel({ rows }: { rows: ReviewRow[] }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function setStatus(r: ReviewRow, status: 'published' | 'hidden') {
    startTransition(async () => {
      const res = await setReviewStatus(r.id, status);
      if (res.ok) {
        toast.success(status === 'published' ? 'Review published' : 'Review hidden');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  function remove(r: ReviewRow) {
    startTransition(async () => {
      const res = await deleteReview(r.id);
      if (res.ok) {
        toast.success('Review deleted');
        router.refresh();
      } else {
        toast.error('Could not delete', res.error);
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
        <Star className="mx-auto size-8 text-ink-300" />
        <p className="mt-3 text-[15px] font-medium">No reviews yet</p>
        <p className="mt-1 text-sm text-ink-500">Reviews from guests appear here after their visit.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.id} className="rounded-2xl border border-ink-100 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[15px] font-medium">{r.guestName}</p>
                <span className="flex gap-0.5" aria-label={`${r.rating} out of 5 stars`}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star
                      key={i}
                      className={cn('size-3.5', i <= r.rating ? 'fill-amber-400 text-amber-400' : 'text-ink-200')}
                    />
                  ))}
                </span>
                <Badge tone={r.status === 'published' ? 'success' : r.status === 'hidden' ? 'danger' : 'warning'}>
                  {r.status}
                </Badge>
              </div>
              {r.comment && <p className="mt-1 max-w-prose text-[13.5px] text-ink-600">{r.comment}</p>}
              <p className="mt-1 text-[12.5px] text-ink-400">{formatDate(r.createdAt, undefined, { dateStyle: 'medium' })}</p>
            </div>
            <div className="flex items-center gap-1">
              {r.status !== 'published' ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setStatus(r, 'published')}
                  className={buttonClasses('ghost', 'sm', 'text-emerald-600 hover:bg-emerald-50')}
                >
                  Publish
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setStatus(r, 'hidden')}
                  className={buttonClasses('ghost', 'sm', 'text-rose-600 hover:bg-rose-50')}
                >
                  Hide
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(r)}
                className={buttonClasses('ghost', 'sm', 'text-rose-600 hover:bg-rose-50')}
                aria-label={`Delete review from ${r.guestName}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { formatDate } from '@/lib/utils';

export type ReviewItem = {
  id: string;
  guestName: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  bookingId: string | null;
  source: string;
};

/** The page showcases 10 reviews at a time. */
const PAGE_SIZE = 10;

function Stars({ value }: { value: number }) {
  const filled = Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          className={
            i < filled ? 'size-4 fill-amber-400 text-amber-400' : 'size-4 fill-ink-200 text-ink-200'
          }
        />
      ))}
    </span>
  );
}

/**
 * One line of review text. When the line is too long to fit, it ellipsizes
 * and a "show more" sits at the end of the line to enlarge it.
 */
function ReviewComment({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Measure only while collapsed — an expanded comment never clips.
  useLayoutEffect(() => {
    if (expanded) return;
    const el = ref.current;
    if (el) setOverflowing(el.scrollWidth > el.clientWidth + 2);
  }, [text, expanded]);

  return (
    <div className="mt-3 flex items-start gap-2 text-[14px] leading-relaxed text-ink-600">
      <span ref={ref} className={expanded ? 'min-w-0 break-words' : 'min-w-0 truncate'}>
        {text}
      </span>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 font-medium text-brand-700 hover:underline"
        >
          {expanded ? 'show less' : 'show more'}
        </button>
      )}
    </div>
  );
}

export function ReviewList({ reviews }: { reviews: ReviewItem[] }) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const visible = reviews.slice(0, shown);
  const remaining = reviews.length - visible.length;

  if (reviews.length === 0) {
    return (
      <p className="rounded-3xl border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
        No reviews yet — leave one after your visit.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((r) => (
        <article
          key={r.id}
          className="rounded-3xl border border-ink-100 bg-white p-4 sm:p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[15px] font-semibold text-brand-700">
                {r.guestName.trim().charAt(0).toUpperCase() || 'G'}
              </span>
              <div>
                <p className="text-[14.5px] font-medium text-ink-800">{r.guestName}</p>
                <p className="text-[12.5px] text-ink-400">
                  {formatDate(r.createdAt)} ·{' '}
                  {r.source === 'google' ? (
                    <span className="font-medium text-ink-500">Imported from Google Maps</span>
                  ) : r.bookingId ? (
                    'Verified booking'
                  ) : (
                    'Guest review'
                  )}
                </p>
              </div>
            </div>
            <Stars value={r.rating} />
          </div>
          {r.comment && <ReviewComment text={r.comment} />}
        </article>
      ))}
      {remaining > 0 && (
        <div className="pt-1 text-center">
          <button
            type="button"
            onClick={() => setShown((s) => s + PAGE_SIZE)}
            className="inline-flex h-11 items-center rounded-xl border border-ink-200 bg-white px-6 text-[14px] font-medium text-ink-700 hover:border-brand-400"
          >
            Show more reviews ({Math.min(remaining, PAGE_SIZE)} more)
          </button>
        </div>
      )}
    </div>
  );
}

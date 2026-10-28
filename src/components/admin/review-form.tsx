'use client';

import { useMemo, useState, useTransition, type FormEvent } from 'react';
import { Pencil, Search, Star, Trash2, X } from 'lucide-react';
import { adminAddReview, adminDeleteReview, adminUpdateReview } from '@/lib/actions/admin';
import { Field, Input, Select } from '@/components/ui/field';
import { RichText } from '@/components/ui/rich-text';
import { buttonClasses } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn, stripHtml } from '@/lib/utils';

/** Today as YYYY-MM-DD in the browser's calendar. */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The source options shown beside the date on the Add Review form. */
const SOURCES = [
  { value: 'platform', label: 'Guest review' },
  { value: 'google', label: 'Google Review' },
] as const;

/**
 * Admin DB → spa form → "Add Review" (opens in its own window). Writes a
 * single review for the location: name, stars, the date it is posted, its
 * source label and a rich-text body with emoji. It lands on the public page
 * straight away, so the badge and the 10-per-page showcase update with it.
 */
type ManagedReview = {
  id: string;
  guestName: string;
  rating: number;
  comment: string | null;
  source: 'platform' | 'google';
  createdAt: string;
};

export function ReviewForm({
  branchId,
  branchName,
  providerName,
  reviews: initialReviews,
}: {
  branchId: string;
  branchName: string;
  providerName: string;
  reviews: ManagedReview[];
}) {
  const [reviews, setReviews] = useState(initialReviews);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rating, setRating] = useState(5);
  const [date, setDate] = useState(todayKey());
  const [source, setSource] = useState<(typeof SOURCES)[number]['value']>('platform');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const filteredReviews = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return reviews;
    return reviews.filter((review) =>
      `${review.guestName} ${stripHtml(review.comment ?? '')}`.toLocaleLowerCase().includes(needle),
    );
  }, [query, reviews]);

  function resetForm() {
    setEditingId(null);
    setName('');
    setComment('');
    setRating(5);
    setDate(todayKey());
    setSource('platform');
    setError('');
  }

  function beginEdit(review: ManagedReview) {
    setEditingId(review.id);
    setName(review.guestName);
    setComment(review.comment ?? '');
    setRating(review.rating);
    setDate(review.createdAt.slice(0, 10));
    setSource(review.source);
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function removeReview(review: ManagedReview) {
    if (!window.confirm(`Delete this review from ${review.guestName}? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await adminDeleteReview(review.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReviews((items) => items.filter((item) => item.id !== review.id));
      if (editingId === review.id) resetForm();
      toast.success('Review deleted');
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const guestName = name.trim().replace(/\s+/g, ' ');
    if (guestName.length < 2) {
      setError('Enter the name the review is from (at least 2 characters).');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Pick the date the review was posted.');
      return;
    }
    if (date > todayKey()) {
      setError('The posted date cannot be in the future.');
      return;
    }
    setError('');
    startTransition(async () => {
      if (editingId) {
        const res = await adminUpdateReview({ id: editingId, guestName, rating, comment, date, source });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setReviews((items) => items.map((item) => item.id === editingId
          ? { ...item, guestName, rating, comment: comment.trim() ? comment : null, source, createdAt: `${date}T12:00:00.000Z` }
          : item));
        toast.success('Review updated', `Changes saved for ${branchName}.`);
      } else {
        const res = await adminAddReview({ branchId, guestName, rating, comment, date, source });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const id = res.data?.id;
        if (id) setReviews((items) => [{ id, guestName, rating, comment: comment.trim() ? comment : null, source, createdAt: `${date}T12:00:00.000Z` }, ...items]);
        toast.success('Review added', `Published on ${branchName}.`);
      }
      resetForm();
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-ink-100 bg-white p-5">
      <form onSubmit={submit} className="space-y-4">
        {editingId && (
          <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-900">
            <span>Editing an existing review</span>
            <button type="button" onClick={resetForm} className="inline-flex items-center gap-1 text-brand-800 hover:underline">
              <X className="size-4" /> Cancel edit
            </button>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required hint="Who the review is from.">
            {({ id }) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sarah J."
                maxLength={60}
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="Star" required hint="Whole stars, 1 to 5.">
            {() => (
              <div className="flex h-11 items-center gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`${i} star${i > 1 ? 's' : ''}`}
                    aria-pressed={i === rating}
                    onClick={() => setRating(i)}
                    className="rounded p-1 transition hover:bg-sand-100"
                  >
                    <Star
                      className={cn(
                        'size-6',
                        i <= rating ? 'fill-amber-400 text-amber-400' : 'text-ink-300',
                      )}
                    />
                  </button>
                ))}
              </div>
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date posted" required hint="Shown beside the review on the page.">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={date}
                max={todayKey()}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
          </Field>
          <Field label="Source" hint="Shown beside the date.">
            {({ id }) => (
              <Select id={id} value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field
          label="Review"
          hint="Rich text with emoji — bold, headings and lists all work. Leave it empty if you have nothing to add."
        >
          {() => (
            <RichText
              key={editingId ?? 'new-review'}
              value={comment}
              onChange={setComment}
              placeholder="Lovely team and a very relaxing treatment."
              minHeight={140}
              emoji
            />
          )}
        </Field>

        {error && (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-[12.5px] text-ink-500">
            Goes live on {providerName} → {branchName} immediately.
          </p>
          <button type="submit" disabled={pending} className={buttonClasses('primary', 'sm')}>
            {pending ? (editingId ? 'Saving…' : 'Adding…') : (editingId ? 'Save changes' : 'Add review')}
          </button>
        </div>
      </form>
      </section>

      <section className="rounded-3xl border border-ink-100 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-ink-900">Manage reviews</h2>
          <p className="mt-0.5 text-[13px] text-ink-500">{reviews.length} review{reviews.length === 1 ? '' : 's'} for this location. Search by name or review text.</p>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a review…"
            aria-label="Search reviews"
            className="h-10 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
        </div>
      </div>
      {filteredReviews.length ? (
        <ul className="mt-4 space-y-2.5">
          {filteredReviews.map((review) => (
            <li key={review.id} className="rounded-2xl border border-ink-100 bg-sand-50/50 p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-800">{review.guestName}</span>
                    <span className="inline-flex items-center gap-1 text-[12.5px] text-ink-500">
                      <Star className="size-3.5 fill-amber-400 text-amber-400" /> {review.rating}/5
                    </span>
                    <span className="text-[12px] text-ink-400">{review.source === 'google' ? 'Google Review' : 'Guest review'} · {new Date(review.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 break-words text-[13.5px] text-ink-600">{stripHtml(review.comment ?? '') || 'No written comment'}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => beginEdit(review)}
                    className={buttonClasses('ghost', 'sm')}
                    aria-label={`Edit review from ${review.guestName}`}
                  >
                    <Pencil className="size-3.5" /> Edit
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => removeReview(review)}
                    className={buttonClasses('ghost', 'sm', 'text-rose-600 hover:bg-rose-50')}
                    aria-label={`Delete review from ${review.guestName}`}
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
          {reviews.length ? 'No reviews match your search.' : 'No reviews yet for this location.'}
        </p>
      )}
      </section>
    </div>
  );
}
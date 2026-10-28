'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { Star } from 'lucide-react';
import { adminAddReview } from '@/lib/actions/admin';
import { Field, Input, Select } from '@/components/ui/field';
import { RichText } from '@/components/ui/rich-text';
import { buttonClasses } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/** Today as YYYY-MM-DD in the browser's calendar. */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** What each `reviews.source` value says on the public page, beside the date. */
const SOURCES = [
  { value: 'platform', label: 'Guest review' },
  { value: 'google', label: 'Imported from Google Maps' },
] as const;

/**
 * Admin DB → spa form → "Add Review" (opens in its own window). Writes a
 * single review for the location: name, stars, the date it is posted, its
 * source label and a rich-text body with emoji. It lands on the public page
 * straight away, so the badge and the 10-per-page showcase update with it.
 */
export function ReviewForm({
  branchId,
  branchName,
  providerName,
}: {
  branchId: string;
  branchName: string;
  providerName: string;
}) {
  const [name, setName] = useState('');
  const [rating, setRating] = useState(5);
  const [date, setDate] = useState(todayKey());
  const [source, setSource] = useState<(typeof SOURCES)[number]['value']>('platform');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

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
      const res = await adminAddReview({ branchId, guestName, rating, comment, date, source });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      toast.success('Review added', `Published on ${branchName}.`);
    });
  }

  if (saved) {
    return (
      <section className="rounded-3xl border border-ink-100 bg-white p-5">
        <p className="text-[15px] font-medium text-ink-800">Review published</p>
        <p className="mt-1 text-sm text-ink-500">
          It is live on {branchName} — the page shows 10 reviews at a time, newest first.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setName('');
              setComment('');
              setRating(5);
              setDate(todayKey());
              setSource('platform');
              setSaved(false);
            }}
            className={buttonClasses('outline', 'sm')}
          >
            Add another review
          </button>
          <button type="button" onClick={() => window.close()} className={buttonClasses('ghost', 'sm')}>
            Close window
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-ink-100 bg-white p-5">
      <form onSubmit={submit} className="space-y-4">
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
            {pending ? 'Adding…' : 'Add review'}
          </button>
        </div>
      </form>
    </section>
  );
}
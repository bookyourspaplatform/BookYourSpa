'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Plus, X } from 'lucide-react';
import { saveWeeklySchedule } from '@/lib/actions/provider';
import { buttonClasses } from '@/components/ui/button';
import { inputCls } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Entry = { weekday: number; startTime: string; endTime: string };

export function ScheduleEditor({
  therapist,
  entries,
}: {
  therapist: { id: string; name: string };
  entries: Entry[];
}) {
  const [rows, setRows] = useState<Entry[]>(entries.slice().sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)));
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const dirty = JSON.stringify([...rows].sort(cmp)) !== JSON.stringify([...entries].sort(cmp));

  function cmp(a: Entry, b: Entry) {
    return a.weekday - b.weekday || a.startTime.localeCompare(b.startTime);
  }

  function save() {
    startTransition(async () => {
      const res = await saveWeeklySchedule({ therapistId: therapist.id, entries: rows });
      if (res.ok) {
        toast.success('Schedule saved');
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
      }
    });
  }

  function setRow(i: number, patch: Partial<Entry>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  return (
    <div className="rounded-2xl border border-ink-100 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-[14.5px] font-medium">{therapist.name}</p>
          <p className="text-[12.5px] text-ink-400">
            {entries.length
              ? entries
                  .slice()
                  .sort(cmp)
                  .map((e) => `${DAY_NAMES[e.weekday]} ${e.startTime}–${e.endTime}`)
                  .join(' · ')
              : 'No weekly shifts defined'}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-3 py-1 text-[12px] font-medium',
            entries.length ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700',
          )}
        >
          {open ? 'Close' : 'Edit'}
        </span>
      </button>

      {open && (
        <div className="border-t border-ink-100 px-4 py-3.5">
          {rows.length === 0 && <p className="mb-2 text-[13px] text-ink-500">No shifts — add one to make this therapist bookable.</p>}

          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={`${r.weekday}-${r.startTime}-${i}`} className="flex items-center gap-1.5">
                <select
                  value={r.weekday}
                  onChange={(e) => setRow(i, { weekday: Number(e.target.value) })}
                  aria-label="Weekday"
                  className={cn(inputCls(), 'h-9 w-24 shrink-0 px-2')}
                >
                  {DAY_NAMES.map((d, idx) => (
                    <option key={d} value={idx}>
                      {d}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  value={r.startTime}
                  onChange={(e) => setRow(i, { startTime: e.target.value })}
                  aria-label="Start time"
                  className={cn(inputCls(), 'h-9 w-28 shrink-0 px-2')}
                />
                <span className="text-ink-300">–</span>
                <input
                  type="time"
                  value={r.endTime}
                  onChange={(e) => setRow(i, { endTime: e.target.value })}
                  aria-label="End time"
                  className={cn(inputCls(), 'h-9 w-28 shrink-0 px-2')}
                />
                <button
                  type="button"
                  onClick={() => setRows((list) => list.filter((_, idx) => idx !== i))}
                  aria-label="Remove shift"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setRows((r) => [...r, { weekday: 1, startTime: '09:00', endTime: '17:00' }])}
              className={buttonClasses('outline', 'sm')}
            >
              <Plus className="size-3.5" /> Add shift
            </button>
            <div className="flex items-center gap-2">
              {dirty && <span className="text-[12.5px] text-amber-600">Unsaved changes</span>}
              <button
                type="button"
                onClick={save}
                disabled={!dirty || pending}
                className={buttonClasses(dirty ? 'primary' : 'outline', 'sm', dirty ? '' : 'opacity-50')}
              >
                <CalendarClock className="size-3.5" />
                {pending ? 'Saving…' : 'Save schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

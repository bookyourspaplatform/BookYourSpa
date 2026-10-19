'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarX2, Plus, Trash2 } from 'lucide-react';
import { addException, removeException } from '@/lib/actions/provider';
import { buttonClasses } from '@/components/ui/button';
import { Field, Input, inputCls } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/utils';

type ExceptionRow = {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  kind: 'closed' | 'special_hours';
  reason: string | null;
  therapistId: string | null;
  therapistName: string | null;
};

export function ExceptionsPanel({
  branchId,
  therapists,
  exceptions,
}: {
  branchId: string;
  therapists: { id: string; name: string }[];
  exceptions: ExceptionRow[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<'closed' | 'special_hours'>('closed');
  const [therapistId, setTherapistId] = useState('');
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('18:00');
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function add() {
    startTransition(async () => {
      const res = await addException({
        branchId,
        therapistId: therapistId || null,
        date,
        kind,
        startTime: kind === 'special_hours' ? startTime : null,
        endTime: kind === 'special_hours' ? endTime : null,
        reason: reason.trim() || null,
      });
      if (res.ok) {
        toast.success(kind === 'closed' ? 'Closure added' : 'Special hours added');
        setReason('');
        router.refresh();
      } else {
        toast.error('Could not add', res.error);
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await removeException(id);
      if (res.ok) {
        toast.success('Removed');
        router.refresh();
      } else {
        toast.error('Could not remove', res.error);
      }
    });
  }

  return (
    <div className="rounded-3xl border border-ink-100 bg-white">
      <div className="border-b border-ink-100 px-5 py-4">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold">
          <CalendarX2 className="size-4 text-clay-500" /> Closures & special hours
        </h2>
        <p className="text-[13px] text-ink-500">One-off time off, holidays or reduced hours for a date.</p>
      </div>

      {/* Add form */}
      <div className="border-b border-ink-100 bg-sand-50/50 px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date" required>
            {({ id }) => <Input id={id} type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} required />}
          </Field>
          <Field label="Type" required>
            {({ id }) => (
              <select
                id={id}
                value={kind}
                onChange={(e) => setKind(e.target.value as 'closed' | 'special_hours')}
                className={inputCls()}
              >
                <option value="closed">Closed (whole day)</option>
                <option value="special_hours">Special hours</option>
              </select>
            )}
          </Field>
          <Field label="Applies to">
            {({ id }) => (
              <select id={id} value={therapistId} onChange={(e) => setTherapistId(e.target.value)} className={inputCls()}>
                <option value="">Whole branch</option>
                {therapists.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Reason">
            {({ id }) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Public holiday…" maxLength={120} />}
          </Field>
          {kind === 'special_hours' && (
            <>
              <Field label="Open from">
                {({ id }) => <Input id={id} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
              </Field>
              <Field label="Open until">
                {({ id }) => <Input id={id} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />}
              </Field>
            </>
          )}
        </div>
        <div className="mt-3">
          <button type="button" onClick={add} disabled={pending} className={buttonClasses('primary', 'sm')}>
            <Plus className="size-4" /> {pending ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>

      {/* List */}
      {exceptions.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13.5px] text-ink-500">No closures scheduled.</p>
      ) : (
        <ul className="divide-y divide-ink-50">
          {exceptions.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[14px]">
                  <span className="font-medium">{formatDate(e.date, undefined, { dateStyle: 'medium' })}</span>
                  <Badge tone={e.kind === 'closed' ? 'danger' : 'info'}>
                    {e.kind === 'closed' ? 'closed' : `${e.startTime}–${e.endTime}`}
                  </Badge>
                  <Badge tone="neutral">{e.therapistName ?? 'whole branch'}</Badge>
                </p>
                {e.reason && <p className="mt-0.5 text-[13px] text-ink-500">{e.reason}</p>}
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(e.id)}
                aria-label="Remove closure"
                className="flex size-8 items-center justify-center rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

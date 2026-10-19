import { describe, expect, it } from 'vitest';
import {
  slotsForDate,
  zonedToUtc,
  type BranchRules,
  type TherapistInput,
  type ExceptionInput,
  type BookedInput,
} from '@/lib/availability';

const TZ = 'Asia/Makassar'; // UTC+8, no DST — deterministic
const DATE = '2027-03-10'; // any future date
const NOW = new Date('2027-03-01T00:00:00Z');

const branch: BranchRules = {
  timezone: TZ,
  hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '09:00', close: '17:00', closed: false })),
  leadTimeMinutes: 0,
  maxAdvanceDays: 90,
  bufferMinutes: 0,
  slotIntervalMinutes: 30,
};

const therapist: TherapistInput = {
  id: 'thp_1',
  name: 'Ayu',
  active: true,
  windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })),
};

function minutesInTz(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')!.value);
  const m = Number(parts.find((p) => p.type === 'minute')!.value);
  return h * 60 + m;
}

const baseInput = {
  branch,
  date: DATE,
  durationMin: 60,
  requiresTherapist: true,
  capacity: 1,
  therapists: [therapist],
  exceptions: [] as ExceptionInput[],
  bookings: [] as BookedInput[],
  now: NOW,
};

describe('slotsForDate', () => {
  it('generates slots inside branch + therapist hours', () => {
    const slots = slotsForDate(baseInput);
    // 09:00 → 16:00 starts every 30 min = 15 slots, all for the single therapist.
    expect(slots).toHaveLength(15);
    expect(slots[0]!.therapistId).toBe('thp_1');
    expect(minutesInTz(slots[0]!.start)).toBe(9 * 60);
    expect(minutesInTz(slots[slots.length - 1]!.start)).toBe(16 * 60);
    // Ends within closing time.
    for (const s of slots) expect(minutesInTz(s.end)).toBeLessThanOrEqual(17 * 60);
  });

  it('respects the slot interval', () => {
    const slots = slotsForDate({ ...baseInput, branch: { ...branch, slotIntervalMinutes: 60 } });
    expect(slots).toHaveLength(8); // 09:00..16:00 hourly
  });

  it('respects the treatment duration and buffer', () => {
    const slots = slotsForDate({ ...baseInput, durationMin: 120, branch: { ...branch, bufferMinutes: 15 } });
    // Latest start = 17:00 - 120 - 15 = 14:45 → 09:00..14:30 every 30 min = 12
    expect(slots).toHaveLength(12);
  });

  it('blocks slots that overlap an existing booking', () => {
    const conflictStart = zonedToUtc(DATE, 11 * 60, TZ);
    const bookings: BookedInput[] = [
      { therapistId: 'thp_1', treatmentId: 'trt_a', startAt: conflictStart, endAt: new Date(conflictStart.getTime() + 60 * 60_000) },
    ];
    const slots = slotsForDate({ ...baseInput, bookings });
    const starts = slots.map((s) => minutesInTz(s.start));
    // 10:30, 11:00 and 11:30 would overlap 11:00–12:00.
    expect(starts).not.toContain(10 * 60 + 30);
    expect(starts).not.toContain(11 * 60);
    expect(starts).not.toContain(11 * 60 + 30);
    expect(starts).toContain(12 * 60);
  });

  it('filters by therapist', () => {
    const second: TherapistInput = {
      id: 'thp_2',
      name: 'Made',
      active: true,
      windows: therapist.windows,
    };
    const all = slotsForDate({ ...baseInput, therapists: [therapist, second] });
    expect(all).toHaveLength(30);
    const filtered = slotsForDate({ ...baseInput, therapists: [therapist, second], therapistId: 'thp_2' });
    expect(filtered).toHaveLength(15);
    expect(filtered.every((s) => s.therapistId === 'thp_2')).toBe(true);
  });

  it('skips inactive therapists', () => {
    const slots = slotsForDate({ ...baseInput, therapists: [{ ...therapist, active: false }] });
    expect(slots).toHaveLength(0);
  });

  it('returns nothing on branch-closed days', () => {
    const exceptions: ExceptionInput[] = [
      { therapistId: null, date: DATE, startTime: null, endTime: null, kind: 'closed' },
    ];
    expect(slotsForDate({ ...baseInput, exceptions })).toHaveLength(0);
  });

  it('applies special hours for the day', () => {
    const exceptions: ExceptionInput[] = [
      { therapistId: null, date: DATE, startTime: '13:00', endTime: '16:00', kind: 'special_hours' },
    ];
    const slots = slotsForDate({ ...baseInput, exceptions });
    expect(minutesInTz(slots[0]!.start)).toBe(13 * 60);
    expect(slots).toHaveLength(5); // 13:00..15:00
  });

  it('honours therapist time-off', () => {
    const exceptions: ExceptionInput[] = [
      { therapistId: 'thp_1', date: DATE, startTime: null, endTime: null, kind: 'closed' },
    ];
    expect(slotsForDate({ ...baseInput, exceptions })).toHaveLength(0);
  });

  it('enforces lead time', () => {
    // NOW is 2027-03-01T00:00Z = 08:00 local on Mar 1; booking "today" at 09:00 needs 60+ min lead.
    const today = '2027-03-01';
    const near = slotsForDate({ ...baseInput, date: today, now: new Date('2027-03-01T00:30:00Z') , branch: { ...branch, leadTimeMinutes: 120 } });
    // 08:30 local now + 120 min = 10:30 earliest.
    expect(minutesInTz(near[0]!.start)).toBe(10 * 60 + 30);
  });

  it('refuses dates beyond the advance horizon or in the past', () => {
    expect(slotsForDate({ ...baseInput, date: '2026-01-01' })).toHaveLength(0);
    expect(slotsForDate({ ...baseInput, date: '2027-09-01', branch: { ...branch, maxAdvanceDays: 30 } })).toHaveLength(0);
  });

  it('caps shared-facility treatments by capacity', () => {
    const shared = {
      ...baseInput,
      treatmentId: 'trt_sauna',
      requiresTherapist: false,
      capacity: 2,
      therapists: [] as TherapistInput[],
    };
    const start = zonedToUtc(DATE, 10 * 60, TZ);
    const bookings: BookedInput[] = [
      { therapistId: null, treatmentId: 'trt_sauna', startAt: start, endAt: new Date(start.getTime() + 60 * 60_000) },
    ];
    const free = slotsForDate(shared);
    // One of two seats held: still bookable.
    const full = slotsForDate({ ...shared, bookings });
    expect(free.map((s) => minutesInTz(s.start))).toContain(10 * 60);
    expect(full.map((s) => minutesInTz(s.start))).toContain(10 * 60);
    const atCapacity = slotsForDate({
      ...shared,
      bookings: [...bookings, { ...bookings[0]!, treatmentId: 'trt_sauna' }],
    });
    // Both seats held at 10:00 → that start disappears.
    expect(atCapacity.map((s) => minutesInTz(s.start))).not.toContain(10 * 60);
  });
});

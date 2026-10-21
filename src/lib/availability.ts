import { and, eq, gt, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { AppDb } from '@/db';
import {
  branches,
  branchTreatments,
  scheduleExceptions,
  schedules,
  therapists,
  treatments,
  bookings,
  type BranchHour,
} from '@/db/schema';
import { dateKeyInTz, minutesOf } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Timezone helpers (no external dependency)                           */
/* ------------------------------------------------------------------ */

/** Offset (ms) of `timeZone` at instant `d`: localWallClock − utcWallClock. */
export function tzOffset(d: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Convert a branch-local calendar date + minutes-after-midnight to a UTC instant. */
export function zonedToUtc(dateStr: string, minutes: number, timeZone: string): Date {
  const base = Date.parse(`${dateStr}T00:00:00Z`) + minutes * 60_000;
  const guess = base - tzOffset(new Date(base), timeZone);
  const refined = base - tzOffset(new Date(guess), timeZone);
  return new Date(refined);
}

/** Weekday (0=Sun) of a local calendar date. */
export function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/* ------------------------------------------------------------------ */
/* Pure slot generation                                                */
/* ------------------------------------------------------------------ */

export type Slot = {
  start: Date;
  end: Date;
  therapistId: string | null;
  therapistName: string | null;
};

export type BranchRules = {
  timezone: string;
  hours: BranchHour[];
  leadTimeMinutes: number;
  maxAdvanceDays: number;
  bufferMinutes: number;
  slotIntervalMinutes: number;
};

export type TherapistInput = {
  id: string;
  name: string;
  active: boolean;
  windows: { weekday: number; startTime: string; endTime: string }[];
};

export type ExceptionInput = {
  therapistId: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  kind: 'closed' | 'special_hours';
};

export type BookedInput = {
  therapistId: string | null;
  treatmentId: string;
  startAt: Date;
  endAt: Date;
};

type Window = { start: number; end: number }; // minutes after local midnight

const DEFAULT_HOURS: BranchHour = { day: 0, open: '09:00', close: '21:00', closed: false };

function intersect(a: Window, b: Window): Window | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

/** Subtract [cutStart, cutEnd) from a window — may split it in two. */
function subtract(win: Window, cutStart: number, cutEnd: number): Window[] {
  if (cutEnd <= win.start || cutStart >= win.end) return [win];
  const out: Window[] = [];
  if (cutStart > win.start) out.push({ start: win.start, end: Math.min(cutStart, win.end) });
  if (cutEnd < win.end) out.push({ start: Math.max(cutEnd, win.start), end: win.end });
  return out.filter((w) => w.end > w.start);
}

export function hoursForDay(hours: BranchHour[], weekday: number): Window | null {
  if (hours.length === 0) {
    return { start: minutesOf(DEFAULT_HOURS.open), end: minutesOf(DEFAULT_HOURS.close) };
  }
  const entry = hours.find((h) => h.day === weekday);
  if (!entry || entry.closed) return null;
  const win = { start: minutesOf(entry.open), end: minutesOf(entry.close) };
  return win.end > win.start ? win : null;
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Convert booked instants to branch-local minutes for a given local date. */
function bookedLocalMinutes(b: BookedInput, dateStr: string, tz: string) {
  const dayStartUtc = zonedToUtc(dateStr, 0, tz);
  const dayEndUtc = zonedToUtc(dateStr, 24 * 60, tz);
  if (b.endAt.getTime() <= dayStartUtc.getTime() || b.startAt.getTime() >= dayEndUtc.getTime()) {
    return null;
  }
  const startMin = Math.max(0, Math.round((b.startAt.getTime() - dayStartUtc.getTime()) / 60_000));
  const endMin = Math.min(24 * 60, Math.round((b.endAt.getTime() - dayStartUtc.getTime()) / 60_000));
  return { start: startMin, end: endMin };
}

export function slotsForDate(params: {
  branch: BranchRules;
  date: string;
  durationMin: number;
  requiresTherapist: boolean;
  capacity: number;
  therapists: TherapistInput[];
  exceptions: ExceptionInput[];
  bookings: BookedInput[];
  now: Date;
  therapistId?: string | null;
  treatmentId?: string;
}): Slot[] {
  const { branch, date, durationMin, requiresTherapist, now } = params;
  const weekday = weekdayOf(date);
  const buffer = branch.bufferMinutes;
  const interval = Math.max(5, branch.slotIntervalMinutes);
  const earliest = now.getTime() + branch.leadTimeMinutes * 60_000;
  const ageDays = Math.floor((zonedToUtc(date, 0, branch.timezone).getTime() - now.getTime()) / 86_400_000);

  // Out of booking horizon (before lead time handled per-slot; beyond horizon here).
  const todayKey = dateKeyInTz(now, branch.timezone);
  if (date < todayKey) return [];
  if (ageDays > branch.maxAdvanceDays) return [];

  /* --- Branch-level window for the day (hours + exceptions) --- */
  let dayWindow = hoursForDay(branch.hours, weekday);
  const branchExceptions = params.exceptions.filter(
    (e) => e.therapistId === null && e.date === date,
  );
  for (const ex of branchExceptions) {
    if (ex.kind === 'closed' && (!ex.startTime || !ex.endTime)) return []; // whole day off
    if (ex.kind === 'closed' && ex.startTime && ex.endTime && dayWindow) {
      const pieces = subtract(dayWindow, minutesOf(ex.startTime), minutesOf(ex.endTime));
      dayWindow = pieces[0] ?? null;
      for (let i = 1; i < pieces.length; i++) {
        // Non-contiguous closures are rare; keep only the first piece for the day window.
      }
    }
    if (ex.kind === 'special_hours' && ex.startTime && ex.endTime) {
      dayWindow = { start: minutesOf(ex.startTime), end: minutesOf(ex.endTime) };
    }
  }
  if (!dayWindow) return [];

  /* --- Candidate start minutes in a window --- */
  const candidates = (win: Window): number[] => {
    const latest = win.end - durationMin - buffer;
    const out: number[] = [];
    for (let t = win.start; t <= latest; t += interval) out.push(t);
    return out;
  };

  const activeBookings = params.bookings;
  const slots: Slot[] = [];

  if (!requiresTherapist) {
    // Shared facility treatment: branch-level slots guarded by capacity.
    for (const startMin of candidates(dayWindow)) {
      const endMin = startMin + durationMin;
      const start = zonedToUtc(date, startMin, branch.timezone);
      if (start.getTime() < earliest) continue;
      const end = zonedToUtc(date, endMin + buffer, branch.timezone);
      const concurrent = activeBookings.filter((b) => {
        if (b.therapistId !== null || b.treatmentId !== params.treatmentId) return false;
        const local = bookedLocalMinutes(b, date, branch.timezone);
        return local ? overlaps(startMin, endMin + buffer, local.start, local.end) : false;
      });
      if (concurrent.length >= params.capacity) continue;
      slots.push({ start, end, therapistId: null, therapistName: null });
    }
    return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  /* --- Therapist-anchored slots --- */
  for (const therapist of params.therapists) {
    if (!therapist.active) continue;
    if (params.therapistId && therapist.id !== params.therapistId) continue;
    const dayWindows = therapist.windows
      .filter((w) => w.weekday === weekday)
      .map((w) => ({ start: minutesOf(w.startTime), end: minutesOf(w.endTime) }))
      .map((w) => intersect(w, dayWindow!))
      .filter((w): w is Window => w !== null);
    if (dayWindows.length === 0) continue;

    // Therapist one-off exceptions for this date.
    let windows = dayWindows;
    const exs = params.exceptions.filter((e) => e.therapistId === therapist.id && e.date === date);
    for (const ex of exs) {
      if (ex.kind === 'closed' && (!ex.startTime || !ex.endTime)) {
        windows = [];
        break;
      }
      if (ex.kind === 'closed' && ex.startTime && ex.endTime) {
        const cut = { start: minutesOf(ex.startTime), end: minutesOf(ex.endTime) };
        windows = windows.flatMap((w) => subtract(w, cut.start, cut.end));
      }
      if (ex.kind === 'special_hours' && ex.startTime && ex.endTime) {
        const special = { start: minutesOf(ex.startTime), end: minutesOf(ex.endTime) };
        windows = windows.map((w) => intersect(w, special)).filter((w): w is Window => w !== null);
      }
    }

    const therapistBookings = activeBookings.filter((b) => b.therapistId === therapist.id);

    for (const win of windows) {
      for (const startMin of candidates(win)) {
        const start = zonedToUtc(date, startMin, branch.timezone);
        if (start.getTime() < earliest) continue;
        const endLocal = startMin + durationMin + buffer;
        const end = zonedToUtc(date, endLocal, branch.timezone);
        const clash = therapistBookings.some((b) => {
          const local = bookedLocalMinutes(b, date, branch.timezone);
          return local ? overlaps(startMin, endLocal, local.start, local.end) : false;
        });
        if (clash) continue;
        slots.push({
          start,
          end,
          therapistId: therapist.id,
          therapistName: therapist.name,
        });
      }
    }
  }

  // Sort by time, then therapist name for stable rendering.
  slots.sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      (a.therapistName ?? '').localeCompare(b.therapistName ?? ''),
  );
  // De-duplicate exact (start, therapist) pairs produced by overlapping windows.
  const seen = new Set<string>();
  return slots.filter((s) => {
    const key = `${s.start.getTime()}:${s.therapistId ?? '-'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* DB-backed availability                                              */
/* ------------------------------------------------------------------ */

export type AvailabilityArgs = {
  branchId: string;
  treatmentId: string;
  therapistId?: string | null;
  /** First branch-local date (YYYY-MM-DD). Defaults to today in branch tz. */
  from?: string;
  /** Number of days to generate (default 7, max 62). */
  days?: number;
  now?: Date;
};

export type DayAvailability = { date: string; slots: Slot[] };

export async function getAvailability(
  db: AppDb,
  args: AvailabilityArgs,
): Promise<{ ok: true; days: DayAvailability[] } | { ok: false; error: string }> {
  const branch = await db.query.branches.findFirst({
    where: eq(branches.id, args.branchId),
    columns: {
      id: true,
      timezone: true,
      hours: true,
      leadTimeMinutes: true,
      maxAdvanceDays: true,
      bufferMinutes: true,
      slotIntervalMinutes: true,
      status: true,
      providerId: true,
    },
  });
  if (!branch) return { ok: false, error: 'Branch not found.' };
  if (branch.status !== 'active') return { ok: false, error: 'This branch is not accepting bookings.' };

  const branchTreatment = await db.query.branchTreatments.findFirst({
    where: and(eq(branchTreatments.branchId, branch.id), eq(branchTreatments.treatmentId, args.treatmentId)),
  });
  if (!branchTreatment || !branchTreatment.active)
    return { ok: false, error: 'This treatment is not offered at the selected branch.' };

  const treatment = await db.query.treatments.findFirst({
    where: eq(treatments.id, args.treatmentId),
  });
  if (!treatment || treatment.status !== 'active')
    return { ok: false, error: 'This treatment is currently unavailable.' };

  const now = args.now ?? new Date();
  const days = Math.min(Math.max(args.days ?? 7, 1), 62);
  const from = args.from ?? dateKeyInTz(now, branch.timezone);
  const toDate = new Date(`${from}T12:00:00Z`);
  toDate.setUTCDate(toDate.getUTCDate() + days - 1);
  const to = toDate.toISOString().slice(0, 10);

  const rangeStart = zonedToUtc(from, 0, branch.timezone);
  const rangeEnd = zonedToUtc(to, 24 * 60, branch.timezone);

  const [therapistRows, exceptionRows, bookedRows] = await Promise.all([
    db.query.therapists.findMany({
      where: and(eq(therapists.branchId, branch.id), eq(therapists.role, 'therapist')),
      columns: { id: true, name: true, active: true },
    }),
    db.query.scheduleExceptions.findMany({
      where: and(
        eq(scheduleExceptions.branchId, branch.id),
        gte(scheduleExceptions.date, from),
        lt(scheduleExceptions.date, to),
      ),
      columns: {
        therapistId: true,
        date: true,
        startTime: true,
        endTime: true,
        kind: true,
      },
    }),
    db.query.bookings.findMany({
      where: and(
        or(
          and(gte(bookings.startAt, rangeStart), lt(bookings.startAt, rangeEnd)),
          and(gt(bookings.endAt, rangeStart), lt(bookings.endAt, rangeEnd)),
          and(lt(bookings.startAt, rangeStart), gt(bookings.endAt, rangeEnd)),
        ),
        sql`${bookings.status} IN ('pending','confirmed')`,
        eq(bookings.branchId, branch.id),
      ),
      columns: { therapistId: true, treatmentId: true, startAt: true, endAt: true },
    }),
  ]);

  // Expire stale unpaid holds so their slots come back.
  // (Handled by releaseExpiredHolds in booking.ts — called from routes.)

  const therapistInputs: TherapistInput[] = await (async () => {
    const ids = therapistRows.map((t) => t.id);
    const windows = ids.length
      ? await db.query.schedules.findMany({
          where: inArray(schedules.therapistId, ids),
          columns: { therapistId: true, weekday: true, startTime: true, endTime: true },
        })
      : [];
    return therapistRows.map((t) => ({
      id: t.id,
      name: t.name,
      active: t.active,
      windows: windows
        .filter((w) => w.therapistId === t.id)
        .map((w) => ({ weekday: w.weekday, startTime: w.startTime, endTime: w.endTime })),
    }));
  })();

  const rules: BranchRules = {
    timezone: branch.timezone,
    hours: branch.hours,
    leadTimeMinutes: branch.leadTimeMinutes,
    maxAdvanceDays: branch.maxAdvanceDays,
    bufferMinutes: branch.bufferMinutes,
    slotIntervalMinutes: branch.slotIntervalMinutes,
  };

  const dayList: DayAvailability[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  for (let i = 0; i < days; i++) {
    const dateStr = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    dayList.push({
      date: dateStr,
      slots: slotsForDate({
        branch: rules,
        date: dateStr,
        durationMin: treatment.durationMin,
        requiresTherapist: treatment.requiresTherapist,
        capacity: treatment.capacity,
        therapists: therapistInputs,
        exceptions: exceptionRows,
        bookings: bookedRows,
        now,
        therapistId: args.therapistId ?? null,
        treatmentId: treatment.id,
      }),
    });
  }

  return { ok: true, days: dayList };
}

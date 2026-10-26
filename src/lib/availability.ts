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
import { pickPriceOption } from '@/lib/pricing';

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
  /** Guests occupying shared-facility capacity (defaults to 1). */
  guestCount?: number;
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
  /** Guests this booking needs in a shared facility (default 1). */
  persons?: number;
  /** Therapists that must work this slot together (couples / four-hand). */
  therapistsPerBooking?: number;
}): Slot[] {
  const { branch, date, durationMin, requiresTherapist, now } = params;
  const per = Math.max(1, Math.min(params.therapistsPerBooking ?? 1, 4));
  const persons = Math.max(1, params.persons ?? 1);
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
      const concurrent = activeBookings.reduce((used, b) => {
        if (b.therapistId !== null || b.treatmentId !== params.treatmentId) return used;
        const local = bookedLocalMinutes(b, date, branch.timezone);
        if (!local || !overlaps(startMin, endMin + buffer, local.start, local.end)) return used;
        return used + Math.max(1, b.guestCount ?? 1);
      }, 0);
      if (concurrent + persons > params.capacity) continue;
      slots.push({ start, end, therapistId: null, therapistName: null });
    }
    return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  /* --- Therapist-anchored slots --- */
  for (const therapist of params.therapists) {
    if (!therapist.active) continue;
    // Multi-therapist treatments need every candidate enumerated so a whole
    // team can be proven free; the customer's preferred pick is filtered last.
    if (per === 1 && params.therapistId && therapist.id !== params.therapistId) continue;
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
  const unique = slots.filter((s) => {
    const key = `${s.start.getTime()}:${s.therapistId ?? '-'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (per <= 1) {
    if (!params.therapistId) return unique;
    return unique.filter((s) => s.therapistId === params.therapistId);
  }

  /* Couples / four-hand: a start only exists when a full team is free. */
  const teamAt = new Map<number, Set<string>>();
  for (const s of unique) {
    if (!s.therapistId) continue;
    const team = teamAt.get(s.start.getTime()) ?? new Set<string>();
    team.add(s.therapistId);
    teamAt.set(s.start.getTime(), team);
  }
  const teamFree = unique.filter((s) => (teamAt.get(s.start.getTime())?.size ?? 0) >= per);
  if (!params.therapistId) return teamFree;
  return teamFree.filter((s) => s.therapistId === params.therapistId);
}

/* ------------------------------------------------------------------ */
/* DB-backed availability                                              */
/* ------------------------------------------------------------------ */export type AvailabilityArgs = {
  branchId: string;
  treatmentId: string;
  therapistId?: string | null;
  /** Index into the treatment's price options — selects which duration tier
   * slots are generated for (invalid/absent → the treatment default). */
  optionIndex?: number | null;
  /** Guests this booking needs in a shared facility (default 1). */
  persons?: number;
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

  // Slots must be as long as the chosen duration tier, not just the default.
  const chosenOption = pickPriceOption(treatment.priceOptions, args.optionIndex);
  const durationMin = chosenOption?.durationMin ?? treatment.durationMin;
  // Shared-facility capacity can differ per duration tier.
  const capacity = chosenOption?.capacity ?? treatment.capacity;
  const persons = Math.max(1, Math.min(args.persons ?? 1, 12));

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
      columns: { therapistId: true, treatmentId: true, startAt: true, endAt: true, guestCount: true },
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
        durationMin,
        requiresTherapist: treatment.requiresTherapist,
        capacity,
        therapists: therapistInputs,
        exceptions: exceptionRows,
        bookings: bookedRows,
        now,
        therapistId: args.therapistId ?? null,
        treatmentId: treatment.id,
        persons,
        therapistsPerBooking: treatment.therapistsPerBooking ?? 1,
      }),
    });
  }

  return { ok: true, days: dayList };
}

/* ------------------------------------------------------------------ */
/* "Together" availability — several treatments, one shared start time */
/* ------------------------------------------------------------------ */

export type TogetherItem = {
  treatmentId: string;
  optionIndex?: number | null;
  persons?: number;
  therapistId?: string | null;
};

export type TogetherAssignment = {
  itemIndex: number;
  therapistId: string | null;
  therapistName: string | null;
};

export type TogetherSlot = {
  start: Date;
  end: Date;
  assignments: TogetherAssignment[];
};

export type TogetherDay = { date: string; slots: TogetherSlot[] };

/**
 * Slots where EVERY requested treatment can start at the same instant, with a
 * conflict-free therapist assignment (no therapist serves two treatments at
 * once). Returns the intersection per day.
 */
export async function getTogetherAvailability(
  db: AppDb,
  args: {
    branchId: string;
    items: TogetherItem[];
    from?: string;
    days?: number;
    now?: Date;
  },
): Promise<{ ok: true; days: TogetherDay[] } | { ok: false; error: string }> {
  if (args.items.length === 0) return { ok: false, error: 'Add at least one treatment.' };
  if (args.items.length > 8)
    return { ok: false, error: 'A single booking can hold up to 8 treatments.' };

  const perItem: { ok: true; days: DayAvailability[] }[] = [];
  const treatmentRows = await db.query.treatments.findMany({
    where: inArray(treatments.id, [...new Set(args.items.map((i) => i.treatmentId))]),
    columns: { id: true, requiresTherapist: true, therapistsPerBooking: true },
  });
  /** Therapists this item seats at once (0 = shared-facility treatment). */
  const teamSize = args.items.map((item) => {
    const t = treatmentRows.find((r) => r.id === item.treatmentId);
    if (!t?.requiresTherapist) return 0;
    return Math.max(1, Math.min(t.therapistsPerBooking ?? 1, 4));
  });

  for (let i = 0; i < args.items.length; i++) {
    const item = args.items[i]!;
    const res = await getAvailability(db, {
      branchId: args.branchId,
      treatmentId: item.treatmentId,
      optionIndex: item.optionIndex ?? null,
      // Multi-therapist items list every free therapist so a whole team can be
      // seated; the customer's preferred pick is applied when choosing them.
      therapistId: (teamSize[i] ?? 1) > 1 ? null : item.therapistId ?? null,
      persons: item.persons ?? 1,
      from: args.from,
      days: args.days,
      now: args.now,
    });
    if (!res.ok) return res;
    perItem.push(res);
  }

  const dates = perItem[0]!.days.map((d) => d.date);
  const days: TogetherDay[] = dates.map((date, dayIdx) => {
    const slotsPerItem = perItem.map((r) => r.days[dayIdx]?.slots ?? []);

    // Candidate start instants present in EVERY item's day.
    const first = slotsPerItem[0] ?? [];
    const common = first
      .map((s) => s.start.getTime())
      .filter((t) => slotsPerItem.every((slots) => slots.some((s) => s.start.getTime() === t)));

    const out: TogetherSlot[] = [];
    for (const startMs of [...new Set(common)].sort((a, b) => a - b)) {
      const chosen = slotsPerItem.map((slots, i) => {
        const atStart = slots.filter((s) => s.start.getTime() === startMs);
        // Try the customer's preferred therapist first when picking a team.
        const pref = args.items[i]?.therapistId;
        if (!pref) return atStart;
        return [
          ...atStart.filter((s) => s.therapistId === pref),
          ...atStart.filter((s) => s.therapistId !== pref),
        ];
      });

      // Therapist-requiring items must get distinct therapists at this instant.
      // (Slots with a null therapist belong to shared-facility treatments.)
      const needsTherapist = chosen.map((c) => c.some((s) => s.therapistId !== null));
      const assignment: (Slot | null)[] = new Array(chosen.length).fill(null);
      const assign = (i: number, used: Set<string>): boolean => {
        if (i >= chosen.length) return true;
        if (!needsTherapist[i]) {
          assignment[i] = chosen[i]![0] ?? null;
          return assign(i + 1, used);
        }
        // A couples treatment seats `teamSize[i]` distinct therapists here.
        const need = Math.max(1, teamSize[i] ?? 1);
        const team: Slot[] = [];
        const seat = (from: number): boolean => {
          if (team.length === need) {
            for (const s of team) used.add(s.therapistId!);
            assignment[i] = team[0]!;
            if (assign(i + 1, used)) return true;
            for (const s of team) used.delete(s.therapistId!);
            return false;
          }
          for (let k = from; k < chosen[i]!.length; k++) {
            const cand = chosen[i]![k]!;
            if (!cand.therapistId || used.has(cand.therapistId)) continue;
            if (team.some((s) => s.therapistId === cand.therapistId)) continue;
            team.push(cand);
            if (seat(k + 1)) return true;
            team.pop();
          }
          return false;
        };
        return seat(0);
      };
      if (!assign(0, new Set())) continue;

      out.push({
        start: new Date(startMs),
        end: new Date(Math.max(...assignment.map((s, i) => (s ? s.end.getTime() : chosen[i]![0]!.end.getTime())))),
        assignments: assignment.map((s, i) => ({
          itemIndex: i,
          therapistId: s?.therapistId ?? null,
          therapistName: s?.therapistName ?? null,
        })),
      });
    }

    return { date, slots: out };
  });

  return { ok: true, days };
}

import { randomUUID } from 'node:crypto';

/** Merge conditional class names without pulling in a helper library. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Prefixed, URL-safe id: bkg_9f2c1a7d4b8e3f51 */
export function newId(prefix: string): string {
  const raw = randomUUID().replace(/-/g, '').slice(0, 16);
  return `${prefix}_${raw}`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Unguessable human voucher code: BYS-4F7K2Q */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newVoucherCode(): string {
  let out = '';
  const bytes = randomUUID();
  for (let i = 0; i < 6; i++) {
    const idx = bytes.charCodeAt(i * 2 + 1) % CODE_ALPHABET.length;
    out += CODE_ALPHABET[idx];
  }
  return `BYS-${out}`;
}

export function uniqueSlug(base: string, existing: Set<string>): string {
  let candidate = slugify(base) || 'item';
  let i = 2;
  while (existing.has(candidate)) candidate = `${slugify(base)}-${i++}`;
  return candidate;
}

/* ------------------------------- time ------------------------------ */

export function dateKeyInTz(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date); // YYYY-MM-DD
}

export function partsInTz(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: weekdayMap[parts.weekday] ?? 0,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Minutes since midnight for a "HH:MM" string. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((v) => parseInt(v, 10));
  return h * 60 + (m || 0);
}

export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isValidTime(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/* ---------------------------- formatting --------------------------- */

export function formatDate(date: Date | string, timeZone?: string, opts?: Intl.DateTimeFormatOptions): string {
  // Date-only strings are calendar dates: anchor to UTC noon so local timezones can't shift the day.
  const d =
    typeof date === 'string' ? new Date(date.length === 10 ? `${date}T12:00:00Z` : date) : date;
  // dateStyle/timeStyle conflict with explicit day/month/year fields — emit only one family.
  const hasStyle = Boolean(opts?.dateStyle || opts?.timeStyle);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    ...(hasStyle ? {} : { day: 'numeric', month: 'short', year: 'numeric' }),
    ...opts,
  }).format(d);
}

export function formatDateTime(date: Date | string, timeZone?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatTime(date: Date | string, timeZone?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(d);
}

export function titleCase(input: string): string {
  return input
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

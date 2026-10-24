import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getTogetherAvailability } from '@/lib/availability';
import { releaseExpiredHolds } from '@/lib/booking';
import { clientIpOf, jsonError, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

const itemSchema = {
  treatmentId: (v: unknown) => typeof v === 'string' && v.length > 0,
  optionIndex: (v: unknown) => v === undefined || v === null || (Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 9),
  persons: (v: unknown) => v === undefined || v === null || (Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 8),
  therapistId: (v: unknown) => v === undefined || v === null || typeof v === 'string',
};

/**
 * POST /api/availability/together — start times where EVERY treatment in a
 * cart can begin simultaneously, with distinct therapists per treatment.
 * Public (slots are not secret); lightly rate limited.
 */
export async function POST(req: Request) {
  const ip = clientIpOf(req);
  const limited = rateLimit(`avail:${ip}`, 120, 60_000);
  if (!limited.ok) return jsonError('Too many requests.', 429, { retryAfter: limited.retryAfterSec });

  const body = (await req.json().catch(() => null)) as {
    branchId?: unknown;
    items?: unknown;
    from?: unknown;
    days?: unknown;
  } | null;
  if (!body || typeof body.branchId !== 'string' || !body.branchId)
    return jsonError('branchId is required.');
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 8)
    return jsonError('items must be an array of 1–8 treatments.');
  if (body.from !== undefined && body.from !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.from)))
    return jsonError('from must be YYYY-MM-DD.');

  const days = Number(body.days ?? 7);
  if (!Number.isFinite(days) || days < 1 || days > 62) return jsonError('days must be between 1 and 62.');

  const items: {
    treatmentId: string;
    optionIndex: number | null;
    persons: number;
    therapistId: string | null;
  }[] = [];
  for (const raw of body.items as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') return jsonError('Invalid item.');
    for (const [key, validate] of Object.entries(itemSchema)) {
      if (!validate(raw[key])) return jsonError(`Invalid ${key} for one of the treatments.`);
    }
    items.push({
      treatmentId: String(raw.treatmentId),
      optionIndex: raw.optionIndex == null ? null : Number(raw.optionIndex),
      persons: raw.persons == null ? 1 : Number(raw.persons),
      therapistId: raw.therapistId == null ? null : String(raw.therapistId),
    });
  }

  const db = await getDb();
  await releaseExpiredHolds(db, body.branchId).catch(() => 0);

  const result = await getTogetherAvailability(db, {
    branchId: body.branchId,
    items,
    from: typeof body.from === 'string' ? body.from : undefined,
    days,
  });

  if (!result.ok) return jsonError(result.error, 400);

  return NextResponse.json(
    {
      ok: true,
      days: result.days.map((d) => ({
        date: d.date,
        count: d.slots.length,
        slots: d.slots.slice(0, 120).map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          therapists: s.assignments.map((a) => ({
            itemIndex: a.itemIndex,
            therapistId: a.therapistId,
            therapistName: a.therapistName,
          })),
        })),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
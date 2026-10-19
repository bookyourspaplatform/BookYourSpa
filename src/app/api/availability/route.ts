import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getAvailability } from '@/lib/availability';
import { releaseExpiredHolds } from '@/lib/booking';
import { clientIpOf, jsonError, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/availability?branchId=…&treatmentId=…&therapistId?=…&from=YYYY-MM-DD&days=7
 * Public endpoint (slots are not secret); lightly rate limited.
 */
export async function GET(req: Request) {
  const ip = clientIpOf(req);
  const limited = rateLimit(`avail:${ip}`, 120, 60_000);
  if (!limited.ok) return jsonError('Too many requests.', 429, { retryAfter: limited.retryAfterSec });

  const url = new URL(req.url);
  const branchId = url.searchParams.get('branchId');
  const treatmentId = url.searchParams.get('treatmentId');
  const therapistId = url.searchParams.get('therapistId');
  const from = url.searchParams.get('from');
  const days = Number(url.searchParams.get('days') ?? '7');

  if (!branchId || !treatmentId) return jsonError('branchId and treatmentId are required.');
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return jsonError('from must be YYYY-MM-DD.');
  if (!Number.isFinite(days) || days < 1 || days > 62) return jsonError('days must be between 1 and 62.');

  const db = await getDb();

  // Free up abandoned holds so their slots reappear.
  await releaseExpiredHolds(db, branchId).catch(() => 0);

  const result = await getAvailability(db, {
    branchId,
    treatmentId,
    therapistId: therapistId || null,
    from: from ?? undefined,
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
          therapistId: s.therapistId,
          therapistName: s.therapistName,
        })),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

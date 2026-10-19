import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { agents } from '@/db/schema';
import { BookingError, quoteBooking } from '@/lib/booking';
import { getSession } from '@/lib/auth/session';
import { assertSameOrigin, clientIpOf, jsonError, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

const schema = z.object({
  branchId: z.string().min(1),
  treatmentId: z.string().min(1),
  couponCode: z.string().trim().max(40).optional().nullable(),
});

/**
 * POST /api/quote — prices a potential booking.
 * Agent net rates/commission are resolved from the session only, never from
 * the request body.
 */
export async function POST(req: Request) {
  const origin = assertSameOrigin(req);
  if (!origin.ok) return origin.response;

  const ip = clientIpOf(req);
  const limited = rateLimit(`quote:${ip}`, 60, 60_000);
  if (!limited.ok) return jsonError('Too many requests.', 429);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError('Invalid request.');

  const session = await getSession();
  const db = await getDb();

  let agentId: string | null = null;
  if (session?.role === 'agent') {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.userId, session.sub),
      columns: { id: true, status: true },
    });
    if (agent?.status === 'approved') agentId = agent.id;
  }

  try {
    const quote = await quoteBooking(db, {
      branchId: parsed.data.branchId,
      treatmentId: parsed.data.treatmentId,
      couponCode: parsed.data.couponCode || null,
      agentId,
    });
    return NextResponse.json({ ok: true, quote }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof BookingError) return jsonError(err.message, err.code === 'not_found' ? 404 : 400);
    console.error('[quote] failed', err);
    return jsonError('Could not price this booking.', 500);
  }
}

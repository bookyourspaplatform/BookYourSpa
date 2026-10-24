import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { agents } from '@/db/schema';
import { BookingError, quoteBooking, quoteCart } from '@/lib/booking';
import { getSession } from '@/lib/auth/session';
import { assertSameOrigin, clientIpOf, jsonError, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';

const itemSchema = z.object({
  treatmentId: z.string().min(1),
  /** Index into the treatment's price options (60/90/120-min tiers). */
  optionIndex: z.number().int().min(0).max(9).optional(),
  /** Guests for this line (1–8) — priced per person. */
  persons: z.number().int().min(1).max(8).optional(),
});

const productSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
});

const schema = z
  .object({
    branchId: z.string().min(1),
    /** Legacy single-treatment shape. */
    treatmentId: z.string().min(1).optional(),
    optionIndex: z.number().int().min(0).max(9).optional(),
    /** Multi-treatment cart shape — wins over the legacy fields. */
    items: z.array(itemSchema).min(1).max(8).optional(),
    products: z.array(productSchema).max(20).optional(),
    couponCode: z.string().trim().max(40).optional().nullable(),
  })
  .refine((d) => Boolean(d.items?.length || d.treatmentId), {
    message: 'treatmentId or items is required.',
  });

/**
 * POST /api/quote — prices a potential booking (single treatment or a cart).
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

  const { branchId, couponCode, items, products, treatmentId, optionIndex } = parsed.data;

  try {
    const quote =
      items && items.length > 0
        ? await quoteCart(db, {
            branchId,
            items,
            products,
            couponCode: couponCode || null,
            agentId,
          })
        : await quoteBooking(db, {
            branchId,
            treatmentId: treatmentId!,
            optionIndex: optionIndex ?? null,
            couponCode: couponCode || null,
            agentId,
          });
    return NextResponse.json({ ok: true, quote }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof BookingError) return jsonError(err.message, err.code === 'not_found' ? 404 : 400);
    console.error('[quote] failed', err);
    return jsonError('Could not price this booking.', 500);
  }
}
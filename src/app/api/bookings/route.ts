import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { agents, branches, payments, treatments } from '@/db/schema';
import { BookingError, createBookingGroup, type CreateGroupItem } from '@/lib/booking';
import { getSession } from '@/lib/auth/session';
import { getSettings } from '@/lib/settings';
import { appUrl } from '@/lib/seo';
import { enabledGatewaysForBranch, type CheckoutInput } from '@/lib/payments';
import { emailVoucherForBooking } from '@/lib/payments';
import { logAudit } from '@/lib/audit';
import { assertSameOrigin, clientIpOf, jsonError, rateLimit } from '@/lib/security';
import { newId } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const itemSchema = z.object({
  treatmentId: z.string().min(1),
  optionIndex: z.number().int().min(0).max(9).optional(),
  persons: z.number().int().min(1).max(8).optional(),
  startAt: z.string().datetime({ offset: true }),
  therapistId: z.string().min(1).nullable().optional(),
});

const schema = z
  .object({
    branchId: z.string().min(1),
    /** Legacy single-treatment shape. */
    treatmentId: z.string().min(1).optional(),
    optionIndex: z.number().int().min(0).max(9).optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    therapistId: z.string().min(1).nullable().optional(),
    /** Multi-treatment cart shape — wins over the legacy fields. */
    items: z.array(itemSchema).min(1).max(8).optional(),
    products: z
      .array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
      .max(20)
      .optional(),
    customer: z.object({
      name: z.string().trim().min(2, 'Enter the guest name.').max(80),
      email: z.email('Enter a valid email address.'),
      phone: z.string().trim().max(30).optional().nullable(),
    }),
    couponCode: z.string().trim().max(40).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
    paymentMode: z.enum(['venue', 'online']),
    gateway: z.enum(['stripe', 'paypal', 'razorpay']).optional(),
  })
  .refine((d) => Boolean(d.items?.length || (d.treatmentId && d.startAt)), {
    message: 'treatmentId + startAt or items is required.',
  });

/**
 * POST /api/bookings — creates a reservation (single treatment or a whole
 * cart, as one booking group) and either
 *   • confirms it for pay-at-venue, or
 *   • returns a hosted-checkout URL for online payment.
 */
export async function POST(req: Request) {
  const origin = assertSameOrigin(req);
  if (!origin.ok) return origin.response;

  const ip = clientIpOf(req);
  const limited = rateLimit(`book:${ip}`, 10, 5 * 60_000);
  if (!limited.ok)
    return jsonError('Too many booking attempts — please wait a few minutes.', 429, { retryAfter: limited.retryAfterSec });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return jsonError(issue ? issue.message : 'Invalid booking request.', 422);
  }
  const input = parsed.data;

  // Normalise legacy single-treatment bodies into the cart shape.
  const items: CreateGroupItem[] = (
    input.items?.length
      ? input.items
      : [
          {
            treatmentId: input.treatmentId!,
            optionIndex: input.optionIndex,
            startAt: input.startAt!,
            therapistId: input.therapistId ?? null,
          },
        ]
  ).map((i) => ({
    treatmentId: i.treatmentId,
    optionIndex: (i as { optionIndex?: number | null }).optionIndex ?? null,
    persons: (i as { persons?: number }).persons ?? 1,
    startAt: new Date(i.startAt),
    therapistId: (i as { therapistId?: string | null }).therapistId ?? null,
  }));

  const session = await getSession();
  const settings = await getSettings();
  const db = await getDb();

  // Promotions and promo codes are a registered-customer benefit.
  if (input.couponCode?.trim() && !session) {
    return jsonError('Promo codes are for registered customers — please sign in to use one.', 403);
  }

  /* --- who is booking --- */
  let customerId: string | null = null;
  let agentId: string | null = null;
  let channel: 'direct' | 'agent' | 'admin' = 'direct';

  if (session?.role === 'customer') customerId = session.sub;
  if (session?.role === 'agent') {
    const agent = await db.query.agents.findFirst({ where: eq(agents.userId, session.sub) });
    if (agent && agent.status === 'approved') {
      agentId = agent.id;
      channel = 'agent';
    }
  }
  if (session?.role === 'super_admin') channel = 'admin';
  if (!session && !settings['features.guestCheckout']) {
    return jsonError('Guest checkout is disabled — please sign in.', 403);
  }

  try {
    const { primary, bookings: groupRows, quote } = await createBookingGroup(db, {
      branchId: input.branchId,
      items,
      products: input.products,
      customer: { name: input.customer.name, email: input.customer.email, phone: input.customer.phone ?? null },
      customerId,
      agentId,
      couponCode: input.couponCode ?? null,
      notes: input.notes ?? null,
      channel,
      paymentMode: input.paymentMode,
    });

    await logAudit({
      actorId: session?.sub ?? null,
      actorRole: session?.role ?? null,
      action: 'booking.created',
      entity: 'booking',
      entityId: primary.id,
      ip,
      meta: {
        channel,
        paymentMode: input.paymentMode,
        total: quote.pricing.total,
        currency: quote.currency,
        lines: items.length,
        products: input.products?.length ?? 0,
      },
    });

    const base = await appUrl('');
    const firstLine = quote.lines[0];

    /* --- pay at the venue --- */
    if (input.paymentMode === 'venue') {
      if (!quote.payment.venue) {
        return jsonError('This branch does not accept pay-at-venue for online reservations.', 400);
      }
      await emailVoucherForBooking(primary);
      return NextResponse.json({
        ok: true,
        booking: { id: primary.id, code: primary.code },
        bookings: groupRows.map((b) => ({ id: b.id, code: b.code })),
        payment: { type: 'venue' },
        voucherUrl: `${base}/voucher/${primary.code}`,
      });
    }

    /* --- online checkout --- */
    if (!quote.payment.online) {
      return jsonError('Online payment is not available at this branch.', 400);
    }
    const branchRow = await db.query.branches.findFirst({ where: eq(branches.id, quote.branch.id) });
    if (!branchRow) return jsonError('Branch not found.', 404);
    const branch = branchRow;

    const allowed = await enabledGatewaysForBranch(branch);
    const gateway = input.gateway ? allowed.find((g) => g.name === input.gateway) : allowed[0];
    if (!gateway) {
      return jsonError(
        `Online payment via ${input.gateway ?? 'the selected method'} is not available — choose pay at venue.`,
        400,
      );
    }

    const treatmentRow = await db.query.treatments.findFirst({
      where: eq(treatments.id, firstLine!.treatmentId),
    });
    if (!treatmentRow) return jsonError('Treatment not found.', 404);

    const checkoutInput: CheckoutInput = {
      booking: primary,
      branch,
      treatment: treatmentRow,
      amountMinor: quote.pricing.dueNow,
      currency: quote.currency,
      baseUrl: base,
      successUrl: `${base}/voucher/${primary.code}`,
      cancelUrl: `${base}/spas/${quote.branch.providerSlug}/${quote.branch.slug}/book?treatment=${firstLine!.treatmentId}&cancelled=1`,
      customerEmail: primary.guestEmail,
    };

    const checkout = await gateway.createCheckout(checkoutInput);

    await db.insert(payments).values({
      id: newId('pay'),
      bookingId: primary.id,
      gateway: gateway.name,
      status: 'pending',
      // Only the deposit is collected now; the balance is settled at the spa.
      amount: quote.pricing.dueNow,
      currency: quote.currency,
      externalId: checkout.externalId,
      clientSecret: checkout.clientSecret ?? null,
      payerEmail: primary.guestEmail,
    });

    return NextResponse.json({
      ok: true,
      booking: { id: primary.id, code: primary.code },
      bookings: groupRows.map((b) => ({ id: b.id, code: b.code })),
      payment: { type: 'redirect', gateway: gateway.name, checkoutUrl: checkout.url },
    });
  } catch (err) {
    if (err instanceof BookingError) {
      const status =
        err.code === 'conflict' ? 409 : err.code === 'not_found' ? 404 : err.code === 'coupon' ? 422 : 400;
      return jsonError(err.message, status, { code: err.code, field: err.field });
    }
    console.error('[bookings] unexpected failure', err);
    return jsonError('Could not complete the booking. Please try again.', 500);
  }
}
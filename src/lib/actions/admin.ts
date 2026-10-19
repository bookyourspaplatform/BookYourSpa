'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type AppDb } from '@/db';
import {
  agents,
  bookings,
  commissions,
  coupons,
  pages,
  promotions,
  providers,
  settings,
  TREATMENT_CATEGORIES,
  PROMO_POSITIONS,
} from '@/db/schema';
import { requireUser } from '@/lib/auth/session';
import { cancelBooking, BookingError } from '@/lib/booking';
import { logAudit } from '@/lib/audit';
import { newId, slugify } from '@/lib/utils';
import { DEFAULT_SETTINGS, type SettingKey } from '@/lib/settings';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const fail = (error: string): ActionResult<never> => ({ ok: false, error });

async function adminCtx() {
  const user = await requireUser(['super_admin']);
  const db = await getDb();
  return { user, db };
}

function revalidateAdmin() {
  revalidatePath('/admin');
}

/* ---------------------------- approvals ----------------------------- */

export async function setProviderStatus(id: string, status: 'approved' | 'suspended' | 'pending'): Promise<ActionResult> {
  try {
    const { user, db } = await adminCtx();
    const row = await db.query.providers.findFirst({ where: eq(providers.id, id) });
    if (!row) return fail('Provider not found.');
    await db
      .update(providers)
      .set({ status, approvedAt: status === 'approved' ? new Date() : row.approvedAt, updatedAt: new Date() })
      .where(eq(providers.id, id));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.provider_status', entity: 'provider', entityId: id, meta: { status } });
    revalidateAdmin();
    revalidatePath('/spas');
    return { ok: true };
  } catch {
    return fail('Could not update the provider.');
  }
}

export async function setAgentStatus(id: string, status: 'approved' | 'suspended' | 'pending'): Promise<ActionResult> {
  try {
    const { user, db } = await adminCtx();
    const row = await db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!row) return fail('Agent not found.');
    await db
      .update(agents)
      .set({ status, approvedAt: status === 'approved' ? new Date() : row.approvedAt, updatedAt: new Date() })
      .where(eq(agents.id, id));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.agent_status', entity: 'agent', entityId: id, meta: { status } });
    revalidateAdmin();
    return { ok: true };
  } catch {
    return fail('Could not update the agent.');
  }
}

export async function setAgentCommission(id: string, commissionBps: number): Promise<ActionResult> {
  try {
    if (!Number.isFinite(commissionBps) || commissionBps < 0 || commissionBps > 10000)
      return fail('Commission must be between 0 and 100%.');
    const { user, db } = await adminCtx();
    await db.update(agents).set({ commissionBps: Math.round(commissionBps), updatedAt: new Date() }).where(eq(agents.id, id));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.agent_commission', entity: 'agent', entityId: id, meta: { commissionBps } });
    revalidateAdmin();
    return { ok: true };
  } catch {
    return fail('Could not update commission.');
  }
}

/* ----------------------------- bookings ----------------------------- */

export async function adminBookingAction(
  bookingId: string,
  action: 'confirm' | 'complete' | 'noshow' | 'cancel',
): Promise<ActionResult> {
  try {
    const { user, db } = await adminCtx();
    const booking = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
    if (!booking) return fail('Booking not found.');

    if (action === 'cancel') {
      await cancelBooking(db, bookingId, { actorRole: 'super_admin', reason: 'Cancelled by platform admin' });
    } else {
      const next = action === 'confirm' ? 'confirmed' : action === 'complete' ? 'completed' : 'no_show';
      if (['cancelled', 'completed', 'no_show'].includes(booking.status)) return fail('This booking can no longer be changed.');
      await db.update(bookings).set({ status: next, updatedAt: new Date() }).where(eq(bookings.id, bookingId));
    }
    await logAudit({ actorId: user.id, actorRole: user.role, action: `admin.booking_${action}`, entity: 'booking', entityId: bookingId });
    revalidateAdmin();
    return { ok: true };
  } catch (err) {
    return fail(err instanceof BookingError ? err.message : 'Could not update the booking.');
  }
}

/* --------------------------- commissions ---------------------------- */

export async function setCommissionStatus(id: string, status: 'pending' | 'approved' | 'paid'): Promise<ActionResult> {
  try {
    const { user, db } = await adminCtx();
    const row = await db.query.commissions.findFirst({ where: eq(commissions.id, id) });
    if (!row) return fail('Commission not found.');
    await db
      .update(commissions)
      .set({ status, paidAt: status === 'paid' ? new Date() : row.paidAt })
      .where(eq(commissions.id, id));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.commission_status', entity: 'commission', entityId: id, meta: { status } });
    revalidateAdmin();
    return { ok: true };
  } catch {
    return fail('Could not update the commission.');
  }
}

/* ------------------------------ settings ---------------------------- */

const settingSchema = z.record(z.string(), z.unknown());

export async function saveSettings(values: Record<string, unknown>): Promise<ActionResult> {
  try {
    const parsed = settingSchema.safeParse(values);
    if (!parsed.success) return fail('Invalid settings payload.');
    const { user, db } = await adminCtx();

    for (const [key, value] of Object.entries(parsed.data)) {
      if (!(key in DEFAULT_SETTINGS)) continue; // only known keys
      const typed = value as (typeof DEFAULT_SETTINGS)[SettingKey];
      const existing = await db.query.settings.findFirst({ where: eq(settings.key, key) });
      if (existing) await db.update(settings).set({ value: typed, updatedAt: new Date() }).where(eq(settings.key, key));
      else await db.insert(settings).values({ key, value: typed });
    }
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.settings_updated', entity: 'settings', meta: { keys: Object.keys(parsed.data) } });
    revalidatePath('/admin/settings');
    revalidatePath('/');
    revalidatePath('/spas');
    return { ok: true };
  } catch {
    return fail('Could not save settings.');
  }
}

/* --------------------------- CMS pages ------------------------------ */

const pageSchema = z.object({
  id: z.string().optional(),
  slug: z.string().min(1).max(80),
  title: z.string().min(2).max(160),
  body: z.string().max(30000),
  metaTitle: z.string().max(200).optional().nullable(),
  metaDescription: z.string().max(320).optional().nullable(),
  published: z.boolean(),
});

export async function savePage(input: z.infer<typeof pageSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = pageSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid page.');
    const { user, db } = await adminCtx();
    const data = parsed.data;
    const slug = slugify(data.slug);

    if (data.id) {
      await db
        .update(pages)
        .set({
          slug,
          title: data.title,
          body: data.body,
          metaTitle: data.metaTitle || null,
          metaDescription: data.metaDescription || null,
          published: data.published,
          updatedAt: new Date(),
        })
        .where(eq(pages.id, data.id));
      await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.page_updated', entity: 'page', entityId: data.id, meta: { slug } });
      revalidateAdmin();
      revalidatePath(`/${slug}`);
      return { ok: true, data: { id: data.id } };
    }

    const dupe = await db.query.pages.findFirst({ where: eq(pages.slug, slug) });
    if (dupe) return fail('A page with this slug already exists.');

    const [created] = await db
      .insert(pages)
      .values({
        id: newId('pag'),
        slug,
        title: data.title,
        body: data.body,
        metaTitle: data.metaTitle || null,
        metaDescription: data.metaDescription || null,
        published: data.published,
      })
      .returning({ id: pages.id });
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.page_created', entity: 'page', entityId: created!.id, meta: { slug } });
    revalidateAdmin();
    revalidatePath(`/${slug}`);
    return { ok: true, data: { id: created!.id } };
  } catch {
    return fail('Could not save the page.');
  }
}

export async function deletePage(id: string): Promise<ActionResult> {
  try {
    const { user, db } = await adminCtx();
    await db.delete(pages).where(eq(pages.id, id));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.page_deleted', entity: 'page', entityId: id });
    revalidateAdmin();
    return { ok: true };
  } catch {
    return fail('Could not delete the page (it may be referenced).');
  }
}

/* --------------------------- promotions ----------------------------- */

const promoSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(2).max(160),
  summary: z.string().max(400).optional().nullable(),
  linkUrl: z.string().max(400).optional().nullable(),
  position: z.enum(PROMO_POSITIONS),
  startsAt: z.string().optional().nullable(),
  endsAt: z.string().optional().nullable(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
});

export async function savePromotion(input: z.infer<typeof promoSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = promoSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid promotion.');
    const { user, db } = await adminCtx();
    const data = parsed.data;
    const payload = {
      title: data.title,
      summary: data.summary || null,
      linkUrl: data.linkUrl || null,
      position: data.position,
      startsAt: data.startsAt ? new Date(`${data.startsAt}T00:00:00Z`) : null,
      endsAt: data.endsAt ? new Date(`${data.endsAt}T23:59:59Z`) : null,
      active: data.active,
      sortOrder: data.sortOrder,
    };

    if (data.id) {
      await db.update(promotions).set(payload).where(eq(promotions.id, data.id));
      await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.promo_updated', entity: 'promotion', entityId: data.id });
      revalidateAdmin();
      revalidatePath('/deals');
      return { ok: true, data: { id: data.id } };
    }

    let slug = slugify(data.title) || 'promo';
    const dupe = await db.query.promotions.findFirst({ where: eq(promotions.slug, slug) });
    if (dupe) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const [created] = await db
      .insert(promotions)
      .values({ ...payload, id: newId('prm'), slug })
      .returning({ id: promotions.id });
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.promo_created', entity: 'promotion', entityId: created!.id });
    revalidateAdmin();
    revalidatePath('/deals');
    return { ok: true, data: { id: created!.id } };
  } catch {
    return fail('Could not save the promotion.');
  }
}

export async function deletePromotion(id: string): Promise<ActionResult> {
  try {
    const { user, db } = await adminCtx();
    await db.delete(promotions).where(eq(promotions.id, id));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.promo_deleted', entity: 'promotion', entityId: id });
    revalidateAdmin();
    revalidatePath('/deals');
    return { ok: true };
  } catch {
    return fail('Could not delete the promotion.');
  }
}

/* ----------------------------- coupons ------------------------------ */

const couponSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(3).max(24),
  description: z.string().max(240).optional().nullable(),
  discountType: z.enum(['percent', 'fixed']),
  discountValue: z.number().int().min(1).max(100_000_000),
  currency: z.string().length(3).optional().nullable(),
  minAmount: z.number().int().min(0),
  maxUses: z.number().int().min(0).max(1_000_000),
  startsAt: z.string().optional().nullable(),
  endsAt: z.string().optional().nullable(),
  active: z.boolean(),
});

export async function saveCoupon(input: z.infer<typeof couponSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = couponSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid coupon.');
    const { user, db } = await adminCtx();
    const data = parsed.data;
    if (data.discountType === 'percent' && data.discountValue > 10000)
      return fail('Percent discounts are stored in basis points (10000 = 100%).');

    const payload = {
      code: data.code.toUpperCase().trim(),
      description: data.description || null,
      discountType: data.discountType,
      discountValue: data.discountValue,
      currency: data.currency || null,
      minAmount: data.minAmount,
      maxUses: data.maxUses,
      startsAt: data.startsAt ? new Date(`${data.startsAt}T00:00:00Z`) : null,
      endsAt: data.endsAt ? new Date(`${data.endsAt}T23:59:59Z`) : null,
      active: data.active,
    };

    if (data.id) {
      await db.update(coupons).set(payload).where(eq(coupons.id, data.id));
      await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.coupon_updated', entity: 'coupon', entityId: data.id, meta: { code: payload.code } });
      revalidateAdmin();
      revalidatePath('/deals');
      return { ok: true, data: { id: data.id } };
    }

    const dupe = await db.query.coupons.findFirst({ where: eq(coupons.code, payload.code) });
    if (dupe) return fail('That coupon code already exists.');
    const [created] = await db.insert(coupons).values({ ...payload, id: newId('cpn') }).returning({ id: coupons.id });
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.coupon_created', entity: 'coupon', entityId: created!.id, meta: { code: payload.code } });
    revalidateAdmin();
    revalidatePath('/deals');
    return { ok: true, data: { id: created!.id } };
  } catch {
    return fail('Could not save the coupon.');
  }
}

export async function deleteCoupon(id: string): Promise<ActionResult> {
  try {
    const { user, db } = await adminCtx();
    await db.delete(coupons).where(eq(coupons.id, id));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.coupon_deleted', entity: 'coupon', entityId: id });
    revalidateAdmin();
    revalidatePath('/deals');
    return { ok: true };
  } catch {
    return fail('Could not delete the coupon.');
  }
}

/* ------------------------------ helpers ----------------------------- */

export async function adminTotals(db: AppDb) {
  const [gmv] = await db
    .select({ total: sql<string>`coalesce(sum(${bookings.totalAmount}), 0)`, n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(sql`${bookings.paymentStatus} IN ('paid','venue')`);
  return gmv;
}

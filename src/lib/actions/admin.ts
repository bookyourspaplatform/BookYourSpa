'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, ne, sql, asc, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type AppDb } from '@/db';
import {
  agents,
  bookings,
  branchTreatments,
  branches,
  commissions,
  coupons,
  pages,
  promotions,
  providerClaims,
  providers,
  reviews,
  settings,
  therapists,
  treatments,
  users,
  TREATMENT_CATEGORIES,
  PROMO_POSITIONS,
  PROMO_APPLIES_TO,
  DISCOUNT_TYPES,
} from '@/db/schema';
import { branchPayload, branchSchema, uniqueBranchSlug } from '@/lib/branch';
import { treatmentPayload, treatmentSchema } from '@/lib/treatment';
import { findUserByEmail, requireUser } from '@/lib/auth/session';
import { cancelBooking, BookingError } from '@/lib/booking';
import { logAudit } from '@/lib/audit';
import { newId, slugify, stripHtml } from '@/lib/utils';
import { sanitizeRichText } from '@/lib/security';
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

/* ------------------ spa business creation + claims ------------------ */

/**
 * The full spa-business form — identical to the supplier's New/Edit spa
 * business (branchSchema) plus the admin-only extras: owner invite + publish.
 * No `id` creates the provider + first branch together; `providerId` only adds
 * a branch to an existing provider; `id` edits that branch.
 */
const adminSpaSchema = branchSchema.extend({
  providerId: z.string().optional(),
  ownerEmail: z.string().trim().max(200).optional().or(z.literal('')),
  publish: z.boolean().optional(),
});

/** Pending claim invite for this email, unless one already exists. */
async function inviteOwner(db: AppDb, providerId: string, email: string) {
  const existing = await db.query.providerClaims.findFirst({
    where: and(eq(providerClaims.providerId, providerId), eq(providerClaims.email, email)),
  });
  if (existing) return false;
  const invitee = await findUserByEmail(email);
  await db.insert(providerClaims).values({
    id: newId('clm'),
    providerId,
    email,
    userId: invitee?.id ?? null,
    message: 'Owner invite added by admin',
  });
  return true;
}

function providerStatusPatch(publish: boolean | undefined, current: typeof providers.$inferSelect) {
  if (publish === undefined) return {};
  return {
    status: (publish ? 'approved' : 'pending') as typeof current.status,
    approvedAt: publish ? new Date() : current.approvedAt,
    updatedAt: new Date(),
  };
}

export type AdminSpaSaveResult = { id: string; providerId: string };

/**
 * Admin create/edit for a spa business using the supplier's full form.
 * - no id: creates the provider (unowned, awaiting claim) + its first branch
 * - providerId only: adds a branch to an existing provider
 * - id: edits that branch; unclaimed providers get name/tagline/country
 *   kept in step, and `publish` maps onto the listing status.
 */
export async function adminSaveSpa(input: z.infer<typeof adminSpaSchema>): Promise<ActionResult<AdminSpaSaveResult>> {
  try {
    const { user, db } = await adminCtx();
    const parsed = adminSpaSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid spa business data.');
    const { providerId: inputProviderId, id: branchId, ownerEmail, publish, ...branchData } = parsed.data;

    const email = ownerEmail ? ownerEmail.toLowerCase() : null;
    if (email && !z.email().safeParse(email).success) return fail('Enter a valid owner email address.');

    const payload = branchPayload(branchData);

    /* ------------------------------- edit -------------------------------- */
    if (branchId) {
      const branch = await db.query.branches.findFirst({ where: eq(branches.id, branchId) });
      if (!branch) return fail('Spa business not found.');
      const provider = await db.query.providers.findFirst({ where: eq(providers.id, branch.providerId) });
      if (!provider) return fail('Spa business not found.');
      if (inputProviderId && inputProviderId !== provider.id) return fail('Spa business not found.');

      const slug = await uniqueBranchSlug(db, provider.id, branchData.name, branch.id);
      await db
        .update(branches)
        .set({ ...payload, slug, updatedAt: new Date() })
        .where(eq(branches.id, branch.id));

      // Unclaimed listings belong to the platform — the brand follows the form.
      const brandSync = provider.ownerId
        ? {}
        : { name: branchData.name, tagline: branchData.tagline || null, country: branchData.country };
      const providerPatch = { ...brandSync, ...providerStatusPatch(publish, provider) };
      if (Object.keys(providerPatch).length > 0) {
        await db.update(providers).set({ ...providerPatch, updatedAt: new Date() }).where(eq(providers.id, provider.id));
      }
      if (email) await inviteOwner(db, provider.id, email);

      await logAudit({
        actorId: user.id,
        actorRole: user.role,
        action: 'admin.spa_updated',
        entity: 'branch',
        entityId: branch.id,
        meta: { providerId: provider.id, invited: Boolean(email) },
      });
      revalidateAdmin();
      revalidatePath('/spas');
      revalidatePath(`/spas/${provider.slug}`);
      revalidatePath(`/spas/${provider.slug}/${slug}`);
      return { ok: true, data: { id: branch.id, providerId: provider.id } };
    }

    /* ------------------------------ create ------------------------------- */
    let providerId = inputProviderId ?? null;
    let providerSlug: string;

    if (providerId) {
      const existing = await db.query.providers.findFirst({ where: eq(providers.id, providerId) });
      if (!existing) return fail('Spa business not found.');
      providerSlug = existing.slug;
      const statusPatch = providerStatusPatch(publish, existing);
      if (Object.keys(statusPatch).length > 0) {
        await db.update(providers).set(statusPatch).where(eq(providers.id, providerId));
      }
      if (email) await inviteOwner(db, providerId, email);
    } else {
      providerId = newId('prv');
      providerSlug = slugify(branchData.name) || 'spa';
      const dupe = await db.query.providers.findFirst({ where: eq(providers.slug, providerSlug) });
      if (dupe) providerSlug = `${providerSlug}-${Date.now().toString(36).slice(-4)}`;
      await db.insert(providers).values({
        id: providerId,
        ownerId: null,
        name: branchData.name,
        slug: providerSlug,
        country: branchData.country,
        baseCurrency: branchData.currency,
        tagline: branchData.tagline || null,
        email,
        status: publish === false ? 'pending' : 'approved',
        approvedAt: publish === false ? null : new Date(),
      });
      if (email) await inviteOwner(db, providerId, email);
    }

    const slug = await uniqueBranchSlug(db, providerId, branchData.name);
    const [created] = await db
      .insert(branches)
      .values({ ...payload, id: newId('brn'), providerId, slug, status: payload.status ?? 'active' })
      .returning({ id: branches.id });

    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'admin.spa_created',
      entity: 'branch',
      entityId: created!.id,
      meta: { providerId, slug, publish: publish !== false, invited: Boolean(email) },
    });
    revalidateAdmin();
    revalidatePath('/spas');
    revalidatePath(`/spas/${providerSlug}`);
    revalidatePath(`/spas/${providerSlug}/${slug}`);
    return { ok: true, data: { id: created!.id, providerId } };
  } catch {
    return fail('Could not save the spa business.');
  }
}

/** Branch row shape for the admin editor — mirrors the supplier's BranchRow. */
export type AdminSpaBranch = {
  id: string;
  name: string;
  addressLine: string;
  city: string;
  region: string | null;
  country: string;
  timezone: string;
  currency: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  googleMapsUrl: string | null;
  googleRating: number | null;
  googleRatingCount: number | null;
  lat: string | null;
  lng: string | null;
  tagline: string | null;
  shortDescription: string | null;
  categories: string[];
  spaTypes: string[];
  doorstepService: boolean;
  showTherapistOnline: boolean;
  agentFeeBps: number | null;
  facilities: string[];
  description: string | null;
  images: string[];
  hours: { day: number; open: string; close: string; closed: boolean }[];
  leadTimeMinutes: number;
  maxAdvanceDays: number;
  bufferMinutes: number;
  slotIntervalMinutes: number;
  onlinePaymentEnabled: boolean;
  paymentMethods: string[];
  status: string;
  treatmentCount: number;
  therapistCount: number;
};

/**
 * Everything the admin editor needs for one provider: its listing meta plus
 * every branch (empty → the editor opens in "add first location" mode).
 */
export async function adminGetSpa(
  providerId: string,
): Promise<ActionResult<{ provider: { id: string; name: string; status: string; ownerId: string | null; slug: string }; branches: AdminSpaBranch[] }>> {
  try {
    const { db } = await adminCtx();
    const provider = await db.query.providers.findFirst({ where: eq(providers.id, providerId) });
    if (!provider) return fail('Spa business not found.');

    const branchRows = await db.query.branches.findMany({
      where: eq(branches.providerId, providerId),
      orderBy: [asc(branches.name)],
    });
    const branchIds = branchRows.map((b) => b.id);
    const [treatmentCounts, therapistCounts] = branchIds.length
      ? await Promise.all([
          db
            .select({ branchId: branchTreatments.branchId, n: sql<number>`count(*)::int` })
            .from(branchTreatments)
            .where(and(eq(branchTreatments.active, true), inArray(branchTreatments.branchId, branchIds)))
            .groupBy(branchTreatments.branchId),
          db
            .select({ branchId: therapists.branchId, n: sql<number>`count(*)::int` })
            .from(therapists)
            .where(and(eq(therapists.active, true), inArray(therapists.branchId, branchIds)))
            .groupBy(therapists.branchId),
        ])
      : [[], []];

    const branchesOut: AdminSpaBranch[] = branchRows.map((b) => ({
      id: b.id,
      name: b.name,
      addressLine: b.addressLine,
      city: b.city,
      region: b.region,
      country: b.country,
      timezone: b.timezone,
      currency: b.currency,
      phone: b.phone,
      email: b.email,
      website: b.website,
      googleMapsUrl: b.googleMapsUrl,
      googleRating: b.googleRating,
      googleRatingCount: b.googleRatingCount,
      lat: b.lat,
      lng: b.lng,
      tagline: b.tagline,
      shortDescription: b.shortDescription,
      categories: b.categories ?? [],
      spaTypes: b.spaTypes ?? [],
      doorstepService: b.doorstepService,
      showTherapistOnline: b.showTherapistOnline,
      agentFeeBps: b.agentFeeBps,
      facilities: b.facilities ?? [],
      description: b.description,
      images: b.images ?? [],
      hours: b.hours,
      leadTimeMinutes: b.leadTimeMinutes,
      maxAdvanceDays: b.maxAdvanceDays,
      bufferMinutes: b.bufferMinutes,
      slotIntervalMinutes: b.slotIntervalMinutes,
      onlinePaymentEnabled: b.onlinePaymentEnabled,
      paymentMethods: b.paymentMethods,
      status: b.status,
      treatmentCount: treatmentCounts.find((t) => t.branchId === b.id)?.n ?? 0,
      therapistCount: therapistCounts.find((t) => t.branchId === b.id)?.n ?? 0,
    }));

    return {
      ok: true,
      data: {
        provider: {
          id: provider.id,
          name: provider.name,
          status: provider.status,
          ownerId: provider.ownerId,
          slug: provider.slug,
        },
        branches: branchesOut,
      },
    };
  } catch {
    return fail('Could not load the spa business.');
  }
}

/**
 * Admin DB → spa form → "Add Review": writes one review for a location
 * straight onto its public page — for reviews transcribed by hand (a Google
 * listing, a message from a guest). `date` is the posted date shown beside
 * the review, `source` the label shown next to it, `comment` rich text (it is
 * sanitized here). It publishes immediately, so the badge and the
 * 10-per-page showcase pick it up right away.
 */
export async function adminAddReview(input: {
  branchId: string;
  guestName: string;
  rating: number;
  comment?: string | null;
  date?: string | null;
  source?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const { user, db } = await adminCtx();
    const branchId = String(input?.branchId ?? '');
    const guestName = String(input?.guestName ?? '').trim().replace(/\s+/g, ' ');
    const rating = Math.round(Number(input?.rating));
    const date = String(input?.date ?? '').trim();
    const source = input?.source === 'google' ? 'google' : 'platform';
    // Rich text from the editor: sanitize, then treat an empty body as none.
    const body = sanitizeRichText(String(input?.comment ?? ''));
    const comment = stripHtml(body);
    if (!branchId) return fail('Save the location first, then add a review.');
    if (guestName.length < 2 || guestName.length > 60) {
      return fail('Name must be between 2 and 60 characters.');
    }
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return fail('Star must be between 1 and 5.');
    }
    if (comment.length > 4000) return fail('Keep the review under 4000 characters.');

    // Posted date: defaults to now, otherwise a real day that is not ahead of us.
    let postedAt = new Date();
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Pick the date the review was posted.');
      const parsed = new Date(`${date}T12:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        return fail('Pick a real calendar date.');
      }
      if (parsed.getTime() > Date.now() + 36 * 60 * 60 * 1000) {
        return fail('The posted date cannot be in the future.');
      }
      postedAt = parsed;
    }
    const branch = await db.query.branches.findFirst({
      where: eq(branches.id, branchId),
      with: { provider: true },
    });
    if (!branch) return fail('Location not found.');

    const id = newId('rev');
    await db.insert(reviews).values({
      id,
      branchId,
      guestName,
      rating,
      comment: comment ? body : null,
      status: 'published',
      source,
      createdAt: postedAt,
      updatedAt: postedAt,
    });
    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'admin.add_review',
      entity: 'branch',
      entityId: branchId,
      meta: { guestName, rating },
    });
    revalidatePath('/spas');
    revalidatePath(`/spas/${branch.provider.slug}/${branch.slug}`);
    return { ok: true, data: { id } };
  } catch {
    return fail('Could not add the review.');
  }
}

/** Admin updates a review's visible details and posted date for its existing branch. */
export async function adminUpdateReview(input: {
  id: string;
  guestName: string;
  rating: number;
  comment?: string | null;
  date: string;
  source?: string | null;
}): Promise<ActionResult> {
  try {
    const { user, db } = await adminCtx();
    const id = String(input?.id ?? '').trim();
    const guestName = String(input?.guestName ?? '').trim().replace(/\s+/g, ' ');
    const rating = Number(input?.rating);
    const date = String(input?.date ?? '').trim();
    const source = input?.source === 'google' ? 'google' : 'platform';
    const body = sanitizeRichText(String(input?.comment ?? ''));
    const comment = stripHtml(body);
    if (!id) return fail('Review not found.');
    if (guestName.length < 2 || guestName.length > 60) return fail('Name must be between 2 and 60 characters.');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail('Star must be between 1 and 5.');
    if (comment.length > 4000) return fail('Keep the review under 4000 characters.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Pick the date the review was posted.');
    const postedAt = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(postedAt.getTime()) || postedAt.toISOString().slice(0, 10) !== date) return fail('Pick a real calendar date.');
    if (postedAt.getTime() > Date.now() + 36 * 60 * 60 * 1000) return fail('The posted date cannot be in the future.');

    const existing = await db.query.reviews.findFirst({
      where: eq(reviews.id, id),
      with: { branch: { with: { provider: true } } },
    });
    if (!existing) return fail('Review not found.');
    await db.update(reviews).set({
      guestName,
      rating,
      comment: comment ? body : null,
      source,
      createdAt: postedAt,
      updatedAt: new Date(),
    }).where(eq(reviews.id, id));
    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'admin.review_updated',
      entity: 'review',
      entityId: id,
      meta: { branchId: existing.branchId, guestName, rating },
    });
    revalidatePath('/spas');
    revalidatePath(`/spas/${existing.branch.provider.slug}/${existing.branch.slug}`);
    revalidatePath('/admin/reviews/new');
    return { ok: true };
  } catch {
    return fail('Could not update the review.');
  }
}

/** Admin permanently removes a review from its branch and public listing. */
export async function adminDeleteReview(id: string): Promise<ActionResult> {
  try {
    const { user, db } = await adminCtx();
    const reviewId = String(id ?? '').trim();
    if (!reviewId) return fail('Review not found.');
    const existing = await db.query.reviews.findFirst({
      where: eq(reviews.id, reviewId),
      with: { branch: { with: { provider: true } } },
    });
    if (!existing) return fail('Review not found.');
    await db.delete(reviews).where(eq(reviews.id, reviewId));
    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'admin.review_deleted',
      entity: 'review',
      entityId: reviewId,
      meta: { branchId: existing.branchId, guestName: existing.guestName, rating: existing.rating },
    });
    revalidatePath('/spas');
    revalidatePath(`/spas/${existing.branch.provider.slug}/${existing.branch.slug}`);
    revalidatePath('/admin/reviews/new');
    return { ok: true };
  } catch {
    return fail('Could not delete the review.');
  }
}

export async function approveProviderClaim(claimId: string): Promise<ActionResult> {
  try {
    const { user, db } = await adminCtx();
    const claim = await db.query.providerClaims.findFirst({
      where: eq(providerClaims.id, claimId),
      with: { provider: true },
    });
    if (!claim) return fail('Claim not found.');
    if (claim.status !== 'pending') return fail('This claim was already decided.');
    const ownerId = claim.userId;
    if (!ownerId) return fail('The claimant has not confirmed yet — ask them to sign in with the invited email.');
    if (claim.provider.ownerId && claim.provider.ownerId !== ownerId) {
      return fail('This spa already has a different owner.');
    }
    const owner = await db.query.users.findFirst({ where: eq(users.id, ownerId) });
    if (!owner || owner.status !== 'active') return fail('The claimant account is not active.');

    const publish = claim.provider.status === 'pending';
    await db.transaction(async (tx) => {
      await tx
        .update(providerClaims)
        .set({ status: 'approved', decidedAt: new Date(), decidedBy: user.id })
        .where(eq(providerClaims.id, claimId));
      await tx
        .update(providers)
        .set({
          ownerId,
          ...(publish ? { status: 'approved' as const, approvedAt: claim.provider.approvedAt ?? new Date() } : {}),
        })
        .where(eq(providers.id, claim.providerId));
      // No second owner can be approved later.
      await tx
        .update(providerClaims)
        .set({ status: 'rejected', decidedAt: new Date(), decidedBy: user.id })
        .where(
          and(
            eq(providerClaims.providerId, claim.providerId),
            eq(providerClaims.status, 'pending'),
            ne(providerClaims.id, claimId),
          ),
        );
      // Owners run the spa console — promote customer accounts on approval.
      await tx
        .update(users)
        .set({ role: 'provider' })
        .where(and(eq(users.id, ownerId), eq(users.role, 'customer')));
    });

    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'admin.claim_approved',
      entity: 'provider',
      entityId: claim.providerId,
      meta: { claimId, ownerId },
    });
    revalidateAdmin();
    revalidatePath(`/spas/${claim.provider.slug}`);
    revalidatePath('/provider');
    revalidatePath('/account');
    return { ok: true };
  } catch {
    return fail('Could not approve the claim.');
  }
}

export async function rejectProviderClaim(claimId: string): Promise<ActionResult> {
  try {
    const { user, db } = await adminCtx();
    const claim = await db.query.providerClaims.findFirst({
      where: eq(providerClaims.id, claimId),
      with: { provider: { columns: { slug: true } } },
    });
    if (!claim) return fail('Claim not found.');
    if (claim.status !== 'pending') return fail('This claim was already decided.');

    await db
      .update(providerClaims)
      .set({ status: 'rejected', decidedAt: new Date(), decidedBy: user.id })
      .where(eq(providerClaims.id, claimId));
    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'admin.claim_rejected',
      entity: 'provider',
      entityId: claim.providerId,
      meta: { claimId },
    });
    revalidateAdmin();
    revalidatePath(`/spas/${claim.provider.slug}`);
    revalidatePath('/account');
    revalidatePath('/provider');
    return { ok: true };
  } catch {
    return fail('Could not reject the claim.');
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
  /* Redeemable general promotion — valid at every spa that has not opted out. */
  code: z.string().trim().min(2).max(40),
  discountType: z.enum(DISCOUNT_TYPES).optional().nullable(),
  /** percent = basis points (1500 = 15%), fixed = minor units. */
  discountValue: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
  currency: z.string().length(3).optional().nullable(),
  minAmount: z.number().int().min(0).default(0),
  maxUses: z.number().int().min(0).default(0),
  /**
   * “All treatments” or “Selected treatments”. Admin never picks the treatments
   * itself — on a platform promotion the supplier chooses them when it
   * activates the offer (stored in provider_promotions.treatment_ids).
   */
  appliesTo: z.enum(PROMO_APPLIES_TO).default('all'),
  /** Optional daily hour window (spa local time), hours 0–23. */
  validFromHour: z.number().int().min(0).max(23).optional().nullable(),
  validUntilHour: z.number().int().min(0).max(23).optional().nullable(),
});

export async function savePromotion(input: z.infer<typeof promoSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = promoSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid promotion.');
    const { user, db } = await adminCtx();
    const data = parsed.data;

    const code = data.code.trim().toUpperCase();
    if (!code) return fail('Every promotion needs a promo code customers can redeem.');
    if (data.discountType && !(data.discountValue && data.discountValue > 0))
      return fail('Enter a discount value.');
    const dupe = await db.query.promotions.findFirst({
      where: eq(promotions.code, code),
      columns: { id: true },
    });
    if (dupe && dupe.id !== data.id) return fail('That code is already used by another promotion.');

    const payload = {
      title: data.title,
      summary: data.summary || null,
      linkUrl: data.linkUrl || null,
      position: data.position,
      startsAt: data.startsAt ? new Date(`${data.startsAt}T00:00:00Z`) : null,
      endsAt: data.endsAt ? new Date(`${data.endsAt}T23:59:59Z`) : null,
      active: data.active,
      sortOrder: data.sortOrder,
      code,
      discountType: data.discountType ?? null,
      discountValue: data.discountType ? data.discountValue : null,
      currency: data.currency?.trim() ? data.currency.trim().toUpperCase() : null,
      minAmount: data.minAmount ?? 0,
      maxUses: data.maxUses ?? 0,
      appliesTo: data.appliesTo,
      validFromHour: data.validFromHour ?? null,
      validUntilHour: data.validUntilHour ?? null,
    };

    if (data.id) {
      await db.update(promotions).set(payload).where(eq(promotions.id, data.id));
      await logAudit({ actorId: user.id, actorRole: user.role, action: 'admin.promo_updated', entity: 'promotion', entityId: data.id });
      revalidateAdmin();
      revalidatePath('/deals');
      return { ok: true, data: { id: data.id } };
    }

    let slug = slugify(data.title) || 'promo';
    const dupeSlug = await db.query.promotions.findFirst({ where: eq(promotions.slug, slug) });
    if (dupeSlug) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
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

/* ------------------------- treatments (admin) ----------------------- */

const adminTreatmentSchema = treatmentSchema.extend({ providerId: z.string().min(1) });

/**
 * Admin create/edit of a treatment for any spa (the supplier form's payload,
 * under admin auth). New treatments are offered at every active branch
 * immediately so admin-managed listings are bookable without a second step.
 */
export async function adminSaveTreatment(
  input: z.infer<typeof adminTreatmentSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { user, db } = await adminCtx();
    const parsed = adminTreatmentSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid treatment data.');
    const { providerId, id, ...rest } = parsed.data;
    const provider = await db.query.providers.findFirst({
      where: eq(providers.id, providerId),
      columns: { id: true, baseCurrency: true },
    });
    if (!provider) return fail('Spa not found.');
    const payload = treatmentPayload(rest);

    if (id) {
      const existing = await db.query.treatments.findFirst({
        where: and(eq(treatments.id, id), eq(treatments.providerId, providerId)),
        columns: { id: true },
      });
      if (!existing) return fail('Treatment not found.');
      await db.update(treatments).set({ ...payload, updatedAt: new Date() }).where(eq(treatments.id, id));
      await logAudit({
        actorId: user.id,
        actorRole: user.role,
        action: 'admin.treatment_updated',
        entity: 'treatment',
        entityId: id,
        meta: { providerId },
      });
      revalidateAdmin();
      revalidatePath('/spas');
      return { ok: true, data: { id } };
    }

    const dupe = await db.query.treatments.findFirst({
      where: and(eq(treatments.providerId, providerId), eq(treatments.slug, slugify(rest.name))),
      columns: { id: true },
    });
    let slug = slugify(rest.name) || 'treatment';
    if (dupe) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    const [created] = await db
      .insert(treatments)
      .values({
        ...payload,
        id: newId('trt'),
        providerId,
        slug,
        currency: provider.baseCurrency,
      })
      .returning({ id: treatments.id });

    const branchRows = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.providerId, providerId), eq(branches.status, 'active')));
    if (branchRows.length) {
      await db.insert(branchTreatments).values(
        branchRows.map((b) => ({
          id: newId('btr'),
          branchId: b.id,
          treatmentId: created!.id,
          price: payload.listPrice,
          active: true,
        })),
      );
    }

    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'admin.treatment_created',
      entity: 'treatment',
      entityId: created!.id,
      meta: { providerId, branches: branchRows.length },
    });
    revalidateAdmin();
    revalidatePath('/spas');
    return { ok: true, data: { id: created!.id } };
  } catch {
    return fail('Could not save the treatment.');
  }
}

export async function adminSetTreatmentStatus(
  providerId: string,
  treatmentId: string,
  status: 'active' | 'pending',
): Promise<ActionResult> {
  try {
    const { user, db } = await adminCtx();
    const existing = await db.query.treatments.findFirst({
      where: and(eq(treatments.id, treatmentId), eq(treatments.providerId, providerId)),
      columns: { id: true },
    });
    if (!existing) return fail('Treatment not found.');
    await db.update(treatments).set({ status, updatedAt: new Date() }).where(eq(treatments.id, treatmentId));
    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'admin.treatment_status',
      entity: 'treatment',
      entityId: treatmentId,
      meta: { status },
    });
    revalidateAdmin();
    revalidatePath('/spas');
    return { ok: true };
  } catch {
    return fail('Could not update treatment status.');
  }
}

/** Treatment menu for the admin editor — mirrors the supplier's list shape. */
export async function adminGetTreatments(
  providerId: string,
): Promise<
  ActionResult<{
    currency: string;
    treatments: {
      id: string;
      name: string;
      description: string | null;
      durationMin: number;
      listPrice: number;
      currency: string;
      requiresTherapist: boolean;
      therapistsPerBooking: number;
      capacity: number;
      agentApproved: boolean;
      tags: string[];
      genre: string;
      deliveryType: string;
      priceOptions: { durationMin: number; price: number; capacity: number }[] | null;
      status: string;
      branchCount: number;
    }[];
  }>> {
  try {
    const { db } = await adminCtx();
    const provider = await db.query.providers.findFirst({
      where: eq(providers.id, providerId),
      columns: { id: true, baseCurrency: true },
    });
    if (!provider) return fail('Spa not found.');

    const rows = await db.query.treatments.findMany({
      where: eq(treatments.providerId, providerId),
      orderBy: [treatments.category, treatments.name],
    });
    const ids = rows.map((t) => t.id);
    const counts = ids.length
      ? await db
          .select({ treatmentId: branchTreatments.treatmentId, n: sql<number>`count(*)::int` })
          .from(branchTreatments)
          .where(and(eq(branchTreatments.active, true), inArray(branchTreatments.treatmentId, ids)))
          .groupBy(branchTreatments.treatmentId)
      : [];

    return {
      ok: true,
      data: {
        currency: provider.baseCurrency,
        treatments: rows.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          durationMin: t.durationMin,
          listPrice: t.listPrice,
          currency: t.currency,
          requiresTherapist: t.requiresTherapist,
          therapistsPerBooking: t.therapistsPerBooking,
          capacity: t.capacity,
          agentApproved: t.agentApproved,
          tags: t.tags ?? [],
          genre: t.genre,
          deliveryType: t.deliveryType,
          priceOptions: t.priceOptions ?? [],
          status: t.status,
          branchCount: counts.find((c) => c.treatmentId === t.id)?.n ?? 0,
        })),
      },
    };
  } catch {
    return fail('Could not load treatments.');
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
  /** Optional daily hour window (spa local time), hours 0–23. */
  validFromHour: z.number().int().min(0).max(23).optional().nullable(),
  validUntilHour: z.number().int().min(0).max(23).optional().nullable(),
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
      validFromHour: data.validFromHour ?? null,
      validUntilHour: data.validUntilHour ?? null,
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

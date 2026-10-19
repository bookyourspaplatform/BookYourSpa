'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type AppDb } from '@/db';
import {
  bookings,
  branchTreatments,
  branches,
  providers,
  scheduleExceptions,
  schedules,
  therapists,
  treatments,
  TREATMENT_CATEGORIES,
  USER_STATUSES,
} from '@/db/schema';
import { requireUser } from '@/lib/auth/session';
import { cancelBooking, BookingError } from '@/lib/booking';
import { logAudit } from '@/lib/audit';
import { newId, slugify, isValidTime, hhmm, minutesOf } from '@/lib/utils';

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

async function providerCtx() {
  const user = await requireUser(['provider']);
  const db = await getDb();
  return { user, db, providerId: user.provider!.id };
}

function revalidateProvider(providerId: string, extra: string[] = []) {
  revalidatePath('/provider');
  for (const p of extra) revalidatePath(p);
  // public catalog pages read provider data
  revalidatePath('/spas');
  void providerId;
}

/* ----------------------------- ownership ----------------------------- */

async function assertBranch(db: AppDb, providerId: string, branchId: string) {
  const row = await db.query.branches.findFirst({ where: eq(branches.id, branchId) });
  if (!row || row.providerId !== providerId) throw new Error('Branch not found.');
  return row;
}

async function assertTreatment(db: AppDb, providerId: string, treatmentId: string) {
  const row = await db.query.treatments.findFirst({ where: eq(treatments.id, treatmentId) });
  if (!row || row.providerId !== providerId) throw new Error('Treatment not found.');
  return row;
}

async function assertTherapist(db: AppDb, providerId: string, therapistId: string) {
  const row = await db.query.therapists.findFirst({
    where: eq(therapists.id, therapistId),
    with: { branch: { columns: { providerId: true } } },
  });
  if (!row || row.branch?.providerId !== providerId) throw new Error('Therapist not found.');
  return row;
}

async function assertBooking(db: AppDb, providerId: string, bookingId: string) {
  const row = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
  if (!row || row.providerId !== providerId) throw new Error('Booking not found.');
  return row;
}

async function uniqueBranchSlug(db: AppDb, providerId: string, base: string, ignoreId?: string) {
  const existing = await db
    .select({ id: branches.id, slug: branches.slug })
    .from(branches)
    .where(eq(branches.providerId, providerId));
  const taken = new Set(existing.filter((r) => r.id !== ignoreId).map((r) => r.slug));
  let candidate = slugify(base) || 'branch';
  let i = 2;
  while (taken.has(candidate)) candidate = `${slugify(base)}-${i++}`;
  return candidate;
}

/* ------------------------------ branches ----------------------------- */

const hoursSchema = z.array(
  z.object({
    day: z.number().int().min(0).max(6),
    open: z.string().regex(/^\d{2}:\d{2}$/),
    close: z.string().regex(/^\d{2}:\d{2}$/),
    closed: z.boolean(),
  }),
);

const branchSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2).max(120),
  addressLine: z.string().min(3).max(240),
  city: z.string().min(1).max(80),
  region: z.string().max(80).optional().nullable(),
  country: z.string().min(2).max(3),
  timezone: z.string().min(3).max(60),
  currency: z.string().min(3).max(3),
  phone: z.string().max(40).optional().nullable(),
  email: z.union([z.string().email().max(160), z.literal('')]).optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  hours: hoursSchema.optional(),
  leadTimeMinutes: z.number().int().min(0).max(60 * 24 * 7),
  maxAdvanceDays: z.number().int().min(1).max(400),
  bufferMinutes: z.number().int().min(0).max(240),
  slotIntervalMinutes: z.number().int().min(5).max(240),
  onlinePaymentEnabled: z.boolean(),
  paymentMethods: z.array(z.enum(['stripe', 'paypal', 'razorpay', 'venue'])).min(1),
  status: z.enum(USER_STATUSES).optional(),
});

export async function saveBranch(input: z.infer<typeof branchSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = branchSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid branch data.');
    const { db, providerId, user } = await providerCtx();
    const data = parsed.data;

    if (data.id) {
      await assertBranch(db, providerId, data.id);
      const slug = await uniqueBranchSlug(db, providerId, data.name, data.id);
      const { id, ...rest } = data;
      const [updated] = await db
        .update(branches)
        .set({ ...rest, email: rest.email || null, slug, updatedAt: new Date() })
        .where(and(eq(branches.id, id), eq(branches.providerId, providerId)))
        .returning({ id: branches.id });
      await logAudit({ actorId: user.id, actorRole: user.role, action: 'branch.updated', entity: 'branch', entityId: id });
      revalidateProvider(providerId, ['/provider/branches', '/provider/availability']);
      return { ok: true, data: { id: updated!.id } };
    }

    const slug = await uniqueBranchSlug(db, providerId, data.name);
    const [created] = await db
      .insert(branches)
      .values({ ...data, id: newId('brn'), providerId, slug })
      .returning({ id: branches.id });
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'branch.created', entity: 'branch', entityId: created!.id });
    revalidateProvider(providerId, ['/provider/branches', '/provider/availability']);
    return { ok: true, data: { id: created!.id } };
  } catch {
    return fail('Could not save the branch.');
  }
}

export async function setBranchStatus(branchId: string, status: 'active' | 'suspended'): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    await assertBranch(db, providerId, branchId);
    await db
      .update(branches)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(branches.id, branchId), eq(branches.providerId, providerId)));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'branch.status', entity: 'branch', entityId: branchId, meta: { status } });
    revalidateProvider(providerId, ['/provider/branches']);
    return { ok: true };
  } catch {
    return fail('Could not update branch status.');
  }
}

/* ----------------------------- treatments ---------------------------- */

const treatmentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2).max(120),
  category: z.enum(TREATMENT_CATEGORIES),
  description: z.string().max(4000).optional().nullable(),
  durationMin: z.number().int().min(5).max(600),
  listPrice: z.number().int().min(0).max(1_000_000_000),
  requiresTherapist: z.boolean(),
  capacity: z.number().int().min(1).max(50),
  agentApproved: z.boolean(),
  status: z.enum(USER_STATUSES).optional(),
});

export async function saveTreatment(input: z.infer<typeof treatmentSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = treatmentSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid treatment data.');
    const { db, providerId, user } = await providerCtx();
    const data = parsed.data;

    if (data.id) {
      await assertTreatment(db, providerId, data.id);
      const { id, ...rest } = data;
      await db
        .update(treatments)
        .set({ ...rest, updatedAt: new Date() })
        .where(and(eq(treatments.id, id), eq(treatments.providerId, providerId)));
      await logAudit({ actorId: user.id, actorRole: user.role, action: 'treatment.updated', entity: 'treatment', entityId: id });
      revalidateProvider(providerId, ['/provider/treatments', '/provider/branches']);
      return { ok: true, data: { id: data.id } };
    }

    const dupe = await db.query.treatments.findFirst({
      where: and(eq(treatments.providerId, providerId), eq(treatments.slug, slugify(data.name))),
    });
    let slug = slugify(data.name) || 'treatment';
    if (dupe) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    const [created] = await db
      .insert(treatments)
      .values({
        ...data,
        id: newId('trt'),
        providerId,
        slug,
        currency: (await db.query.providers.findFirst({ where: eq(providers.id, providerId) }))?.baseCurrency ?? 'IDR',
      })
      .returning({ id: treatments.id });
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'treatment.created', entity: 'treatment', entityId: created!.id });
    revalidateProvider(providerId, ['/provider/treatments', '/provider/branches']);
    return { ok: true, data: { id: created!.id } };
  } catch {
    return fail('Could not save the treatment.');
  }
}

export async function setTreatmentStatus(treatmentId: string, status: 'active' | 'pending'): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    await assertTreatment(db, providerId, treatmentId);
    await db
      .update(treatments)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(treatments.id, treatmentId), eq(treatments.providerId, providerId)));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'treatment.status', entity: 'treatment', entityId: treatmentId, meta: { status } });
    revalidateProvider(providerId, ['/provider/treatments']);
    return { ok: true };
  } catch {
    return fail('Could not update treatment status.');
  }
}

/** Toggle a treatment on/off at a branch (keeps its price row). */
export async function setBranchTreatmentActive(
  branchTreatmentId: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    const row = await db.query.branchTreatments.findFirst({ where: eq(branchTreatments.id, branchTreatmentId) });
    if (!row) return fail('Not found.');
    await assertBranch(db, providerId, row.branchId);
    await db.update(branchTreatments).set({ active }).where(eq(branchTreatments.id, branchTreatmentId));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'branch_price.toggled', entity: 'branchTreatment', entityId: branchTreatmentId, meta: { active } });
    revalidateProvider(providerId, ['/provider/treatments']);
    return { ok: true };
  } catch {
    return fail('Could not update the offering.');
  }
}

/** Set the branch-local price for a treatment (creates the row if missing). */
export async function setBranchPrice(input: {
  branchId: string;
  treatmentId: string;
  price: number;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = z
      .object({
        branchId: z.string().min(1),
        treatmentId: z.string().min(1),
        price: z.number().int().min(0).max(1_000_000_000),
      })
      .safeParse(input);
    if (!parsed.success) return fail('Invalid price.');
    const { db, providerId, user } = await providerCtx();
    await assertBranch(db, providerId, parsed.data.branchId);
    await assertTreatment(db, providerId, parsed.data.treatmentId);

    const existing = await db.query.branchTreatments.findFirst({
      where: and(
        eq(branchTreatments.branchId, parsed.data.branchId),
        eq(branchTreatments.treatmentId, parsed.data.treatmentId),
      ),
    });
    if (existing) {
      await db.update(branchTreatments).set({ price: parsed.data.price }).where(eq(branchTreatments.id, existing.id));
      revalidateProvider(providerId, ['/provider/treatments']);
      return { ok: true, data: { id: existing.id } };
    }
    const [created] = await db
      .insert(branchTreatments)
      .values({
        id: newId('btr'),
        branchId: parsed.data.branchId,
        treatmentId: parsed.data.treatmentId,
        price: parsed.data.price,
      })
      .returning({ id: branchTreatments.id });
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'branch_price.set', entity: 'branchTreatment', entityId: created!.id });
    revalidateProvider(providerId, ['/provider/treatments']);
    return { ok: true, data: { id: created!.id } };
  } catch {
    return fail('Could not save the price.');
  }
}

/* ------------------------------ therapists --------------------------- */

const therapistSchema = z.object({
  id: z.string().optional(),
  branchId: z.string().min(1),
  name: z.string().min(2).max(120),
  bio: z.string().max(2000).optional().nullable(),
  specialties: z.array(z.string().max(60)).max(12).default([]),
  active: z.boolean().default(true),
});

export async function saveTherapist(input: z.infer<typeof therapistSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = therapistSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid therapist data.');
    const { db, providerId, user } = await providerCtx();
    const data = parsed.data;
    await assertBranch(db, providerId, data.branchId);

    if (data.id) {
      await assertTherapist(db, providerId, data.id);
      const { id, ...rest } = data;
      await db
        .update(therapists)
        .set({ ...rest, updatedAt: new Date() })
        .where(eq(therapists.id, id));
      await logAudit({ actorId: user.id, actorRole: user.role, action: 'therapist.updated', entity: 'therapist', entityId: id });
      revalidateProvider(providerId, ['/provider/therapists', '/provider/availability']);
      return { ok: true, data: { id: data.id } };
    }

    const [created] = await db
      .insert(therapists)
      .values({ ...data, id: newId('thp') })
      .returning({ id: therapists.id });
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'therapist.created', entity: 'therapist', entityId: created!.id });
    revalidateProvider(providerId, ['/provider/therapists', '/provider/availability']);
    return { ok: true, data: { id: created!.id } };
  } catch {
    return fail('Could not save the therapist.');
  }
}

export async function setTherapistActive(therapistId: string, active: boolean): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    await assertTherapist(db, providerId, therapistId);
    await db.update(therapists).set({ active, updatedAt: new Date() }).where(eq(therapists.id, therapistId));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'therapist.status', entity: 'therapist', entityId: therapistId, meta: { active } });
    revalidateProvider(providerId, ['/provider/therapists', '/provider/availability']);
    return { ok: true };
  } catch {
    return fail('Could not update the therapist.');
  }
}

/* ----------------------------- availability -------------------------- */

const scheduleSchema = z.object({
  therapistId: z.string().min(1),
  entries: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .max(42),
});

/** Replace a therapist's weekly schedule atomically. */
export async function saveWeeklySchedule(input: z.infer<typeof scheduleSchema>): Promise<ActionResult> {
  try {
    const parsed = scheduleSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid schedule.');
    const { db, providerId, user } = await providerCtx();
    await assertTherapist(db, providerId, parsed.data.therapistId);

    for (const e of parsed.data.entries) {
      if (!isValidTime(e.startTime) || !isValidTime(e.endTime)) return fail('Times must look like 09:00.');
      if (minutesOf(e.endTime) <= minutesOf(e.startTime)) return fail('End time must be after start time.');
    }
    const seen = new Set<string>();
    for (const e of parsed.data.entries) {
      const key = `${e.weekday}-${e.startTime}`;
      if (seen.has(key)) return fail('Duplicate shift for the same day/time.');
      seen.add(key);
    }

    await db.transaction(async (tx) => {
      await tx.delete(schedules).where(eq(schedules.therapistId, parsed.data.therapistId));
      if (parsed.data.entries.length) {
        await tx.insert(schedules).values(
          parsed.data.entries.map((e) => ({
            id: newId('sch'),
            therapistId: parsed.data.therapistId,
            weekday: e.weekday,
            startTime: e.startTime,
            endTime: e.endTime,
          })),
        );
      }
    });
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'schedule.saved', entity: 'therapist', entityId: parsed.data.therapistId, meta: { shifts: parsed.data.entries.length } });
    revalidateProvider(providerId, ['/provider/availability', '/provider/calendar']);
    return { ok: true };
  } catch {
    return fail('Could not save the schedule.');
  }
}

const exceptionSchema = z.object({
  branchId: z.string().min(1),
  therapistId: z.string().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  kind: z.enum(['closed', 'special_hours']),
  reason: z.string().max(200).optional().nullable(),
});

export async function addException(input: z.infer<typeof exceptionSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = exceptionSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid entry.');
    const { db, providerId, user } = await providerCtx();
    await assertBranch(db, providerId, parsed.data.branchId);
    if (parsed.data.therapistId) await assertTherapist(db, providerId, parsed.data.therapistId);
    if (parsed.data.kind === 'special_hours' && (!parsed.data.startTime || !parsed.data.endTime))
      return fail('Special hours need a start and end time.');

    const [created] = await db
      .insert(scheduleExceptions)
      .values({ ...parsed.data, id: newId('exc') })
      .returning({ id: scheduleExceptions.id });
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'exception.added', entity: 'scheduleException', entityId: created!.id });
    revalidateProvider(providerId, ['/provider/availability', '/provider/calendar']);
    return { ok: true, data: { id: created!.id } };
  } catch {
    return fail('Could not add the closure.');
  }
}

export async function removeException(id: string): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    const row = await db.query.scheduleExceptions.findFirst({ where: eq(scheduleExceptions.id, id) });
    if (!row) return fail('Not found.');
    await assertBranch(db, providerId, row.branchId);
    await db.delete(scheduleExceptions).where(eq(scheduleExceptions.id, id));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'exception.removed', entity: 'scheduleException', entityId: id });
    revalidateProvider(providerId, ['/provider/availability', '/provider/calendar']);
    return { ok: true };
  } catch {
    return fail('Could not remove the closure.');
  }
}

/* ------------------------------- bookings ---------------------------- */

const transitionActions = {
  confirm: 'confirmed',
  complete: 'completed',
  noshow: 'no_show',
} as const;

export async function updateBookingStatus(
  bookingId: string,
  action: keyof typeof transitionActions | 'cancel',
): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    const booking = await assertBooking(db, providerId, bookingId);

    if (action === 'cancel') {
      await cancelBooking(db, bookingId, { actorRole: 'provider', reason: 'Cancelled by spa' });
    } else {
      const next = transitionActions[action];
      if (!next) return fail('Unknown action.');
      if (['cancelled', 'completed', 'no_show'].includes(booking.status))
        return fail('This booking can no longer be changed.');
      await db.update(bookings).set({ status: next, updatedAt: new Date() }).where(eq(bookings.id, bookingId));
    }
    await logAudit({ actorId: user.id, actorRole: user.role, action: `booking.${action}`, entity: 'booking', entityId: bookingId });
    revalidateProvider(providerId, ['/provider/bookings', '/provider/calendar']);
    return { ok: true };
  } catch (err) {
    const message = err instanceof BookingError ? err.message : 'Could not update the booking.';
    return fail(message);
  }
}

/* ------------------------------- profile ----------------------------- */

const profileSchema = z.object({
  name: z.string().min(2).max(120),
  tagline: z.string().max(180).optional().nullable(),
  description: z.string().max(6000).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().max(160).or(z.literal('')).optional().nullable(),
  website: z.union([z.string().url().max(240), z.literal('')]).optional().nullable(),
});

export async function saveProviderProfile(input: z.infer<typeof profileSchema>): Promise<ActionResult> {
  try {
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid profile data.');
    const { db, providerId, user } = await providerCtx();
    const data = parsed.data;
    await db
      .update(providers)
      .set({
        name: data.name,
        tagline: data.tagline || null,
        description: data.description || null,
        phone: data.phone || null,
        email: data.email || null,
        website: data.website || null,
        updatedAt: new Date(),
      })
      .where(eq(providers.id, providerId));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'provider.profile_updated', entity: 'provider', entityId: providerId });
    revalidatePath('/provider/settings');
    revalidatePath('/');
    return { ok: true };
  } catch {
    return fail('Could not save your profile.');
  }
}

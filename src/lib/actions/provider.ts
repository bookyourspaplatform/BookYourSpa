'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type AppDb } from '@/db';
import {
  bookings,
  branchTreatments,
  branches,
  products,
  promotions,
  providers,
  reviews,
  scheduleExceptions,
  schedules,
  therapists,
  treatments,
  PROMO_POSITIONS,
  SPA_CATEGORIES,
  SPA_FACILITIES,
  SPA_TYPES,
  TREATMENT_CATEGORIES,
  USER_STATUSES,
} from '@/db/schema';
import { sanitizeRichText } from '@/lib/security';
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
  website: z.union([z.string().url().max(240), z.literal('')]).optional().nullable(),
  description: z.string().max(60000).optional().nullable(),
  googleMapsUrl: z.union([z.string().url().max(500), z.literal('')]).optional().nullable(),
  lat: z.string().max(40).optional().nullable(),
  lng: z.string().max(40).optional().nullable(),
  tagline: z.string().max(140).optional().nullable(),
  shortDescription: z.string().max(160).optional().nullable(),
  categories: z.array(z.enum(SPA_CATEGORIES)).max(6).default([]),
  spaTypes: z.array(z.enum(SPA_TYPES)).max(20).default([]),
  doorstepService: z.boolean().default(false),
  facilities: z.array(z.enum(SPA_FACILITIES)).max(20).default([]),
  images: z
    .array(z.string().max(4_000_000))
    .max(10)
    .default([]),
  hours: hoursSchema.optional(),
  leadTimeMinutes: z.number().int().min(0).max(60 * 24 * 7),
  maxAdvanceDays: z.number().int().min(1).max(400),
  bufferMinutes: z.number().int().min(0).max(240),
  slotIntervalMinutes: z.number().int().min(5).max(240),
  // Payments are platform-configured — the form no longer edits these.
  onlinePaymentEnabled: z.boolean().optional(),
  paymentMethods: z.array(z.enum(['stripe', 'paypal', 'razorpay', 'venue'])).min(1).optional(),
  status: z.enum(USER_STATUSES).optional(),
});

function cleanCoord(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return /^-?\d{1,3}(\.\d+)?$/.test(v) ? v : null;
}

export async function saveBranch(input: z.infer<typeof branchSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = branchSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid branch data.');
    const { db, providerId, user } = await providerCtx();
    const { id, ...data } = parsed.data;

    // Shared shape for create + update. Empty strings → null; rich text sanitized;
    // payment fields are optional (platform-configured) and omitted when absent.
    const payload = {
      ...data,
      email: data.email || null,
      website: data.website || null,
      description: data.description ? sanitizeRichText(data.description) : null,
      googleMapsUrl: data.googleMapsUrl || null,
      lat: cleanCoord(data.lat),
      lng: cleanCoord(data.lng),
      tagline: data.tagline || null,
      shortDescription: data.shortDescription || null,
      images: data.images.filter((s) => /^https?:\/\//i.test(s) || /^data:image\//i.test(s)).slice(0, 10),
    };

    if (id) {
      await assertBranch(db, providerId, id);
      const slug = await uniqueBranchSlug(db, providerId, data.name, id);
      const [updated] = await db
        .update(branches)
        .set({ ...payload, slug, updatedAt: new Date() })
        .where(and(eq(branches.id, id), eq(branches.providerId, providerId)))
        .returning({ id: branches.id });
      await logAudit({ actorId: user.id, actorRole: user.role, action: 'branch.updated', entity: 'branch', entityId: id });
      revalidateProvider(providerId, ['/provider/branches', '/provider/availability']);
      return { ok: true, data: { id: updated!.id } };
    }

    const slug = await uniqueBranchSlug(db, providerId, data.name);
    const [created] = await db
      .insert(branches)
      .values({ ...payload, id: newId('brn'), providerId, slug })
      .returning({ id: branches.id });
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'branch.created', entity: 'branch', entityId: created!.id });
    revalidateProvider(providerId, ['/provider/branches', '/provider/availability']);
    return { ok: true, data: { id: created!.id } };
  } catch {
    return fail('Could not save the branch.');
  }
}

/* --------------------------- Google Maps import ------------------------- */

export type GoogleMapsImport = {
  ok: true;
  data: {
    lat: string | null;
    lng: string | null;
    name: string | null;
    phone: string | null;
    website: string | null;
    address: string | null;
    resolvedUrl: string;
    /** 'places' = enriched via GOOGLE_MAPS_API_KEY, 'url' = parsed from the link only. */
    source: 'places' | 'url';
  };
} | { ok: false; error: string };

const MAPS_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
  'www.goo.gl',
]);

function allowedMapsUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase();
    if (!MAPS_HOSTS.has(host)) return null;
    if (host === 'goo.gl' || host === 'www.goo.gl') {
      if (!u.pathname.startsWith('/maps')) return null;
    }
    return u;
  } catch {
    return null;
  }
}

/** Follow redirects manually (validating every hop) to resolve short links. */
async function resolveMapsUrl(start: string): Promise<string> {
  let current = start;
  for (let hop = 0; hop < 5; hop++) {
    const url = allowedMapsUrl(current);
    if (!url) return current;
    const res = await fetch(url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!res) return current;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return current;
      try {
        current = new URL(loc, url).toString();
      } catch {
        return current;
      }
      continue;
    }
    return res.url || current;
  }
  return current;
}

function parseCoordsFromUrl(raw: string): { lat: string | null; lng: string | null; name: string | null } {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  let lat: string | null = null;
  let lng: string | null = null;

  // /maps/.../@lat,lng[,zoom]
  const at = decoded.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,[\d.]+z?)?/);
  if (at) {
    lat = at[1]!;
    lng = at[2]!;
  }
  // data payload !3dLAT!4dLNG
  if (!lat) {
    const bang = decoded.match(/!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
    if (bang) {
      lat = bang[1]!;
      lng = bang[2]!;
    }
  }
  // q=lat,lng or center=lat,lng
  if (!lat) {
    const q = decoded.match(/[?&](?:q|center)=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
    if (q) {
      lat = q[1]!;
      lng = q[2]!;
    }
  }
  if (lat && (Number(lat) < -90 || Number(lat) > 90 || Number(lng) < -180 || Number(lng) > 180)) {
    lat = null;
    lng = null;
  }

  // Readable place name from /maps/place/Some+Place/…
  let name: string | null = null;
  const place = decoded.match(/\/maps\/place\/([^/?#]+)/);
  if (place) {
    const cleaned = place[1]!
      .replace(/\/.*$/, '')
      .replace(/\+/g, ' ')
      .replace(/@-?\d.*/, '')
      .trim();
    if (cleaned && !/^\d/.test(cleaned)) name = cleaned.slice(0, 120);
  }

  return { lat, lng, name };
}

/**
 * Import business details from a Google Maps link.
 * Coordinates + place name are parsed from the (redirect-resolved) URL — no key
 * needed. Phone/website/address require GOOGLE_MAPS_API_KEY to be configured;
 * without it the response returns what the URL itself carried.
 */
export async function importGoogleMaps(rawUrl: string): Promise<GoogleMapsImport> {
  try {
    const initial = allowedMapsUrl(rawUrl);
    if (!initial) {
      return { ok: false, error: 'Paste a Google Maps link (google.com/maps/… or a maps.app.goo.gl share link).' };
    }

    const resolved = await resolveMapsUrl(initial.toString());
    const parsed = parseCoordsFromUrl(resolved);

    if (!parsed.lat || !parsed.lng) {
      return {
        ok: false,
        error:
          'No coordinates found in that link. In Google Maps, right-click the place → Share or embed image → Copy link, and paste it here (you can still enter lat/lng manually).',
      };
    }

    const data = {
      lat: parsed.lat,
      lng: parsed.lng,
      name: parsed.name,
      phone: null as string | null,
      website: null as string | null,
      address: null as string | null,
      resolvedUrl: resolved,
      source: 'url' as 'places' | 'url',
    };

    // Optional enrichment (requires GOOGLE_MAPS_API_KEY with Places API enabled).
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (key) {
      try {
        // Prefer the placeId embedded in the URL; otherwise look up by coordinates.
        let placeId = resolved.match(/!1s(ChIJ[\w-]+)/)?.[1] ?? null;
        if (!placeId) {
          const search = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
            body: JSON.stringify({
              locationRestriction: {
                circle: { center: { latitude: Number(parsed.lat), longitude: Number(parsed.lng) }, radius: 80 },
              },
              includedTypes: ['spa', 'health'],
              maxResultCount: 1,
            }),
            signal: AbortSignal.timeout(8000),
          }).catch(() => null);
          if (search?.ok) {
            const json = (await search.json()) as { places?: { id?: string }[] };
            placeId = json.places?.[0]?.id ?? null;
          }
        }
        if (placeId) {
          const details = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
            headers: {
              'X-Goog-Api-Key': key,
              'X-Goog-FieldMask': 'displayName,formattedAddress,nationalPhoneNumber,websiteUri',
            },
            signal: AbortSignal.timeout(8000),
          }).catch(() => null);
          if (details?.ok) {
            const json = (await details.json()) as {
              displayName?: { text?: string };
              formattedAddress?: string;
              nationalPhoneNumber?: string;
              websiteUri?: string;
            };
            data.name = json.displayName?.text ?? data.name;
            data.address = json.formattedAddress ?? null;
            data.phone = json.nationalPhoneNumber ?? null;
            data.website = json.websiteUri ?? null;
            data.source = 'places';
          }
        }
      } catch {
        /* enrichment is best-effort — URL parsing already succeeded */
      }
    }

    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Could not reach Google Maps to import that link.' };
  }
}

export async function deleteBranch(branchId: string): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    await assertBranch(db, providerId, branchId);

    const bookingRows = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.branchId, branchId))
      .limit(1);
    if (bookingRows.length > 0) {
      return fail(
        'This branch has bookings and cannot be deleted. Suspend it instead — customers keep access to their vouchers.',
      );
    }

    await db.delete(branches).where(and(eq(branches.id, branchId), eq(branches.providerId, providerId)));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'branch.deleted', entity: 'branch', entityId: branchId });
    revalidateProvider(providerId, ['/provider/branches', '/provider/availability', '/provider/treatments', '/provider/therapists']);
    return { ok: true };
  } catch {
    return fail('Could not delete the branch.');
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
  /** Spa-type tags (shared vocabulary with the spa editor). */
  tags: z.array(z.string().max(60)).max(14).default([]),
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

/* ------------------------------- products ---------------------------- */

const productSchema = z.object({
  id: z.string().optional(),
  branchId: z.string().min(1),
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional().nullable(),
  price: z.number().int().min(0).max(1_000_000_000),
  imageUrl: z.string().max(400).optional().nullable(),
  active: z.boolean().default(true),
});

export async function saveProduct(input: z.infer<typeof productSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = productSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid product data.');
    const { db, providerId, user } = await providerCtx();
    const branch = await assertBranch(db, providerId, parsed.data.branchId);
    const payload = {
      name: parsed.data.name,
      description: parsed.data.description || null,
      price: parsed.data.price,
      currency: branch.currency,
      imageUrl: parsed.data.imageUrl || null,
      active: parsed.data.active,
    };

    if (parsed.data.id) {
      const row = await db.query.products.findFirst({ where: eq(products.id, parsed.data.id) });
      if (!row || row.providerId !== providerId) return fail('Product not found.');
      await db.update(products).set({ ...payload, updatedAt: new Date() }).where(eq(products.id, parsed.data.id));
      await logAudit({ actorId: user.id, actorRole: user.role, action: 'product.updated', entity: 'product', entityId: parsed.data.id });
      revalidateProvider(providerId, [`/provider/branches/${parsed.data.branchId}`]);
      return { ok: true, data: { id: parsed.data.id } };
    }

    const [created] = await db
      .insert(products)
      .values({ ...payload, id: newId('prd'), providerId, branchId: parsed.data.branchId })
      .returning({ id: products.id });
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'product.created', entity: 'product', entityId: created!.id });
    revalidateProvider(providerId, [`/provider/branches/${parsed.data.branchId}`]);
    return { ok: true, data: { id: created!.id } };
  } catch {
    return fail('Could not save the product.');
  }
}

export async function setProductActive(productId: string, active: boolean): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    const row = await db.query.products.findFirst({ where: eq(products.id, productId) });
    if (!row || row.providerId !== providerId) return fail('Product not found.');
    await db.update(products).set({ active, updatedAt: new Date() }).where(eq(products.id, productId));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'product.status', entity: 'product', entityId: productId, meta: { active } });
    revalidateProvider(providerId, [`/provider/branches/${row.branchId}`]);
    return { ok: true };
  } catch {
    return fail('Could not update the product.');
  }
}

export async function deleteProduct(productId: string): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    const row = await db.query.products.findFirst({ where: eq(products.id, productId) });
    if (!row || row.providerId !== providerId) return fail('Product not found.');
    await db.delete(products).where(eq(products.id, productId));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'product.deleted', entity: 'product', entityId: productId });
    revalidateProvider(providerId, [`/provider/branches/${row.branchId}`]);
    return { ok: true };
  } catch {
    return fail('Could not delete the product.');
  }
}

/* ------------------------ provider promotions ----------------------- */

const branchPromoSchema = z.object({
  id: z.string().optional(),
  branchId: z.string().min(1),
  title: z.string().min(2).max(160),
  summary: z.string().max(400).optional().nullable(),
  position: z.enum(PROMO_POSITIONS),
  startsAt: z.string().optional().nullable(),
  endsAt: z.string().optional().nullable(),
  active: z.boolean().default(true),
});

async function assertPromotion(db: AppDb, providerId: string, promotionId: string) {
  const row = await db.query.promotions.findFirst({ where: eq(promotions.id, promotionId) });
  const owned =
    row &&
    (row.providerId === providerId ||
      (row.branchId ? (await db.query.branches.findFirst({ where: eq(branches.id, row.branchId) }))?.providerId === providerId : false));
  if (!row || !owned) throw new Error('Promotion not found.');
  return row;
}

export async function saveBranchPromotion(input: z.infer<typeof branchPromoSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = branchPromoSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid promotion.');
    const { db, providerId, user } = await providerCtx();
    await assertBranch(db, providerId, parsed.data.branchId);
    const data = parsed.data;
    const payload = {
      title: data.title,
      summary: data.summary || null,
      position: data.position,
      startsAt: data.startsAt ? new Date(`${data.startsAt}T00:00:00Z`) : null,
      endsAt: data.endsAt ? new Date(`${data.endsAt}T23:59:59Z`) : null,
      active: data.active,
    };

    if (data.id) {
      await assertPromotion(db, providerId, data.id);
      await db.update(promotions).set(payload).where(eq(promotions.id, data.id));
      await logAudit({ actorId: user.id, actorRole: user.role, action: 'promo.updated', entity: 'promotion', entityId: data.id });
      revalidateProvider(providerId, [`/provider/branches/${data.branchId}`]);
      revalidatePath('/deals');
      return { ok: true, data: { id: data.id } };
    }

    let slug = slugify(data.title) || 'promo';
    const dupe = await db.query.promotions.findFirst({ where: eq(promotions.slug, slug) });
    if (dupe) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const [created] = await db
      .insert(promotions)
      .values({ ...payload, id: newId('prm'), slug, providerId, branchId: data.branchId })
      .returning({ id: promotions.id });
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'promo.created', entity: 'promotion', entityId: created!.id });
    revalidateProvider(providerId, [`/provider/branches/${data.branchId}`]);
    revalidatePath('/deals');
    return { ok: true, data: { id: created!.id } };
  } catch {
    return fail('Could not save the promotion.');
  }
}

export async function setPromotionActive(promotionId: string, active: boolean): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    const row = await assertPromotion(db, providerId, promotionId);
    await db.update(promotions).set({ active }).where(eq(promotions.id, promotionId));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'promo.status', entity: 'promotion', entityId: promotionId, meta: { active } });
    revalidateProvider(providerId, row.branchId ? [`/provider/branches/${row.branchId}`] : []);
    revalidatePath('/deals');
    return { ok: true };
  } catch {
    return fail('Could not update the promotion.');
  }
}

export async function deletePromotion(promotionId: string): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    const row = await assertPromotion(db, providerId, promotionId);
    await db.delete(promotions).where(eq(promotions.id, promotionId));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'promo.deleted', entity: 'promotion', entityId: promotionId });
    revalidateProvider(providerId, row.branchId ? [`/provider/branches/${row.branchId}`] : []);
    revalidatePath('/deals');
    return { ok: true };
  } catch {
    return fail('Could not delete the promotion.');
  }
}

/* ------------------------------ reviews ----------------------------- */

async function assertReview(db: AppDb, providerId: string, reviewId: string) {
  const row = await db.query.reviews.findFirst({ where: eq(reviews.id, reviewId) });
  if (!row) throw new Error('Review not found.');
  await assertBranch(db, providerId, row.branchId);
  return row;
}

export async function setReviewStatus(reviewId: string, status: 'published' | 'hidden'): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    await assertReview(db, providerId, reviewId);
    await db.update(reviews).set({ status, updatedAt: new Date() }).where(eq(reviews.id, reviewId));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'review.status', entity: 'review', entityId: reviewId, meta: { status } });
    revalidateProvider(providerId, ['/provider/branches']);
    return { ok: true };
  } catch {
    return fail('Could not update the review.');
  }
}

export async function deleteReview(reviewId: string): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    const row = await assertReview(db, providerId, reviewId);
    await db.delete(reviews).where(eq(reviews.id, reviewId));
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'review.deleted', entity: 'review', entityId: reviewId });
    revalidateProvider(providerId, [`/provider/branches/${row.branchId}`]);
    return { ok: true };
  } catch {
    return fail('Could not delete the review.');
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

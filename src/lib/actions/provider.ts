'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type AppDb } from '@/db';
import {
  bookings,
  branchTreatments,
  branches,
  bookingProducts,
  commissions,
  payments,
  products,
  promotions,
  providerPromotions,
  providers,
  reviews,
  scheduleExceptions,
  schedules,
  therapists,
  treatments,
  PROMO_POSITIONS,
  PROMO_APPLIES_TO,
  DISCOUNT_TYPES,
  STAFF_ROLES,
  STAFF_PAY_TYPES,
  USER_STATUSES,
} from '@/db/schema';
import { branchPayload, branchSchema, uniqueBranchSlug } from '@/lib/branch';
import { treatmentPayload, treatmentSchema } from '@/lib/treatment';
import { requireUser } from '@/lib/auth/session';
import { cancelBooking, hasSlotConflict, BookingError } from '@/lib/booking';
import { zonedToUtc } from '@/lib/availability';
import { logAudit } from '@/lib/audit';
import { getSettings } from '@/lib/settings';
import { branchOptionPrice, pickPriceOption } from '@/lib/pricing';
import { formatMoney } from '@/lib/money';
import { clamp, newId, newVoucherCode, slugify, isValidTime, hhmm, minutesOf } from '@/lib/utils';

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


/* ------------------------------ branches ----------------------------- */

export async function saveBranch(input: z.infer<typeof branchSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = branchSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid branch data.');
    const { db, providerId, user } = await providerCtx();
    const { id, ...data } = parsed.data;

    // Shared shape for create + update (cleaning lives in @/lib/branch so the
    // admin action writes identical rows).
    const payload = branchPayload(data);

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
    /** Google's own rating and review count when GOOGLE_MAPS_API_KEY enrichment ran (e.g. 4.8 / 9062). */
    rating: number | null;
    ratingCount: number | null;
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
      rating: null as number | null,
      ratingCount: null as number | null,
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
              'X-Goog-FieldMask': 'displayName,formattedAddress,nationalPhoneNumber,websiteUri,rating,userRatingCount',
            },
            signal: AbortSignal.timeout(8000),
          }).catch(() => null);
          if (details?.ok) {
            const json = (await details.json()) as {
              displayName?: { text?: string };
              formattedAddress?: string;
              nationalPhoneNumber?: string;
              websiteUri?: string;
              rating?: number;
              userRatingCount?: number;
            };
            data.name = json.displayName?.text ?? data.name;
            data.address = json.formattedAddress ?? null;
            data.phone = json.nationalPhoneNumber ?? null;
            data.website = json.websiteUri ?? null;
            if (typeof json.rating === 'number') data.rating = Math.round(json.rating * 10) / 10;
            if (typeof json.userRatingCount === 'number') data.ratingCount = json.userRatingCount;
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

/**
 * Published review aggregate for a branch — feeds the Google-style badge on
 * the spa form (stars · average · count). Any signed-in role may read it:
 * the same numbers render on the public branch page.
 */
export async function getBranchReviewStats(
  branchId: string,
): Promise<ActionResult<{ avg: number; count: number }>> {
  try {
    await requireUser();
    if (!branchId) return fail('Location not found.');
    const db = await getDb();
    const branch = await db.query.branches.findFirst({ where: eq(branches.id, branchId) });
    if (!branch) return fail('Location not found.');
    const rows = await db
      .select({ avg: sql<string>`avg(${reviews.rating})`, n: sql<number>`count(*)::int` })
      .from(reviews)
      .where(and(eq(reviews.branchId, branchId), eq(reviews.status, 'published')));
    const n = rows[0]?.n ?? 0;
    if (!n) return { ok: true, data: { avg: 0, count: 0 } };
    return { ok: true, data: { avg: Math.round(Number(rows[0]!.avg) * 10) / 10, count: n } };
  } catch {
    return fail('Could not load review stats.');
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

export async function saveTreatment(
  input: z.infer<typeof treatmentSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = treatmentSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid treatment data.');
    const { db, providerId, user } = await providerCtx();
    const data = parsed.data;
    const payload = treatmentPayload(data);

    if (data.id) {
      await assertTreatment(db, providerId, data.id);
      const { id } = data;
      await db
        .update(treatments)
        .set({ ...payload, updatedAt: new Date() })
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
        ...payload,
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
  /** Device upload (data URL) or a link; never anything executable. */
  avatarUrl: z
    .string()
    .max(2_500_000)
    .optional()
    .nullable()
    .refine((v) => !v || v.startsWith('data:image/') || /^https?:\/\//.test(v), 'Photo must be an image upload or a link.')
    .transform((v) => v?.trim() || null),
  role: z.enum(STAFF_ROLES).default('therapist'),
  /** fixed = manual amount, percent = share of every job (basis points). */
  salaryType: z.enum(STAFF_PAY_TYPES).default('fixed'),
  salaryValue: z.number().int().min(0).max(1_000_000_000).default(0),
  incentiveType: z.enum(STAFF_PAY_TYPES).default('fixed'),
  incentiveValue: z.number().int().min(0).max(1_000_000_000).default(0),
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

/* -------------------------------- POS ---------------------------------- */

const posItemSchema = z.object({
  treatmentId: z.string().min(1),
  optionIndex: z.number().int().min(0).max(9).default(0),
  qty: z.number().int().min(1).max(20),
  /** Branch-local start time, "HH:MM". */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** One therapist per slot — qty × therapistsPerBooking, in unit order. */
  therapistIds: z.array(z.string().min(1)).max(8).default([]),
});

const posSaleSchema = z.object({
  branchId: z.string().min(1),
  guestName: z.string().trim().min(1).max(120),
  guestEmail: z.string().trim().max(200).optional().nullable(),
  guestPhone: z.string().trim().max(40).optional().nullable(),
  /** Branch-local calendar date (YYYY-MM-DD). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(posItemSchema).min(1).max(8),
  products: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
    .max(20)
    .default([]),
  discountPercent: z.number().min(0).max(100).default(0),
  /** Negotiated total in minor units — the till sends its computed total. */
  amount: z.number().int().min(0).max(1_000_000_000).optional(),
  paymentMethod: z.enum(['cash', 'card', 'other']).default('cash'),
  notes: z.string().max(400).optional().nullable(),
});

export type PosSaleItem = { name: string; qty: number; amount: number };
export type PosSaleShare = { name: string; bps: number; amount: number };

export type PosSaleResult = {
  id: string;
  code: string;
  total: number;
  platformFee: number;
  /** Total − platform fee − therapist shares. */
  spaIncome: number;
  currency: string;
  paymentMethod: string;
  items: PosSaleItem[];
  shares: PosSaleShare[];
};

/** Walk-in sale taken at the front desk — always captured as paid. */
export async function createPosSale(input: z.infer<typeof posSaleSchema>): Promise<ActionResult<PosSaleResult>> {
  try {
    const parsed = posSaleSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid sale.');
    const { db, providerId, user } = await providerCtx();
    const data = parsed.data;

    const branch = await assertBranch(db, providerId, data.branchId);

    /* --- catalog: every treatment must be live and offered here --- */
    const treatmentIds = [...new Set(data.items.map((i) => i.treatmentId))];
    const [treatmentRows, links, branchStaff] = await Promise.all([
      db.query.treatments.findMany({ where: inArray(treatments.id, treatmentIds) }),
      db.query.branchTreatments.findMany({
        where: and(
          eq(branchTreatments.branchId, branch.id),
          inArray(branchTreatments.treatmentId, treatmentIds),
        ),
      }),
      db.query.therapists.findMany({
        where: eq(therapists.branchId, branch.id),
        columns: {
          id: true,
          name: true,
          active: true,
          salaryType: true,
          salaryValue: true,
          incentiveType: true,
          incentiveValue: true,
        },
      }),
    ]);
    const activeStaff = branchStaff.filter((s) => s.active);

    /* --- one row per therapist slot: qty × therapists-per-booking --- */
    type Slot = {
      treatmentId: string;
      therapistId: string | null;
      listUnit: number;
      startAt: Date;
      endAt: Date;
    };
    const slots: Slot[] = [];
    const lineItems: PosSaleItem[] = [];

    for (const item of data.items) {
      const treatment = treatmentRows.find((t) => t.id === item.treatmentId);
      if (!treatment || treatment.status !== 'active') return fail('That treatment is not published.');
      const link = links.find((l) => l.treatmentId === item.treatmentId);
      if (!link || !link.active) return fail('That treatment is not offered at this branch.');

      const option = pickPriceOption(treatment.priceOptions, item.optionIndex);
      const unitPrice = option
        ? branchOptionPrice(option, treatment.listPrice, link.price)
        : link.price;
      const durationMin = option?.durationMin ?? treatment.durationMin;
      const per = treatment.requiresTherapist
        ? clamp(Math.max(1, treatment.therapistsPerBooking ?? 1), 1, 4)
        : 1;
      const slotCount = item.qty * per;

      const ids: (string | null)[] = item.therapistIds.slice(0, slotCount);
      while (ids.length < slotCount) ids.push(null);
      if (treatment.requiresTherapist && activeStaff.length && ids.some((id) => !id))
        return fail(`Assign a therapist for every ${treatment.name} slot.`);
      const assigned = ids.filter((id): id is string => Boolean(id));
      if (new Set(assigned).size !== assigned.length)
        return fail(`The same therapist is listed twice on ${treatment.name}.`);
      for (const id of assigned) {
        const person = branchStaff.find((s) => s.id === id);
        if (!person) return fail('That staff member does not work at this branch.');
        if (!person.active) return fail('That staff member is inactive.');
      }

      const startAt = zonedToUtc(data.date, minutesOf(item.time), branch.timezone);
      const endAt = new Date(startAt.getTime() + durationMin * 60_000);

      // A couples treatment's price is shared by its therapists (275 each of 550).
      const sliceOf = (j: number) =>
        per === 1 ? unitPrice : Math.round((unitPrice * (j + 1)) / per) - Math.round((unitPrice * j) / per);

      for (let u = 0; u < item.qty; u++) {
        for (let j = 0; j < per; j++) {
          slots.push({
            treatmentId: treatment.id,
            therapistId: treatment.requiresTherapist ? ids[u * per + j] ?? null : null,
            listUnit: sliceOf(j),
            startAt,
            endAt,
          });
        }
      }
      lineItems.push({
        name: `${treatment.name} (${durationMin} min)`,
        qty: item.qty,
        amount: unitPrice * item.qty,
      });
    }

    /* --- retail products (sold from this branch's shelf) --- */
    const productLines: {
      productId: string;
      name: string;
      unitPrice: number;
      quantity: number;
    }[] = [];
    if (data.products.length) {
      const pids = [...new Set(data.products.map((p) => p.productId))];
      const rows = await db.query.products.findMany({
        where: and(eq(products.branchId, branch.id), inArray(products.id, pids)),
      });
      for (const req of data.products) {
        const row = rows.find((r) => r.id === req.productId);
        if (!row || !row.active) return fail('A product in this sale is no longer available.');
        if (row.currency !== branch.currency) return fail('Product currency does not match this branch.');
        productLines.push({
          productId: row.id,
          name: row.name,
          unitPrice: row.price,
          quantity: req.quantity,
        });
      }
    }
    const productsGross = productLines.reduce((sum, p) => sum + p.unitPrice * p.quantity, 0);

    /* --- money: walk-in total, discount, platform fee --- */
    const settings = await getSettings();
    const posBps = settings['finance.posCommissionBps'];
    const treatmentsGross = slots.reduce((sum, s) => sum + s.listUnit, 0);
    const gross = treatmentsGross + productsGross;
    const pctOff = Math.round((gross * clamp(data.discountPercent, 0, 100)) / 100);
    const negotiated = data.amount && data.amount > 0 ? data.amount : Math.max(0, gross - pctOff);
    const listPrice = Math.max(gross, negotiated);
    const discountAmount = Math.max(0, listPrice - negotiated);
    const total = negotiated;
    const platformFee = Math.round((total * posBps) / 10_000);
    const ratio = listPrice > 0 ? total / listPrice : 0;

    /* --- therapist shares: their percentage of what they personally served --- */
    const shareAcc = new Map<string, { name: string; bps: number; paid: number }>();
    for (const slot of slots) {
      if (!slot.therapistId) continue;
      const person = branchStaff.find((s) => s.id === slot.therapistId);
      if (!person) continue;
      const bps =
        (person.salaryType === 'percent' ? person.salaryValue : 0) +
        (person.incentiveType === 'percent' ? person.incentiveValue : 0);
      const found = shareAcc.get(person.id);
      if (found) found.paid += slot.listUnit * ratio;
      else shareAcc.set(person.id, { name: person.name, bps, paid: slot.listUnit * ratio });
    }
    const shares: PosSaleShare[] = [...shareAcc.values()].map((s) => ({
      name: s.name,
      bps: s.bps,
      amount: Math.round((s.paid * Math.min(s.bps, 10_000)) / 10_000),
    }));
    const sharesTotal = shares.reduce((sum, s) => sum + s.amount, 0);

    /* --- split the sale across rows so every figure sums to the totals --- */
    const surplus = Math.max(0, listPrice - gross);
    const rowList = slots.map((s, i) => s.listUnit + (i === 0 ? productsGross + surplus : 0));
    const rowDiscount = rowList.map((l) =>
      listPrice > 0 ? Math.floor((discountAmount * l) / listPrice) : 0,
    );
    rowDiscount[0] = (rowDiscount[0] ?? 0) + (discountAmount - rowDiscount.reduce((s, d) => s + d, 0));
    const rowTotals = rowList.map((l, i) => l - rowDiscount[i]!);
    const rowFee = rowTotals.map((t) => (total > 0 ? Math.round((platformFee * t) / total) : 0));
    rowFee[0] = (rowFee[0] ?? 0) + (platformFee - rowFee.reduce((s, f) => s + f, 0));

    const now = new Date();
    const groupId = newId('grp');
    const shareNote = shares.length
      ? `staff share ${shares
          .map((s) => `${s.name} ${formatMoney(s.amount, branch.currency)}`)
          .join(', ')}`
      : null;
    const saleNotes = [data.notes?.trim() || null, `POS · ${data.paymentMethod}`]
      .filter(Boolean)
      .join(' — ');

    const rows = await db.transaction(async (tx) => {
      const created: (typeof bookings.$inferSelect)[] = [];

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]!;
        const providerEarning = rowTotals[i]! - rowFee[i]!;
        const [row] = await tx
          .insert(bookings)
          .values({
            id: newId('bkg'),
            code: newVoucherCode(),
            groupId,
            providerId,
            branchId: branch.id,
            treatmentId: slot.treatmentId,
            therapistId: slot.therapistId,
            guestName: data.guestName,
            guestEmail: (data.guestEmail ?? '').trim().toLowerCase(),
            guestPhone: data.guestPhone || null,
            guestCount: 1,
            startAt: slot.startAt,
            endAt: slot.endAt,
            timezone: branch.timezone,
            status: 'confirmed',
            paymentStatus: 'paid',
            channel: 'pos',
            currency: branch.currency,
            listPrice: rowList[i]!,
            discountAmount: rowDiscount[i]!,
            totalAmount: rowTotals[i]!,
            platformFee: rowFee[i]!,
            agentCommission: 0,
            providerEarning,
            expiresAt: null,
            paidAt: now,
            notes: i === 0 ? [saleNotes, shareNote].filter(Boolean).join(' — ').slice(0, 400) : saleNotes,
          })
          .returning();
        const row2 = row!;
        created.push(row2);

        const ledger: (typeof commissions.$inferInsert)[] = [];
        if (row2.platformFee > 0) {
          ledger.push({
            id: newId('com'),
            bookingId: row2.id,
            party: 'platform',
            providerId,
            rateBps: posBps,
            amount: row2.platformFee,
            currency: row2.currency,
          });
        }
        if (row2.providerEarning > 0) {
          ledger.push({
            id: newId('com'),
            bookingId: row2.id,
            party: 'provider',
            providerId,
            amount: row2.providerEarning,
            currency: row2.currency,
          });
        }
        if (ledger.length) await tx.insert(commissions).values(ledger);

        await tx.insert(payments).values({
          id: newId('pay'),
          bookingId: row2.id,
          gateway: 'venue',
          status: 'succeeded',
          amount: row2.totalAmount,
          currency: row2.currency,
          gatewayData: { source: 'pos', method: data.paymentMethod },
          paidAt: now,
        });
      }

      /* Retail lines hang off the group's primary booking. */
      if (productLines.length) {
        await tx.insert(bookingProducts).values(
          productLines.map((p) => ({
            id: newId('bpr'),
            bookingId: created[0]!.id,
            productId: p.productId,
            name: p.name,
            unitPrice: p.unitPrice,
            quantity: p.quantity,
            currency: branch.currency,
          })),
        );
      }

      return created;
    });

    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'pos.sale',
      entity: 'booking',
      entityId: rows[0]!.id,
      meta: { total, method: data.paymentMethod, slots: slots.length },
    });
    revalidateProvider(providerId, ['/provider/pos', '/provider/bookings', '/provider/calendar', '/provider/earnings']);

    return {
      ok: true,
      data: {
        id: rows[0]!.id,
        code: rows[0]!.code,
        total,
        platformFee,
        spaIncome: Math.max(0, total - platformFee - sharesTotal),
        currency: branch.currency,
        paymentMethod: data.paymentMethod,
        items: [
          ...lineItems,
          ...productLines.map((p) => ({
            name: p.name,
            qty: p.quantity,
            amount: p.unitPrice * p.quantity,
          })),
        ],
        shares,
      },
    };
  } catch (err) {
    // Drizzle wraps the driver error — walk `cause` to reach the SQLSTATE.
    let cur: unknown = err;
    let code: string | undefined;
    for (let depth = 0; depth < 5 && cur; depth++) {
      const candidate = (cur as { code?: unknown }).code;
      if (typeof candidate === 'string') {
        code = candidate;
        break;
      }
      cur = (cur as { cause?: unknown }).cause;
    }
    if (code === '23505')
      return fail('A therapist in this sale already has an appointment starting at that time.');
    return fail('Could not complete the sale.');
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

/**
 * Assign, swap or clear the therapist on a booking. Customers can book without
 * picking a therapist (auto-assign), and staff changes happen — so the spa must
 * be able to set one later or move it to somebody else.
 */
export async function setBookingTherapist(
  bookingId: string,
  therapistId: string | null,
): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    const booking = await assertBooking(db, providerId, bookingId);

    if (['cancelled', 'completed', 'no_show'].includes(booking.status))
      return fail('This booking can no longer be changed.');

    const treatment = await db.query.treatments.findFirst({ where: eq(treatments.id, booking.treatmentId) });
    if (!treatment?.requiresTherapist) return fail('This treatment does not need a therapist.');

    if (therapistId) {
      const person = await assertTherapist(db, providerId, therapistId);
      if (person.branchId !== booking.branchId) return fail('That therapist does not work at this branch.');
      if (person.role !== 'therapist') return fail('That staff member is not a bookable therapist.');
      if (!person.active) return fail('That therapist is inactive.');
      const busy = await hasSlotConflict(db, {
        branchId: booking.branchId,
        therapistId,
        startAt: booking.startAt,
        endAt: booking.endAt,
        excludeBookingId: booking.id,
      });
      if (busy) return fail(`${person.name} already has an appointment that overlaps this time.`);
    }

    try {
      await db
        .update(bookings)
        .set({ therapistId, updatedAt: new Date() })
        .where(eq(bookings.id, booking.id));
    } catch {
      // Partial unique index on (therapist_id, start_at) raced with another write.
      return fail('That therapist was just booked for this time — pick someone else.');
    }

    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'booking.therapist',
      entity: 'booking',
      entityId: booking.id,
      meta: { therapistId },
    });
    revalidateProvider(providerId, ['/provider/bookings', '/provider/calendar']);
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof BookingError || (err instanceof Error && err.message.endsWith('not found.'))
        ? err.message
        : 'Could not update the therapist.';
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
      revalidateProvider(providerId, [`/provider/branches/${parsed.data.branchId}`, '/provider/products']);
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
    revalidateProvider(providerId, [`/provider/branches/${row.branchId}`, '/provider/products']);
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
    revalidateProvider(providerId, [`/provider/branches/${row.branchId}`, '/provider/products']);
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
  linkUrl: z.string().max(400).optional().nullable(),
  position: z.enum(PROMO_POSITIONS),
  startsAt: z.string().optional().nullable(),
  endsAt: z.string().optional().nullable(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
  /* Redeemable code — the supplier form clones the admin promotion form. */
  code: z.string().trim().min(2).max(40),
  discountType: z.enum(DISCOUNT_TYPES).optional().nullable(),
  /** percent = basis points (1500 = 15%), fixed = minor units. */
  discountValue: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
  currency: z.string().length(3).optional().nullable(),
  minAmount: z.number().int().min(0).default(0),
  maxUses: z.number().int().min(0).default(0),
  /** 'all' = every treatment at the branch; 'selected' = treatmentIds below. */
  appliesTo: z.enum(PROMO_APPLIES_TO).default('all'),
  treatmentIds: z.array(z.string().max(40)).max(200).optional().nullable(),
  /** Optional daily hour window (spa local time), hours 0–23. */
  validFromHour: z.number().int().min(0).max(23).optional().nullable(),
  validUntilHour: z.number().int().min(0).max(23).optional().nullable(),
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

    const code = data.code.trim().toUpperCase();
    if (!code) return fail('Every promotion needs a promo code customers can redeem.');
    if (data.discountType && !(data.discountValue && data.discountValue > 0))
      return fail('Enter a discount value.');
    const dupe = await db.query.promotions.findFirst({
      where: eq(promotions.code, code),
      columns: { id: true },
    });
    if (dupe && dupe.id !== data.id) return fail('That code is already used by another promotion.');

    // Treatment scope — only this spa's own treatments may be selected.
    const treatmentIds = [...new Set((data.treatmentIds ?? []).map((t) => t.trim()).filter(Boolean))];
    if (data.appliesTo === 'selected') {
      if (treatmentIds.length === 0)
        return fail('Pick at least one treatment, or switch back to “All treatments”.');
      const owned = await db.query.treatments.findMany({
        where: and(eq(treatments.providerId, providerId), inArray(treatments.id, treatmentIds)),
        columns: { id: true },
      });
      if (owned.length !== treatmentIds.length) return fail('One of those treatments is not yours.');
    }

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
      treatmentIds: data.appliesTo === 'selected' ? treatmentIds : null,
      validFromHour: data.validFromHour ?? null,
      validUntilHour: data.validUntilHour ?? null,
    };

    if (data.id) {
      await assertPromotion(db, providerId, data.id);
      await db.update(promotions).set(payload).where(eq(promotions.id, data.id));
      await logAudit({ actorId: user.id, actorRole: user.role, action: 'promo.updated', entity: 'promotion', entityId: data.id });
      revalidateProvider(providerId, ['/provider/promotions', `/provider/branches/${data.branchId}`]);
      revalidatePath('/deals');
      return { ok: true, data: { id: data.id } };
    }

    let slug = slugify(data.title) || 'promo';
    const dupeSlug = await db.query.promotions.findFirst({ where: eq(promotions.slug, slug) });
    if (dupeSlug) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const [created] = await db
      .insert(promotions)
      .values({ ...payload, id: newId('prm'), slug, providerId, branchId: data.branchId })
      .returning({ id: promotions.id });
    await logAudit({ actorId: user.id, actorRole: user.role, action: 'promo.created', entity: 'promotion', entityId: created!.id });
    revalidateProvider(providerId, ['/provider/promotions', `/provider/branches/${data.branchId}`]);
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

/**
 * Opt this spa in or out of a platform (general) promotion. General
 * promotions are valid everywhere by default — this records the spa's own
 * choice, so a supplier can deactivate any offer it does not want to run.
 *
 * When the promotion is scoped to “Selected treatments”, the spa must pass its
 * treatment list (and can re-pass it later to change the selection); the offer
 * cannot be activated until at least one treatment is chosen.
 */
export async function setProviderPromotionActive(
  promotionId: string,
  active: boolean,
  treatmentIds?: string[] | null,
): Promise<ActionResult> {
  try {
    const { db, providerId, user } = await providerCtx();
    const promo = await db.query.promotions.findFirst({
      where: eq(promotions.id, promotionId),
      columns: { id: true, providerId: true, branchId: true, appliesTo: true },
    });
    if (!promo) return fail('Promotion not found.');
    if (promo.providerId || promo.branchId)
      return fail('Only platform-wide promotions are managed here.');

    const existing = await db.query.providerPromotions.findFirst({
      where: and(
        eq(providerPromotions.providerId, providerId),
        eq(providerPromotions.promotionId, promotionId),
      ),
    });

    // Resolve this spa's treatment selection for a “selected” promotion.
    let selection: string[] | null = existing?.treatmentIds ?? null;
    if (promo.appliesTo === 'selected') {
      if (treatmentIds) {
        const next = [...new Set(treatmentIds.map((t) => t.trim()).filter(Boolean))];
        if (next.length === 0) return fail('Pick at least one treatment for this promotion.');
        const owned = await db.query.treatments.findMany({
          where: and(eq(treatments.providerId, providerId), inArray(treatments.id, next)),
          columns: { id: true },
        });
        if (owned.length !== next.length) return fail('One of those treatments is not yours.');
        selection = next;
      }
      if (active && !(selection && selection.length))
        return fail('Choose which treatments this promotion applies to before activating it.');
    }

    if (existing) {
      const patch: { active?: boolean; treatmentIds?: string[] | null } = {};
      if (existing.active !== active) patch.active = active;
      if (
        promo.appliesTo === 'selected' &&
        JSON.stringify(existing.treatmentIds ?? []) !== JSON.stringify(selection ?? [])
      )
        patch.treatmentIds = selection;
      if (Object.keys(patch).length > 0)
        await db.update(providerPromotions).set(patch).where(eq(providerPromotions.id, existing.id));
    } else {
      await db
        .insert(providerPromotions)
        .values({
          id: newId('prp'),
          providerId,
          promotionId,
          active,
          treatmentIds: promo.appliesTo === 'selected' ? selection : null,
        });
    }

    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'provider.promo_choice',
      entity: 'promotion',
      entityId: promotionId,
      meta: { active, treatments: selection?.length ?? null },
    });
    revalidateProvider(providerId, ['/provider/promotions']);
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

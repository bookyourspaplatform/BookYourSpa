import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { AppDb } from '@/db';
import { branches, SPA_CATEGORIES, SPA_TYPES, USER_STATUSES } from '@/db/schema';
import { sanitizeRichText } from '@/lib/security';
import { slugify } from '@/lib/utils';

/**
 * Shared branch (spa business) shape + payload cleaning for the server actions.
 * Lives outside 'use server' so both the provider and admin actions can import
 * the schema (server-action modules may only export async functions).
 */

export const hoursSchema = z.array(
  z.object({
    day: z.number().int().min(0).max(6),
    open: z.string().regex(/^\d{2}:\d{2}$/),
    close: z.string().regex(/^\d{2}:\d{2}$/),
    closed: z.boolean(),
  }),
);

export const branchSchema = z.object({
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
  showTherapistOnline: z.boolean().default(false),
  /** Agent/reseller/affiliate fee in basis points (1500 = 15%); null = partner default. */
  agentFeeBps: z.number().int().min(0).max(10000).optional().nullable(),
  /** Preset amenity keys plus anything the owner types in themselves. */
  facilities: z
    .array(z.string().trim().min(2).max(48))
    .max(30)
    .default([])
    .transform((list) => {
      const seen = new Set<string>();
      return list.filter((facility) => {
        const key = facility.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }),
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

export type BranchSaveInput = z.infer<typeof branchSchema>;

function cleanCoord(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return /^-?\d{1,3}(\.\d+)?$/.test(v) ? v : null;
}

/**
 * Empty strings → null, rich text sanitized, only renderable image sources kept.
 * Shared by the provider saveBranch and the admin adminSaveSpa actions so both
 * write identical rows.
 */
export function branchPayload(data: Omit<BranchSaveInput, 'id'>) {
  return {
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
}

/** Slug for a branch within its provider: first-come, suffixed on collision. */
export async function uniqueBranchSlug(db: AppDb, providerId: string, base: string, ignoreId?: string) {
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

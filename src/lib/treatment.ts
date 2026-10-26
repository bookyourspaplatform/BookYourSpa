import { z } from 'zod';
import {
  SPA_TYPES,
  TREATMENT_GENRES,
  TREATMENT_DELIVERY_TYPES,
  USER_STATUSES,
} from '@/db/schema';
import { sanitizeRichText } from '@/lib/security';

/**
 * Shared treatment shape + payload building for the server actions. Lives
 * outside 'use server' so both the provider and admin actions can import the
 * schema (server-action modules may only export async functions).
 */

export const priceOptionSchema = z.object({
  durationMin: z.number().int().min(5).max(600),
  price: z.number().int().min(0).max(1_000_000_000),
  capacity: z.number().int().min(1).max(50),
});

export const treatmentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2).max(120),
  /** Rich-text HTML (sanitized below). */
  description: z.string().max(40000).optional().nullable(),
  /** Duration/price/capacity tiers; the first option drives booking defaults. */
  priceOptions: z.array(priceOptionSchema).min(1).max(10),
  genre: z.enum(TREATMENT_GENRES).default('both'),
  deliveryType: z.enum(TREATMENT_DELIVERY_TYPES).default('both'),
  requiresTherapist: z.boolean().default(true),
  /** Therapists needed per session — couples / four-hand treatments use 2+. */
  therapistsPerBooking: z.number().int().min(1).max(4).default(1),
  agentApproved: z.boolean(),
  /** Spa-type tags (shared vocabulary with the spa editor). Free-form input
   *  is accepted and filtered to known spa types so legacy rows stay editable. */
  tags: z.array(z.string().max(60)).max(20).default([]),
  status: z.enum(USER_STATUSES).optional(),
});

export type TreatmentSaveInput = z.infer<typeof treatmentSchema>;

/**
 * Row values shared by saveTreatment (supplier) and adminSaveTreatment (admin)
 * so both write identical treatment rows. Legacy single-price columns mirror
 * the first option so availability/booking flows keep working unchanged.
 */
export function treatmentPayload(data: Omit<TreatmentSaveInput, 'id'>) {
  const primary = data.priceOptions[0]!;
  const knownTypes = new Set<string>(SPA_TYPES);
  return {
    name: data.name,
    description: data.description ? sanitizeRichText(data.description) : null,
    priceOptions: data.priceOptions,
    durationMin: primary.durationMin,
    listPrice: primary.price,
    capacity: primary.capacity,
    genre: data.genre,
    deliveryType: data.deliveryType,
    requiresTherapist: data.requiresTherapist,
    therapistsPerBooking: data.requiresTherapist ? data.therapistsPerBooking : 1,
    agentApproved: data.agentApproved,
    tags: data.tags.filter((t) => knownTypes.has(t)) as (typeof SPA_TYPES)[number][],
    ...(data.status ? { status: data.status } : {}),
  };
}

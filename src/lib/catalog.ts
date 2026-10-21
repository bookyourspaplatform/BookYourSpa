import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { AppDb } from '@/db';
import {
  branches,
  branchTreatments,
  promotions,
  providers,
  therapists,
  treatments,
  coupons,
  type Branch,
  type Promotion,
  type Provider,
  type Treatment,
} from '@/db/schema';

/**
 * Read-side catalogue queries shared by the public site, sitemap and dashboards.
 * All queries only expose approved providers + active branches/treatments.
 */

export type SpaListItem = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  country: string;
  baseCurrency: string;
  featured: boolean;
  branchCount: number;
  cities: string[];
  branches: Pick<Branch, 'id' | 'name' | 'slug' | 'city' | 'country' | 'currency'>[];
  minPrice: number | null;
  /** Treatment categories aggregated across branches (legacy chips). */
  categories: string[];
  /** Spa business categories from the branch editor (union across branches). */
  spaCategories: string[];
  /** Spa types from the branch editor (union across branches). */
  spaTypes: string[];
  /** 160-char SEO/card description — first active branch that has one. */
  shortDescription: string | null;
};

export type SpaFilters = {
  q?: string;
  city?: string;
  category?: string;
  /** Spa business category (day_spa, hotel_resort_spa, …). */
  spa?: string;
  /** Spa type (massages, hammam_bath, …). */
  type?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: 'featured' | 'price_asc' | 'price_desc' | 'name';
  page?: number;
  pageSize?: number;
};

export const CATEGORY_LABELS: Record<string, string> = {
  massage: 'Massage',
  facial: 'Facials',
  body: 'Body rituals',
  bath: 'Baths & hammam',
  nails: 'Nails',
  hair: 'Hair',
  wellness: 'Wellness',
  package: 'Packages',
};

export const SPA_CATEGORY_LABELS: Record<string, string> = {
  day_spa: 'Day Spa',
  hotel_resort_spa: 'Hotel & Resort Spa',
  doorstep_spa: 'Massage on Call / Doorstep Spa',
  wellness_center: 'Wellness Center',
  beauty_spa: 'Beauty Spa',
  medical_spa: 'Medical Spa',
};

export const SPA_TYPE_LABELS: Record<string, string> = {
  massages: 'Massages',
  body_treatment: 'Body Treatment',
  facials_skincare: 'Facials & Skincare',
  beauty_treatment: 'Beauty Treatment',
  sauna_thermal: 'Sauna & Thermal',
  hydrotherapy: 'Hydrotherapy',
  hammam_bath: 'Hammam & Bath Ritual',
  wellness_therapies: 'Wellness Therapies',
  yoga_pilates: 'Yoga & Pilates',
  foot_reflexology: 'Foot Care & Reflexology',
  relaxation_healing: 'Relaxation & Healing',
  retreats_packages: 'Wellness Retreats & Packages',
  couples_romantic: 'Couples & Romantic Spa',
  sensual_wellness: 'Sensual Wellness',
  spa_package: 'Spa Package',
};

export const GENRE_LABELS: Record<string, string> = {
  both: 'Both',
  man_only: 'Man Only',
  woman_only: 'Woman Only',
};

export const DELIVERY_TYPE_LABELS: Record<string, string> = {
  both: 'Both',
  in_spa: 'In Spa',
  doorstep: 'Doorstep',
};

export const SPA_FACILITY_LABELS: Record<string, string> = {
  sauna: 'Sauna',
  steam_room: 'Steam room',
  jacuzzi: 'Jacuzzi / hot tub',
  plunge_pool: 'Cold plunge',
  swimming_pool: 'Swimming pool',
  gym: 'Gym',
  spa_lounge: 'Relaxation lounge',
  showers: 'Showers',
  lockers: 'Lockers',
  wifi: 'Free Wi-Fi',
  parking: 'Parking',
  restaurant: 'Café / restaurant',
  garden: 'Garden',
  couple_rooms: 'Couples room',
  private_rooms: 'Private room',
};

const activeCatalog = and(
  eq(providers.status, 'approved'),
);

type ProviderRow = Provider & {
  branches: Pick<
    Branch,
    | 'id'
    | 'name'
    | 'slug'
    | 'city'
    | 'country'
    | 'currency'
    | 'status'
    | 'tagline'
    | 'shortDescription'
    | 'categories'
    | 'spaTypes'
    | 'images'
  >[];
};

export async function listSpas(db: AppDb, filters: SpaFilters = {}) {
  const providerRows = (await db.query.providers.findMany({
    where: activeCatalog,
    with: {
      branches: {
        columns: {
          id: true,
          name: true,
          slug: true,
          city: true,
          country: true,
          currency: true,
          status: true,
          tagline: true,
          shortDescription: true,
          categories: true,
          spaTypes: true,
          images: true,
        },
        where: eq(branches.status, 'active'),
      },
    },
  })) as ProviderRow[];

  const aggRows = await db
    .select({
      providerId: branches.providerId,
      minPrice: sql<number | null>`min(${branchTreatments.price})`,
      maxPrice: sql<number | null>`max(${branchTreatments.price})`,
      cats: sql<string>`array_to_string(array_agg(distinct ${treatments.category}), ',')`,
      treatmentCount: sql<number>`count(*)::int`,
    })
    .from(branchTreatments)
    .innerJoin(treatments, eq(treatments.id, branchTreatments.treatmentId))
    .innerJoin(branches, eq(branches.id, branchTreatments.branchId))
    .where(
      and(
        eq(branchTreatments.active, true),
        eq(treatments.status, 'active'),
        eq(branches.status, 'active'),
      ),
    )
    .groupBy(branches.providerId);

  const aggByProvider = new Map<string, {
    minPrice: number | null;
    maxPrice: number | null;
    categories: string[];
    treatmentCount: number;
  }>(
    aggRows.map((r) => [
      r.providerId,
      {
        minPrice: r.minPrice === null ? null : Number(r.minPrice),
        maxPrice: r.maxPrice === null ? null : Number(r.maxPrice),
        categories: (r.cats ?? '').split(',').filter(Boolean),
        treatmentCount: r.treatmentCount ?? 0,
      },
    ]),
  );

  let items: SpaListItem[] = providerRows.map((p) => {
    const agg = aggByProvider.get(p.id);
    const cities = [...new Set(p.branches.map((b) => b.city))];
    const spaCategories = [...new Set(p.branches.flatMap((b) => b.categories ?? []))];
    const spaTypes = [...new Set(p.branches.flatMap((b) => b.spaTypes ?? []))];
    const first = p.branches.find((b) => b.shortDescription?.trim()) ?? p.branches[0];
    const coverFromBranch = p.branches.find((b) => (b.images ?? []).length > 0)?.images[0] ?? null;
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      tagline: p.tagline ?? p.branches.find((b) => b.tagline?.trim())?.tagline ?? null,
      description: p.description,
      logoUrl: p.logoUrl,
      coverUrl: p.coverUrl ?? coverFromBranch,
      country: p.country,
      baseCurrency: p.baseCurrency,
      featured: p.featured || (p.featuredUntil ? p.featuredUntil.getTime() > Date.now() : false),
      branchCount: p.branches.length,
      cities,
      branches: p.branches,
      minPrice: agg?.minPrice ?? null,
      categories: agg?.categories ?? [],
      spaCategories,
      spaTypes,
      shortDescription: first?.shortDescription ?? null,
    };
  });

  // Facets computed from the unfiltered set.
  const cityFacet = new Map<string, number>();
  for (const item of items) for (const city of item.cities) cityFacet.set(city, (cityFacet.get(city) ?? 0) + 1);
  const categoryFacet = new Map<string, number>();
  for (const [, agg] of aggByProvider)
    for (const c of agg.categories) categoryFacet.set(c, (categoryFacet.get(c) ?? 0) + 1);
  const spaFacet = new Map<string, number>();
  for (const item of items) for (const c of item.spaCategories) spaFacet.set(c, (spaFacet.get(c) ?? 0) + 1);
  const spaTypeFacet = new Map<string, number>();
  for (const item of items) for (const t of item.spaTypes) spaTypeFacet.set(t, (spaTypeFacet.get(t) ?? 0) + 1);
  const totalAll = items.length;

  const q = filters.q?.trim().toLowerCase();
  if (q) {
    items = items.filter((i) =>
      [
        i.name,
        i.tagline ?? '',
        i.shortDescription ?? '',
        i.description ?? '',
        ...i.spaCategories.map((c) => SPA_CATEGORY_LABELS[c] ?? c),
        ...i.spaTypes.map((t) => SPA_TYPE_LABELS[t] ?? t),
        ...i.cities,
        ...i.branches.map((b) => b.name),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }
  if (filters.city) {
    const city = filters.city.toLowerCase();
    items = items.filter((i) => i.cities.some((c) => c.toLowerCase() === city));
  }
  if (filters.category) {
    items = items.filter((i) => i.categories.includes(filters.category!));
  }
  if (filters.spa) {
    items = items.filter((i) => i.spaCategories.includes(filters.spa!));
  }
  if (filters.type) {
    items = items.filter((i) => i.spaTypes.includes(filters.type!));
  }
  if (typeof filters.minPrice === 'number') items = items.filter((i) => (i.minPrice ?? Infinity) >= filters.minPrice!);
  if (typeof filters.maxPrice === 'number') items = items.filter((i) => (i.minPrice ?? 0) <= filters.maxPrice!);

  const sort = filters.sort ?? 'featured';
  items.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'price_asc') return (a.minPrice ?? Number.MAX_SAFE_INTEGER) - (b.minPrice ?? Number.MAX_SAFE_INTEGER);
    if (sort === 'price_desc') return (b.minPrice ?? 0) - (a.minPrice ?? 0);
    return Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name);
  });

  const pageSize = Math.min(filters.pageSize ?? 12, 48);
  const page = Math.max(filters.page ?? 1, 1);
  const paged = items.slice((page - 1) * pageSize, page * pageSize);

  const allCities = [...cityFacet.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([city, count]) => ({ city, count }));
  const allCategories = [...categoryFacet.entries()]
    .map(([value, count]) => ({ value, label: CATEGORY_LABELS[value] ?? value, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const allSpaCategories = [...spaFacet.entries()]
    .map(([value, count]) => ({ value, label: SPA_CATEGORY_LABELS[value] ?? value, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const allSpaTypes = [...spaTypeFacet.entries()]
    .map(([value, count]) => ({ value, label: SPA_TYPE_LABELS[value] ?? value, count }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    items: paged,
    total: items.length,
    totalAll,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
    facets: {
      cities: allCities,
      categories: allCategories,
      spaCategories: allSpaCategories,
      spaTypes: allSpaTypes,
      priceRange: {
        min: Math.min(...items.map((i) => i.minPrice ?? Infinity).filter(Number.isFinite), Infinity),
        max: Math.max(...items.map((i) => i.minPrice ?? 0), 0),
      },
    },
  };
}

/* ------------------------------ spa detail ---------------------------- */

export type SpaDetail = {
  provider: Provider;
  branches: (Branch & { therapistCount: number })[];
  treatments: (Treatment & { branchPrices: { branchId: string; branchSlug: string; branchName: string; city: string; price: number }[] })[];
};

export async function getSpaDetail(db: AppDb, slug: string): Promise<SpaDetail | null> {
  const provider = await db.query.providers.findFirst({
    where: and(eq(providers.slug, slug), eq(providers.status, 'approved')),
  });
  if (!provider) return null;

  const [branchRows, treatmentRows] = await Promise.all([
    db.query.branches.findMany({
      where: and(eq(branches.providerId, provider.id), eq(branches.status, 'active')),
      with: { therapists: { columns: { id: true }, where: eq(therapists.active, true) } },
    }),
    db.query.treatments.findMany({
      where: and(eq(treatments.providerId, provider.id), eq(treatments.status, 'active')),
      with: { branchTreatments: { where: eq(branchTreatments.active, true) } },
    }),
  ]);

  const branchById = new Map(branchRows.map((b) => [b.id, b]));

  const treatmentsWithPrices = treatmentRows
    .map((t) => ({
      ...t,
      branchPrices: t.branchTreatments
        .filter((bt) => branchById.has(bt.branchId))
        .map((bt) => {
          const b = branchById.get(bt.branchId)!;
          return { branchId: b.id, branchSlug: b.slug, branchName: b.name, city: b.city, price: bt.price };
        })
        .sort((a, b) => a.price - b.price),
    }))
    .filter((t) => t.branchPrices.length > 0);

  return {
    provider,
    branches: branchRows.map(({ therapists: th, ...b }) => ({ ...b, therapistCount: th.length })),
    treatments: treatmentsWithPrices,
  };
}

/* ----------------------------- branch detail -------------------------- */

export type BranchDetail = {
  branch: Branch & { provider: Provider };
  treatments: (Treatment & { price: number })[];
  therapistList: {
    id: string;
    name: string;
    bio: string | null;
    specialties: string[];
    avatarUrl: string | null;
  }[];
  promos: Promotion[];
};

export async function getBranchDetail(
  db: AppDb,
  providerSlug: string,
  branchSlug: string,
): Promise<BranchDetail | null> {
  const provider = await db.query.providers.findFirst({
    where: and(eq(providers.slug, providerSlug), eq(providers.status, 'approved')),
  });
  if (!provider) return null;

  const branch = await db.query.branches.findFirst({
    where: and(
      eq(branches.providerId, provider.id),
      eq(branches.slug, branchSlug),
      eq(branches.status, 'active'),
    ),
  });
  if (!branch) return null;

  const [treatmentRows, therapistRows, promoRows] = await Promise.all([
    db.query.branchTreatments.findMany({
      where: and(eq(branchTreatments.branchId, branch.id), eq(branchTreatments.active, true)),
      with: { treatment: true },
    }),
    db.query.therapists.findMany({
      // Only treating staff are bookable/published — admins and workers stay internal.
      where: and(
        eq(therapists.branchId, branch.id),
        eq(therapists.active, true),
        eq(therapists.role, 'therapist'),
      ),
      columns: { id: true, name: true, bio: true, specialties: true, avatarUrl: true },
      orderBy: [asc(therapists.name)],
    }),
    db.query.promotions.findMany({
      where: sql`${promotions.active} = true AND (${promotions.providerId} = ${provider.id} OR ${promotions.branchId} = ${branch.id} OR ${promotions.providerId} IS NULL)`,
      orderBy: [asc(promotions.sortOrder)],
      limit: 4,
    }),
  ]);

  return {
    branch: { ...branch, provider },
    treatments: treatmentRows
      .filter((bt) => bt.treatment && bt.treatment.status === 'active')
      .map(({ treatment, price }) => ({ ...(treatment as Treatment), price }))
      .sort((a, b) => a.price - b.price),
    therapistList: therapistRows,
    promos: promoRows,
  };
}

/* -------------------------------- facets ------------------------------ */

export async function listCities(db: AppDb): Promise<{ city: string; country: string; count: number }[]> {
  const rows = await db
    .select({
      city: branches.city,
      country: branches.country,
      count: sql<number>`count(*)::int`,
    })
    .from(branches)
    .innerJoin(providers, eq(providers.id, branches.providerId))
    .where(and(eq(branches.status, 'active'), eq(providers.status, 'approved')))
    .groupBy(branches.city, branches.country)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ city: r.city, country: r.country, count: r.count ?? 0 }));
}

export async function listCategoryCounts(db: AppDb): Promise<{ value: string; label: string; count: number }[]> {
  const rows = await db
    .select({ category: treatments.category, count: sql<number>`count(distinct ${treatments.id})::int` })
    .from(treatments)
    .innerJoin(providers, eq(providers.id, treatments.providerId))
    .where(and(eq(treatments.status, 'active'), eq(providers.status, 'approved')))
    .groupBy(treatments.category);
  return rows
    .map((r) => ({ value: r.category, label: CATEGORY_LABELS[r.category] ?? r.category, count: r.count ?? 0 }))
    .sort((a, b) => b.count - a.count);
}

/** Spa business categories for the search bar (approved providers, active branches). */
export async function listSpaCategoryCounts(db: AppDb): Promise<{ value: string; label: string; count: number }[]> {
  const rows = await db
    .select({ cat: branches.categories, count: sql<number>`count(distinct ${branches.id})::int` })
    .from(branches)
    .innerJoin(providers, eq(providers.id, branches.providerId))
    .where(and(eq(branches.status, 'active'), eq(providers.status, 'approved')))
    .groupBy(branches.categories);
  const facet = new Map<string, number>();
  for (const r of rows) {
    for (const c of r.cat ?? []) facet.set(c, (facet.get(c) ?? 0) + (r.count ?? 0));
  }
  return [...facet.entries()]
    .map(([value, count]) => ({ value, label: SPA_CATEGORY_LABELS[value] ?? value, count }))
    .sort((a, b) => b.count - a.count);
}

/** Spa types for the search bar (approved providers, active branches). */
export async function listSpaTypeCounts(db: AppDb): Promise<{ value: string; label: string; count: number }[]> {
  const rows = await db
    .select({ t: branches.spaTypes, count: sql<number>`count(distinct ${branches.id})::int` })
    .from(branches)
    .innerJoin(providers, eq(providers.id, branches.providerId))
    .where(and(eq(branches.status, 'active'), eq(providers.status, 'approved')))
    .groupBy(branches.spaTypes);
  const facet = new Map<string, number>();
  for (const r of rows) {
    for (const t of r.t ?? []) facet.set(t, (facet.get(t) ?? 0) + (r.count ?? 0));
  }
  return [...facet.entries()]
    .map(([value, count]) => ({ value, label: SPA_TYPE_LABELS[value] ?? value, count }))
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------- promos ------------------------------- */

export async function listPromotions(
  db: AppDb,
  opts: { position?: Promotion['position']; limit?: number } = {},
): Promise<Promotion[]> {
  const rows = await db.query.promotions.findMany({
    where: sql`${promotions.active} = true AND (${promotions.startsAt} IS NULL OR ${promotions.startsAt} <= now()) AND (${promotions.endsAt} IS NULL OR ${promotions.endsAt} >= now())${opts.position ? sql`AND ${promotions.position} = ${opts.position}` : sql``}`,
    orderBy: [asc(promotions.sortOrder), desc(promotions.createdAt)],
    limit: opts.limit ?? 10,
  });
  return rows;
}

export async function listPublicCoupons(db: AppDb): Promise<(typeof coupons.$inferSelect)[]> {
  const rows = await db.query.coupons.findMany({
    where: sql`${coupons.active} = true AND (${coupons.startsAt} IS NULL OR ${coupons.startsAt} <= now()) AND (${coupons.endsAt} IS NULL OR ${coupons.endsAt} >= now()) AND (${coupons.maxUses} IS NULL OR ${coupons.maxUses} = 0 OR ${coupons.usedCount} < ${coupons.maxUses})`,
    orderBy: [desc(coupons.startsAt)],
    limit: 12,
  });
  return rows;
}

/* ------------------------ compare (treatments) ------------------------ */

export type ComparableTreatment = {
  id: string;
  name: string;
  category: string;
  durationMin: number;
  benefits: string[];
  providerName: string;
  providerSlug: string;
  currency: string;
  offers: { branchId: string; branchName: string; city: string; price: number }[];
};

export async function listTreatmentsForCompare(
  db: AppDb,
  opts: { ids?: string[]; category?: string; q?: string; limit?: number } = {},
): Promise<ComparableTreatment[]> {
  const where = and(
    eq(treatments.status, 'active'),
    eq(providers.status, 'approved'),
    opts.category ? eq(treatments.category, opts.category as Treatment['category']) : sql`true`,
    opts.ids?.length ? inArray(treatments.id, opts.ids) : sql`true`,
    opts.q ? or(ilike(treatments.name, `%${opts.q}%`), ilike(providers.name, `%${opts.q}%`)) : sql`true`,
  );

  const rows = await db
    .select({
      treatment: treatments,
      provider: providers,
      branchId: branches.id,
      branchName: branches.name,
      branchCity: branches.city,
      branchStatus: branches.status,
      price: branchTreatments.price,
    })
    .from(treatments)
    .innerJoin(providers, eq(providers.id, treatments.providerId))
    .innerJoin(branchTreatments, eq(branchTreatments.treatmentId, treatments.id))
    .innerJoin(branches, eq(branches.id, branchTreatments.branchId))
    .where(where)
    .orderBy(asc(treatments.name), asc(branchTreatments.price))
    .limit(opts.ids?.length ? 400 : 200);

  const byTreatment = new Map<
    string,
    { treatment: Treatment; provider: typeof providers.$inferSelect; offers: ComparableTreatment['offers'] }
  >();
  for (const r of rows) {
    if (r.branchStatus !== 'active') continue;
    let entry = byTreatment.get(r.treatment.id);
    if (!entry) {
      entry = { treatment: r.treatment, provider: r.provider, offers: [] };
      byTreatment.set(r.treatment.id, entry);
    }
    entry.offers.push({ branchId: r.branchId, branchName: r.branchName, city: r.branchCity, price: r.price });
  }

  return [...byTreatment.values()]
    .map(({ treatment, provider, offers }) => ({
      id: treatment.id,
      name: treatment.name,
      category: treatment.category,
      durationMin: treatment.durationMin,
      benefits: treatment.benefits,
      providerName: provider.name,
      providerSlug: provider.slug,
      currency: treatment.currency,
      offers: offers.sort((a, b) => a.price - b.price),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

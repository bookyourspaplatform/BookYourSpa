import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AppDb } from '@/db';
import { sanitizeRichText } from '@/lib/security';
import {
  branches,
  branchTreatments,
  promotions,
  providerPromotions,
  providers,
  reviews,
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
  /** Outlet (branch) id — one public listing per spa business. */
  id: string;
  /** Owning supplier slug — used only to build /spas/{slug}/{branchSlug} URLs. */
  slug: string;
  /** Outlet slug within the supplier's listing. */
  branchSlug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  shortDescription: string | null;
  coverUrl: string | null;
  city: string;
  country: string;
  currency: string;
  featured: boolean;
  /** Supplier name — search haystack only, never displayed publicly. */
  providerName: string;
  /**
   * The badge this outlet's card shows — Google listing numbers when the
   * admin typed them, otherwise the published review average. Same
   * precedence as the branch page so card and page never disagree.
   */
  rating: { avg: number; count: number | null } | null;
  /** Kilometres to this outlet — only set when `near` filtering was used. */
  distanceKm: number | null;
  minPrice: number | null;
  /** Treatment categories offered at this outlet. */
  categories: string[];
  /** Spa business categories from the branch editor. */
  spaCategories: string[];
  /** Spa types from the branch editor. */
  spaTypes: string[];
  lat: number | null;
  lng: number | null;
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
  /** Guest location — enables distance sorting/filtering for "Spa near me". */
  near?: { lat: number; lng: number };
  /** Only outlets within this many km of `near`. */
  radiusKm?: number;
  sort?: 'featured' | 'price_asc' | 'price_desc' | 'name' | 'rating' | 'distance';
  page?: number;
  pageSize?: number;
};

/** Great-circle distance in kilometres. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

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
  luxury_spa: 'Luxury Spa',
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
  ayurvedic: 'Ayurvedic',
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
    | 'tagline'
    | 'shortDescription'
    | 'description'
    | 'categories'
    | 'spaTypes'
    | 'images'
    | 'lat'
    | 'lng'
    | 'googleRating'
    | 'googleRatingCount'
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
          tagline: true,
          shortDescription: true,
          description: true,
          categories: true,
          spaTypes: true,
          images: true,
          lat: true,
          lng: true,
          googleRating: true,
          googleRatingCount: true,
        },
        where: eq(branches.status, 'active'),
      },
    },
  })) as ProviderRow[];

  const [aggRows, ratingRows] = await Promise.all([
    db
      .select({
        branchId: branchTreatments.branchId,
        minPrice: sql<number | null>`min(${branchTreatments.price})`,
        cats: sql<string>`array_to_string(array_agg(distinct ${treatments.category}), ',')`,
      })
      .from(branchTreatments)
      .innerJoin(treatments, eq(treatments.id, branchTreatments.treatmentId))
      .where(and(eq(branchTreatments.active, true), eq(treatments.status, 'active')))
      .groupBy(branchTreatments.branchId),
    // Published reviews per outlet power the star ratings.
    db
      .select({
        branchId: reviews.branchId,
        avg: sql<number>`avg(${reviews.rating})`,
        count: sql<number>`count(*)::int`,
      })
      .from(reviews)
      .innerJoin(branches, eq(branches.id, reviews.branchId))
      .where(and(eq(reviews.status, 'published'), eq(branches.status, 'active')))
      .groupBy(reviews.branchId),
  ]);

  const ratingByBranch = new Map<string, { avg: number; count: number }>(
    ratingRows.map((r) => [r.branchId, { avg: Math.round(Number(r.avg) * 10) / 10, count: r.count }]),
  );

  /** Card badge: Google listing first, then the published review average. */
  const badgeFor = (branchId: string, googleRating: number | null, googleCount: number | null) =>
    googleRating != null && googleRating >= 1 && googleRating <= 5
      ? {
          avg: Math.round(googleRating * 10) / 10,
          count: googleCount != null && googleCount > 0 ? googleCount : null,
        }
      : (ratingByBranch.get(branchId) ?? null);

  const aggByBranch = new Map<string, { minPrice: number | null; categories: string[] }>(
    aggRows.map((r) => [
      r.branchId,
      {
        minPrice: r.minPrice === null ? null : Number(r.minPrice),
        categories: (r.cats ?? '').split(',').filter(Boolean),
      },
    ]),
  );

  // One public listing per outlet (spa business) — the supplier itself is never shown.
  let items: SpaListItem[] = providerRows.flatMap((p) =>
    p.branches.map((b) => {
      const agg = aggByBranch.get(b.id);
      return {
        id: b.id,
        slug: p.slug,
        branchSlug: b.slug,
        name: b.name,
        tagline: b.tagline,
        description: b.description,
        shortDescription: b.shortDescription,
        coverUrl: b.images?.[0] ?? p.logoUrl ?? null,
        city: b.city,
        country: b.country,
        currency: b.currency,
        featured: p.featured || (p.featuredUntil ? p.featuredUntil.getTime() > Date.now() : false),
        providerName: p.name,
        rating: badgeFor(b.id, b.googleRating, b.googleRatingCount),
        distanceKm: null,
        minPrice: agg?.minPrice ?? null,
        categories: agg?.categories ?? [],
        spaCategories: b.categories ?? [],
        spaTypes: b.spaTypes ?? [],
        lat: b.lat == null ? null : Number(b.lat),
        lng: b.lng == null ? null : Number(b.lng),
      };
    }),
  );

  // Facets computed from the unfiltered set.
  const cityFacet = new Map<string, number>();
  for (const item of items) cityFacet.set(item.city, (cityFacet.get(item.city) ?? 0) + 1);
  const categoryFacet = new Map<string, number>();
  for (const [, agg] of aggByBranch)
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
        i.providerName,
        i.city,
        ...i.spaCategories.map((c) => SPA_CATEGORY_LABELS[c] ?? c),
        ...i.spaTypes.map((t) => SPA_TYPE_LABELS[t] ?? t),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }
  if (filters.city) {
    const city = filters.city.toLowerCase();
    items = items.filter((i) => i.city.toLowerCase() === city);
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

  // "Spa near me": attach distance to each outlet, then filter by radius.
  if (filters.near) {
    const { lat, lng } = filters.near;
    items = items
      .map((i) => ({
        ...i,
        distanceKm:
          i.lat != null && i.lng != null
            ? Math.round(haversineKm(lat, lng, i.lat, i.lng) * 10) / 10
            : null,
      }))
      .filter((i) => i.distanceKm !== null)
      .filter((i) => (typeof filters.radiusKm === 'number' ? i.distanceKm! <= filters.radiusKm! : true));
  }

  const sort = filters.sort ?? (filters.near ? 'distance' : 'featured');
  items.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'price_asc') return (a.minPrice ?? Number.MAX_SAFE_INTEGER) - (b.minPrice ?? Number.MAX_SAFE_INTEGER);
    if (sort === 'price_desc') return (b.minPrice ?? 0) - (a.minPrice ?? 0);
    if (sort === 'rating')
      return (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0) || (b.rating?.count ?? 0) - (a.rating?.count ?? 0);
    if (sort === 'distance')
      return (a.distanceKm ?? Number.MAX_SAFE_INTEGER) - (b.distanceKm ?? Number.MAX_SAFE_INTEGER);
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
  /** The spa businesses (outlets) as listed in the supplier console — the public page is built from these. */
  branches: (Branch & { therapistCount: number; treatmentCount: number })[];
  treatments: (Treatment & { branchPrices: { branchId: string; branchSlug: string; branchName: string; city: string; price: number }[] })[];
  /** Published review aggregate across the spa's active branches. */
  rating: { avg: number; count: number } | null;
  /** Recent published reviews. */
  reviews: {
    id: string;
    guestName: string;
    rating: number;
    comment: string | null;
    createdAt: Date;
    bookingId: string | null;
  }[];
  /** Live promotions for this spa (plus platform-wide offers). */
  promos: Promotion[];
  /** Lowest treatment price across branches. */
  minPrice: number | null;
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

  // Active treatments offered per spa business (outlet).
  const treatmentCountByBranch = new Map<string, number>();
  for (const t of treatmentRows) {
    for (const bt of t.branchTreatments) {
      if (!branchById.has(bt.branchId)) continue;
      treatmentCountByBranch.set(bt.branchId, (treatmentCountByBranch.get(bt.branchId) ?? 0) + 1);
    }
  }

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

  const [ratingRows, reviewRows, promoRows] = await Promise.all([
    db
      .select({ avg: sql<number>`avg(${reviews.rating})`, count: sql<number>`count(*)::int` })
      .from(reviews)
      .innerJoin(branches, eq(branches.id, reviews.branchId))
      .where(and(eq(reviews.status, 'published'), eq(branches.providerId, provider.id))),
    db
      .select({
        id: reviews.id,
        guestName: reviews.guestName,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        bookingId: reviews.bookingId,
      })
      .from(reviews)
      .innerJoin(branches, eq(branches.id, reviews.branchId))
      .where(and(eq(reviews.status, 'published'), eq(branches.providerId, provider.id)))
      .orderBy(desc(reviews.createdAt))
      .limit(6),
    db.query.promotions.findMany({
      where: and(eq(promotions.active, true), isNull(promotions.providerId), isNull(promotions.branchId)),
      orderBy: [asc(promotions.sortOrder), desc(promotions.createdAt)],
      limit: 6,
    }),
  ]);

  const ratingRow = ratingRows[0];
  const rating = ratingRow?.count
    ? { avg: Math.round(Number(ratingRow.avg) * 10) / 10, count: ratingRow.count }
    : null;

  const now = Date.now();
  const promos = await advertisedPlatformPromotions(
    db,
    provider.id,
    promoRows.filter((p) => {
      if (p.startsAt && p.startsAt.getTime() > now) return false;
      if (p.endsAt && p.endsAt.getTime() < now) return false;
      return true;
    }),
  );

  const prices = treatmentsWithPrices.flatMap((t) => t.branchPrices.map((bp) => bp.price));
  const minPrice = prices.length ? Math.min(...prices) : null;

  return {
    provider,
    branches: branchRows.map(({ therapists: th, ...b }) => ({
      ...b,
      therapistCount: th.length,
      treatmentCount: treatmentCountByBranch.get(b.id) ?? 0,
    })),
    treatments: treatmentsWithPrices,
    rating,
    reviews: reviewRows.map((r) => ({ ...r, comment: r.comment ? sanitizeRichText(r.comment) : null })),
    promos,
    minPrice,
  };
}

/* ----------------------------- branch detail -------------------------- */

export type BranchDetail = {
  branch: Branch & { provider: Provider };
  /** Whether the owning supplier is currently featured (respects `featuredUntil`). */
  featured: boolean;
  treatments: (Treatment & { price: number })[];
  therapistList: {
    id: string;
    name: string;
    bio: string | null;
    specialties: string[];
    avatarUrl: string | null;
  }[];
  promos: Promotion[];
  /** Published review aggregate for this outlet. */
  rating: { avg: number; count: number } | null;
  /** Google listing badge typed by the admin under "Import from Google Maps". */
  googleBadge: { avg: number; count: number | null } | null;
  /** Recent published reviews for this outlet (the page showcases 10 at a time). */
  reviews: {
    id: string;
    guestName: string;
    rating: number;
    comment: string | null;
    createdAt: Date;
    bookingId: string | null;
    source: string;
  }[];
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

  const [treatmentRows, therapistRows, promoRows, ratingRow, reviewRows] = await Promise.all([
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
      where: and(eq(promotions.active, true), isNull(promotions.providerId), isNull(promotions.branchId)),
      orderBy: [asc(promotions.sortOrder)],
      limit: 4,
    }),
    db
      .select({
        avg: sql<number>`avg(${reviews.rating})`,
        count: sql<number>`count(*)::int`,
      })
      .from(reviews)
      .where(and(eq(reviews.branchId, branch.id), eq(reviews.status, 'published'))),
    db
      .select({
        id: reviews.id,
        guestName: reviews.guestName,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        bookingId: reviews.bookingId,
        source: reviews.source,
      })
      .from(reviews)
      .where(and(eq(reviews.branchId, branch.id), eq(reviews.status, 'published')))
      .orderBy(desc(reviews.createdAt))
      .limit(120),
  ]);

  const ratingAgg = ratingRow[0];
  const rating =
    ratingAgg && ratingAgg.count > 0
      ? { avg: Math.round(Number(ratingAgg.avg) * 10) / 10, count: ratingAgg.count }
      : null;

  // Google listing numbers (★ 4.8 (9,062)) take over the badge when the
  // admin typed them; otherwise the published review average shows instead.
  const googleBadge =
    branch.googleRating != null && branch.googleRating >= 1 && branch.googleRating <= 5
      ? {
          avg: Math.round(branch.googleRating * 10) / 10,
          count: branch.googleRatingCount != null && branch.googleRatingCount > 0 ? branch.googleRatingCount : null,
        }
      : null;

  return {
    branch: { ...branch, provider },
    featured:
      provider.featured ||
      (provider.featuredUntil ? provider.featuredUntil.getTime() > Date.now() : false),
    treatments: treatmentRows
      .filter((bt) => bt.treatment && bt.treatment.status === 'active')
      .map(({ treatment, price }) => ({ ...(treatment as Treatment), price }))
      .sort((a, b) => a.price - b.price),
    therapistList: therapistRows,
    promos: await advertisedPlatformPromotions(db, provider.id, promoRows),
    rating,
    googleBadge,
    // Rich-text bodies are sanitized on save; re-sanitize on read so no raw
    // markup can ever reach the public page.
    reviews: reviewRows.map((r) => ({ ...r, comment: r.comment ? sanitizeRichText(r.comment) : null })),
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

/**
 * The spa page's offers box carries admin (platform) promotions only —
 * supplier campaigns live in the “Promo codes” sidebar instead. A promotion
 * that carries a redeemable discount code is only advertised where the
 * supplier has activated it in its console (otherwise the code would be
 * rejected at checkout); pure marketing banners always show.
 */
async function advertisedPlatformPromotions(
  db: AppDb,
  providerId: string,
  rows: Promotion[],
): Promise<Promotion[]> {
  const redeemable = (p: Promotion) => Boolean(p.code && p.discountType && p.discountValue != null);
  if (!rows.some(redeemable)) return rows;

  const choices = await db.query.providerPromotions.findMany({
    where: eq(providerPromotions.providerId, providerId),
    columns: { promotionId: true, active: true, treatmentIds: true },
  });
  const byId = new Map(choices.map((c) => [c.promotionId, c]));

  return rows.filter((p) => {
    if (!redeemable(p)) return true;
    const choice = byId.get(p.id);
    if (!choice || !choice.active) return false;
    if (p.appliesTo === 'selected' && !(choice.treatmentIds?.length)) return false;
    return true;
  });
}

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

/* --------------------- featured treatments (home) -------------------- */

export type FeaturedTreatment = {
  id: string;
  name: string;
  category: string;
  durationMin: number;
  providerName: string;
  providerSlug: string;
  branchName: string;
  branchSlug: string;
  city: string;
  price: number;
  currency: string;
};

/**
 * Hand-picked treatments for the landing page: cheapest active branch price
 * per treatment, spread across distinct categories so the row isn't all massage.
 */
export async function listFeaturedTreatments(
  db: AppDb,
  opts: { limit?: number } = {},
): Promise<FeaturedTreatment[]> {
  const rows = await db
    .select({
      treatment: treatments,
      providerName: providers.name,
      providerSlug: providers.slug,
      branchName: branches.name,
      branchSlug: branches.slug,
      city: branches.city,
      price: branchTreatments.price,
    })
    .from(branchTreatments)
    .innerJoin(treatments, eq(treatments.id, branchTreatments.treatmentId))
    .innerJoin(branches, eq(branches.id, branchTreatments.branchId))
    .innerJoin(providers, eq(providers.id, branches.providerId))
    .where(
      and(
        eq(branchTreatments.active, true),
        eq(treatments.status, 'active'),
        eq(branches.status, 'active'),
        eq(providers.status, 'approved'),
      ),
    )
    .orderBy(asc(treatments.name), asc(branches.name), asc(branchTreatments.price))
    .limit(400);

  // Cheapest offer per treatment.
  const cheapest = new Map<string, FeaturedTreatment>();
  for (const r of rows) {
    if (cheapest.has(r.treatment.id)) continue;
    cheapest.set(r.treatment.id, {
      id: r.treatment.id,
      name: r.treatment.name,
      category: r.treatment.category,
      durationMin: r.treatment.durationMin,
      providerName: r.providerName,
      providerSlug: r.providerSlug,
      branchName: r.branchName,
      branchSlug: r.branchSlug,
      city: r.city,
      price: r.price,
      currency: r.treatment.currency,
    });
  }

  // Spread across categories: take the cheapest of each category in turn.
  const limit = opts.limit ?? 8;
  const byCategory = new Map<string, FeaturedTreatment[]>();
  for (const item of [...cheapest.values()].sort((a, b) => a.price - b.price)) {
    const bucket = byCategory.get(item.category);
    if (bucket) bucket.push(item);
    else byCategory.set(item.category, [item]);
  }
  const out: FeaturedTreatment[] = [];
  while (out.length < limit) {
    let added = false;
    for (const bucket of byCategory.values()) {
      const next = bucket.shift();
      if (next && out.length < limit) {
        out.push(next);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
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

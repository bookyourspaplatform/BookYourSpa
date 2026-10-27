import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { CalendarDays, Receipt } from 'lucide-react';
import { getDb } from '@/db';
import {
  bookings,
  branches,
  products,
  promotions,
  reviews,
  schedules,
  therapists,
  treatments,
  branchTreatments,
} from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import { pageMetadata } from '@/lib/seo';
import { Badge, BOOKING_STATUS_TONE, PAYMENT_STATUS_TONE } from '@/components/ui/badge';
import { TabLinks } from '@/components/ui/tabs';
import { BookingActions } from '@/components/dash/booking-actions';
import { TherapistManager, type TherapistRow } from '@/components/provider/therapist-manager';
import { BranchHeaderActions } from '@/components/provider/branch-header-actions';
import { BranchTreatmentsPanel, type BranchTreatmentRow } from '@/components/provider/branch-treatments-panel';
import { ProductPanel, type ProductRow } from '@/components/provider/product-panel';
import { PromotionPanel, type PromotionRow } from '@/components/provider/promotion-panel';
import { ReviewPanel, type ReviewRow } from '@/components/provider/review-panel';

export const dynamic = 'force-dynamic';

const TABS = ['bookings', 'treatments', 'products', 'staff', 'promotions', 'reviews'] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Branch', description: 'Manage this location.', path: '/provider/branches', noIndex: true });
}

export default async function BranchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  const providerId = user.provider!.id;
  const db = await getDb();

  const branch = await db.query.branches.findFirst({
    where: and(eq(branches.id, id), eq(branches.providerId, providerId)),
  });
  if (!branch) notFound();

  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'bookings';

  // Counts for tab badges + branch card summary.
  const [bookingCount, treatmentCount, productCount, staffCount, promoCount, reviewCount] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(eq(bookings.branchId, branch.id)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(branchTreatments)
      .where(and(eq(branchTreatments.branchId, branch.id), eq(branchTreatments.active, true))),
    db.select({ n: sql<number>`count(*)::int` }).from(products).where(and(eq(products.branchId, branch.id), eq(products.active, true))),
    db.select({ n: sql<number>`count(*)::int` }).from(therapists).where(and(eq(therapists.branchId, branch.id), eq(therapists.active, true))),
    db.select({ n: sql<number>`count(*)::int` }).from(promotions).where(and(eq(promotions.branchId, branch.id), eq(promotions.active, true))),
    db.select({ n: sql<number>`count(*)::int` }).from(reviews).where(and(eq(reviews.branchId, branch.id), eq(reviews.status, 'published'))),
  ]);

  const headerRow = {
    id: branch.id,
    name: branch.name,
    addressLine: branch.addressLine,
    city: branch.city,
    region: branch.region,
    country: branch.country,
    timezone: branch.timezone,
    currency: branch.currency,
    phone: branch.phone,
    email: branch.email,
    website: branch.website,
    googleMapsUrl: branch.googleMapsUrl,
    lat: branch.lat,
    lng: branch.lng,
    tagline: branch.tagline,
    shortDescription: branch.shortDescription,
    categories: branch.categories ?? [],
    spaTypes: branch.spaTypes ?? [],
    doorstepService: branch.doorstepService,
    showTherapistOnline: branch.showTherapistOnline,
    agentFeeBps: branch.agentFeeBps,
    facilities: branch.facilities ?? [],
    description: branch.description,
    images: branch.images ?? [],
    hours: branch.hours,
    leadTimeMinutes: branch.leadTimeMinutes,
    maxAdvanceDays: branch.maxAdvanceDays,
    bufferMinutes: branch.bufferMinutes,
    slotIntervalMinutes: branch.slotIntervalMinutes,
    onlinePaymentEnabled: branch.onlinePaymentEnabled,
    paymentMethods: branch.paymentMethods,
    status: branch.status,
    treatmentCount: treatmentCount[0]?.n ?? 0,
    therapistCount: staffCount[0]?.n ?? 0,
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl">{branch.name}</h1>
              <Badge tone={branch.status === 'active' ? 'success' : branch.status === 'suspended' ? 'danger' : 'warning'}>
                {branch.status}
              </Badge>
            </div>
            <p className="mt-0.5 text-sm text-ink-500">
              {branch.addressLine}, {branch.city}
              {branch.region ? `, ${branch.region}` : ''}, {branch.country} · {branch.timezone} · {branch.currency}
            </p>
          </div>
          <BranchHeaderActions branch={headerRow} />
        </div>

        <TabLinks
          basePath={`/provider/branches/${branch.id}`}
          activeValue={tab}
          items={[
            { value: 'bookings', label: 'Bookings', count: bookingCount[0]?.n ?? 0 },
            { value: 'treatments', label: 'Treatments', count: treatmentCount[0]?.n ?? 0 },
            { value: 'products', label: 'Products', count: productCount[0]?.n ?? 0 },
            { value: 'staff', label: 'Staff', count: staffCount[0]?.n ?? 0 },
            { value: 'promotions', label: 'Promotions', count: promoCount[0]?.n ?? 0 },
            { value: 'reviews', label: 'Reviews', count: reviewCount[0]?.n ?? 0 },
          ]}
        />
      </div>

      {tab === 'bookings' && <BranchBookingsTab branchId={branch.id} timezone={branch.timezone} />}

      {tab === 'treatments' && <BranchTreatmentsTab branchId={branch.id} currency={branch.currency} providerId={providerId} />}

      {tab === 'products' && <BranchProductsTab branchId={branch.id} currency={branch.currency} />}

      {tab === 'staff' && <BranchStaffTab branchId={branch.id} providerId={providerId} branchName={branch.name} currency={branch.currency} />}

      {tab === 'promotions' && <BranchPromotionsTab branchId={branch.id} />}

      {tab === 'reviews' && <BranchReviewsTab branchId={branch.id} />}
    </div>
  );
}

/* ------------------------------ bookings tab ----------------------------- */

const BOOKING_PAGE_SIZE = 10;

async function BranchBookingsTab({ branchId, timezone }: { branchId: string; timezone: string }) {
  const db = await getDb();
  const rows = await db.query.bookings.findMany({
    where: eq(bookings.branchId, branchId),
    orderBy: [desc(bookings.startAt)],
    limit: BOOKING_PAGE_SIZE,
    with: {
      treatment: { columns: { name: true } },
      therapist: { columns: { name: true } },
    },
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
        <p className="text-[15px] font-medium">No bookings for this branch yet</p>
        <p className="mt-1 text-sm text-ink-500">New reservations appear here as customers book.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">Most recent {rows.length} booking{rows.length === 1 ? '' : 's'} at this branch.</p>
        <Link href={`/provider/bookings?branch=${branchId}`} className="text-[13px] text-brand-700 underline hover:text-brand-800">
          Open full list with filters
        </Link>
      </div>
      <ul className="space-y-2.5">
        {rows.map((b) => (
          <li key={b.id} className="rounded-2xl border border-ink-100 bg-white p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12.5px] font-semibold text-brand-700">{b.code}</span>
                  <Badge tone={BOOKING_STATUS_TONE[b.status] ?? 'neutral'}>{b.status.replace('_', '-')}</Badge>
                  <Badge tone={PAYMENT_STATUS_TONE[b.paymentStatus] ?? 'neutral'}>
                    {b.paymentStatus === 'venue' ? 'pay at venue' : b.paymentStatus}
                  </Badge>
                </div>
                <p className="mt-1.5 text-[15px] font-medium">{b.treatment?.name ?? 'Treatment'}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[13.5px] text-ink-500">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="size-3.5" />
                    {formatDateTime(b.startAt, timezone)}
                  </span>
                  <span>
                    {b.guestName} · {b.guestEmail}
                  </span>
                  {b.therapist && <span>with {b.therapist.name}</span>}
                </p>
                <p className="mt-1 text-[13px] tabular-nums text-ink-500">{formatMoney(b.totalAmount, b.currency)}</p>
              </div>
              <div className="flex flex-col items-start gap-2 lg:items-end">
                <BookingActions bookingId={b.id} status={b.status} />
                <Link href={`/voucher/${b.code}`} className="flex items-center gap-1 text-[13px] text-ink-500 hover:text-brand-700">
                  <Receipt className="size-3.5" /> Voucher
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------- treatments tab ----------------------------- */

async function BranchTreatmentsTab({ branchId, currency, providerId }: { branchId: string; currency: string; providerId: string }) {
  const db = await getDb();
  const [cellRows, catalogRows] = await Promise.all([
    db
      .select({
        id: branchTreatments.id,
        treatmentId: branchTreatments.treatmentId,
        price: branchTreatments.price,
        active: branchTreatments.active,
        name: treatments.name,
        category: treatments.category,
        durationMin: treatments.durationMin,
      })
      .from(branchTreatments)
      .innerJoin(treatments, eq(branchTreatments.treatmentId, treatments.id))
      .where(eq(branchTreatments.branchId, branchId))
      .orderBy(treatments.name),
    db.query.treatments.findMany({
      where: eq(treatments.providerId, providerId),
      columns: { id: true, name: true, durationMin: true, listPrice: true },
      orderBy: [treatments.name],
    }),
  ]);

  const offered = new Set(cellRows.map((c) => c.treatmentId));
  const catalog = catalogRows.filter((t) => !offered.has(t.id));

  const rows: BranchTreatmentRow[] = cellRows.map((c) => ({
    id: c.id,
    treatmentId: c.treatmentId,
    name: c.name,
    category: c.category,
    durationMin: c.durationMin,
    price: c.price,
    active: c.active,
  }));

  return <BranchTreatmentsPanel branchId={branchId} rows={rows} catalog={catalog} currency={currency} />;
}

/* ------------------------------ products tab ------------------------------ */

async function BranchProductsTab({ branchId, currency }: { branchId: string; currency: string }) {
  const db = await getDb();
  const productRows = await db.query.products.findMany({
    where: eq(products.branchId, branchId),
    orderBy: [products.name],
  });
  const rows: ProductRow[] = productRows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    currency: p.currency,
    active: p.active,
  }));
  return <ProductPanel branchId={branchId} currency={currency} rows={rows} />;
}

/* -------------------------------- staff tab -------------------------------- */

async function BranchStaffTab({
  branchId,
  providerId,
  branchName,
  currency,
}: {
  branchId: string;
  providerId: string;
  branchName: string;
  currency: string;
}) {
  const db = await getDb();
  const therapistRows = await db.query.therapists.findMany({
    where: eq(therapists.branchId, branchId),
    orderBy: [therapists.name],
  });

  const [shiftRows, upcomingRows] = await Promise.all([
    db
      .select({ therapistId: schedules.therapistId, n: sql<number>`count(*)::int` })
      .from(schedules)
      .where(inArray(schedules.therapistId, therapistRows.map((t) => t.id).length ? therapistRows.map((t) => t.id) : ['__none__']))
      .groupBy(schedules.therapistId),
    db
      .select({ therapistId: bookings.therapistId, n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        and(
          eq(bookings.providerId, providerId),
          eq(bookings.branchId, branchId),
          inArray(bookings.status, ['pending', 'confirmed']),
          gte(bookings.startAt, new Date()),
          sql`${bookings.startAt} <= now() + interval '7 days'`,
          sql`${bookings.therapistId} IS NOT NULL`,
        ),
      )
      .groupBy(bookings.therapistId),
  ]);

  const rows: TherapistRow[] = therapistRows.map((t) => ({
    id: t.id,
    branchId: t.branchId,
    name: t.name,
    bio: t.bio,
    specialties: t.specialties,
    avatarUrl: t.avatarUrl,
    role: t.role,
    salaryType: t.salaryType,
    salaryValue: t.salaryValue,
    incentiveType: t.incentiveType,
    incentiveValue: t.incentiveValue,
    active: t.active,
    shiftCount: shiftRows.find((s) => s.therapistId === t.id)?.n ?? 0,
    next7Count: upcomingRows.find((u) => u.therapistId === t.id)?.n ?? 0,
  }));

  return (
    <TherapistManager
      therapists={rows}
      branches={[{ id: branchId, name: branchName, currency }]}
    />
  );
}

/* ----------------------------- promotions tab ----------------------------- */

async function BranchPromotionsTab({ branchId }: { branchId: string }) {
  const db = await getDb();
  const [promoRows, branchRow, linkRows] = await Promise.all([
    db.query.promotions.findMany({
      where: eq(promotions.branchId, branchId),
      orderBy: [desc(promotions.createdAt)],
    }),
    db.query.branches.findFirst({
      where: eq(branches.id, branchId),
      columns: { providerId: true },
    }),
    db.query.branchTreatments.findMany({
      where: eq(branchTreatments.branchId, branchId),
      columns: { treatmentId: true },
    }),
  ]);
  const rows: PromotionRow[] = promoRows.map((p) => ({
    id: p.id,
    title: p.title,
    summary: p.summary,
    position: p.position,
    startsAt: p.startsAt?.toISOString() ?? null,
    endsAt: p.endsAt?.toISOString() ?? null,
    active: p.active,
    linkUrl: p.linkUrl,
    sortOrder: p.sortOrder,
    code: p.code,
    discountType: p.discountType,
    discountValue: p.discountValue,
    currency: p.currency,
    minAmount: p.minAmount,
    maxUses: p.maxUses ?? 0,
    usedCount: p.usedCount,
    appliesTo: p.appliesTo,
    treatmentIds: p.treatmentIds,
    validFromHour: p.validFromHour,
    validUntilHour: p.validUntilHour,
  }));
  const linked = new Set(linkRows.map((l) => l.treatmentId));
  const treatmentRows = branchRow
    ? await db.query.treatments.findMany({
        where: eq(treatments.providerId, branchRow.providerId),
        orderBy: [asc(treatments.name)],
        columns: { id: true, name: true },
      })
    : [];
  const treatmentOptions = treatmentRows.filter((t) => linked.has(t.id));
  return <PromotionPanel branchId={branchId} rows={rows} treatmentOptions={treatmentOptions} />;
}

/* -------------------------------- reviews tab ------------------------------- */

async function BranchReviewsTab({ branchId }: { branchId: string }) {
  const db = await getDb();
  const reviewRows = await db.query.reviews.findMany({
    where: eq(reviews.branchId, branchId),
    orderBy: [desc(reviews.createdAt)],
  });
  const rows: ReviewRow[] = reviewRows.map((r) => ({
    id: r.id,
    guestName: r.guestName,
    rating: r.rating,
    comment: r.comment,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
  return <ReviewPanel rows={rows} />;
}

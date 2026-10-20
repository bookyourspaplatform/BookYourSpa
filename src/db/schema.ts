import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ */
/* Enums (text columns with literal unions — portable & easy to evolve) */
/* ------------------------------------------------------------------ */

export const ROLES = ['super_admin', 'provider', 'agent', 'customer'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['active', 'pending', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PROVIDER_STATUSES = ['pending', 'approved', 'suspended'] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export const TREATMENT_CATEGORIES = [
  'massage',
  'facial',
  'body',
  'bath',
  'nails',
  'hair',
  'wellness',
  'package',
] as const;
export type TreatmentCategory = (typeof TREATMENT_CATEGORIES)[number];

export const BOOKING_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'unpaid',
  'processing',
  'paid',
  'refunded',
  'partially_refunded',
  'venue',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_GATEWAYS = ['stripe', 'paypal', 'razorpay', 'venue'] as const;
export type PaymentGateway = (typeof PAYMENT_GATEWAYS)[number];

export const BOOKING_CHANNELS = ['direct', 'agent', 'admin'] as const;
export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

export const AGENT_TYPES = [
  'travel_agent',
  'hotel_concierge',
  'tour_operator',
  'affiliate',
  'reseller',
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export const COMMISSION_PARTIES = ['agent', 'provider', 'platform'] as const;
export type CommissionParty = (typeof COMMISSION_PARTIES)[number];

export const PAYOUT_PARTIES = ['provider', 'agent'] as const;
export type PayoutParty = (typeof PAYOUT_PARTIES)[number];

export const LEDGER_STATUSES = ['pending', 'approved', 'paid'] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

export const GATEWAY_PAYMENT_STATUSES = [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded',
  'cancelled',
] as const;
export type GatewayPaymentStatus = (typeof GATEWAY_PAYMENT_STATUSES)[number];

export const COUPON_SCOPES = ['global', 'provider', 'branch', 'treatment'] as const;
export type CouponScope = (typeof COUPON_SCOPES)[number];

export const DISCOUNT_TYPES = ['percent', 'fixed'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const PROMO_POSITIONS = ['hero', 'banner', 'deal'] as const;
export type PromoPosition = (typeof PROMO_POSITIONS)[number];

export const SPA_CATEGORIES = [
  'day_spa',
  'hotel_resort_spa',
  'doorstep_spa',
  'wellness_center',
  'beauty_spa',
  'medical_spa',
] as const;
export type SpaCategory = (typeof SPA_CATEGORIES)[number];

export const SPA_TYPES = [
  'massages',
  'body_treatment',
  'facials_skincare',
  'beauty_treatment',
  'sauna_thermal',
  'hydrotherapy',
  'hammam_bath',
  'wellness_therapies',
  'yoga_pilates',
  'foot_reflexology',
  'relaxation_healing',
  'retreats_packages',
  'couples_romantic',
  'sensual_wellness',
] as const;
export type SpaType = (typeof SPA_TYPES)[number];

export const SPA_FACILITIES = [
  'sauna',
  'steam_room',
  'jacuzzi',
  'plunge_pool',
  'swimming_pool',
  'gym',
  'spa_lounge',
  'showers',
  'lockers',
  'wifi',
  'parking',
  'restaurant',
  'garden',
  'couple_rooms',
  'private_rooms',
] as const;
export type SpaFacility = (typeof SPA_FACILITIES)[number];

export const EMAIL_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(), // usr_xxxxxxxx
    email: text('email').notNull().unique(),
    phone: text('phone'),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ROLES }).notNull().default('customer'),
    status: text('status', { enum: USER_STATUSES }).notNull().default('active'),
    locale: text('locale').default('en'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('users_role_idx').on(t.role)],
);

export const usersRelations = relations(users, ({ one }) => ({
  provider: one(providers, { fields: [users.id], references: [providers.ownerId] }),
  agent: one(agents, { fields: [users.id], references: [agents.userId] }),
}));

/* ------------------------------------------------------------------ */
/* Suppliers (spa providers / POS)                                     */
/* ------------------------------------------------------------------ */

export const providers = pgTable(
  'providers',
  {
    id: text('id').primaryKey(), // prv_xxxxxxxx
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    tagline: text('tagline'),
    description: text('description'),
    logoUrl: text('logo_url'),
    coverUrl: text('cover_url'),
    website: text('website'),
    phone: text('phone'),
    email: text('email'),
    country: text('country').notNull().default('ID'),
    baseCurrency: text('base_currency').notNull().default('IDR'),
    status: text('status', { enum: PROVIDER_STATUSES }).notNull().default('pending'),
    /** Platform take-rate in basis points (null -> use global setting). */
    commissionBps: integer('commission_bps'),
    featured: boolean('featured').notNull().default(false),
    featuredUntil: timestamp('featured_until', { withTimezone: true }),
    payoutMethod: text('payout_method'),
    payoutDetails: jsonb('payout_details').$type<Record<string, string>>().default({}),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('providers_status_idx').on(t.status)],
);

export const providersRelations = relations(providers, ({ one, many }) => ({
  owner: one(users, { fields: [providers.ownerId], references: [users.id] }),
  branches: many(branches),
  treatments: many(treatments),
}));

/* ------------------------------------------------------------------ */
/* Branches (locations / POS outlets)                                  */
/* ------------------------------------------------------------------ */

export type BranchHour = { day: number; open: string; close: string; closed: boolean };

export const branches = pgTable(
  'branches',
  {
    id: text('id').primaryKey(), // brn_xxxxxxxx
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    addressLine: text('address_line').notNull(),
    city: text('city').notNull(),
    region: text('region'),
    country: text('country').notNull().default('ID'),
    timezone: text('timezone').notNull().default('Asia/Makassar'),
    currency: text('currency').notNull().default('IDR'),
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    lat: text('lat'),
    lng: text('lng'),
    images: text('images').array().notNull().default(sql`'{}'::text[]`),
    /** Google Maps share/place link — the import source for lat/lng and details. */
    googleMapsUrl: text('google_maps_url'),
    /** CTA / branding words shown on the spa card. */
    tagline: text('tagline'),
    /** Up to 160 chars — doubles as the SEO description for the branch page. */
    shortDescription: text('short_description'),
    /** Spa business categories (shown on the search bar + spa card). */
    categories: text('categories', { enum: SPA_CATEGORIES })
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Service types (shown on the search bar and treatment forms). */
    spaTypes: text('spa_types', { enum: SPA_TYPES })
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Therapists travel to the guest (massage on call / doorstep). */
    doorstepService: boolean('doorstep_service').notNull().default(false),
    facilities: text('facilities', { enum: SPA_FACILITIES })
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    description: text('description'),
    /** Weekly opening hours in branch-local time. */
    hours: jsonb('hours').$type<BranchHour[]>().notNull().default([]),
    /** Minimum minutes between now and the earliest bookable slot. */
    leadTimeMinutes: integer('lead_time_minutes').notNull().default(60),
    /** How far ahead customers may book, in days. */
    maxAdvanceDays: integer('max_advance_days').notNull().default(90),
    /** Minutes of buffer appended to each appointment for turnover. */
    bufferMinutes: integer('buffer_minutes').notNull().default(0),
    slotIntervalMinutes: integer('slot_interval_minutes').notNull().default(30),
    onlinePaymentEnabled: boolean('online_payment_enabled').notNull().default(true),
    paymentMethods: text('payment_methods')
      .array()
      .notNull()
      .default(sql`'{stripe,paypal,razorpay,venue}'::text[]`),
    status: text('status', { enum: USER_STATUSES }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('branches_provider_slug_uq').on(t.providerId, t.slug),
    index('branches_city_idx').on(t.city),
    index('branches_status_idx').on(t.status),
  ],
);

export const branchesRelations = relations(branches, ({ one, many }) => ({
  provider: one(providers, { fields: [branches.providerId], references: [providers.id] }),
  branchTreatments: many(branchTreatments),
  therapists: many(therapists),
  bookings: many(bookings),
}));

/* ------------------------------------------------------------------ */
/* Catalog: treatments + branch pricing                                */
/* ------------------------------------------------------------------ */

export const treatments = pgTable(
  'treatments',
  {
    id: text('id').primaryKey(), // trt_xxxxxxxx
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    category: text('category', { enum: TREATMENT_CATEGORIES }).notNull().default('massage'),
    description: text('description'),
    durationMin: integer('duration_min').notNull().default(60),
    listPrice: integer('list_price').notNull().default(0),
    currency: text('currency').notNull().default('IDR'),
    imageUrl: text('image_url'),
    benefits: text('benefits').array().notNull().default(sql`'{}'::text[]`),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    requiresTherapist: boolean('requires_therapist').notNull().default(true),
    /** Seats/rooms available concurrently for non-therapist treatments. */
    capacity: integer('capacity').notNull().default(1),
    agentApproved: boolean('agent_approved').notNull().default(false),
    status: text('status', { enum: USER_STATUSES }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('treatments_provider_idx').on(t.providerId),
    index('treatments_category_idx').on(t.category),
    index('treatments_status_idx').on(t.status),
  ],
);

export const treatmentsRelations = relations(treatments, ({ one, many }) => ({
  provider: one(providers, { fields: [treatments.providerId], references: [providers.id] }),
  branchTreatments: many(branchTreatments),
  agentRates: many(agentRates),
}));

/** Treatment offered at a branch, with the branch-local price. */
export const branchTreatments = pgTable(
  'branch_treatments',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    treatmentId: text('treatment_id')
      .notNull()
      .references(() => treatments.id, { onDelete: 'cascade' }),
    price: integer('price').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('branch_treatments_uq').on(t.branchId, t.treatmentId),
    index('branch_treatments_treatment_idx').on(t.treatmentId),
  ],
);

export const branchTreatmentsRelations = relations(branchTreatments, ({ one }) => ({
  branch: one(branches, { fields: [branchTreatments.branchId], references: [branches.id] }),
  treatment: one(treatments, { fields: [branchTreatments.treatmentId], references: [treatments.id] }),
}));

/* ------------------------------------------------------------------ */
/* Therapists + schedules                                              */
/* ------------------------------------------------------------------ */

export const therapists = pgTable(
  'therapists',
  {
    id: text('id').primaryKey(), // thp_xxxxxxxx
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    bio: text('bio'),
    specialties: text('specialties').array().notNull().default(sql`'{}'::text[]`),
    avatarUrl: text('avatar_url'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('therapists_branch_idx').on(t.branchId)],
);

export const therapistsRelations = relations(therapists, ({ one }) => ({
  branch: one(branches, { fields: [therapists.branchId], references: [branches.id] }),
}));

/** Recurring weekly working window for a therapist (branch-local time). */
export const schedules = pgTable(
  'therapist_schedules',
  {
    id: text('id').primaryKey(),
    therapistId: text('therapist_id')
      .notNull()
      .references(() => therapists.id, { onDelete: 'cascade' }),
    /** 0 = Sunday … 6 = Saturday */
    weekday: integer('weekday').notNull(),
    startTime: text('start_time').notNull(), // HH:MM
    endTime: text('end_time').notNull(), // HH:MM
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('schedules_uq').on(t.therapistId, t.weekday, t.startTime),
    index('schedules_therapist_idx').on(t.therapistId),
  ],
);

export const schedulesRelations = relations(schedules, ({ one }) => ({
  therapist: one(therapists, { fields: [schedules.therapistId], references: [therapists.id] }),
}));

/** One-off overrides: time off or special hours. */
export const scheduleExceptions = pgTable(
  'schedule_exceptions',
  {
    id: text('id').primaryKey(),
    /** null therapist = applies to the whole branch (or a single treatment room). */
    therapistId: text('therapist_id').references(() => therapists.id, { onDelete: 'cascade' }),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    date: date('date').notNull(), // YYYY-MM-DD (branch local)
    startTime: text('start_time'), // null = whole day
    endTime: text('end_time'),
    kind: text('kind', { enum: ['closed', 'special_hours'] }).notNull().default('closed'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('exceptions_branch_date_idx').on(t.branchId, t.date),
    index('exceptions_therapist_date_idx').on(t.therapistId, t.date),
  ],
);

export const scheduleExceptionsRelations = relations(scheduleExceptions, ({ one }) => ({
  therapist: one(therapists, {
    fields: [scheduleExceptions.therapistId],
    references: [therapists.id],
  }),
  branch: one(branches, { fields: [scheduleExceptions.branchId], references: [branches.id] }),
}));

/* ------------------------------------------------------------------ */
/* Agents / resellers                                                  */
/* ------------------------------------------------------------------ */

export const agents = pgTable(
  'agents',
  {
    id: text('id').primaryKey(), // agt_xxxxxxxx
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .unique(),
    companyName: text('company_name').notNull(),
    slug: text('slug').notNull().unique(),
    agentType: text('agent_type', { enum: AGENT_TYPES }).notNull().default('travel_agent'),
    country: text('country').notNull().default('ID'),
    website: text('website'),
    phone: text('phone'),
    /** Default commission in basis points applied to booking gross. */
    commissionBps: integer('commission_bps').notNull().default(1000),
    status: text('status', { enum: PROVIDER_STATUSES }).notNull().default('pending'),
    referralCode: text('referral_code').notNull().unique(),
    payoutDetails: jsonb('payout_details').$type<Record<string, string>>().default({}),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('agents_status_idx').on(t.status)],
);

export const agentsRelations = relations(agents, ({ one, many }) => ({
  user: one(users, { fields: [agents.userId], references: [users.id] }),
  rates: many(agentRates),
  bookings: many(bookings),
}));

/** Net (reseller) price an approved agent pays for a treatment. */
export const agentRates = pgTable(
  'agent_rates',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    treatmentId: text('treatment_id')
      .notNull()
      .references(() => treatments.id, { onDelete: 'cascade' }),
    /** Net cost to the agent, in the treatment currency. */
    netPrice: integer('net_price').notNull(),
    active: boolean('active').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('agent_rates_uq').on(t.agentId, t.treatmentId)],
);

export const agentRatesRelations = relations(agentRates, ({ one }) => ({
  agent: one(agents, { fields: [agentRates.agentId], references: [agents.id] }),
  treatment: one(treatments, { fields: [agentRates.treatmentId], references: [treatments.id] }),
}));

/* ------------------------------------------------------------------ */
/* Bookings                                                            */
/* ------------------------------------------------------------------ */

export const bookings = pgTable(
  'bookings',
  {
    id: text('id').primaryKey(), // bkg_xxxxxxxx
    code: text('code').notNull().unique(), // human voucher code, e.g. BYS-4F7K2Q
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'restrict' }),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    treatmentId: text('treatment_id')
      .notNull()
      .references(() => treatments.id, { onDelete: 'restrict' }),
    therapistId: text('therapist_id').references(() => therapists.id, { onDelete: 'set null' }),
    customerId: text('customer_id').references(() => users.id, { onDelete: 'set null' }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** Guest checkout snapshot (also filled for member bookings). */
    guestName: text('guest_name').notNull(),
    guestEmail: text('guest_email').notNull(),
    guestPhone: text('guest_phone'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull().default('Asia/Makassar'),
    status: text('status', { enum: BOOKING_STATUSES }).notNull().default('pending'),
    paymentStatus: text('payment_status', { enum: PAYMENT_STATUSES }).notNull().default('unpaid'),
    channel: text('channel', { enum: BOOKING_CHANNELS }).notNull().default('direct'),
    /** Money snapshots — all integers in branch-currency minor units. */
    currency: text('currency').notNull().default('IDR'),
    listPrice: integer('list_price').notNull().default(0),
    discountAmount: integer('discount_amount').notNull().default(0),
    totalAmount: integer('total_amount').notNull().default(0),
    platformFee: integer('platform_fee').notNull().default(0),
    agentCommission: integer('agent_commission').notNull().default(0),
    providerEarning: integer('provider_earning').notNull().default(0),
    couponCode: text('coupon_code'),
    /** Unpaid online bookings release their slot after this moment. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    notes: text('notes'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('bookings_branch_start_idx').on(t.branchId, t.startAt),
    index('bookings_provider_start_idx').on(t.providerId, t.startAt),
    index('bookings_customer_idx').on(t.customerId),
    index('bookings_agent_idx').on(t.agentId),
    index('bookings_status_idx').on(t.status),
    index('bookings_email_idx').on(t.guestEmail),
    // Belt-and-braces against double booking: one *active* appointment per therapist slot.
    uniqueIndex('bookings_therapist_slot_uq')
      .on(t.therapistId, t.startAt)
      .where(sql`therapist_id IS NOT NULL AND status IN ('pending','confirmed')`),
  ],
);

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  provider: one(providers, { fields: [bookings.providerId], references: [providers.id] }),
  branch: one(branches, { fields: [bookings.branchId], references: [branches.id] }),
  treatment: one(treatments, { fields: [bookings.treatmentId], references: [treatments.id] }),
  therapist: one(therapists, { fields: [bookings.therapistId], references: [therapists.id] }),
  customer: one(users, { fields: [bookings.customerId], references: [users.id] }),
  agent: one(agents, { fields: [bookings.agentId], references: [agents.id] }),
  payments: many(payments),
  commissions: many(commissions),
}));

/* ------------------------------------------------------------------ */
/* Money movement: payments, commissions, payouts                      */
/* ------------------------------------------------------------------ */

export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey(), // pay_xxxxxxxx
    bookingId: text('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    gateway: text('gateway', { enum: PAYMENT_GATEWAYS }).notNull(),
    status: text('status', { enum: GATEWAY_PAYMENT_STATUSES }).notNull().default('pending'),
    amount: integer('amount').notNull(),
    refundedAmount: integer('refunded_amount').notNull().default(0),
    currency: text('currency').notNull(),
    /** Gateway checkout / order / payment id. */
    externalId: text('external_id'),
    clientSecret: text('client_secret'),
    payerEmail: text('payer_email'),
    gatewayData: jsonb('gateway_data').$type<Record<string, unknown>>().default({}),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('payments_booking_idx').on(t.bookingId),
    uniqueIndex('payments_external_uq').on(t.gateway, t.externalId),
    index('payments_status_idx').on(t.status),
  ],
);

export const paymentsRelations = relations(payments, ({ one }) => ({
  booking: one(bookings, { fields: [payments.bookingId], references: [bookings.id] }),
}));

export const commissions = pgTable(
  'commissions',
  {
    id: text('id').primaryKey(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    party: text('party', { enum: COMMISSION_PARTIES }).notNull(),
    providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    rateBps: integer('rate_bps').notNull().default(0),
    amount: integer('amount').notNull().default(0),
    currency: text('currency').notNull(),
    status: text('status', { enum: LEDGER_STATUSES }).notNull().default('pending'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('commissions_booking_idx').on(t.bookingId),
    index('commissions_agent_idx').on(t.agentId),
    index('commissions_provider_idx').on(t.providerId),
    index('commissions_status_idx').on(t.status),
  ],
);

export const commissionsRelations = relations(commissions, ({ one }) => ({
  booking: one(bookings, { fields: [commissions.bookingId], references: [bookings.id] }),
  agent: one(agents, { fields: [commissions.agentId], references: [agents.id] }),
  provider: one(providers, { fields: [commissions.providerId], references: [providers.id] }),
}));

export const payouts = pgTable(
  'payouts',
  {
    id: text('id').primaryKey(),
    party: text('party', { enum: PAYOUT_PARTIES }).notNull(),
    providerId: text('provider_id').references(() => providers.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    status: text('status', { enum: ['pending', 'processing', 'paid'] })
      .notNull()
      .default('pending'),
    reference: text('reference'),
    notes: text('notes'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('payouts_party_idx').on(t.party, t.providerId, t.agentId)],
);

export const payoutsRelations = relations(payouts, ({ one }) => ({
  provider: one(providers, { fields: [payouts.providerId], references: [providers.id] }),
  agent: one(agents, { fields: [payouts.agentId], references: [agents.id] }),
}));

/* ------------------------------------------------------------------ */
/* Marketing, content, platform config                                 */
/* ------------------------------------------------------------------ */

export const coupons = pgTable(
  'coupons',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    description: text('description'),
    scope: text('scope', { enum: COUPON_SCOPES }).notNull().default('global'),
    providerId: text('provider_id').references(() => providers.id, { onDelete: 'cascade' }),
    branchId: text('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    treatmentId: text('treatment_id').references(() => treatments.id, { onDelete: 'cascade' }),
    discountType: text('discount_type', { enum: DISCOUNT_TYPES }).notNull().default('percent'),
    /** percent = basis points (1500 = 15%), fixed = minor units. */
    discountValue: integer('discount_value').notNull(),
    currency: text('currency'),
    minAmount: integer('min_amount').notNull().default(0),
    maxUses: integer('max_uses').default(0), // 0 = unlimited
    usedCount: integer('used_count').notNull().default(0),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('coupons_active_idx').on(t.active)],
);

export const couponsRelations = relations(coupons, ({ one }) => ({
  provider: one(providers, { fields: [coupons.providerId], references: [providers.id] }),
  branch: one(branches, { fields: [coupons.branchId], references: [branches.id] }),
  treatment: one(treatments, { fields: [coupons.treatmentId], references: [treatments.id] }),
}));

export const promotions = pgTable(
  'promotions',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    summary: text('summary'),
    imageUrl: text('image_url'),
    linkUrl: text('link_url'),
    position: text('position', { enum: PROMO_POSITIONS }).notNull().default('banner'),
    providerId: text('provider_id').references(() => providers.id, { onDelete: 'cascade' }),
    branchId: text('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('promotions_position_idx').on(t.position, t.active)],
);

export const promotionsRelations = relations(promotions, ({ one }) => ({
  provider: one(providers, { fields: [promotions.providerId], references: [providers.id] }),
  branch: one(branches, { fields: [promotions.branchId], references: [branches.id] }),
}));

/* ------------------------------------------------------------------ */
/* Retail products sold at a branch                                    */
/* ------------------------------------------------------------------ */

export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(), // prd_xxxxxxxx
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** Retail price in branch-currency minor units. */
    price: integer('price').notNull().default(0),
    currency: text('currency').notNull().default('IDR'),
    imageUrl: text('image_url'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('products_branch_idx').on(t.branchId), index('products_provider_idx').on(t.providerId)],
);

export const productsRelations = relations(products, ({ one }) => ({
  provider: one(providers, { fields: [products.providerId], references: [providers.id] }),
  branch: one(branches, { fields: [products.branchId], references: [branches.id] }),
}));

/* ------------------------------------------------------------------ */
/* Customer reviews of a branch                                        */
/* ------------------------------------------------------------------ */

export const REVIEW_STATUSES = ['pending', 'published', 'hidden'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const reviews = pgTable(
  'reviews',
  {
    id: text('id').primaryKey(), // rev_xxxxxxxx
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    bookingId: text('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    guestName: text('guest_name').notNull(),
    rating: integer('rating').notNull(), // 1..5
    comment: text('comment'),
    /** Providers publish/hide reviews; hidden ones never show publicly. */
    status: text('status', { enum: REVIEW_STATUSES }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('reviews_branch_idx').on(t.branchId), index('reviews_status_idx').on(t.status)],
);

export const reviewsRelations = relations(reviews, ({ one }) => ({
  branch: one(branches, { fields: [reviews.branchId], references: [branches.id] }),
  booking: one(bookings, { fields: [reviews.bookingId], references: [bookings.id] }),
}));

export const pages = pgTable('pages', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  metaTitle: text('meta_title'),
  metaDescription: text('meta_description'),
  published: boolean('published').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role', { enum: ROLES }),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('audit_actor_idx').on(t.actorId), index('audit_entity_idx').on(t.entity, t.entityId)],
);

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }),
}));

export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: text('id').primaryKey(),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    template: text('template').notNull(),
    body: text('body').notNull(),
    status: text('status', { enum: EMAIL_STATUSES }).notNull().default('queued'),
    error: text('error'),
    bookingId: text('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [index('email_outbox_status_idx').on(t.status)],
);

export const emailOutboxRelations = relations(emailOutbox, ({ one }) => ({
  booking: one(bookings, { fields: [emailOutbox.bookingId], references: [bookings.id] }),
}));

/* ------------------------------------------------------------------ */
/* Inferred types                                                      */
/* ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type Provider = typeof providers.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type BranchHourRow = BranchHour;
export type Treatment = typeof treatments.$inferSelect;
export type BranchTreatment = typeof branchTreatments.$inferSelect;
export type Therapist = typeof therapists.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type ScheduleException = typeof scheduleExceptions.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type AgentRate = typeof agentRates.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type Commission = typeof commissions.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type Promotion = typeof promotions.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Page = typeof pages.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type EmailOutbox = typeof emailOutbox.$inferSelect;

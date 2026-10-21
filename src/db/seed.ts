import { eq } from 'drizzle-orm';
import { getDb } from './index';
import * as T from './schema';
import { hashPassword } from '@/lib/auth/password';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { priceBooking } from '@/lib/pricing';
import { dateKeyInTz, minutesOf, newId, slugify } from '@/lib/utils';
import { zonedToUtc } from '@/lib/availability';

/**
 * Realistic demo data covering every role and flow:
 *   admin, two approved providers (Bali + Dubai), a pending provider,
 *   an approved + a pending agent, a member customer, branch catalogues,
 *   therapist schedules, agent net rates, coupons, promotions, CMS pages
 *   and a spread of bookings across paid / venue / agent / cancelled states.
 */

const BALI_TZ = 'Asia/Makassar';
const DUBAI_TZ = 'Asia/Dubai';

const PASSWORDS = {
  admin: 'BYS154@bys',
  provider: 'HCS154@bys',
  orchid: 'BOS@test',
  agent: 'BTTD154@bys',
  customer: 'apps154@bys',
};

function weeklyHours(open: string, close: string): T.BranchHour[] {
  return [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open, close, closed: false }));
}

/** Local wall time → UTC instant for a day offset from today in `tz`. */
function atLocal(dayOffset: number, time: string, tz: string): Date {
  const today = dateKeyInTz(new Date(), tz);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return zonedToUtc(d.toISOString().slice(0, 10), minutesOf(time), tz);
}

export async function runSeed(opts: { force?: boolean } = {}): Promise<void> {
  const db = await getDb();

  const existing = await db
    .select({ id: T.users.id })
    .from(T.users)
    .where(eq(T.users.email, 'portal@bookyourspa.net'))
    .limit(1);

  if (existing.length > 0) {
    if (!opts.force) {
      console.log('Database already seeded — run with --force to wipe and reseed.');
      return;
    }
    // Child → parent wipe order (no cascade on every relation).
    for (const table of [
      T.commissions,
      T.payments,
      T.payouts,
      T.emailOutbox,
      T.auditLogs,
      T.bookings,
      T.agentRates,
      T.agents,
      T.coupons,
      T.promotions,
      T.products,
      T.reviews,
      T.branchTreatments,
      T.scheduleExceptions,
      T.schedules,
      T.therapists,
      T.treatments,
      T.branches,
      T.providers,
      T.settings,
      T.pages,
      T.users,
    ]) {
      await db.delete(table);
    }
    console.log('Wiped existing data.');
  }

  /* ------------------------------ users ------------------------------ */

  const adminId = newId('usr');
  const aranjayaOwnerId = newId('usr');
  const serenityOwnerId = newId('usr');
  const lotusOwnerId = newId('usr');
  const agentUserId = newId('usr');
  const pendingAgentUserId = newId('usr');
  const customerId = newId('usr');

  await db.insert(T.users).values([
    {
      id: adminId,
      email: 'portal@bookyourspa.net',
      name: 'Super Admin',
      passwordHash: await hashPassword(PASSWORDS.admin),
      role: 'super_admin',
      status: 'active',
    },
    {
      id: aranjayaOwnerId,
      email: 'baliorchidspa@bookyourspa.net',
      name: 'Bali Orchid Spa',
      phone: '+62 812 1000 1001',
      passwordHash: await hashPassword(PASSWORDS.orchid),
      role: 'provider',
      status: 'active',
    },
    {
      id: serenityOwnerId,
      email: 'booking@homecarespa.ae',
      name: 'Nadia Al Mansoori',
      phone: '+971 50 100 1002',
      passwordHash: await hashPassword(PASSWORDS.provider),
      role: 'provider',
      status: 'active',
    },
    {
      id: lotusOwnerId,
      email: 'owner@lotusretreat.com',
      name: 'Wayan Gede',
      passwordHash: await hashPassword(PASSWORDS.provider),
      role: 'provider',
      status: 'active',
    },
    {
      id: agentUserId,
      email: 'info@balithingstodo.net',
      name: 'Sasha Rivera',
      phone: '+62 813 2000 2001',
      passwordHash: await hashPassword(PASSWORDS.agent),
      role: 'agent',
      status: 'active',
    },
    {
      id: pendingAgentUserId,
      email: 'agent@horizontours.com',
      name: 'Omar Haddad',
      passwordHash: await hashPassword(PASSWORDS.agent),
      role: 'agent',
      status: 'pending',
    },
    {
      id: customerId,
      email: 'appsdaeng@gmail.com',
      name: 'Apps Daeng',
      phone: '+61 400 555 010',
      passwordHash: await hashPassword(PASSWORDS.customer),
      role: 'customer',
      status: 'active',
    },
  ]);

  /* ---------------------------- providers ---------------------------- */

  const aranjayaId = newId('prv');
  const serenityId = newId('prv');
  const lotusId = newId('prv');

  await db.insert(T.providers).values([
    {
      id: aranjayaId,
      ownerId: aranjayaOwnerId,
      name: 'Orchid Spa',
      slug: slugify('Orchid Spa'),
      tagline: 'Traditional Balinese healing, five-star service',
      description:
        'Orchid Spa blends ancient Balinese boreh and boreh-inspired rituals with modern wellness practice. Two flagship outlets — Bali Orchid Spa and Royal Orchid Spa — a team of certified therapists and an unhurried approach to every treatment.',
      country: 'ID',
      baseCurrency: 'IDR',
      status: 'approved',
      featured: true,
      featuredUntil: atLocal(60, '12:00', BALI_TZ),
      website: 'https://orchidspa.example.com',
      phone: '+62 361 474 7001',
      email: 'hello@orchidspa.example.com',
      approvedAt: new Date(),
      commissionBps: 1500,
      payoutMethod: 'bank_transfer',
      payoutDetails: { bank: 'BCA', account: '8830 1100 2211', holder: 'PT Orchid Spa Wellness' },
    },
    {
      id: serenityId,
      ownerId: serenityOwnerId,
      name: 'Serenity Dubai Spa',
      slug: slugify('Serenity Dubai Spa'),
      tagline: 'Hammam rituals and desert botanicals in Dubai Marina',
      description:
        'Serenity Dubai Spa brings authentic Moroccan hammam ceremonies, desert clay wraps and signature facials to Dubai Marina. Open daily until 22:00 with a mixed-gender therapist team.',
      country: 'AE',
      baseCurrency: 'AED',
      status: 'approved',
      featured: true,
      featuredUntil: atLocal(45, '12:00', DUBAI_TZ),
      website: 'https://serenitydubai.example.com',
      phone: '+971 4 555 0199',
      email: 'spa@serenitydubai.example.com',
      approvedAt: new Date(),
      commissionBps: 2000,
      payoutMethod: 'bank_transfer',
      payoutDetails: { bank: 'Emirates NBD', account: 'AE07 0331 2345 6789 0123 456', holder: 'Serenity Wellness FZ-LLC' },
    },
    {
      id: lotusId,
      ownerId: lotusOwnerId,
      name: 'Lotus Retreat Spa',
      slug: slugify('Lotus Retreat Spa'),
      tagline: 'Awaiting approval — Canggu',
      description: 'New wellness studio in Canggu offering Balinese massage and sound healing.',
      country: 'ID',
      baseCurrency: 'IDR',
      status: 'pending',
    },
  ]);

  /* ---------------------------- branches ----------------------------- */

  const seminyakId = newId('brn');
  const ubudId = newId('brn');
  const marinaId = newId('brn');
  const cangguId = newId('brn');

  await db.insert(T.branches).values([
    {
      id: seminyakId,
      providerId: aranjayaId,
      name: 'Bali Orchid Spa',
      slug: 'bali-orchid-spa',
      addressLine: 'Jl. Kayu Ayo No. 18, Seminyak',
      city: 'Seminyak',
      region: 'Bali',
      country: 'ID',
      timezone: BALI_TZ,
      currency: 'IDR',
      phone: '+62 361 474 7001',
      email: 'bali@orchidspa.example.com',
      website: 'https://orchidspa.example.com',
      lat: '-8.7216701',
      lng: '115.1897817',
      googleMapsUrl:
        'https://www.google.com/maps/place/Bali+Orchid+Spa/@-8.7216701,115.1872068,17z/data=!4m9!3m8!1s0x2dd2414d4312737b:0x38aa1b1af04e2591!5m2!4m1!1i2!8m2!3d-8.7216701!4d115.1897817!16s%2Fg%2F1td2qpls?entry=ttu&g_ep=EgoyMDI2MTAxOS4wIKXMDSoASAFQAw%3D%3D',
      tagline: 'Beachside flagship, 50m from the sand',
      shortDescription:
        'Six treatment rooms, a flower-bath suite and a garden lounge — our flagship spa, fifty metres from Seminyak Beach.',
      categories: ['day_spa', 'beauty_spa'],
      spaTypes: ['massages', 'body_treatment', 'facials_skincare', 'foot_reflexology'],
      doorstepService: true,
      showTherapistOnline: true,
      facilities: ['sauna', 'steam_room', 'garden', 'couple_rooms', 'wifi', 'parking'],
      images: [
        'https://images.unsplash.com/photo-1519823551278-64ac92734fb1?w=1200&q=80',
        'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1200&q=80',
        'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=1200&q=80',
      ],
      description:
        'Our flagship outlet,50 metres from Seminyak Beach. Six treatment rooms, a flower-bath suite and a lush garden relaxation lounge.',
      hours: weeklyHours('10:00', '21:00'),
      paymentMethods: ['stripe', 'paypal', 'venue'],
      leadTimeMinutes: 60,
      maxAdvanceDays: 90,
      bufferMinutes: 15,
      slotIntervalMinutes: 30,
      onlinePaymentEnabled: true,
      status: 'active',
    },
    {
      id: ubudId,
      providerId: aranjayaId,
      name: 'Royal Orchid Spa',
      slug: 'royal-orchid-spa',
      addressLine: 'Jl. Raya Sanggingan No. 9, Ubud',
      city: 'Ubud',
      region: 'Bali',
      country: 'ID',
      timezone: BALI_TZ,
      currency: 'IDR',
      phone: '+62 361 474 7002',
      email: 'ubud@orchidspa.example.com',
      website: 'https://orchidspa.example.com',
      lat: '-8.7855258',
      lng: '115.2251176',
      googleMapsUrl:
        'https://www.google.com/maps/place/Royal+Orchid+Spa/@-8.7855258,115.2251176,17z/data=!3m1!4b1!4m6!3m5!1s0x2dd243573ab44599:0x50e5d8a5adf6b0b2!8m2!3d-8.7855258!4d115.2251176!16s%2Fg%2F11fmqnbcpy?entry=ttu&g_ep=EgoyMDI2MTAxOS4wIKXMDSoASAFQAw%3D%3D',
      tagline: 'Riverside calm above the Campuhan ridge',
      shortDescription:
        'Open-air pavilions, sauna and steam complex and two couple suites on a riverside ridge above Campuhan.',
      categories: ['day_spa', 'wellness_center'],
      spaTypes: ['massages', 'wellness_therapies', 'yoga_pilates', 'retreats_packages'],
      doorstepService: false,
      showTherapistOnline: true,
      facilities: ['sauna', 'steam_room', 'swimming_pool', 'garden', 'restaurant', 'wifi', 'parking'],
      images: [
        'https://images.unsplash.com/photo-1515377905703-c4788e51af15?w=1200&q=80',
        'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=1200&q=80',
      ],
      description:
        'Riverside sanctuary above the Campuhan ridge with open-air pavilions, a sauna and steam complex and two couple suites.',
      hours: weeklyHours('10:00', '20:30'),
      paymentMethods: ['stripe', 'paypal', 'venue'],
      leadTimeMinutes: 90,
      maxAdvanceDays: 60,
      bufferMinutes: 15,
      slotIntervalMinutes: 30,
      onlinePaymentEnabled: true,
      status: 'active',
    },
    {
      id: marinaId,
      providerId: serenityId,
      name: 'Dubai Marina',
      slug: 'dubai-marina',
      addressLine: 'Marina Plaza, Level 3, Dubai Marina',
      city: 'Dubai',
      region: 'Dubai',
      country: 'AE',
      timezone: DUBAI_TZ,
      currency: 'AED',
      phone: '+971 4 555 0199',
      email: 'marina@serenitydubai.example.com',
      website: 'https://serenitydubai.example.com',
      lat: '25.0805',
      lng: '55.1403',
      googleMapsUrl: 'https://www.google.com/maps/place/Dubai+Marina+Spa/@25.0805,55.1403,17z',
      tagline: 'Marble hammam rituals overlooking the Marina',
      shortDescription:
        'Moroccan hammam ceremonies, a snow room and eight treatment suites overlooking Dubai Marina — open daily until 22:00.',
      categories: ['day_spa', 'hotel_resort_spa', 'beauty_spa'],
      spaTypes: ['massages', 'hammam_bath', 'hydrotherapy', 'facials_skincare', 'body_treatment'],
      doorstepService: true,
      showTherapistOnline: true,
      agentFeeBps: 1200,
      facilities: ['sauna', 'steam_room', 'jacuzzi', 'swimming_pool', 'parking', 'couple_rooms', 'wifi', 'restaurant'],
      images: [
        'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=1200&q=80',
        'https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?w=1200&q=80',
        'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=1200&q=80',
        'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=1200&q=80',
      ],
      description:
        'Hammam ceremony room, snow room and eight treatment suites overlooking Dubai Marina. Valet parking available.',
      hours: weeklyHours('10:00', '22:00'),
      paymentMethods: ['stripe', 'razorpay', 'venue'],
      leadTimeMinutes: 60,
      maxAdvanceDays: 120,
      bufferMinutes: 15,
      slotIntervalMinutes: 30,
      onlinePaymentEnabled: true,
      status: 'active',
    },
    {
      id: cangguId,
      providerId: lotusId,
      name: 'Canggu',
      slug: 'canggu',
      addressLine: 'Jl. Pantai Berawa No. 5, Canggu',
      city: 'Canggu',
      region: 'Bali',
      country: 'ID',
      timezone: BALI_TZ,
      currency: 'IDR',
      tagline: 'Laid-back surf-town wellness',
      shortDescription: 'Compact wellness studio near Berawa beach — massages, recovery and quick facials.',
      categories: ['day_spa', 'wellness_center'],
      spaTypes: ['massages', 'relaxation_healing', 'foot_reflexology'],
      doorstepService: false,
      facilities: ['wifi', 'lockers', 'showers'],
      images: ['https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?w=1200&q=80'],
      hours: weeklyHours('09:00', '20:00'),
      status: 'active',
    },
  ]);

  /* --------------------------- treatments ---------------------------- */

  type Tmt = Omit<typeof T.treatments.$inferInsert, 'listPrice'> & { listPrice: number };
  const aranjayaTreatments: Tmt[] = [
    {
      id: 'trt_aranjaya_boreh',
      providerId: aranjayaId,
      name: 'Balinese Boreh Massage',
      slug: 'balinese-boreh-massage',
      category: 'massage',
      description:
        'A warming traditional boreh paste of clove, ginger and nutmeg is applied before a slow full-body Balinese massage. Eases travel fatigue and jet lag.',
      durationMin: 60,
      listPrice: 450000,
      currency: 'IDR',
      priceOptions: [
        { durationMin: 60, price: 450000, capacity: 2 },
        { durationMin: 90, price: 620000, capacity: 2 },
        { durationMin: 120, price: 800000, capacity: 1 },
      ],
      genre: 'both',
      deliveryType: 'both',
      benefits: ['Eases muscle tension', 'Warming spice paste', 'Improves circulation'],
      tags: ['traditional', 'jet-lag', 'signature'],
      agentApproved: true,
    },
    {
      id: 'trt_aranjaya_deep',
      providerId: aranjayaId,
      name: 'Deep Tissue Massage',
      slug: 'deep-tissue-massage',
      category: 'massage',
      description:
        'Firm, focused pressure across the posterior chain for chronic tension in the shoulders, lower back and hips.',
      durationMin: 90,
      listPrice: 650000,
      currency: 'IDR',
      priceOptions: [
        { durationMin: 60, price: 480000, capacity: 2 },
        { durationMin: 90, price: 650000, capacity: 2 },
      ],
      genre: 'man_only',
      deliveryType: 'in_spa',
      benefits: ['Releases chronic tension', 'Postural recovery'],
      tags: ['firm pressure'],
    },
    {
      id: 'trt_aranjaya_aroma',
      providerId: aranjayaId,
      name: 'Aromatherapy Massage',
      slug: 'aromatherapy-massage',
      category: 'massage',
      description:
        'Slow Swedish-style strokes with a bespoke essential-oil blend — choose frangipani, lemongrass or lavender.',
      durationMin: 60,
      listPrice: 480000,
      currency: 'IDR',
      benefits: ['Deep relaxation', 'Custom oil blend'],
      tags: ['relaxing', 'first-visit'],
      agentApproved: true,
    },
    {
      id: 'trt_aranjaya_hotstone',
      providerId: aranjayaId,
      name: 'Hot Stone Therapy',
      slug: 'hot-stone-therapy',
      category: 'massage',
      description: 'Basalt stones heated to 45°C placed along meridians while the therapist works deep, flowing strokes.',
      durationMin: 75,
      listPrice: 720000,
      currency: 'IDR',
      benefits: ['Melts deep tension', 'Warm, restorative'],
      tags: ['warming'],
    },
    {
      id: 'trt_aranjaya_facial',
      providerId: aranjayaId,
      name: 'Tropical Fruit Facial',
      slug: 'tropical-fruit-facial',
      category: 'facial',
      description:
        'Enzyme peel of papaya and pineapple, lymphatic drainage massage and a hydrating mask for sun-exposed skin.',
      durationMin: 60,
      listPrice: 550000,
      currency: 'IDR',
      benefits: ['Brightens dull skin', 'After-sun recovery'],
      tags: ['glow', 'sun-care'],
      agentApproved: true,
    },
    {
      id: 'trt_aranjaya_scrub',
      providerId: aranjayaId,
      name: 'Body Scrub & Flower Bath',
      slug: 'body-scrub-flower-bath',
      category: 'body',
      description: 'Sea-salt and coconut scrub followed by a private frangipani flower bath and body lotion seal.',
      durationMin: 90,
      listPrice: 780000,
      currency: 'IDR',
      benefits: ['Exfoliates & softens', 'Private flower bath'],
      tags: ['ritual', 'instagrammable'],
    },
    {
      id: 'trt_aranjaya_reflex',
      providerId: aranjayaId,
      name: 'Foot Reflexology',
      slug: 'foot-reflexology',
      category: 'wellness',
      description: 'Thumb-work across reflex points of the feet and lower legs after a herbal soak.',
      durationMin: 45,
      listPrice: 320000,
      currency: 'IDR',
      benefits: ['Relieves tired feet', 'Great between meetings'],
      tags: ['quick'],
    },
    {
      id: 'trt_aranjaya_couples',
      providerId: aranjayaId,
      name: 'Couples Spa Ritual',
      slug: 'couples-spa-ritual',
      category: 'package',
      description:
        'Side-by-side Balinese massage for two, followed by a shared flower bath and sparkling tea service. Second therapist assigned by the spa.',
      durationMin: 120,
      listPrice: 1600000,
      currency: 'IDR',
      benefits: ['For two guests', 'Shared flower bath'],
      tags: ['couples', 'celebration'],
      agentApproved: true,
    },
  ];

  const serenityTreatments: Tmt[] = [
    {
      id: 'trt_serenity_hammam',
      providerId: serenityId,
      name: 'Moroccan Hammam Ritual',
      slug: 'moroccan-hammam-ritual',
      category: 'bath',
      description:
        'Traditional black-soap cleanse, rhassoul clay wrap and a vigorous kessa glove exfoliation in our marble hammam chamber.',
      durationMin: 90,
      listPrice: 42000,
      currency: 'AED',
      priceOptions: [
        { durationMin: 60, price: 30000, capacity: 2 },
        { durationMin: 90, price: 42000, capacity: 2 },
      ],
      genre: 'woman_only',
      deliveryType: 'in_spa',
      benefits: ['Full-body exfoliation', 'Hammam chamber access'],
      tags: ['signature', 'ritual'],
      agentApproved: true,
    },
    {
      id: 'trt_serenity_deep',
      providerId: serenityId,
      name: 'Deep Tissue Massage',
      slug: 'deep-tissue-massage',
      category: 'massage',
      description: 'Targeted myofascial work for desk-bound shoulders and lower backs.',
      durationMin: 60,
      listPrice: 35000,
      currency: 'AED',
      benefits: ['Releases desk tension'],
      tags: ['firm pressure'],
    },
    {
      id: 'trt_serenity_facial',
      providerId: serenityId,
      name: 'Signature Glow Facial',
      slug: 'signature-glow-facial',
      category: 'facial',
      description: 'Oxygen infusion, cooling quartz massage and SPF finish — pre-event ready in60 minutes.',
      durationMin: 60,
      listPrice: 32000,
      currency: 'AED',
      benefits: ['Instant glow', 'Pre-event favourite'],
      tags: ['glow'],
      agentApproved: true,
    },
    {
      id: 'trt_serenity_clay',
      providerId: serenityId,
      name: 'Desert Clay Body Wrap',
      slug: 'desert-clay-body-wrap',
      category: 'body',
      description: 'Mineral-rich clay wrap with a dry-brush exfoliation and scalp massage while the mask sets.',
      durationMin: 75,
      listPrice: 38000,
      currency: 'AED',
      benefits: ['Detoxifying', 'Scalp massage included'],
      tags: ['detox'],
    },
    {
      id: 'trt_serenity_balinese',
      providerId: serenityId,
      name: 'Balinese Massage',
      slug: 'balinese-massage',
      category: 'massage',
      description: 'Our therapists trained in Bali: flowing pressure, acupressure and skin rolling.',
      durationMin: 60,
      listPrice: 30000,
      currency: 'AED',
      genre: 'both',
      deliveryType: 'doorstep',
      benefits: ['Full-body relaxation'],
      tags: ['classic'],
    },
  ];

  const lotusTreatments: Tmt[] = [
    {
      id: 'trt_lotus_balinese',
      providerId: lotusId,
      name: 'Balinese Massage',
      slug: 'balinese-massage',
      category: 'massage',
      description: 'Classic Balinese massage in our Canggu studio.',
      durationMin: 60,
      listPrice: 400000,
      currency: 'IDR',
      tags: ['classic'],
    },
    {
      id: 'trt_lotus_sound',
      providerId: lotusId,
      name: 'Sound Healing Session',
      slug: 'sound-healing-session',
      category: 'wellness',
      description: 'Group session with Tibetan singing bowls in our bamboo pavilion (capacity8).',
      durationMin: 45,
      listPrice: 250000,
      currency: 'IDR',
      requiresTherapist: false,
      capacity: 8,
      tags: ['group'],
    },
  ];

  await db.insert(T.treatments).values([...aranjayaTreatments, ...serenityTreatments, ...lotusTreatments]);

  /* ------------------------- branch pricing -------------------------- */

  const price = (branchId: string, treatmentId: string, amount: number) => ({
    id: newId('btr'),
    branchId,
    treatmentId,
    price: amount,
    active: true,
  });

  // Seminyak = catalogue price; Ubud slightly lower.
  const ubudPrices: Record<string, number> = {
    trt_aranjaya_boreh: 420000,
    trt_aranjaya_deep: 620000,
    trt_aranjaya_aroma: 450000,
    trt_aranjaya_hotstone: 690000,
    trt_aranjaya_facial: 520000,
    trt_aranjaya_scrub: 740000,
    trt_aranjaya_reflex: 300000,
    trt_aranjaya_couples: 1500000,
  };

  await db.insert(T.branchTreatments).values([
    ...aranjayaTreatments.map((t) => price(seminyakId, t.id, t.listPrice)),
    ...aranjayaTreatments.map((t) => price(ubudId, t.id, ubudPrices[t.id] ?? t.listPrice)),
    ...serenityTreatments.map((t) => price(marinaId, t.id, t.listPrice)),
    ...lotusTreatments.map((t) => price(cangguId, t.id, t.listPrice)),
  ]);

  /* --------------------- therapists & schedules ---------------------- */

  const t = (id: string, branchId: string, name: string, bio: string, specialties: string[]) => ({
    id,
    branchId,
    name,
    bio,
    specialties,
    active: true,
  });

  const therapistDefs = [
    t('thp_ayu', seminyakId, 'Ayu Lestari', 'Fifteen years of Balinese boreh and deep-tissue practice; speaks English and German.', ['boreh', 'deep tissue']),
    t('thp_made', seminyakId, 'Made Sari', 'Sports recovery specialist and reflexology instructor.', ['sports', 'reflexology']),
    t('thp_ketut', seminyakId, 'Ketut Wirawan', 'Aromatherapy and hot-stone therapist with a gentle, flowing style.', ['aromatherapy', 'hot stone']),
    t('thp_ratna', ubudId, 'Ratna Dewi', 'Former Ayurvedic clinic lead in Ubud; facial and body-ritual expert.', ['facials', 'body rituals']),
    t('thp_gede', ubudId, 'Gede Mahendra', 'Couples rituals and traditional massage; certified in shiatsu.', ['couples', 'shiatsu']),
    t('thp_layla', marinaId, 'Layla Hassan', 'Hammam specialist trained in Fez; ten years in five-star Dubai spas.', ['hammam', 'exfoliation']),
    t('thp_omar', marinaId, 'Omar Nasser', 'Deep-tissue and myofascial release for athletes and frequent flyers.', ['deep tissue', 'myofascial']),
    t('thp_priya', marinaId, 'Priya Menon', 'Ayurvedic facials and clay wraps.', ['facials', 'wraps']),
  ];
  await db.insert(T.therapists).values(therapistDefs);

  const sched = (therapistId: string, weekdays: number[], startTime: string, endTime: string) =>
    weekdays.map((weekday) => ({
      id: newId('sch'),
      therapistId,
      weekday,
      startTime,
      endTime,
    }));

  await db.insert(T.schedules).values([
    ...sched('thp_ayu', [1, 2, 3, 4, 5, 6], '10:00', '19:00'), // Mon–Sat
    ...sched('thp_made', [0, 2, 3, 4, 5, 6], '12:00', '21:00'), // Sun, Tue–Sat
    ...sched('thp_ketut', [3, 4, 5, 6, 0], '10:00', '17:00'), // Wed–Sun
    ...sched('thp_ratna', [1, 2, 3, 4, 5], '10:00', '20:00'), // Mon–Fri
    ...sched('thp_gede', [0, 3, 6], '11:00', '21:00'), // Sun, Wed, Sat
    ...sched('thp_layla', [0, 1, 2, 3, 4], '10:00', '21:00'), // Sun–Thu
    ...sched('thp_omar', [1, 2, 3, 4, 5, 6], '12:00', '22:00'), // Mon–Sat
    ...sched('thp_priya', [5, 6, 0, 1, 2], '10:00', '19:00'), // Fri–Tue
  ]);

  await db.insert(T.scheduleExceptions).values([
    {
      id: newId('exc'),
      therapistId: 'thp_ayu',
      branchId: seminyakId,
      date: (() => {
        const d = new Date(`${dateKeyInTz(new Date(), BALI_TZ)}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().slice(0, 10);
      })(),
      startTime: '14:00',
      endTime: '16:00',
      kind: 'closed',
      reason: 'Wellness training',
    },
    {
      id: newId('exc'),
      therapistId: null,
      branchId: ubudId,
      date: (() => {
        const d = new Date(`${dateKeyInTz(new Date(), BALI_TZ)}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 2);
        return d.toISOString().slice(0, 10);
      })(),
      startTime: null,
      endTime: null,
      kind: 'closed',
      reason: 'Annual maintenance',
    },
  ]);

  /* ------------------------------ agents ----------------------------- */

  const baliBlissId = newId('agt');
  const horizonId = newId('agt');

  await db.insert(T.agents).values([
    {
      id: baliBlissId,
      userId: agentUserId,
      companyName: 'Bali Bliss Travel',
      slug: slugify('Bali Bliss Travel'),
      agentType: 'travel_agent',
      country: 'ID',
      website: 'https://balibliss.example.com',
      phone: '+62 361 200 2001',
      commissionBps: 1200,
      status: 'approved',
      referralCode: 'BALIBLISS',
      approvedAt: new Date(),
      payoutDetails: { bank: 'Mandiri', account: '1220 0099 8877', holder: 'PT Bali Bliss Tours' },
    },
    {
      id: horizonId,
      userId: pendingAgentUserId,
      companyName: 'Horizon Tours & Concierge',
      slug: slugify('Horizon Tours Concierge'),
      agentType: 'tour_operator',
      country: 'AE',
      commissionBps: 1000,
      status: 'pending',
      referralCode: 'HORIZON1',
    },
  ]);

  await db.insert(T.agentRates).values([
    { id: newId('afr'), agentId: baliBlissId, treatmentId: 'trt_aranjaya_boreh', netPrice: 380000, active: true },
    { id: newId('afr'), agentId: baliBlissId, treatmentId: 'trt_aranjaya_aroma', netPrice: 400000, active: true },
    { id: newId('afr'), agentId: baliBlissId, treatmentId: 'trt_aranjaya_couples', netPrice: 1350000, active: true },
    { id: newId('afr'), agentId: baliBlissId, treatmentId: 'trt_serenity_hammam', netPrice: 35000, active: true },
  ]);

  /* --------------------- coupons, promos, pages ---------------------- */

  const now = Date.now();
  const days = (n: number) => new Date(now + n * 86_400_000);

  await db.insert(T.coupons).values([
    {
      id: newId('cpn'),
      code: 'WELCOME10',
      description: '10% off your first booking, any branch',
      scope: 'global',
      discountType: 'percent',
      discountValue: 1000,
      maxUses: 500,
      usedCount: 0,
      startsAt: days(-7),
      endsAt: days(60),
      active: true,
    },
    {
      id: newId('cpn'),
      code: 'BALI20',
      description: '20% off at Aranjaya Spa & Wellness',
      scope: 'provider',
      providerId: aranjayaId,
      discountType: 'percent',
      discountValue: 2000,
      maxUses: 100,
      usedCount: 0,
      startsAt: days(-3),
      endsAt: days(30),
      active: true,
    },
    {
      id: newId('cpn'),
      code: 'SEMINYAK50',
      description: 'Rp50.000 off at the Seminyak branch (min. Rp200.000)',
      scope: 'branch',
      branchId: seminyakId,
      discountType: 'fixed',
      discountValue: 50000,
      currency: 'IDR',
      minAmount: 200000,
      maxUses: 200,
      usedCount: 0,
      startsAt: days(-3),
      endsAt: days(45),
      active: true,
    },
  ]);

  await db.insert(T.promotions).values([
    {
      id: newId('prm'),
      title: 'Monsoon Wellness Sale',
      slug: 'monsoon-wellness-sale',
      summary: 'Up to 20% off signature rituals in Bali and Dubai this month.',
      linkUrl: '/spas',
      position: 'hero',
      active: true,
      sortOrder: 1,
      startsAt: days(-5),
      endsAt: days(25),
    },
    {
      id: newId('prm'),
      title: 'New in Dubai: Moroccan Hammam Rituals',
      slug: 'dubai-hammam-rituals',
      summary: 'Marble hammam ceremonies now open at Dubai Marina, daily until 22:00.',
      linkUrl: '/spas/serenity-dubai-spa',
      position: 'banner',
      active: true,
      sortOrder: 1,
    },
    {
      id: newId('prm'),
      title: 'First booking? Use WELCOME10',
      slug: 'welcome10-deal',
      summary: '10% off any treatment, any branch — new customers only.',
      linkUrl: '/spas',
      position: 'deal',
      active: true,
      sortOrder: 2,
    },
  ]);

  /* ------------------------- retail products ------------------------- */

  await db.insert(T.products).values([
    {
      id: newId('prd'),
      providerId: aranjayaId,
      branchId: seminyakId,
      name: 'Boreh spice body scrub (take-home jar)',
      description: '250g jar of our signature warming boreh blend — the same paste used in the treatment room.',
      price: 185000,
      currency: 'IDR',
      active: true,
    },
    {
      id: newId('prd'),
      providerId: aranjayaId,
      branchId: seminyakId,
      name: 'Frangipani body oil',
      description: 'Cold-pressed coconut and frangipani oil, 100ml.',
      price: 120000,
      currency: 'IDR',
      active: true,
    },
    {
      id: newId('prd'),
      providerId: aranjayaId,
      branchId: ubudId,
      name: 'Jamu wellness tea blend',
      description: 'Turmeric, ginger and lemongrass — 20 sachets.',
      price: 95000,
      currency: 'IDR',
      active: true,
    },
    {
      id: newId('prd'),
      providerId: serenityId,
      branchId: marinaId,
      name: 'Moroccan black soap + kessa glove set',
      description: 'Authentic beldi soap (200g) with a traditional exfoliating kessa glove.',
      price: 85,
      currency: 'AED',
      active: true,
    },
    {
      id: newId('prd'),
      providerId: serenityId,
      branchId: marinaId,
      name: 'Rhassoul clay ritual kit',
      description: '300g ghassoul clay, rose water and application brush — the hammam take-home ritual.',
      price: 140,
      currency: 'AED',
      active: false,
    },
  ]);

  /* --------------------------- reviews ------------------------------- */

  await db.insert(T.reviews).values([
    {
      id: newId('rev'),
      branchId: seminyakId,
      guestName: 'Emma R.',
      rating: 5,
      comment: 'The boreh scrub was incredible — booking was confirmed instantly and the team remembered my preferences.',
      status: 'published',
    },
    {
      id: newId('rev'),
      branchId: seminyakId,
      guestName: 'Daniel K.',
      rating: 4,
      comment: 'Lovely deep tissue massage. Started ten minutes late but the therapist made up for it.',
      status: 'published',
    },
    {
      id: newId('rev'),
      branchId: marinaId,
      guestName: 'Fatima A.',
      rating: 5,
      comment: 'The hammam ceremony is the real thing. Snow room afterwards was a surprise bonus.',
      status: 'published',
    },
    {
      id: newId('rev'),
      branchId: marinaId,
      guestName: 'James W.',
      rating: 3,
      comment: 'Good treatment but hard to find parking on a weekend evening.',
      status: 'pending',
    },
    {
      id: newId('rev'),
      branchId: ubudId,
      guestName: 'Sofia M.',
      rating: 5,
      comment: 'Most peaceful hour of our honeymoon. The riverside sala is pure magic.',
      status: 'published',
    },
  ]);

  await db.insert(T.pages).values([
    {
      id: newId('pag'),
      slug: 'about',
      title: 'About BookYourSpa',
      body:
        'BookYourSpa is a multi-vendor spa and wellness marketplace connecting guests with vetted spas across Bali, Dubai and a growing list of international destinations.\n\nWe partner directly with spa owners, travel agents and hotel concierges so that every booking on the platform is confirmed by the venue, priced transparently and delivered as an instant voucher.',
      metaTitle: 'About BookYourSpa — the spa & wellness booking marketplace',
      metaDescription: 'Who we are, how we partner with spas, and our quality standards in Bali, Dubai and beyond.',
      published: true,
    },
    {
      id: newId('pag'),
      slug: 'contact',
      title: 'Contact us',
      body:
        'Questions about a booking? Our team is available daily, 09:00–21:00 (WITA / GST).\n\nEmail: hello@bookyourspa.net\nPhone: +62 361 000 0000\n\nFor spa partnerships, email partners@bookyourspa.net.',
      metaTitle: 'Contact BookYourSpa',
      metaDescription: 'Get in touch with the BookYourSpa team for bookings, partnerships and support.',
      published: true,
    },
    {
      id: newId('pag'),
      slug: 'terms',
      title: 'Terms of Service',
      body:
        'These terms govern your use of BookYourSpa.\n\n1. Bookings are confirmed by the participating spa and held subject to the cancellation policy shown at checkout.\n2. Online payments are processed by our payment partners; we never store full card details.\n3. Vouchers are valid only for the date, time, branch and treatment shown.',
      metaTitle: 'Terms of Service — BookYourSpa',
      published: true,
    },
    {
      id: newId('pag'),
      slug: 'privacy',
      title: 'Privacy Policy',
      body:
        'We collect only the data required to complete your booking: name, contact details, appointment preferences and payment status.\n\nGuest bookings store a contact email so the venue can reach you; members can delete their account at any time from their profile page.',
      metaTitle: 'Privacy Policy — BookYourSpa',
      published: true,
    },
  ]);

  await db
    .insert(T.settings)
    .values(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })))
    .onConflictDoNothing();

  /* ----------------------- bookings & payments ----------------------- */

  const commission = (platformBps: number) => platformBps;

  async function seedBooking(opts: {
    branchId: string;
    providerId: string;
    treatmentId: string;
    therapistId: string | null;
    startAt: Date;
    customer: { name: string; email: string; phone?: string };
    customerId?: string;
    agentId?: string | null;
    couponCode?: string | null;
    status: T.Booking['status'];
    paymentStatus: T.PaymentStatus;
    channel: T.BookingChannel;
    payment?: { gateway: T.PaymentGateway; status: 'succeeded'; externalId: string };
    cancelReason?: string;
    durationMin: number;
    platformBps: number;
    agentTerms?: { commissionBps: number; netPrice?: number };
    currency: string;
    listPriceOverride?: number;
  }) {
    const priceQuote = priceBooking({
      listPrice: opts.listPriceOverride ?? 0,
      coupon:
        opts.couponCode === 'WELCOME10'
          ? { code: 'WELCOME10', discountType: 'percent', discountValue: 1000 }
          : null,
      platformBps: opts.platformBps,
      agent: opts.agentTerms ?? null,
    });
    const bookingId = newId('bkg');
    await db.insert(T.bookings).values({
      id: bookingId,
      code: `BYS-SEED${String(Math.floor(Math.random() * 9000) + 1000)}`,
      providerId: opts.providerId,
      branchId: opts.branchId,
      treatmentId: opts.treatmentId,
      therapistId: opts.therapistId,
      customerId: opts.customerId ?? null,
      agentId: opts.agentId ?? null,
      guestName: opts.customer.name,
      guestEmail: opts.customer.email,
      guestPhone: opts.customer.phone ?? null,
      startAt: opts.startAt,
      endAt: new Date(opts.startAt.getTime() + opts.durationMin * 60_000),
      timezone: opts.branchId === marinaId ? DUBAI_TZ : BALI_TZ,
      status: opts.status,
      paymentStatus: opts.paymentStatus,
      channel: opts.channel,
      currency: opts.currency,
      listPrice: priceQuote.listPrice,
      discountAmount: priceQuote.discountAmount,
      totalAmount: priceQuote.total,
      platformFee: priceQuote.platformFee,
      agentCommission: priceQuote.agentCommission,
      providerEarning: priceQuote.providerEarning,
      couponCode: priceQuote.couponCode,
      cancelReason: opts.cancelReason,
      paidAt: opts.paymentStatus === 'paid' ? new Date() : null,
      expiresAt: null,
    });
    const ledger: typeof T.commissions.$inferInsert[] = [];
    if (priceQuote.platformFee > 0)
      ledger.push({
        id: newId('com'),
        bookingId,
        party: 'platform',
        providerId: opts.providerId,
        rateBps: commission(opts.platformBps),
        amount: priceQuote.platformFee,
        currency: opts.currency,
        status: 'pending',
        createdAt: new Date(),
      });
    if (priceQuote.agentCommission > 0 && opts.agentId)
      ledger.push({
        id: newId('com'),
        bookingId,
        party: 'agent',
        providerId: opts.providerId,
        agentId: opts.agentId,
        rateBps: opts.agentTerms?.commissionBps ?? 0,
        amount: priceQuote.agentCommission,
        currency: opts.currency,
        status: 'pending',
        createdAt: new Date(),
      });
    if (priceQuote.providerEarning > 0)
      ledger.push({
        id: newId('com'),
        bookingId,
        party: 'provider',
        providerId: opts.providerId,
        agentId: opts.agentId ?? null,
        amount: priceQuote.providerEarning,
        currency: opts.currency,
        status: opts.paymentStatus === 'paid' ? 'approved' : 'pending',
        createdAt: new Date(),
      });
    if (ledger.length) await db.insert(T.commissions).values(ledger);

    if (opts.payment) {
      await db.insert(T.payments).values({
        id: newId('pay'),
        bookingId,
        gateway: opts.payment.gateway,
        status: opts.payment.status,
        amount: priceQuote.total,
        currency: opts.currency,
        externalId: opts.payment.externalId,
        payerEmail: opts.customer.email,
        paidAt: new Date(),
        gatewayData: { seeded: true },
      });
    }
    return bookingId;
  }

  // 1. Paid online (Stripe) — member booking tomorrow 10:00 Seminyak.
  await seedBooking({
    branchId: seminyakId,
    providerId: aranjayaId,
    treatmentId: 'trt_aranjaya_boreh',
    therapistId: 'thp_ayu',
    startAt: atLocal(1, '10:00', BALI_TZ),
    customer: { name: 'Apps Daeng', email: 'appsdaeng@gmail.com', phone: '+61 400 555 010' },
    customerId,
    couponCode: 'WELCOME10',
    status: 'confirmed',
    paymentStatus: 'paid',
    channel: 'direct',
    payment: { gateway: 'stripe', status: 'succeeded', externalId: 'cs_test_seed_bkg_0001' },
    durationMin: 60 + 15,
    platformBps: 1500,
    currency: 'IDR',
    listPriceOverride: 450000,
  });

  // 2. Pay-at-venue guest booking tomorrow 13:00 Seminyak.
  await seedBooking({
    branchId: seminyakId,
    providerId: aranjayaId,
    treatmentId: 'trt_aranjaya_deep',
    therapistId: 'thp_made',
    startAt: atLocal(1, '13:00', BALI_TZ),
    customer: { name: 'Sarah Johnson', email: 'sarah.johnson@example.com', phone: '+61 400 555 011' },
    status: 'confirmed',
    paymentStatus: 'venue',
    channel: 'direct',
    durationMin: 90 + 15,
    platformBps: 1500,
    currency: 'IDR',
    listPriceOverride: 650000,
  });

  // 3. Agent booking on net rate — day +3, Ubud, unpaid on invoice terms.
  await seedBooking({
    branchId: ubudId,
    providerId: aranjayaId,
    treatmentId: 'trt_aranjaya_aroma',
    therapistId: 'thp_ratna',
    startAt: atLocal(3, '15:00', BALI_TZ),
    customer: { name: 'Marco Silva', email: 'marco.silva@example.com' },
    agentId: baliBlissId,
    status: 'confirmed',
    paymentStatus: 'unpaid',
    channel: 'agent',
    durationMin: 60 + 15,
    platformBps: 1500,
    agentTerms: { commissionBps: 1200, netPrice: 400000 },
    currency: 'IDR',
    listPriceOverride: 450000,
  });

  // 4. Completed paid booking (earnings history) — yesterday.
  await seedBooking({
    branchId: seminyakId,
    providerId: aranjayaId,
    treatmentId: 'trt_aranjaya_reflex',
    therapistId: 'thp_ketut',
    startAt: atLocal(-1, '11:00', BALI_TZ),
    customer: { name: 'Apps Daeng', email: 'appsdaeng@gmail.com', phone: '+61 400 555 010' },
    customerId,
    status: 'completed',
    paymentStatus: 'paid',
    channel: 'direct',
    payment: { gateway: 'stripe', status: 'succeeded', externalId: 'cs_test_seed_bkg_0004' },
    durationMin: 45 + 15,
    platformBps: 1500,
    currency: 'IDR',
    listPriceOverride: 320000,
  });

  // 5. Cancelled booking.
  await seedBooking({
    branchId: ubudId,
    providerId: aranjayaId,
    treatmentId: 'trt_aranjaya_scrub',
    therapistId: 'thp_gede',
    startAt: atLocal(-2, '16:00', BALI_TZ),
    customer: { name: 'Emily Chen', email: 'emily.chen@example.com' },
    status: 'cancelled',
    paymentStatus: 'unpaid',
    channel: 'direct',
    cancelReason: 'Customer rescheduled',
    durationMin: 90 + 15,
    platformBps: 1500,
    currency: 'IDR',
    listPriceOverride: 740000,
  });

  // 6. Dubai paid booking (PayPal), day +1.
  await seedBooking({
    branchId: marinaId,
    providerId: serenityId,
    treatmentId: 'trt_serenity_hammam',
    therapistId: 'thp_layla',
    startAt: atLocal(1, '16:00', DUBAI_TZ),
    customer: { name: 'Fatima Al Suwaidi', email: 'fatima@example.com', phone: '+971 50 555 0177' },
    status: 'confirmed',
    paymentStatus: 'paid',
    channel: 'direct',
    payment: { gateway: 'paypal', status: 'succeeded', externalId: 'PAYID-SEED-0006' },
    durationMin: 90 + 15,
    platformBps: 2000,
    currency: 'AED',
    listPriceOverride: 42000,
  });

  await db.insert(T.auditLogs).values({
    id: newId('aud'),
    actorId: adminId,
    actorRole: 'super_admin',
    action: 'system.seed',
    entity: 'platform',
    meta: { note: 'initial demo dataset' },
  });

  console.log(`
✓ Seed complete — demo logins (development only):
  Super Admin   portal@bookyourspa.net        / ${PASSWORDS.admin}
  Supplier/POS  booking@homecarespa.ae        / ${PASSWORDS.provider}   (Dubai, AED)
  Supplier/POS  owner@aranjaya.com            / ${PASSWORDS.provider}
  Supplier/POS  owner@lotusretreat.com        / ${PASSWORDS.provider}   (pending approval)
  Agent         info@balithingstodo.net       / ${PASSWORDS.agent}
  Agent         agent@horizontours.com        / ${PASSWORDS.agent}      (pending approval)
  Customer      appsdaeng@gmail.com           / ${PASSWORDS.customer}
  Coupons: WELCOME10 · BALI20 · SEMINYAK50
`);
}

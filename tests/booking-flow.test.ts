import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type AppDb } from '@/db';
import * as T from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { quoteBooking, quoteCart, createBooking, createBookingGroup, cancelBooking, releaseExpiredHolds, BookingError } from '@/lib/booking';
import { getAvailability, getTogetherAvailability, zonedToUtc } from '@/lib/availability';
import { dateKeyInTz } from '@/lib/utils';

const TZ = 'Asia/Makassar';

let db: AppDb;
const ids = {
  user: 'usr_test_customer',
  owner: 'usr_test_owner',
  agentUser: 'usr_test_agent',
  provider: 'prv_test',
  branch: 'brn_test',
  treatment: 'trt_test',
  therapistA: 'thp_test_a',
  therapistB: 'thp_test_b',
  coupon: 'cpn_test',
  agent: 'agt_test',
};

beforeAll(async () => {
  process.env.VITEST = 'true';
  db = await getDb();
  const pw = await hashPassword('TestPass123!');

  await db.insert(T.users).values([
    { id: ids.user, email: 'it-customer@example.com', name: 'IT Customer', passwordHash: pw, role: 'customer', status: 'active' },
    { id: ids.owner, email: 'it-owner@example.com', name: 'IT Owner', passwordHash: pw, role: 'provider', status: 'active' },
    { id: ids.agentUser, email: 'it-agent@example.com', name: 'IT Agent', passwordHash: pw, role: 'agent', status: 'active' },
  ]);

  await db.insert(T.providers).values({
    id: ids.provider,
    ownerId: ids.owner,
    name: 'IT Test Spa',
    slug: 'it-test-spa',
    country: 'ID',
    baseCurrency: 'IDR',
    status: 'approved',
    commissionBps: 1500,
  });

  const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '09:00', close: '17:00', closed: false }));
  await db.insert(T.branches).values({
    id: ids.branch,
    providerId: ids.provider,
    name: 'IT Branch',
    slug: 'it-branch',
    addressLine: '1 Test Street',
    city: 'Denpasar',
    country: 'ID',
    timezone: TZ,
    currency: 'IDR',
    hours,
    leadTimeMinutes: 0,
    maxAdvanceDays: 90,
    bufferMinutes: 0,
    slotIntervalMinutes: 30,
    onlinePaymentEnabled: true,
    paymentMethods: ['stripe', 'venue'],
    status: 'active',
  });

  await db.insert(T.treatments).values({
    id: ids.treatment,
    providerId: ids.provider,
    name: 'IT Massage',
    slug: 'it-massage',
    category: 'massage',
    durationMin: 60,
    listPrice: 400_000,
    currency: 'IDR',
    requiresTherapist: true,
    status: 'active',
  });

  await db.insert(T.branchTreatments).values({
    id: 'btr_test',
    branchId: ids.branch,
    treatmentId: ids.treatment,
    price: 400_000,
    active: true,
  });

  await db.insert(T.therapists).values([
    { id: ids.therapistA, branchId: ids.branch, name: 'Therapist A', active: true },
    { id: ids.therapistB, branchId: ids.branch, name: 'Therapist B', active: true },
  ]);

  await db.insert(T.schedules).values(
    [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) =>
      [ids.therapistA, ids.therapistB].map((therapistId) => ({
        id: `sch_${therapistId}_${weekday}`,
        therapistId,
        weekday,
        startTime: '09:00',
        endTime: '17:00',
      })),
    ),
  );

  await db.insert(T.coupons).values({
    id: ids.coupon,
    code: 'ITWELCOME10',
    discountType: 'percent',
    discountValue: 1000,
    active: true,
    maxUses: 0,
  });

  await db.insert(T.agents).values({
    id: ids.agent,
    userId: ids.agentUser,
    companyName: 'IT Agency',
    slug: 'it-agency',
    commissionBps: 1000,
    status: 'approved',
    referralCode: 'ITTEST',
  });

  return async () => {
    // Fresh in-memory DB per run; nothing to tear down.
  };
});

function futureSlot(offsetMin = 0): { date: string; startAt: Date } {
  const d = new Date(Date.now() + 5 * 86_400_000);
  const date = dateKeyInTz(d, TZ);
  return { date, startAt: zonedToUtc(date, 10 * 60 + offsetMin, TZ) }; // 10:00 local + offset
}

describe('quoteBooking', () => {
  it('prices a direct booking with a percent coupon', async () => {
    const quote = await quoteBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      couponCode: 'ITWELCOME10',
    });
    expect(quote.listPrice).toBe(400_000);
    expect(quote.pricing.discountAmount).toBe(40_000);
    expect(quote.pricing.total).toBe(360_000);
    expect(quote.pricing.platformFee).toBe(54_000);
    expect(quote.pricing.providerEarning).toBe(306_000);
    expect(quote.currency).toBe('IDR');
    expect(quote.payment.venue).toBe(true);
  });

  it('applies agent commission terms', async () => {
    const quote = await quoteBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      agentId: ids.agent,
    });
    expect(quote.pricing.total).toBe(400_000);
    expect(quote.pricing.agentCommission).toBe(40_000);
    expect(quote.pricing.platformFee).toBe(60_000);
    expect(quote.pricing.providerEarning).toBe(300_000);
    expect(quote.agentTerms).toEqual({ commissionBps: 1000, netPrice: null });
  });

  it('rejects unknown coupons', async () => {
    await expect(
      quoteBooking(db, { branchId: ids.branch, treatmentId: ids.treatment, couponCode: 'NOPE' }),
    ).rejects.toThrow(BookingError);
  });
});

describe('createBooking', () => {
  it('creates a venue booking with correct money splits', async () => {
    const { startAt } = futureSlot();
    const { booking, quote } = await createBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      startAt,
      customer: { name: 'Guest One', email: 'guest1@example.com' },
      paymentMode: 'venue',
      couponCode: 'ITWELCOME10',
    });
    expect(booking.code).toMatch(/^BYS-[A-Z0-9]{6}$/);
    expect(booking.totalAmount).toBe(360_000);
    expect(booking.listPrice).toBe(400_000);
    expect(booking.platformFee).toBe(54_000);
    expect(booking.providerEarning).toBe(306_000);
    expect(booking.paymentStatus).toBe('venue');
    expect(booking.startAt.getTime()).toBe(startAt.getTime());
    expect(quote.pricing.total).toBe(360_000);
    // Active statuses keep the slot reserved.
    expect(['pending', 'confirmed']).toContain(booking.status);
  });

  it('auto-assigns a free therapist', async () => {
    const { startAt } = futureSlot();
    const { booking } = await createBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      startAt,
      customer: { name: 'Guest Two', email: 'guest2@example.com' },
      paymentMode: 'venue',
    });
    expect(booking.therapistId).not.toBeNull();
  });

  it('rejects double-booking the same therapist slot', async () => {
    const { startAt } = futureSlot(60); // 11:00
    await createBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      startAt,
      therapistId: ids.therapistA,
      customer: { name: 'Guest Three', email: 'guest3@example.com' },
      paymentMode: 'venue',
    });
    await expect(
      createBooking(db, {
        branchId: ids.branch,
        treatmentId: ids.treatment,
        startAt,
        therapistId: ids.therapistA,
        customer: { name: 'Guest Four', email: 'guest4@example.com' },
        paymentMode: 'venue',
      }),
    ).rejects.toThrow();
  });

  it('books the other therapist for the same time', async () => {
    const { startAt } = futureSlot(120); // 12:00
    await createBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      startAt,
      therapistId: ids.therapistA,
      customer: { name: 'Guest Six', email: 'guest6@example.com' },
      paymentMode: 'venue',
    });
    const { booking } = await createBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      startAt,
      therapistId: ids.therapistB,
      customer: { name: 'Guest Five', email: 'guest5@example.com' },
      paymentMode: 'venue',
    });
    expect(booking.therapistId).toBe(ids.therapistB);
  });
});

describe('cancellation policy', () => {
  it('blocks customer cancellations inside the cutoff window', async () => {
    const { startAt } = futureSlot(180); // 13:00, five days out
    const { booking } = await createBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      startAt,
      therapistId: ids.therapistA,
      customer: { name: 'Guest Cancel', email: 'guestc@example.com' },
      paymentMode: 'venue',
    });
    // Free cancellation is allowed well ahead of time.
    const ok = await cancelBooking(db, booking.id, { actorRole: 'customer' });
    expect(ok.status).toBe('cancelled');

    // Move a fresh booking inside the 24h cutoff — customer cancel must be refused.
    const second = await createBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      startAt: zonedToUtc(futureSlot().date, 14 * 60, TZ),
      therapistId: ids.therapistA,
      customer: { name: 'Guest Late', email: 'guestl@example.com' },
      paymentMode: 'venue',
    });
    await db
      .update(T.bookings)
      .set({ startAt: new Date(Date.now() + 60 * 60_000), endAt: new Date(Date.now() + 2 * 3600_000) })
      .where(eq(T.bookings.id, second.booking.id));
    await expect(cancelBooking(db, second.booking.id, { actorRole: 'customer' })).rejects.toThrow(/Free cancellation/i);

    // Staff can always cancel.
    const cancelled = await cancelBooking(db, second.booking.id, { actorRole: 'provider', reason: 'test' });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it('releases expired unpaid holds', async () => {
    const { startAt } = futureSlot(240); // 14:00
    const { booking } = await createBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      startAt,
      therapistId: ids.therapistB,
      customer: { name: 'Guest Hold', email: 'guesth@example.com' },
      paymentMode: 'online',
    });
    await db
      .update(T.bookings)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(T.bookings.id, booking.id));

    const released = await releaseExpiredHolds(db, ids.branch);
    expect(released).toBeGreaterThanOrEqual(1);

    const row = await db.query.bookings.findFirst({ where: eq(T.bookings.id, booking.id) });
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelReason).toMatch(/payment/i);
  });
});

describe('treatment price options', () => {
  beforeAll(async () => {
    // Provider adds 60/90/120-min tiers to the fixture treatment.
    await db
      .update(T.treatments)
      .set({
        priceOptions: [
          { durationMin: 60, price: 400_000, capacity: 1 },
          { durationMin: 90, price: 550_000, capacity: 1 },
          { durationMin: 120, price: 700_000, capacity: 1 },
        ],
      })
      .where(eq(T.treatments.id, ids.treatment));
  });

  it('quotes the selected tier and keeps the default unchanged', async () => {
    const tier = await quoteBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      optionIndex: 1,
    });
    expect(tier.listPrice).toBe(550_000);
    expect(tier.pricing.total).toBe(550_000);
    expect(tier.treatment.durationMin).toBe(90);

    const primary = await quoteBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
    });
    expect(primary.listPrice).toBe(400_000);
    expect(primary.treatment.durationMin).toBe(60);
  });

  it('falls back to the default tier for an out-of-range index', async () => {
    const quote = await quoteBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      optionIndex: 99,
    });
    expect(quote.listPrice).toBe(400_000);
    expect(quote.treatment.durationMin).toBe(60);
  });

  it("re-bases tiers onto the branch's own price", async () => {
    await db
      .update(T.branchTreatments)
      .set({ price: 450_000 })
      .where(eq(T.branchTreatments.id, 'btr_test'));

    const first = await quoteBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      optionIndex: 0,
    });
    expect(first.listPrice).toBe(450_000); // tier 0 maps exactly to the branch price

    const second = await quoteBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      optionIndex: 1,
    });
    expect(second.listPrice).toBe(600_000); // 550k + (450k − 400k)

    await db
      .update(T.branchTreatments)
      .set({ price: 400_000 })
      .where(eq(T.branchTreatments.id, 'btr_test'));
  });

  it('books the chosen tier price and reserves the tier duration', async () => {
    const { startAt } = futureSlot(240); // 14:00 local — fits a 120-min tier before 17:00 close
    const { booking } = await createBooking(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      optionIndex: 2,
      startAt,
      customer: { name: 'Tier Guest', email: 'guesttier@example.com' },
      paymentMode: 'venue',
    });
    expect(booking.listPrice).toBe(700_000);
    expect(booking.totalAmount).toBe(700_000);
    // bufferMinutes = 0 in fixtures → the held window is exactly the tier length.
    expect(booking.endAt.getTime() - booking.startAt.getTime()).toBe(120 * 60_000);
  });

  it('sizes generated slots to the chosen tier', async () => {
    const from = futureSlot().date;
    const base = await getAvailability(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      from,
      days: 1,
    });
    const long = await getAvailability(db, {
      branchId: ids.branch,
      treatmentId: ids.treatment,
      optionIndex: 2,
      from,
      days: 1,
    });
    expect(base.ok && long.ok).toBe(true);
    if (!base.ok || !long.ok) return;
    const lastStart = (r: typeof base) =>
      Math.max(...(r.days[0]?.slots ?? []).map((s) => s.start.getTime()), 0);
    // A 120-min treatment must not offer slots as late as a 60-min one.
    expect(lastStart(long)).toBeLessThan(lastStart(base));
  });
});

/* ------------------------------------------------------------------ */
/* Multi-treatment cart: quote + group booking + Together/Split         */
/* ------------------------------------------------------------------ */

describe('cart booking (multi-treatment + products)', () => {
  const FACIAL = 'trt_test_facial';
  const SAUNA = 'trt_test_sauna';
  const UNLINKED = 'trt_test_unlinked';
  const PRODUCT = 'prd_test_oil';

  /** Local wall time → UTC instant for a day offset from today, at `minutes` local. */
  function daySlot(dayOffset: number, minutes: number): { date: string; startAt: Date } {
    const d = new Date(Date.now() + dayOffset * 86_400_000);
    const date = dateKeyInTz(d, TZ);
    return { date, startAt: zonedToUtc(date, minutes, TZ) };
  }

  beforeAll(async () => {
    await db.insert(T.treatments).values([
      {
        id: FACIAL,
        providerId: ids.provider,
        name: 'IT Facial',
        slug: 'it-facial',
        category: 'facial',
        durationMin: 45,
        listPrice: 300_000,
        currency: 'IDR',
        requiresTherapist: true,
        status: 'active',
      },
      {
        id: SAUNA,
        providerId: ids.provider,
        name: 'IT Sauna',
        slug: 'it-sauna',
        category: 'wellness',
        durationMin: 30,
        listPrice: 100_000,
        currency: 'IDR',
        requiresTherapist: false,
        capacity: 3,
        status: 'active',
      },
      {
        id: UNLINKED,
        providerId: ids.provider,
        name: 'IT Unlinked',
        slug: 'it-unlinked',
        category: 'massage',
        durationMin: 60,
        listPrice: 200_000,
        currency: 'IDR',
        status: 'active',
      },
    ]);
    await db.insert(T.branchTreatments).values([
      { id: 'btr_test_facial', branchId: ids.branch, treatmentId: FACIAL, price: 300_000, active: true },
      { id: 'btr_test_sauna', branchId: ids.branch, treatmentId: SAUNA, price: 100_000, active: true },
    ]);
    await db.insert(T.products).values({
      id: PRODUCT,
      providerId: ids.provider,
      branchId: ids.branch,
      name: 'IT Body Oil',
      price: 50_000,
      currency: 'IDR',
      active: true,
    });
  });

  describe('quoteCart', () => {
    it('prices a multi-line cart with persons and products', async () => {
      const quote = await quoteCart(db, {
        branchId: ids.branch,
        items: [
          { treatmentId: ids.treatment, optionIndex: 0, persons: 2 },
          { treatmentId: FACIAL, persons: 1 },
        ],
        products: [{ productId: PRODUCT, quantity: 2 }],
      });
      expect(quote.lines).toHaveLength(2);
      expect(quote.lines[0]).toMatchObject({ persons: 2, unitPrice: 400_000, lineTotal: 800_000 });
      expect(quote.lines[1]).toMatchObject({ persons: 1, unitPrice: 300_000, lineTotal: 300_000 });
      expect(quote.treatmentsTotal).toBe(1_100_000);
      expect(quote.productsTotal).toBe(100_000);
      expect(quote.listPrice).toBe(1_200_000);
      expect(quote.currency).toBe('IDR');
    });

    it('applies one coupon across the whole cart', async () => {
      const quote = await quoteCart(db, {
        branchId: ids.branch,
        items: [{ treatmentId: ids.treatment }, { treatmentId: FACIAL }],
        couponCode: 'ITWELCOME10',
      });
      expect(quote.listPrice).toBe(700_000);
      expect(quote.pricing.discountAmount).toBe(70_000); // 10% once, not per line
      expect(quote.pricing.total).toBe(630_000);
      expect(quote.pricing.platformFee).toBe(94_500);
      expect(quote.pricing.providerEarning).toBe(535_500);
      expect(quote.pricing.platformFee + quote.pricing.agentCommission + quote.pricing.providerEarning).toBe(
        quote.pricing.total,
      );
    });

    it('rejects treatments not offered at the branch and unknown products', async () => {
      await expect(
        quoteCart(db, { branchId: ids.branch, items: [{ treatmentId: UNLINKED }] }),
      ).rejects.toThrow(/not offered/);
      await expect(
        quoteCart(db, {
          branchId: ids.branch,
          items: [{ treatmentId: ids.treatment }],
          products: [{ productId: 'prd_missing', quantity: 1 }],
        }),
      ).rejects.toThrow(/no longer available/);
    });
  });

  describe('createBookingGroup', () => {
    it('creates a Split-time group whose money sums equal the cart quote', async () => {
      const couponBefore = await db.query.coupons.findFirst({
        where: eq(T.coupons.code, 'ITWELCOME10'),
        columns: { usedCount: true },
      });
      const a = daySlot(6, 15 * 60); // 15:00 — treatment A
      const b = daySlot(6, 16 * 60); // 16:00 — treatment B (split time)

      const { groupId, primary, bookings: rows, quote } = await createBookingGroup(db, {
        branchId: ids.branch,
        items: [
          { treatmentId: ids.treatment, optionIndex: 0, persons: 2, startAt: a.startAt, therapistId: null },
          { treatmentId: FACIAL, persons: 1, startAt: b.startAt, therapistId: null },
        ],
        products: [{ productId: PRODUCT, quantity: 2 }],
        customer: { name: 'Cart Guest', email: 'cart@example.com' },
        couponCode: 'ITWELCOME10',
        paymentMode: 'venue',
      });

      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.groupId))).toEqual(new Set([groupId]));
      expect(primary.id).toBe(rows[0]!.id);
      // Each line keeps its own (split) time and its guest count.
      expect(rows[0]!.startAt.getTime()).toBe(a.startAt.getTime());
      expect(rows[1]!.startAt.getTime()).toBe(b.startAt.getTime());
      expect(rows[0]!.guestCount).toBe(2);
      expect(rows[0]!.therapistId).not.toBeNull();
      expect(rows[1]!.therapistId).not.toBeNull();

      // Row figures sum exactly to the cart quote.
      expect(rows.reduce((s, r) => s + r.listPrice, 0)).toBe(quote.listPrice);
      expect(rows.reduce((s, r) => s + r.discountAmount, 0)).toBe(quote.pricing.discountAmount);
      expect(rows.reduce((s, r) => s + r.totalAmount, 0)).toBe(quote.pricing.total);
      expect(rows.reduce((s, r) => s + r.platformFee, 0)).toBe(quote.pricing.platformFee);
      expect(rows.reduce((s, r) => s + r.providerEarning, 0)).toBe(quote.pricing.providerEarning);

      // Products hang off the group's primary row.
      const productRows = await db.query.bookingProducts.findMany({
        where: eq(T.bookingProducts.bookingId, primary.id),
      });
      expect(productRows).toHaveLength(1);
      expect(productRows[0]).toMatchObject({ productId: PRODUCT, quantity: 2, unitPrice: 50_000 });

      // The coupon is redeemed once for the whole group.
      const couponAfter = await db.query.coupons.findFirst({
        where: eq(T.coupons.code, 'ITWELCOME10'),
        columns: { usedCount: true },
      });
      expect((couponAfter?.usedCount ?? 0) - (couponBefore?.usedCount ?? 0)).toBe(1);
    });

    it('creates a Together group with a shared start and distinct therapists', async () => {
      const shared = daySlot(7, 10 * 60); // 10:00 on day +7 for BOTH lines
      const { bookings: rows, quote } = await createBookingGroup(db, {
        branchId: ids.branch,
        items: [
          { treatmentId: ids.treatment, persons: 1, startAt: shared.startAt, therapistId: null },
          { treatmentId: FACIAL, persons: 1, startAt: shared.startAt, therapistId: null },
        ],
        customer: { name: 'Together Guest', email: 'together@example.com' },
        paymentMode: 'venue',
      });

      expect(rows).toHaveLength(2);
      expect(rows[0]!.startAt.getTime()).toBe(shared.startAt.getTime());
      expect(rows[1]!.startAt.getTime()).toBe(shared.startAt.getTime());
      expect(rows[0]!.therapistId).not.toBeNull();
      expect(rows[1]!.therapistId).not.toBeNull();
      expect(rows[0]!.therapistId).not.toBe(rows[1]!.therapistId);
      expect(quote.pricing.total).toBe(700_000);
      expect(rows.reduce((s, r) => s + r.totalAmount, 0)).toBe(quote.pricing.total);
    });
  });

  describe('getTogetherAvailability', () => {
    it('returns shared starts where every treatment fits with distinct therapists', async () => {
      const from = dateKeyInTz(new Date(Date.now() + 8 * 86_400_000), TZ);
      const res = await getTogetherAvailability(db, {
        branchId: ids.branch,
        items: [{ treatmentId: ids.treatment }, { treatmentId: FACIAL }],
        from,
        days: 3,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.days.some((d) => d.slots.length > 0)).toBe(true);

      const soloA = await getAvailability(db, {
        branchId: ids.branch,
        treatmentId: ids.treatment,
        from,
        days: 3,
      });
      const soloB = await getAvailability(db, { branchId: ids.branch, treatmentId: FACIAL, from, days: 3 });
      expect(soloA.ok && soloB.ok).toBe(true);
      if (!soloA.ok || !soloB.ok) return;

      for (const day of res.days) {
        const a = soloA.days.find((d) => d.date === day.date)?.slots ?? [];
        const b = soloB.days.find((d) => d.date === day.date)?.slots ?? [];
        for (const slot of day.slots) {
          const ms = slot.start.getTime();
          // A together slot must exist in BOTH single-treatment availabilities.
          expect(a.some((s) => s.start.getTime() === ms)).toBe(true);
          expect(b.some((s) => s.start.getTime() === ms)).toBe(true);
          // …with a conflict-free, distinct therapist per treatment.
          expect(slot.assignments).toHaveLength(2);
          const [first, second] = slot.assignments;
          expect(first?.therapistId).toBeTruthy();
          expect(second?.therapistId).toBeTruthy();
          expect(first!.therapistId).not.toBe(second!.therapistId);
        }
      }
    });

    it('rejects an empty together request', async () => {
      const res = await getTogetherAvailability(db, { branchId: ids.branch, items: [] });
      expect(res.ok).toBe(false);
    });
  });

  describe('persons-aware capacity (shared facility)', () => {
    it('offers no slots when persons exceed the treatment capacity', async () => {
      const from = dateKeyInTz(new Date(Date.now() + 9 * 86_400_000), TZ);
      const fits = await getAvailability(db, {
        branchId: ids.branch,
        treatmentId: SAUNA,
        persons: 2,
        from,
        days: 1,
      });
      expect(fits.ok).toBe(true);
      if (fits.ok) expect(fits.days[0]!.slots.length).toBeGreaterThan(0);

      const tooMany = await getAvailability(db, {
        branchId: ids.branch,
        treatmentId: SAUNA,
        persons: 4,
        from,
        days: 1,
      });
      expect(tooMany.ok).toBe(true);
      if (tooMany.ok) expect(tooMany.days[0]!.slots).toHaveLength(0);
    });

    it('counts a booking\u2019s guest_count against shared capacity', async () => {
      const { date, startAt } = daySlot(9, 10 * 60);
      await createBookingGroup(db, {
        branchId: ids.branch,
        items: [{ treatmentId: SAUNA, persons: 2, startAt, therapistId: null }],
        customer: { name: 'Sauna Guest', email: 'sauna@example.com' },
        paymentMode: 'venue',
      });

      const offersAt = async (persons: number) => {
        const res = await getAvailability(db, {
          branchId: ids.branch,
          treatmentId: SAUNA,
          persons,
          from: date,
          days: 1,
        });
        if (!res.ok) return false;
        return (res.days[0]?.slots ?? []).some((s) => s.start.getTime() === startAt.getTime());
      };

      expect(await offersAt(1)).toBe(true); // 1 + 2 booked = capacity 3 → fits
      expect(await offersAt(2)).toBe(false); // 2 + 2 booked = 4 > 3 → blocked
    });
  });
});

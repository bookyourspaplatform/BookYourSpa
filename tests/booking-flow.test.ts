import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type AppDb } from '@/db';
import * as T from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { quoteBooking, createBooking, cancelBooking, releaseExpiredHolds, BookingError } from '@/lib/booking';
import { zonedToUtc } from '@/lib/availability';
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

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type AppDb } from '@/db';
import * as T from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { createPosSale } from '@/lib/actions/provider';

// Server-action environment stubs: no Next.js cache or cookie request in tests.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const OWNER_ID = 'usr_pos_owner';

vi.mock('@/lib/auth/session', () => ({
  requireUser: vi.fn(async () => ({
    id: OWNER_ID,
    role: 'provider',
    status: 'active',
    provider: { id: 'prv_pos' },
  })),
}));

const ids = {
  owner: OWNER_ID,
  provider: 'prv_pos',
  branch: 'brn_pos',
  balinese: 'trt_pos_balinese',
  couples: 'trt_pos_couples',
  yuka: 'thp_pos_yuka',
  risa: 'thp_pos_risa',
  lucy: 'thp_pos_lucy',
  product: 'prd_pos_set',
};

const TZ = 'Asia/Dubai';

let db: AppDb;

beforeAll(async () => {
  process.env.VITEST = 'true';
  db = await getDb();
  const pw = await hashPassword('TestPass123!');

  await db.insert(T.users).values({
    id: ids.owner,
    email: 'pos-owner@example.com',
    name: 'POS Owner',
    passwordHash: pw,
    role: 'provider',
    status: 'active',
  });

  await db.insert(T.providers).values({
    id: ids.provider,
    ownerId: ids.owner,
    name: 'POS Test Spa',
    slug: 'pos-test-spa',
    country: 'AE',
    baseCurrency: 'AED',
    status: 'approved',
  });

  const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    open: '09:00',
    close: '22:00',
    closed: false,
  }));
  await db.insert(T.branches).values({
    id: ids.branch,
    providerId: ids.provider,
    name: 'POS Branch',
    slug: 'pos-branch',
    addressLine: '1 Test Street',
    city: 'Dubai',
    country: 'AE',
    timezone: TZ,
    currency: 'AED',
    hours,
    leadTimeMinutes: 0,
    maxAdvanceDays: 90,
    bufferMinutes: 0,
    slotIntervalMinutes: 30,
    onlinePaymentEnabled: true,
    paymentMethods: ['stripe', 'venue'],
    status: 'active',
  });

  await db.insert(T.treatments).values([
    {
      id: ids.balinese,
      providerId: ids.provider,
      name: 'Balinese Signature Massage',
      slug: 'balinese-signature-massage',
      category: 'massage',
      durationMin: 60,
      listPrice: 30_000,
      currency: 'AED',
      requiresTherapist: true,
      therapistsPerBooking: 1,
      priceOptions: [{ durationMin: 60, price: 30_000, capacity: 1 }],
      status: 'active',
    },
    {
      id: ids.couples,
      providerId: ids.provider,
      name: 'Couples Harmony Massage',
      slug: 'couples-harmony-massage',
      category: 'massage',
      durationMin: 60,
      listPrice: 55_000,
      currency: 'AED',
      requiresTherapist: true,
      // Set up in the treatment editor as a 2-therapist session.
      therapistsPerBooking: 2,
      priceOptions: [{ durationMin: 60, price: 55_000, capacity: 1 }],
      status: 'active',
    },
  ]);

  await db.insert(T.branchTreatments).values([
    { id: 'btr_pos_balinese', branchId: ids.branch, treatmentId: ids.balinese, price: 30_000, active: true },
    { id: 'btr_pos_couples', branchId: ids.branch, treatmentId: ids.couples, price: 55_000, active: true },
  ]);

  // Every therapist is paid at 25% of what they serve.
  await db.insert(T.therapists).values(
    [ids.yuka, ids.risa, ids.lucy].map((id) => ({
      id,
      branchId: ids.branch,
      name: id.split('_').pop()!.replace(/^./, (c) => c.toUpperCase()),
      role: 'therapist' as const,
      salaryType: 'percent' as const,
      salaryValue: 2500,
      incentiveType: 'fixed' as const,
      incentiveValue: 0,
      active: true,
    })),
  );

  await db.insert(T.products).values({
    id: ids.product,
    providerId: ids.provider,
    branchId: ids.branch,
    name: 'Moroccan black soap + kessa glove set',
    price: 8_500,
    currency: 'AED',
    active: true,
  });

  return async () => {
    // Fresh in-memory DB per run; nothing to tear down.
  };
});

/**
 * The sample sale: 2 × Balinese (Yuka + Risa), 1 × Couples (Yuka + Lucy,
 * 2-therapist treatment) and a retail set. Times are parameters so each test
 * books its own slots — a therapist can only hold one start time.
 */
function sampleSale(balineseTime = '14:00', couplesTime = '15:00') {
  return {
    branchId: ids.branch,
    guestName: 'Sarah W.',
    guestEmail: 'sarah@example.com',
    guestPhone: '+971 50 000 0000',
    date: '2026-10-25',
    items: [
      {
        treatmentId: ids.balinese,
        optionIndex: 0,
        qty: 2,
        time: balineseTime,
        therapistIds: [ids.yuka, ids.risa],
      },
      {
        treatmentId: ids.couples,
        optionIndex: 0,
        qty: 1,
        time: couplesTime,
        therapistIds: [ids.yuka, ids.lucy],
      },
    ],
    products: [{ productId: ids.product, quantity: 1 }],
    discountPercent: 0,
    amount: 123_500,
    paymentMethod: 'cash' as const,
  };
}

describe('createPosSale', () => {
  it('splits a couples treatment across two therapists and shares 25% each', async () => {
    const res = await createPosSale(sampleSale());
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) throw new Error('sale failed');

    // 600.00 + 550.00 + 85.00
    expect(res.data.total).toBe(123_500);
    // 3% platform commission on the whole sale.
    expect(res.data.platformFee).toBe(3_705);
    // Yuka 75.00 + 68.75 · Risa 75.00 · Lucy 68.75
    const shares = Object.fromEntries(res.data.shares.map((s) => [s.name, s.amount]));
    expect(shares.Yuka).toBe(14_375);
    expect(shares.Risa).toBe(7_500);
    expect(shares.Lucy).toBe(6_875);
    expect(res.data.spaIncome).toBe(91_045);

    expect(res.data.items).toEqual([
      { name: 'Balinese Signature Massage (60 min)', qty: 2, amount: 60_000 },
      { name: 'Couples Harmony Massage (60 min)', qty: 1, amount: 55_000 },
      { name: 'Moroccan black soap + kessa glove set', qty: 1, amount: 8_500 },
    ]);
  });

  it('creates one booking row per therapist slot in a single group', async () => {
    const res = await createPosSale(sampleSale('16:00', '17:00'));
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) throw new Error('sale failed');

    const rows = await db.query.bookings.findMany({
      where: eq(T.bookings.groupId, (await groupIdOf(res.data.id))!),
      with: { therapist: { columns: { name: true } }, bookingProducts: true },
    });

    // 2 Balinese slots + 2 couples slots.
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.channel === 'pos' && r.paymentStatus === 'paid')).toBe(true);
    expect(rows.reduce((sum, r) => sum + r.totalAmount, 0)).toBe(123_500);
    expect(rows.reduce((sum, r) => sum + r.platformFee, 0)).toBe(3_705);

    // One couples booking per therapist, at half price each.
    const couples = rows.filter((r) => r.treatmentId === ids.couples);
    expect(couples).toHaveLength(2);
    expect(couples.map((r) => r.totalAmount)).toEqual([27_500, 27_500]);
    expect(couples.map((r) => r.therapist?.name).sort()).toEqual(['Lucy', 'Yuka']);

    const balinese = rows.filter((r) => r.treatmentId === ids.balinese);
    expect(balinese.map((r) => r.therapist?.name).sort()).toEqual(['Risa', 'Yuka']);

    // Retail lines hang off exactly one row of the group.
    const retail = rows.filter((r) => r.bookingProducts.length > 0);
    expect(retail).toHaveLength(1);
    expect(retail[0]!.bookingProducts[0]!.quantity).toBe(1);

    // One succeeded payment per row.
    for (const row of rows) {
      const payments = await db.query.payments.findMany({
        where: eq(T.payments.bookingId, row.id),
      });
      expect(payments).toHaveLength(1);
      expect(payments[0]!.status).toBe('succeeded');
    }
  });

  it('rejects the same therapist twice in one treatment', async () => {
    const res = await createPosSale({
      ...sampleSale(),
      items: [{ treatmentId: ids.balinese, optionIndex: 0, qty: 2, time: '18:00', therapistIds: [ids.risa, ids.risa] }],
      products: [],
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a therapist already booked at that start time', async () => {
    const first = await createPosSale(sampleSale('20:00', '21:00'));
    expect(first.ok).toBe(true);

    const second = await createPosSale({
      ...sampleSale('20:00', '21:00'),
      items: [
        { treatmentId: ids.balinese, optionIndex: 0, qty: 1, time: '20:00', therapistIds: [ids.yuka] },
      ],
      products: [],
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/appointment starting/i);
  });

  it('applies a percent discount to the negotiated total', async () => {
    const res = await createPosSale({
      ...sampleSale('22:00', '22:30'),
      discountPercent: 10,
      // 10% off the 300.00 single treatment.
      amount: 27_000,
      items: [
        { treatmentId: ids.balinese, optionIndex: 0, qty: 1, time: '22:00', therapistIds: [ids.risa] },
      ],
      products: [],
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) throw new Error('sale failed');
    expect(res.data.total).toBe(27_000);
    expect(res.data.platformFee).toBe(Math.round((27_000 * 300) / 10_000));
    expect(res.data.shares[0]!.amount).toBe(Math.round((27_000 * 2500) / 10_000));
  });
});

async function groupIdOf(bookingId: string): Promise<string | null> {
  const row = await db.query.bookings.findFirst({
    where: eq(T.bookings.id, bookingId),
    columns: { groupId: true },
  });
  return row?.groupId ?? null;
}
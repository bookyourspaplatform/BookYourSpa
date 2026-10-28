import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type AppDb } from '@/db';
import * as T from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { adminAddReview } from '@/lib/actions/admin';

// Server-action environment stubs: no Next.js cache or cookie request in tests.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/auth/session', () => ({
  requireUser: vi.fn(async () => ({ id: 'usr_ar_admin', role: 'super_admin', status: 'active' })),
  findUserByEmail: vi.fn(),
}));

let db: AppDb;

beforeAll(async () => {
  process.env.VITEST = 'true';
  db = await getDb();

  // The mocked super admin, so the audit row has a real actor to point at.
  await db.insert(T.users).values({
    id: 'usr_ar_admin',
    email: 'ar-admin@example.com',
    name: 'AR Admin',
    passwordHash: await hashPassword('TestPass123!'),
    role: 'super_admin',
    status: 'active',
  });

  await db.insert(T.providers).values({
    id: 'prv_ar',
    name: 'AR Test Spa',
    slug: 'ar-test-spa',
    country: 'AE',
    baseCurrency: 'AED',
    status: 'approved',
  });

  await db.insert(T.branches).values({
    id: 'brn_ar',
    providerId: 'prv_ar',
    name: 'AR Branch',
    slug: 'ar-branch',
    addressLine: '1 Test Road',
    city: 'Dubai',
    country: 'AE',
    timezone: 'Asia/Dubai',
    currency: 'AED',
    hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '09:00', close: '17:00', closed: false })),
    leadTimeMinutes: 0,
    maxAdvanceDays: 90,
    bufferMinutes: 0,
    slotIntervalMinutes: 30,
    onlinePaymentEnabled: true,
    paymentMethods: ['stripe', 'venue'],
    status: 'active',
  });

  return async () => {
    // Fresh in-memory DB per run; nothing to tear down.
  };
});

describe('adminAddReview', () => {
  it('publishes the review for the branch straight away', async () => {
    const res = await adminAddReview({
      branchId: 'brn_ar',
      guestName: '  Layla   A.  ',
      rating: 5,
      comment: 'Superb massage, will book again.',
    });
    expect(res.ok).toBe(true);

    const rows = await db.query.reviews.findMany({ where: eq(T.reviews.branchId, 'brn_ar') });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.guestName).toBe('Layla A.'); // whitespace collapsed + trimmed
    expect(rows[0]!.rating).toBe(5);
    expect(rows[0]!.status).toBe('published');
    expect(rows[0]!.source).toBe('platform');
    expect(rows[0]!.bookingId).toBeNull();
  });

  it('rejects an out-of-range star, a too-short name and an unknown branch', async () => {
    const badStar = await adminAddReview({ branchId: 'brn_ar', guestName: 'Omar K.', rating: 9 });
    expect(badStar.ok).toBe(false);

    const badName = await adminAddReview({ branchId: 'brn_ar', guestName: 'A', rating: 5 });
    expect(badName.ok).toBe(false);

    const missing = await adminAddReview({ branchId: 'brn_nope', guestName: 'Omar K.', rating: 5 });
    expect(missing.ok).toBe(false);

    const rows = await db.query.reviews.findMany({ where: eq(T.reviews.branchId, 'brn_ar') });
    expect(rows).toHaveLength(1); // nothing above got through
  });
});

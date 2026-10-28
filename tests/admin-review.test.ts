import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type AppDb } from '@/db';
import * as T from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { adminAddReview, adminDeleteReview, adminUpdateReview } from '@/lib/actions/admin';

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

  it('keeps the posted date, source label and sanitized rich text', async () => {
    const res = await adminAddReview({
      branchId: 'brn_ar',
      guestName: 'Yuka M.',
      rating: 4,
      comment: '<p>Lovely <strong>team</strong> 👍</p><script>alert(1)</script>',
      date: '2026-01-15',
      source: 'google',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const row = await db.query.reviews.findFirst({ where: eq(T.reviews.id, res.data!.id) });
    expect(row?.source).toBe('google');
    expect(row?.comment).toContain('<strong>team</strong>');
    expect(row?.comment).toContain('👍');
    expect(row?.comment).not.toContain('<script');
    // Stored at UTC noon so every timezone still reads the chosen day.
    expect(row!.createdAt.toISOString().slice(0, 10)).toBe('2026-01-15');
  });

  it('lets an admin edit a review and then delete it', async () => {
    const created = await adminAddReview({
      branchId: 'brn_ar',
      guestName: 'Couple Guest',
      rating: 5,
      comment: 'We liked the idea of a couple massage at home. The booking process was straightforward, and the private setting made the occasion comfortable.',
      date: '2026-03-10',
      source: 'google',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await adminUpdateReview({
      id: created.data!.id,
      guestName: 'Couple Guest Edited',
      rating: 4,
      comment: '<p>Updated review 👍</p><img src=x onerror=alert(1)>',
      date: '2026-03-12',
      source: 'platform',
    });
    expect(updated.ok, updated.ok ? '' : updated.error).toBe(true);
    const row = await db.query.reviews.findFirst({ where: eq(T.reviews.id, created.data!.id) });
    expect(row?.guestName).toBe('Couple Guest Edited');
    expect(row?.rating).toBe(4);
    expect(row?.source).toBe('platform');
    expect(row?.comment).toContain('Updated review');
    expect(row?.comment).not.toContain('onerror');
    expect(row?.createdAt.toISOString().slice(0, 10)).toBe('2026-03-12');

    const deleted = await adminDeleteReview(created.data!.id);
    expect(deleted.ok).toBe(true);
    const removed = await db.query.reviews.findFirst({ where: eq(T.reviews.id, created.data!.id) });
    expect(removed).toBeUndefined();
    expect((await adminDeleteReview(created.data!.id)).ok).toBe(false);
  });

  it('refuses a future or impossible posted date', async () => {
    const future = await adminAddReview({
      branchId: 'brn_ar',
      guestName: 'Omar K.',
      rating: 5,
      date: '2999-01-01',
    });
    expect(future.ok).toBe(false);

    const impossible = await adminAddReview({
      branchId: 'brn_ar',
      guestName: 'Omar K.',
      rating: 5,
      date: '2026-02-31',
    });
    expect(impossible.ok).toBe(false);

    const rows = await db.query.reviews.findMany({ where: eq(T.reviews.branchId, 'brn_ar') });
    expect(rows).toHaveLength(2); // add-review and date/source tests wrote rows; edit/delete removed its review
  });
});

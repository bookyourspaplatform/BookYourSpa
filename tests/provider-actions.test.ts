import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type AppDb } from '@/db';
import * as T from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { saveTreatment } from '@/lib/actions/provider';

// Server-action environment stubs: no Next.js cache or cookie request in tests.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const OWNER_ID = 'usr_pa_owner';

vi.mock('@/lib/auth/session', () => ({
  requireUser: vi.fn(async () => ({
    id: OWNER_ID,
    role: 'provider',
    status: 'active',
    provider: { id: 'prv_pa' },
  })),
}));

let db: AppDb;

beforeAll(async () => {
  process.env.VITEST = 'true';
  db = await getDb();
  const pw = await hashPassword('TestPass123!');

  await db.insert(T.users).values({
    id: OWNER_ID,
    email: 'pa-owner@example.com',
    name: 'PA Owner',
    passwordHash: pw,
    role: 'provider',
    status: 'active',
  });

  await db.insert(T.providers).values({
    id: 'prv_pa',
    ownerId: OWNER_ID,
    name: 'PA Test Spa',
    slug: 'pa-test-spa',
    country: 'ID',
    baseCurrency: 'IDR',
    status: 'approved',
  });

  await db.insert(T.treatments).values({
    id: 'trt_pa',
    providerId: 'prv_pa',
    name: 'Old Treatment Name',
    slug: 'old-treatment-name',
    durationMin: 60,
    listPrice: 100_000,
    currency: 'IDR',
    status: 'active',
  });

  return async () => {
    // Fresh in-memory DB per run; nothing to tear down.
  };
});

describe('saveTreatment (edit path)', () => {
  it('persists a renamed treatment — regression: Name was dropped on save', async () => {
    const res = await saveTreatment({
      id: 'trt_pa',
      name: 'Renamed Massage',
      description: null,
      priceOptions: [{ durationMin: 90, price: 150_000, capacity: 1 }],
      genre: 'both',
      deliveryType: 'both',
      requiresTherapist: true,
      agentApproved: false,
      tags: [],
      status: 'active',
    });
    expect(res.ok).toBe(true);

    const row = await db.query.treatments.findFirst({ where: eq(T.treatments.id, 'trt_pa') });
    expect(row?.name).toBe('Renamed Massage');
    // Legacy single-price columns mirror the first price option.
    expect(row?.durationMin).toBe(90);
    expect(row?.listPrice).toBe(150_000);
    // Slug is stable across renames so existing links keep working.
    expect(row?.slug).toBe('old-treatment-name');
    expect(row?.status).toBe('active');
  });
});

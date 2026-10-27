import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type AppDb } from '@/db';
import * as T from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { saveBranchPromotion, saveTreatment, setProviderPromotionActive } from '@/lib/actions/provider';

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

  await db.insert(T.branches).values({
    id: 'brn_pa',
    providerId: 'prv_pa',
    name: 'PA Branch',
    slug: 'pa-branch',
    addressLine: '1 Test Road',
    city: 'Denpasar',
    country: 'ID',
    timezone: 'Asia/Makassar',
    currency: 'IDR',
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
      therapistsPerBooking: 1,
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

describe('saveBranchPromotion (cloned from the admin promotion form)', () => {
  const base = {
    branchId: 'brn_pa',
    title: 'PA Weekend Deal',
    summary: null,
    linkUrl: null,
    position: 'deal' as const,
    startsAt: null,
    endsAt: null,
    active: true,
    sortOrder: 0,
    discountType: 'percent' as const,
    discountValue: 2000,
    currency: null,
    minAmount: 0,
    maxUses: 0,
    appliesTo: 'all' as const,
    treatmentIds: [] as string[],
    validFromHour: null,
    validUntilHour: null,
  };

  it('rejects a promotion without a promo code', async () => {
    const res = await saveBranchPromotion({ ...base, code: '' });
    expect(res.ok).toBe(false);
  });

  it('rejects “selected treatments” when nothing is picked', async () => {
    const res = await saveBranchPromotion({
      ...base,
      code: 'PA20',
      appliesTo: 'selected',
      treatmentIds: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/at least one treatment/i);
  });

  it('persists code, hour validity and the selected treatment scope', async () => {
    const res = await saveBranchPromotion({
      ...base,
      code: 'pa20',
      appliesTo: 'selected',
      treatmentIds: ['trt_pa'],
      validFromHour: 9,
      validUntilHour: 17,
    });
    expect(res.ok).toBe(true);

    const row = await db.query.promotions.findFirst({ where: eq(T.promotions.code, 'PA20') });
    expect(row).toBeTruthy();
    expect(row!.appliesTo).toBe('selected');
    expect(row!.treatmentIds).toEqual(['trt_pa']);
    expect(row!.validFromHour).toBe(9);
    expect(row!.validUntilHour).toBe(17);
    expect(row!.discountType).toBe('percent');
    expect(row!.branchId).toBe('brn_pa');
  });
});

describe('setProviderPromotionActive (platform promotion with selected treatments)', () => {
  const PLAT = 'prm_pa_platform';

  beforeAll(async () => {
    await db.insert(T.promotions).values({
      id: PLAT,
      title: 'PA Platform Promo',
      slug: 'pa-platform-promo',
      position: 'deal',
      code: 'PAPLAT10',
      discountType: 'percent',
      discountValue: 1000,
      appliesTo: 'selected',
      active: true,
      maxUses: 0,
    });
  });

  it('cannot activate before the spa picks its treatments', async () => {
    const res = await setProviderPromotionActive(PLAT, true);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/choose which treatments/i);
  });

  it('activates once the spa picks its own treatments, then keeps the selection on toggle', async () => {
    const picked = await setProviderPromotionActive(PLAT, true, ['trt_pa']);
    expect(picked.ok).toBe(true);

    const row = await db.query.providerPromotions.findFirst({
      where: eq(T.providerPromotions.promotionId, PLAT),
    });
    expect(row?.active).toBe(true);
    expect(row?.treatmentIds).toEqual(['trt_pa']);

    // Deactivating keeps the spa's treatment selection.
    const off = await setProviderPromotionActive(PLAT, false);
    expect(off.ok).toBe(true);
    const after = await db.query.providerPromotions.findFirst({
      where: eq(T.providerPromotions.promotionId, PLAT),
    });
    expect(after?.active).toBe(false);
    expect(after?.treatmentIds).toEqual(['trt_pa']);

    // Re-activating without passing a list reuses the saved selection.
    const on = await setProviderPromotionActive(PLAT, true);
    expect(on.ok).toBe(true);
  });

  it('rejects empty or foreign treatment selections', async () => {
    const empty = await setProviderPromotionActive(PLAT, true, []);
    expect(empty.ok).toBe(false);

    const foreign = await setProviderPromotionActive(PLAT, true, ['trt_not_ours']);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error).toMatch(/not yours/i);
  });
});

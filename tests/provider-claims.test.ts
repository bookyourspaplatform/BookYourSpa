import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type AppDb } from '@/db';
import * as T from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { requestProviderClaim, confirmProviderClaim } from '@/lib/actions/claims';
import { adminSaveSpa, approveProviderClaim, rejectProviderClaim } from '@/lib/actions/admin';
import { getSpaDetail } from '@/lib/catalog';

// Server-action environment stubs: no Next.js cache or cookie request in tests.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const session = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  required: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(async () => session.current),
  requireUser: vi.fn(async () => session.required),
  findUserByEmail: vi.fn(async () => null),
}));

const IDS = {
  admin: 'usr_pcl_admin',
  owner: 'usr_pcl_owner',
  second: 'usr_pcl_second',
  invitee: 'usr_pcl_invitee',
  live: 'prv_pcl_live', // published + unclaimed
  owned: 'prv_pcl_owned', // published + owned
  draft: 'prv_pcl_draft', // hidden (pending) + unclaimed
  live2: 'prv_pcl_live2', // published + unclaimed (for invite flow)
};

function asUser(id: string, role: 'customer' | 'super_admin', email: string) {
  return { id, role, email, name: 'Test User', phone: null, status: 'active', provider: null, agent: null };
}

let db: AppDb;

beforeAll(async () => {
  process.env.VITEST = 'true';
  db = await getDb();
  const pw = await hashPassword('TestPass123!');

  await db.insert(T.users).values([
    { id: IDS.admin, email: 'pcl-admin@example.com', name: 'PCL Admin', passwordHash: pw, role: 'super_admin', status: 'active' },
    { id: IDS.owner, email: 'pcl-owner@example.com', name: 'PCL Owner', passwordHash: pw, role: 'customer', status: 'active' },
    { id: IDS.second, email: 'pcl-second@example.com', name: 'PCL Second', passwordHash: pw, role: 'customer', status: 'active' },
    { id: IDS.invitee, email: 'pcl-invitee@example.com', name: 'PCL Invitee', passwordHash: pw, role: 'customer', status: 'active' },
  ]);

  await db.insert(T.providers).values([
    { id: IDS.live, ownerId: null, name: 'PCL Live Spa', slug: 'pcl-live-spa', country: 'ID', status: 'approved' },
    { id: IDS.owned, ownerId: IDS.owner, name: 'PCL Owned Spa', slug: 'pcl-owned-spa', country: 'ID', status: 'approved' },
    { id: IDS.draft, ownerId: null, name: 'PCL Draft Spa', slug: 'pcl-draft-spa', country: 'ID', status: 'pending' },
    { id: IDS.live2, ownerId: null, name: 'PCL Live Two', slug: 'pcl-live-two', country: 'ID', status: 'approved' },
  ]);

  return async () => {
    // Fresh in-memory DB per run; nothing to tear down.
  };
});

describe('requestProviderClaim', () => {
  it('requires a signed-in user', async () => {
    session.current = null;
    const res = await requestProviderClaim(IDS.live);
    expect(res.ok).toBe(false);
  });

  it('refuses listings that already have an owner', async () => {
    session.current = asUser(IDS.second, 'customer', 'pcl-second@example.com');
    const res = await requestProviderClaim(IDS.owned);
    expect(res.ok).toBe(false);
  });

  it('refuses hidden (pending) listings', async () => {
    session.current = asUser(IDS.owner, 'customer', 'pcl-owner@example.com');
    const res = await requestProviderClaim(IDS.draft);
    expect(res.ok).toBe(false);
  });

  it('creates a pending claim for an unclaimed published spa', async () => {
    session.current = asUser(IDS.owner, 'customer', 'pcl-owner@example.com');
    const res = await requestProviderClaim(IDS.live, 'We run this spa.');
    expect(res.ok).toBe(true);

    const claim = await db.query.providerClaims.findFirst({
      where: eq(T.providerClaims.providerId, IDS.live),
    });
    expect(claim?.status).toBe('pending');
    expect(claim?.userId).toBe(IDS.owner);
    expect(claim?.message).toBe('We run this spa.');

    // Duplicate request is refused while pending.
    const again = await requestProviderClaim(IDS.live);
    expect(again.ok).toBe(false);
  });
});

describe('confirmProviderClaim (admin email invite)', () => {
  it('lets the invited email attach itself to the invite', async () => {
    // Simulates an admin invite whose account did not exist yet.
    await db.insert(T.providerClaims).values({
      id: 'clm_pcl_invite',
      providerId: IDS.live2,
      email: 'pcl-invitee@example.com',
      userId: null,
      message: 'Owner invite added by admin',
    });

    session.current = asUser(IDS.second, 'customer', 'pcl-second@example.com');
    const wrongEmail = await confirmProviderClaim('clm_pcl_invite');
    expect(wrongEmail.ok).toBe(false);

    session.current = asUser(IDS.invitee, 'customer', 'pcl-invitee@example.com');
    const res = await confirmProviderClaim('clm_pcl_invite');
    expect(res.ok).toBe(true);

    const claim = await db.query.providerClaims.findFirst({ where: eq(T.providerClaims.id, 'clm_pcl_invite') });
    expect(claim?.userId).toBe(IDS.invitee);
  });
});

describe('admin approve / reject', () => {
  it('refuses to approve an invite the claimant never confirmed', async () => {
    await db.insert(T.providerClaims).values({
      id: 'clm_pcl_ghost',
      providerId: IDS.live2,
      email: 'ghost@example.com',
      userId: null,
    });
    session.required = asUser(IDS.admin, 'super_admin', 'pcl-admin@example.com');
    const res = await approveProviderClaim('clm_pcl_ghost');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/confirm/i);
  });

  it('transfers ownership, promotes the owner and rejects sibling claims', async () => {
    // A competing claim submitted by a second person.
    await db.insert(T.providerClaims).values({
      id: 'clm_pcl_second',
      providerId: IDS.live,
      email: 'pcl-second@example.com',
      userId: IDS.second,
    });
    const first = await db.query.providerClaims.findFirst({
      where: eq(T.providerClaims.providerId, IDS.live),
    });

    session.required = asUser(IDS.admin, 'super_admin', 'pcl-admin@example.com');
    const res = await approveProviderClaim(first!.id);
    expect(res.ok).toBe(true);

    const provider = await db.query.providers.findFirst({ where: eq(T.providers.id, IDS.live) });
    expect(provider?.ownerId).toBe(IDS.owner);

    const owner = await db.query.users.findFirst({ where: eq(T.users.id, IDS.owner) });
    expect(owner?.role).toBe('provider');

    const approved = await db.query.providerClaims.findFirst({ where: eq(T.providerClaims.id, first!.id) });
    expect(approved?.status).toBe('approved');
    const sibling = await db.query.providerClaims.findFirst({ where: eq(T.providerClaims.id, 'clm_pcl_second') });
    expect(sibling?.status).toBe('rejected');

    // Cannot decide the same claim twice.
    const again = await approveProviderClaim(first!.id);
    expect(again.ok).toBe(false);
  });

  it('rejects the unconfirmed invite', async () => {
    session.required = asUser(IDS.admin, 'super_admin', 'pcl-admin@example.com');
    const res = await rejectProviderClaim('clm_pcl_ghost');
    expect(res.ok).toBe(true);
    const claim = await db.query.providerClaims.findFirst({ where: eq(T.providerClaims.id, 'clm_pcl_ghost') });
    expect(claim?.status).toBe('rejected');
  });
});

/** Full supplier-form payload — every required branchSchema field. */
function spaInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Spa',
    addressLine: '1 Test Street',
    city: 'Denpasar',
    country: 'ID',
    timezone: 'Asia/Makassar',
    currency: 'IDR',
    leadTimeMinutes: 60,
    maxAdvanceDays: 90,
    bufferMinutes: 0,
    slotIntervalMinutes: 30,
    ...overrides,
  } as Parameters<typeof adminSaveSpa>[0];
}

describe('adminSaveSpa (create)', () => {
  it('adds a hidden draft with its first branch (never shows publicly)', async () => {
    session.required = asUser(IDS.admin, 'super_admin', 'pcl-admin@example.com');
    const res = await adminSaveSpa(spaInput({ name: 'Hidden Draft Spa', publish: false }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { providerId } = res.data!;

    const provider = await db.query.providers.findFirst({ where: eq(T.providers.id, providerId) });
    expect(provider?.status).toBe('pending');
    expect(provider?.ownerId).toBeNull();

    // The full form data lands on the branch created with the provider.
    const branch = await db.query.branches.findFirst({ where: eq(T.branches.providerId, providerId) });
    expect(branch?.name).toBe('Hidden Draft Spa');
    expect(branch?.addressLine).toBe('1 Test Street');

    // Hidden drafts are not resolvable on the public site.
    expect(await getSpaDetail(db, provider!.slug)).toBeNull();
  });

  it('creates an owner invite claim when an email is supplied', async () => {
    session.required = asUser(IDS.admin, 'super_admin', 'pcl-admin@example.com');
    const res = await adminSaveSpa(
      spaInput({ name: 'Invited Draft Spa', ownerEmail: 'future-owner@example.com', publish: false }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { providerId } = res.data!;

    const claim = await db.query.providerClaims.findFirst({
      where: eq(T.providerClaims.providerId, providerId),
    });
    expect(claim?.status).toBe('pending');
    expect(claim?.email).toBe('future-owner@example.com');
    expect(claim?.userId).toBeNull(); // no account yet — they confirm after signing up
  });

  it('publishes immediately when asked (claim card becomes reachable)', async () => {
    session.required = asUser(IDS.admin, 'super_admin', 'pcl-admin@example.com');
    const res = await adminSaveSpa(spaInput({ name: 'Published Unclaimed Spa', publish: true }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { providerId } = res.data!;

    const provider = await db.query.providers.findFirst({ where: eq(T.providers.id, providerId) });
    expect(provider?.status).toBe('approved');
    expect(provider?.ownerId).toBeNull();

    const spa = await getSpaDetail(db, provider!.slug);
    expect(spa).not.toBeNull();
    expect(spa?.provider.ownerId).toBeNull(); // page renders the "Claim This Spa" card
  });
});

describe('adminSaveSpa (edit)', () => {
  it('edits an unclaimed spa and keeps the provider brand in step', async () => {
    session.required = asUser(IDS.admin, 'super_admin', 'pcl-admin@example.com');
    const created = await adminSaveSpa(spaInput({ name: 'Edit Me Spa', publish: false }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const { id: branchId, providerId } = created.data!;

    const res = await adminSaveSpa(
      spaInput({ id: branchId, providerId, name: 'Renamed Edit Spa', city: 'Jakarta', publish: true }),
    );
    expect(res.ok).toBe(true);

    const branch = await db.query.branches.findFirst({ where: eq(T.branches.id, branchId) });
    expect(branch?.name).toBe('Renamed Edit Spa');
    expect(branch?.city).toBe('Jakarta');

    const provider = await db.query.providers.findFirst({ where: eq(T.providers.id, providerId) });
    expect(provider?.name).toBe('Renamed Edit Spa'); // unclaimed → brand follows the form
    expect(provider?.status).toBe('approved'); // publish applied
  });

  it('never renames a claimed spa when a branch name changes', async () => {
    session.required = asUser(IDS.admin, 'super_admin', 'pcl-admin@example.com');
    const created = await adminSaveSpa(spaInput({ providerId: IDS.owned, name: 'Owned Branch' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const { id: branchId } = created.data!;

    const res = await adminSaveSpa(spaInput({ id: branchId, name: 'Owned Branch Renamed' }));
    expect(res.ok).toBe(true);

    const branch = await db.query.branches.findFirst({ where: eq(T.branches.id, branchId) });
    expect(branch?.name).toBe('Owned Branch Renamed');

    const provider = await db.query.providers.findFirst({ where: eq(T.providers.id, IDS.owned) });
    expect(provider?.name).toBe('PCL Owned Spa'); // claimed — the owner's brand is untouched
    expect(provider?.status).toBe('approved'); // no publish flag → status untouched
  });
});

describe('public visibility', () => {
  it('hides unclaimed drafts on every public page (detail 404s)', async () => {
    expect(await getSpaDetail(db, 'pcl-draft-spa')).toBeNull();
  });

  it('keeps owned listings public', async () => {
    const spa = await getSpaDetail(db, 'pcl-owned-spa');
    expect(spa).not.toBeNull();
    expect(spa?.provider.ownerId).toBe(IDS.owner);
  });
});

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type AppDb } from '@/db';
import * as T from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { setBookingTherapist } from '@/lib/actions/provider';

// Server-action environment stubs: no Next.js cache or cookie request in tests.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const OWNER_ID = 'usr_thr_owner';

vi.mock('@/lib/auth/session', () => ({
  requireUser: vi.fn(async () => ({
    id: OWNER_ID,
    role: 'provider',
    status: 'active',
    provider: { id: 'prv_thr' },
  })),
}));

const IDS = {
  owner: OWNER_ID,
  provider: 'prv_thr',
  branch: 'brn_thr',
  otherBranch: 'brn_thr_other',
  treatment: 'trt_thr',
  noTherapist: 'trt_thr_none',
  therapistA: 'thp_thr_a',
  therapistB: 'thp_thr_b',
  therapistBusy: 'thp_thr_busy',
  therapistInactive: 'thp_thr_off',
  therapistOtherBranch: 'thp_thr_other',
  therapistWorker: 'thp_thr_worker',
  bookingOpen: 'bkg_thr_open',
  bookingBusy: 'bkg_thr_busy',
  bookingDone: 'bkg_thr_done',
  bookingNoThr: 'bkg_thr_none',
};

/** A future window — the action only cares about overlap with other bookings. */
function window_(offsetMs = 0): { startAt: Date; endAt: Date } {
  const startAt = new Date(Date.now() + 5 * 86_400_000 + offsetMs);
  startAt.setUTCHours(10, 0, 0, 0);
  return { startAt, endAt: new Date(startAt.getTime() + 60 * 60_000) };
}
const SLOT = window_();

let db: AppDb;

beforeAll(async () => {
  process.env.VITEST = 'true';
  db = await getDb();
  const pw = await hashPassword('TestPass123!');

  await db.insert(T.users).values({
    id: IDS.owner,
    email: 'thr-owner@example.com',
    name: 'Thr Owner',
    passwordHash: pw,
    role: 'provider',
    status: 'active',
  });

  await db.insert(T.providers).values({
    id: IDS.provider,
    ownerId: IDS.owner,
    name: 'Thr Test Spa',
    slug: 'thr-test-spa',
    country: 'ID',
    baseCurrency: 'IDR',
    status: 'approved',
  });

  const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '09:00', close: '17:00', closed: false }));
  await db.insert(T.branches).values([
    {
      id: IDS.branch,
      providerId: IDS.provider,
      name: 'Thr Branch',
      slug: 'thr-branch',
      addressLine: '1 Test Street',
      city: 'Denpasar',
      country: 'ID',
      timezone: 'Asia/Makassar',
      currency: 'IDR',
      hours,
      status: 'active',
    },
    {
      id: IDS.otherBranch,
      providerId: IDS.provider,
      name: 'Thr Other Branch',
      slug: 'thr-other-branch',
      addressLine: '2 Test Street',
      city: 'Denpasar',
      country: 'ID',
      timezone: 'Asia/Makassar',
      currency: 'IDR',
      hours,
      status: 'active',
    },
  ]);

  await db.insert(T.treatments).values([
    {
      id: IDS.treatment,
      providerId: IDS.provider,
      name: 'Thr Massage',
      slug: 'thr-massage',
      category: 'massage',
      durationMin: 60,
      listPrice: 400_000,
      currency: 'IDR',
      requiresTherapist: true,
      status: 'active',
    },
    {
      id: IDS.noTherapist,
      providerId: IDS.provider,
      name: 'Thr Sauna',
      slug: 'thr-sauna',
      category: 'massage',
      durationMin: 30,
      listPrice: 100_000,
      currency: 'IDR',
      requiresTherapist: false,
      status: 'active',
    },
  ]);

  await db.insert(T.therapists).values([
    { id: IDS.therapistA, branchId: IDS.branch, name: 'Yuka', active: true },
    { id: IDS.therapistB, branchId: IDS.branch, name: 'Risa', active: true },
    { id: IDS.therapistBusy, branchId: IDS.branch, name: 'Lucy', active: true },
    { id: IDS.therapistInactive, branchId: IDS.branch, name: 'Off Duty', active: false },
    { id: IDS.therapistOtherBranch, branchId: IDS.otherBranch, name: 'Elsewhere', active: true },
    { id: IDS.therapistWorker, branchId: IDS.branch, name: 'Reception', active: true, role: 'worker' },
  ]);

  await db.insert(T.bookings).values([
    {
      id: IDS.bookingOpen,
      code: 'BYS-THROPEN',
      providerId: IDS.provider,
      branchId: IDS.branch,
      treatmentId: IDS.treatment,
      therapistId: null,
      guestName: 'Open Guest',
      guestEmail: 'open@example.com',
      startAt: SLOT.startAt,
      endAt: SLOT.endAt,
      timezone: 'Asia/Makassar',
      status: 'pending',
      paymentStatus: 'unpaid',
      channel: 'direct',
      currency: 'IDR',
    },
    {
      id: IDS.bookingBusy,
      code: 'BYS-THRBUSY',
      providerId: IDS.provider,
      branchId: IDS.branch,
      treatmentId: IDS.treatment,
      therapistId: IDS.therapistBusy,
      guestName: 'Busy Guest',
      guestEmail: 'busy@example.com',
      startAt: SLOT.startAt,
      endAt: SLOT.endAt,
      timezone: 'Asia/Makassar',
      status: 'confirmed',
      paymentStatus: 'venue',
      channel: 'direct',
      currency: 'IDR',
    },
    {
      id: IDS.bookingDone,
      code: 'BYS-THRDONE',
      providerId: IDS.provider,
      branchId: IDS.branch,
      treatmentId: IDS.treatment,
      therapistId: null,
      guestName: 'Done Guest',
      guestEmail: 'done@example.com',
      startAt: new Date(SLOT.startAt.getTime() - 86_400_000),
      endAt: new Date(SLOT.endAt.getTime() - 86_400_000),
      timezone: 'Asia/Makassar',
      status: 'completed',
      paymentStatus: 'paid',
      channel: 'direct',
      currency: 'IDR',
    },
    {
      id: IDS.bookingNoThr,
      code: 'BYS-THRNONE',
      providerId: IDS.provider,
      branchId: IDS.branch,
      treatmentId: IDS.noTherapist,
      therapistId: null,
      guestName: 'Sauna Guest',
      guestEmail: 'sauna@example.com',
      startAt: new Date(SLOT.startAt.getTime() + 3_600_000),
      endAt: new Date(SLOT.endAt.getTime() + 3_600_000),
      timezone: 'Asia/Makassar',
      status: 'pending',
      paymentStatus: 'unpaid',
      channel: 'direct',
      currency: 'IDR',
    },
  ]);

  return async () => {
    // Fresh in-memory DB per run; nothing to tear down.
  };
});

async function currentTherapist(bookingId: string): Promise<string | null> {
  const row = await db.query.bookings.findFirst({ where: eq(T.bookings.id, bookingId) });
  return row?.therapistId ?? null;
}

describe('setBookingTherapist', () => {
  it('assigns a therapist to a booking the customer left unassigned', async () => {
    const res = await setBookingTherapist(IDS.bookingOpen, IDS.therapistA);
    expect(res.ok).toBe(true);
    expect(await currentTherapist(IDS.bookingOpen)).toBe(IDS.therapistA);
  });

  it('moves the booking to a different therapist', async () => {
    const res = await setBookingTherapist(IDS.bookingOpen, IDS.therapistB);
    expect(res.ok).toBe(true);
    expect(await currentTherapist(IDS.bookingOpen)).toBe(IDS.therapistB);
  });

  it('clears the assignment back to auto / not assigned', async () => {
    const res = await setBookingTherapist(IDS.bookingOpen, null);
    expect(res.ok).toBe(true);
    expect(await currentTherapist(IDS.bookingOpen)).toBeNull();
  });

  it('refuses a therapist who already has an overlapping appointment', async () => {
    const res = await setBookingTherapist(IDS.bookingOpen, IDS.therapistBusy);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/already has an appointment/i);
    expect(await currentTherapist(IDS.bookingOpen)).toBeNull();
  });

  it('refuses an inactive therapist', async () => {
    const res = await setBookingTherapist(IDS.bookingOpen, IDS.therapistInactive);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/inactive/i);
  });

  it('refuses a therapist from another branch of the same provider', async () => {
    const res = await setBookingTherapist(IDS.bookingOpen, IDS.therapistOtherBranch);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/does not work at this branch/i);
  });

  it('refuses staff who are not bookable therapists', async () => {
    const res = await setBookingTherapist(IDS.bookingOpen, IDS.therapistWorker);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/not a bookable therapist/i);
  });

  it('refuses unknown therapists', async () => {
    const res = await setBookingTherapist(IDS.bookingOpen, 'thp_does_not_exist');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/not found/i);
  });

  it('refuses bookings that are already finished', async () => {
    const res = await setBookingTherapist(IDS.bookingDone, IDS.therapistA);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/no longer be changed/i);
    expect(await currentTherapist(IDS.bookingDone)).toBeNull();
  });

  it('refuses treatments that do not need a therapist', async () => {
    const res = await setBookingTherapist(IDS.bookingNoThr, IDS.therapistA);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/does not need a therapist/i);
  });

  it('refuses bookings belonging to another provider', async () => {
    // The mocked session owns prv_thr; a foreign booking id is simply not found.
    const res = await setBookingTherapist('bkg_someone_else', IDS.therapistA);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/not found/i);
  });
});
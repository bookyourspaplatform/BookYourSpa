import { and, asc, eq } from 'drizzle-orm';
import { providerClaims } from '@/db/schema';
import type { AppDb } from '@/db';

/** A claim this signed-in person still has to confirm (admin invited their email). */
export type ConfirmableClaim = {
  id: string;
  providerName: string;
  providerSlug: string;
};

/** Invite rows matching an email that are waiting for the invitee to confirm. */
export async function listConfirmableClaims(db: AppDb, email: string): Promise<ConfirmableClaim[]> {
  const rows = await db.query.providerClaims.findMany({
    where: and(
      eq(providerClaims.email, email.toLowerCase().trim()),
      eq(providerClaims.status, 'pending'),
    ),
    with: {
      provider: { columns: { name: true, slug: true, status: true } },
    },
    orderBy: [asc(providerClaims.createdAt)],
    limit: 5,
  });
  // The claimant must sign in with the invited email first; confirmed claims
  // are already in the admin queue and need nothing from them.
  return rows
    .filter((c) => c.userId === null && c.provider.status !== 'suspended')
    .map((c) => ({ id: c.id, providerName: c.provider.name, providerSlug: c.provider.slug }));
}

/** This person's pending claim on one spa (shows "under review" on the listing). */
export async function findClaimForUser(
  db: AppDb,
  providerId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const row = await db.query.providerClaims.findFirst({
    where: and(
      eq(providerClaims.providerId, providerId),
      eq(providerClaims.userId, userId),
      eq(providerClaims.status, 'pending'),
    ),
    columns: { id: true },
  });
  return row ?? null;
}

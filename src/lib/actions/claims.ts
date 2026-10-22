'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { providerClaims, providers } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { logAudit } from '@/lib/audit';
import { newId } from '@/lib/utils';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const fail = (error: string): ActionResult<never> => ({ ok: false, error });

/** A signed-in visitor claims an unclaimed, publicly listed spa. Admin approves afterwards. */
export async function requestProviderClaim(providerId: string, message?: string): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return fail('Sign in to claim this spa.');

    const db = await getDb();
    const provider = await db.query.providers.findFirst({ where: eq(providers.id, providerId) });
    if (!provider || provider.status !== 'approved') return fail('This listing cannot be claimed.');
    if (provider.ownerId) return fail('This spa has already been claimed.');

    const existing = await db.query.providerClaims.findFirst({
      where: and(eq(providerClaims.providerId, providerId), eq(providerClaims.email, user.email)),
    });
    if (existing?.status === 'pending') return fail('Your claim is already awaiting review.');
    if (existing?.status === 'approved') return fail('This spa has already been claimed.');

    const note = message?.trim() ? message.trim().slice(0, 500) : null;
    if (existing) {
      // A previously rejected claimant may try again.
      await db
        .update(providerClaims)
        .set({ status: 'pending', userId: user.id, message: note, decidedAt: null, decidedBy: null })
        .where(eq(providerClaims.id, existing.id));
    } else {
      await db.insert(providerClaims).values({
        id: newId('clm'),
        providerId,
        email: user.email,
        userId: user.id,
        message: note,
        status: 'pending',
      });
    }

    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'provider.claim_requested',
      entity: 'provider',
      entityId: providerId,
    });
    revalidatePath(`/spas/${provider.slug}`);
    return { ok: true };
  } catch (err) {
    console.error('[claims] request failed', err);
    return fail('Could not submit the claim. Try again.');
  }
}

/** The invited email (signed in) confirms an admin invite so an admin can approve it. */
export async function confirmProviderClaim(claimId: string): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return fail('Sign in first.');

    const db = await getDb();
    const claim = await db.query.providerClaims.findFirst({ where: eq(providerClaims.id, claimId) });
    if (!claim || claim.status !== 'pending') return fail('This claim is no longer open.');
    if (claim.userId && claim.userId !== user.id) return fail('This invite belongs to a different account.');
    if (claim.email.toLowerCase() !== user.email.toLowerCase()) {
      return fail('This spa was invited to a different email address — sign in with that email.');
    }

    await db.update(providerClaims).set({ userId: user.id }).where(eq(providerClaims.id, claimId));
    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'provider.claim_confirmed',
      entity: 'provider',
      entityId: claim.providerId,
    });
    revalidatePath('/account');
    revalidatePath('/provider');
    return { ok: true };
  } catch (err) {
    console.error('[claims] confirm failed', err);
    return fail('Could not confirm the claim. Try again.');
  }
}

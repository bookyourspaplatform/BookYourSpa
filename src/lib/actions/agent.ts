'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { agents } from '@/db/schema';
import { requireUser } from '@/lib/auth/session';
import { logAudit } from '@/lib/audit';

export type ActionResult = { ok: true } | { ok: false; error: string };

const profileSchema = z.object({
  companyName: z.string().min(2).max(120),
  phone: z.string().max(40).optional().nullable(),
  website: z.union([z.string().url().max(240), z.literal('')]).optional().nullable(),
});

export async function saveAgentProfile(input: z.infer<typeof profileSchema>): Promise<ActionResult> {
  try {
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid data.' };
    const user = await requireUser(['agent']);
    const db = await getDb();
    await db
      .update(agents)
      .set({
        companyName: parsed.data.companyName.trim(),
        phone: parsed.data.phone?.trim() || null,
        website: parsed.data.website || null,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, user.agent!.id));
    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'agent.profile_updated',
      entity: 'agent',
      entityId: user.agent!.id,
    });
    revalidatePath('/agent/settings');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not save your profile.' };
  }
}

import { newId } from '@/lib/utils';
import { getDb } from '@/db';
import type { Role } from '@/db/schema';

export type AuditInput = {
  actorId?: string | null;
  actorRole?: Role | null;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
};

/** Best-effort audit trail — never throws into the request path. */
export async function logAudit(entry: AuditInput): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(await import('@/db/schema').then((m) => m.auditLogs)).values({
      id: newId('aud'),
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      meta: entry.meta ?? {},
      ip: entry.ip ?? null,
    });
  } catch (err) {
    console.error('[audit] failed to write entry', entry.action, err);
  }
}

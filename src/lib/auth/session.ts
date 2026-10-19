import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, and } from 'drizzle-orm';
import type { Role } from '@/db/schema';
import { users, providers, agents } from '@/db/schema';
import { getDb } from '@/db';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  signSession,
  verifySession,
  type SessionPayload,
} from './jwt';

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  status: string;
  provider: { id: string; name: string; slug: string; status: string } | null;
  agent: { id: string; companyName: string; slug: string; status: string; commissionBps: number } | null;
};

export const LOGIN_PAGES: Record<Role, string> = {
  customer: '/login',
  provider: '/login/provider',
  agent: '/login/agent',
  super_admin: '/login/admin',
};

export const HOME_PAGES: Record<Role, string> = {
  customer: '/account',
  provider: '/provider',
  agent: '/agent',
  super_admin: '/admin',
};

/** Read + verify the session cookie (server components, actions, route handlers). */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** Session + full user row (role/status/tenant links). Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession();
  if (!session) return null;
  const db = await getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.sub),
    with: {
      provider: { columns: { id: true, name: true, slug: true, status: true } },
      agent: { columns: { id: true, companyName: true, slug: true, status: true, commissionBps: true } },
    },
  });
  if (!user || user.status !== 'active') return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    status: user.status,
    provider: user.provider && user.provider.status === 'approved' ? user.provider : null,
    agent: user.agent && user.agent.status === 'approved' ? user.agent : null,
  };
});

/** Require an authenticated user, optionally limited to roles. */
export async function requireUser(roles?: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const role = roles?.[0] ?? 'customer';
    redirect(LOGIN_PAGES[role]);
  }
  if (roles && !roles.includes(user.role)) {
    // Signed in as the wrong role — send them to their own home.
    redirect(HOME_PAGES[user.role]);
  }
  if (user.role === 'provider' && !user.provider) {
    // Provider account not approved yet: show the pending screen instead of the console.
    redirect('/provider/pending');
  }
  if (user.role === 'agent' && !user.agent) {
    redirect('/agent/pending');
  }
  return user;
}

export async function createSession(user: {
  id: string;
  role: Role;
  name: string;
  email: string;
}): Promise<void> {
  const token = await signSession({
    sub: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Best-effort client IP for rate limiting / audit trails. */
export async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
  } catch {
    return null;
  }
}

/**
 * Cheap per-identifier login throttle (in-memory per isolate; scrypt hashing
 * provides the real cost). Returns remaining seconds to wait, 0 = allowed.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 8, windowMs = 5 * 60_000): number {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 0;
  }
  bucket.count += 1;
  if (bucket.count > limit) return Math.ceil((bucket.resetAt - now) / 1000);
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
  return 0;
}

export async function findUserByEmail(email: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email.toLowerCase().trim())))
    .limit(1);
  return rows[0] ?? null;
}

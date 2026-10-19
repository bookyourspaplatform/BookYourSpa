import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@/db/schema';

export const SESSION_COOKIE = 'bys_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = {
  sub: string;
  role: Role;
  name: string;
  email: string;
};

/** Edge-safe secret resolution — used by proxy.ts and server code alike. */
export function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) return new TextEncoder().encode(secret);
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_SECRET is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))" and add it to your environment.',
    );
  }
  return new TextEncoder().encode('bookyourspa-development-secret-do-not-use-in-production');
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getAuthSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret(), { algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.role !== 'string') return null;
    return {
      sub: payload.sub,
      role: payload.role as Role,
      name: String(payload.name ?? ''),
      email: String(payload.email ?? ''),
    };
  } catch {
    return null;
  }
}

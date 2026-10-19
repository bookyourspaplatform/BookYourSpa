import { NextResponse } from 'next/server';

/**
 * Same-origin check for JSON mutations (Server Actions already enforce this
 * natively; route handlers must do it themselves).
 */
export function assertSameOrigin(req: Request): { ok: true } | { ok: false; response: NextResponse } {
  const origin = req.headers.get('origin');
  if (!origin) {
    // Non-browser clients (curl, server-to-server) send no Origin — accept
    // only when no Origin AND no Referer (avoids cross-site form posts that
    // browsers always label).
    const referer = req.headers.get('referer');
    if (referer) {
      return { ok: false, response: NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 }) };
    }
    return { ok: true };
  }
  const host = req.headers.get('host');
  if (!host) return { ok: false, response: NextResponse.json({ error: 'Missing host.' }, { status: 403 }) };
  const allowed = new Set([host, `https://${host}`, `http://${host}`, `http://localhost:${host.split(':')[1] ?? '80'}`]);
  // Next/Vercel may present a port-less origin while host includes one.
  const originHost = (() => {
    try {
      return new URL(origin).host;
    } catch {
      return '';
    }
  })();
  if (allowed.has(origin) || originHost === host) return { ok: true };
  const devLocal = process.env.NODE_ENV !== 'production' && ['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin);
  if (devLocal) return { ok: true };
  return { ok: false, response: NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 }) };
}

/* --------------------------- rate limiting --------------------------- */

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 30, windowMs = 60_000): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
  if (bucket.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

export function clientIpOf(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'anonymous'
  );
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

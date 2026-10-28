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

/** Tags the rich-text editor may emit — everything else is unwrapped or dropped. */
const RICH_TEXT_ALLOWED = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
  'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'blockquote', 'span',
]);

/**
 * Sanitize provider-authored rich-text HTML before it reaches the database
 * (and again before rendering). Strips scripts/event handlers/frames and
 * unwraps any tag outside a small allowlist. Not a general-purpose HTML
 * sanitizer — it is deliberately narrow for a fixed editor toolbar.
 */
export function sanitizeRichText(html: string): string {
  let out = html
    // Whole dangerous elements with their content.
    .replace(/<(script|style|iframe|object|embed|form|link|meta|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|link|meta|svg|math)\b[^>]*\/?>/gi, '')
    // Event handlers and unsafe URL schemes in attributes.
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')?\s*javascript:[^"'>\s]*\2?/gi, '$1="#"');

  // Unwrap tags outside the allowlist (keep their inner text).
  out = out.replace(/<\/?([a-z0-9]+)\b[^>]*>/gi, (match, tag: string) =>
    RICH_TEXT_ALLOWED.has(tag.toLowerCase()) ? match : '',
  );
  // Drop residual attributes on allowed tags except href/title on links.
  out = out.replace(/<([a-z0-9]+)((?:\s+[a-z-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))+?)\s*(\/?)>/gi,
    (_m, tag: string, attrs: string, selfClose: string) => {
      const kept: string[] = [];
      const attrRe = /([a-z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(attrs))) {
        const name = m[1]!.toLowerCase();
        if (tag.toLowerCase() === 'a' && (name === 'href' || name === 'title')) kept.push(`${name}=${m[2]}`);
        if (name === 'class') kept.push(`${name}=${m[2]}`);
      }
      const tail = kept.length ? ` ${kept.join(' ')}` : '';
      return `<${tag}${tail}${selfClose ? ' /' : ''}>`;
    },
  );
  return out.trim();
}

/**
 * Plain-text version of rich text — for meta descriptions and JSON-LD.
 * Lives in utils (no `next/server` import) so client components can use it too.
 */
export { stripHtml } from '@/lib/utils';

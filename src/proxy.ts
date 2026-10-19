import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession, type SessionPayload } from '@/lib/auth/jwt';

/**
 * Edge-safe route protection (Next 16 "proxy" — the former middleware).
 * Only verifies the signed session cookie; deep role/status/tenant checks
 * run server-side in every dashboard layout via requireUser().
 */

const LOGIN_FOR_PREFIX: Array<[prefix: string, login: string, home: string]> = [
  ['/provider', '/login/provider', '/provider'],
  ['/agent', '/login/agent', '/agent'],
  ['/admin', '/login/admin', '/admin'],
  ['/account', '/login', '/account'],
];

function loginFor(pathname: string): string {
  for (const [prefix, login] of LOGIN_FOR_PREFIX) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return login;
  }
  return '/login';
}

function homeFor(session: SessionPayload | null): string {
  if (!session) return '/';
  switch (session.role) {
    case 'provider':
      return '/provider';
    case 'agent':
      return '/agent';
    case 'super_admin':
      return '/admin';
    default:
      return '/account';
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  const isProtected = LOGIN_FOR_PREFIX.some(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !session) {
    const url = request.nextUrl.clone();
    url.pathname = loginFor(pathname);
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (isProtected && session) {
    const [prefix] = LOGIN_FOR_PREFIX.find(
      ([p]) => pathname === p || pathname.startsWith(`${p}/`),
    ) ?? ['/account'];
    const roleOk =
      (prefix === '/account' && session.role === 'customer') ||
      (prefix === '/provider' && session.role === 'provider') ||
      (prefix === '/agent' && session.role === 'agent') ||
      (prefix === '/admin' && session.role === 'super_admin');
    if (!roleOk) {
      const url = request.nextUrl.clone();
      url.pathname = homeFor(session);
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  // Already signed in → don't sit on a login/register screen.
  if (session && (pathname === '/login' || pathname.startsWith('/login/') || pathname === '/register' || pathname.startsWith('/register/'))) {
    if (pathname === '/login/provider' && session.role !== 'provider') return NextResponse.next();
    if (pathname === '/login/agent' && session.role !== 'agent') return NextResponse.next();
    if (pathname === '/login/admin' && session.role !== 'super_admin') return NextResponse.next();
    if (pathname === '/login' && session.role !== 'customer') return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = homeFor(session);
    url.search = '';
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  // Conservative security headers (CSP kept permissive for Next dev inline styles).
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  return response;
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|images/).*)'],
};

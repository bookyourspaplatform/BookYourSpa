import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSameOrigin, rateLimit } from '@/lib/security';

describe('rateLimit', () => {
  afterEach(() => vi.useRealTimers());

  it('allows traffic under the limit and blocks after it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    for (let i = 0; i < 5; i++) expect(rateLimit('k1', 5, 60_000).ok).toBe(true);
    const blocked = rateLimit('k1', 5, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('resets after the window elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(rateLimit('k2', 1, 60_000).ok).toBe(true);
    expect(rateLimit('k2', 1, 60_000).ok).toBe(false);
    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
    expect(rateLimit('k2', 1, 60_000).ok).toBe(true);
  });

  it('isolates keys', () => {
    vi.useFakeTimers();
    expect(rateLimit('a', 1, 60_000).ok).toBe(true);
    expect(rateLimit('a', 1, 60_000).ok).toBe(false);
    expect(rateLimit('b', 1, 60_000).ok).toBe(true);
  });
});

function req(headers: Record<string, string>): Request {
  return new Request('http://example.test/api', { headers });
}

describe('assertSameOrigin', () => {
  it('accepts matching origin', () => {
    const res = assertSameOrigin(req({ origin: 'https://example.test', host: 'example.test' }));
    expect(res.ok).toBe(true);
  });

  it('rejects foreign origins', () => {
    const res = assertSameOrigin(req({ origin: 'https://evil.example', host: 'example.test' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });

  it('accepts non-browser clients with no origin and no referer', () => {
    expect(assertSameOrigin(req({ host: 'example.test' })).ok).toBe(true);
  });

  it('rejects form posts that carry a referer but no origin', () => {
    const res = assertSameOrigin(req({ referer: 'https://evil.example/x', host: 'example.test' }));
    expect(res.ok).toBe(false);
  });
});

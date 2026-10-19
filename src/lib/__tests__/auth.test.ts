import { describe, expect, it } from 'vitest';
import { hashPassword, passwordIssues, verifyPassword } from '@/lib/auth/password';
import { signSession, verifySession } from '@/lib/auth/jwt';

describe('password hashing', () => {
  it('round-trips a password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('wrong password', stored)).toBe(false);
  });

  it('uses a fresh salt per hash', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('fails closed on malformed stored values', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$bad')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });

  it('enforces a minimum password policy', () => {
    expect(passwordIssues('short')).not.toEqual([]);
    expect(passwordIssues('')).not.toEqual([]);
    expect(passwordIssues('goodpassword123')).toEqual([]);
  });
});

describe('session tokens', () => {
  const payload = { sub: 'usr_1', role: 'customer' as const, name: 'Test', email: 't@example.com' };

  it('signs and verifies a session', async () => {
    const token = await signSession(payload);
    const out = await verifySession(token);
    expect(out).toMatchObject(payload);
  });

  it('rejects tampered tokens', async () => {
    const token = await signSession(payload);
    const tampered = `${token.slice(0, -4)}AAAA`;
    expect(await verifySession(tampered)).toBeNull();
    expect(await verifySession('garbage')).toBeNull();
    expect(await verifySession('')).toBeNull();
  });

  it('does not accept tokens signed with another secret', async () => {
    const old = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = 'another-secret-another-secret!!';
    const foreign = await signSession(payload);
    process.env.AUTH_SECRET = old;
    expect(await verifySession(foreign)).toBeNull();
  });
});

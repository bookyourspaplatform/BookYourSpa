import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getDb, type AppDb } from '@/db';
import * as T from '@/db/schema';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { forgotPasswordAction, resetPasswordAction } from '@/lib/actions/auth';

// Server-action environment stubs — no Next.js request scope in tests.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const USER_ID = 'usr_reset_test';
const EMAIL = 'reset-me@example.com';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

/** Pull the raw token back out of the recorded outbox HTML (never stored). */
function tokenFromOutbox(body: string): string {
  const m = body.match(/reset-password\?token=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('no reset link found in outbox body');
  return m[1];
}

let db: AppDb;

beforeAll(async () => {
  process.env.VITEST = 'true';
  db = await getDb();
  await db
    .insert(T.users)
    .values({
      id: USER_ID,
      email: EMAIL,
      name: 'Reset Tester',
      passwordHash: await hashPassword('OldPass123!'),
      role: 'customer',
      status: 'active',
    })
    .onConflictDoNothing();
});

async function requestReset() {
  const fd = new FormData();
  fd.set('email', EMAIL);
  return forgotPasswordAction(null, fd);
}

describe('forgotPasswordAction', () => {
  it('records a hashed token and emails a link', async () => {
    const state = await requestReset();
    expect(state?.success).toBeTruthy();

    const rows = await db
      .select()
      .from(T.passwordResetTokens)
      .where(eq(T.passwordResetTokens.userId, USER_ID));
    expect(rows).toHaveLength(1);
    // Only the digest is persisted — never the raw token.
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].usedAt).toBeNull();
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

    const mail = await db
      .select()
      .from(T.emailOutbox)
      .where(eq(T.emailOutbox.template, 'password_reset'));
    expect(mail).toHaveLength(1);
    const token = tokenFromOutbox(mail[0].body);
    expect(rows[0].tokenHash).toBe(sha(token));
  });

  it('never reveals whether the email exists', async () => {
    const fd = new FormData();
    fd.set('email', 'nobody-here@example.com');
    const state = await forgotPasswordAction(null, fd);
    expect(state?.success).toBeTruthy();
    // Same copy as the real-account case, so the form can't be used to probe.
    expect(state?.success).toContain('If an account exists');
  });

  it('supersedes older links when a new one is issued', async () => {
    const before = await db
      .select()
      .from(T.passwordResetTokens)
      .where(eq(T.passwordResetTokens.userId, USER_ID));
    expect(before.length).toBeGreaterThan(0);
    expect(before.some((r) => !r.usedAt)).toBe(true);

    await requestReset();

    const after = await db
      .select()
      .from(T.passwordResetTokens)
      .where(eq(T.passwordResetTokens.userId, USER_ID));
    // Only the newest link stays live; everything older is retired.
    expect(after.filter((r) => !r.usedAt)).toHaveLength(1);
    expect(after.length).toBe(before.length + 1);
  });

  it('throttles repeated requests', async () => {
    // The action allows a few per window, then must refuse. Loop rather than
    // assume an exact count so the earlier cases can consume their own budget.
    let throttled = false;
    for (let i = 0; i < 8 && !throttled; i++) {
      const out = await requestReset();
      if (out?.error?.match(/Too many reset requests/)) throttled = true;
    }
    expect(throttled).toBe(true);
  });
});

describe('resetPasswordAction', () => {
  it('rejects an unknown token', async () => {
    const fd = new FormData();
    fd.set('token', 'not-a-real-token-value');
    fd.set('password', 'NewPass123!');
    fd.set('confirm', 'NewPass123!');
    const state = await resetPasswordAction(null, fd);
    expect(state?.error).toMatch(/expired or already been used/);
  });

  it('rejects a mismatched confirmation', async () => {
    const fd = new FormData();
    fd.set('token', 'whatever-value-here');
    fd.set('password', 'NewPass123!');
    fd.set('confirm', 'Different123!');
    const state = await resetPasswordAction(null, fd);
    expect(state?.fieldErrors?.confirm).toEqual(['Passwords do not match.']);
  });

  it('accepts a valid token once, then refuses reuse', async () => {
    // Issue a fresh link so this case owns a token no other test touched.
    const fdReq = new FormData();
    fdReq.set('email', EMAIL);
    await forgotPasswordAction(null, fdReq);

    const mail = await db
      .select()
      .from(T.emailOutbox)
      .where(eq(T.emailOutbox.template, 'password_reset'));
    const token = tokenFromOutbox(mail[mail.length - 1].body);

    const fd = new FormData();
    fd.set('token', token);
    fd.set('password', 'BrandNew123!');
    fd.set('confirm', 'BrandNew123!');
    const state = await resetPasswordAction(null, fd);
    expect(state?.success).toBeTruthy();
    expect(state?.redirectTo).toBe('/login');

    const user = await db.query.users.findFirst({ where: eq(T.users.email, EMAIL) });
    expect(await verifyPassword('BrandNew123!', user!.passwordHash)).toBe(true);
    expect(await verifyPassword('OldPass123!', user!.passwordHash)).toBe(false);

    // Single use: the same link must not work a second time.
    const replay = await resetPasswordAction(null, fd);
    expect(replay?.error).toMatch(/expired or already been used/);
  });
});

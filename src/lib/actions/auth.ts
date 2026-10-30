'use server';

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb } from '@/db';
import {
  agents,
  passwordResetTokens,
  providers,
  RESET_TOKEN_TTL_MS,
  users,
  type Role,
} from '@/db/schema';
import { hashPassword, passwordIssues, verifyPassword } from '@/lib/auth/password';
import {
  HOME_PAGES,
  LOGIN_PAGES,
  clientIp,
  createSession,
  destroySession,
  rateLimit,
} from '@/lib/auth/session';
import { logAudit } from '@/lib/audit';
import { sendPasswordResetEmail } from '@/lib/email';
import { appUrl } from '@/lib/seo';
import { newId, slugify, titleCase } from '@/lib/utils';

export type AuthFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Generic confirmation (e.g. "check your inbox") — never leaks existence. */
  success?: string;
  /** Where to send the user once the action finished cleanly. */
  redirectTo?: string;
} | null;

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/* ------------------------------- login -------------------------------- */

const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
  role: z.enum(['super_admin', 'provider', 'agent', 'customer']),
  next: z.string().optional(),
});

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    role: formData.get('role'),
    next: formData.get('next'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const email = parsed.data.email.toLowerCase();
  const ip = await clientIp();
  const wait = rateLimit(`login:${ip ?? 'anon'}:${email}`, 8, 5 * 60_000);
  if (wait > 0) {
    return { error: `Too many sign-in attempts. Try again in ${wait} seconds.` };
  }

  const db = await getDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  const passwordOk = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;

  if (!user || !passwordOk) {
    await logAudit({ action: 'auth.login_failed', entity: 'user', entityId: email, ip, meta: { known: Boolean(user) } });
    return { error: 'Incorrect email or password.' };
  }
  if (user.status !== 'active') {
    return { error: 'This account is suspended. Contact support@bookyourspa.net.' };
  }
  if (user.role !== parsed.data.role) {
    return {
      error: `That email belongs to the ${titleCase(user.role)} portal — sign in at ${LOGIN_PAGES[user.role]}.`,
    };
  }

  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id));
  await createSession(user);
  await logAudit({ actorId: user.id, actorRole: user.role, action: 'auth.login', entity: 'user', entityId: user.id, ip });

  const next = parsed.data.next;
  const safeNext =
    next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/api')
      ? next
      : HOME_PAGES[user.role];
  redirect(safeNext);
}

/* ------------------------------ register ------------------------------ */

const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .refine((v) => passwordIssues(v).length === 0, 'Use letters and numbers.');

const registerCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(80),
  email: z.email('Enter a valid email address.'),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  password: passwordSchema,
});

export async function registerCustomerAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = registerCustomerSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone') ?? '',
    password: formData.get('password'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const email = parsed.data.email.toLowerCase();
  const db = await getDb();
  const clash = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (clash) return { fieldErrors: { email: ['An account with this email already exists — sign in instead.'] } };

  const userId = newId('usr');
  await db.insert(users).values({
    id: userId,
    email,
    name: parsed.data.name,
    phone: parsed.data.phone || null,
    passwordHash: await hashPassword(parsed.data.password),
    role: 'customer',
    status: 'active',
  });
  await createSession({ id: userId, role: 'customer', name: parsed.data.name, email });
  await logAudit({ actorId: userId, actorRole: 'customer', action: 'auth.register', entity: 'user', entityId: userId });
  redirect('/account');
}

const registerProviderSchema = z.object({
  companyName: z.string().trim().min(2, 'Enter your spa or company name.').max(120),
  name: z.string().trim().min(2, 'Enter your name.').max(80),
  email: z.email('Enter a valid email address.'),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  country: z.enum(['ID', 'AE', 'SG', 'TH', 'MY', 'IN', 'GB', 'US', 'AU']),
  password: passwordSchema,
});

export async function registerProviderAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = registerProviderSchema.safeParse({
    companyName: formData.get('companyName'),
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone') ?? '',
    country: formData.get('country'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const email = parsed.data.email.toLowerCase();
  const db = await getDb();
  const clash = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (clash) return { fieldErrors: { email: ['An account with this email already exists — sign in instead.'] } };

  const userId = newId('usr');
  const providerId = newId('prv');
  let slug = slugify(parsed.data.companyName);
  const dupe = await db.query.providers.findFirst({ where: eq(providers.slug, slug) });
  if (dupe) slug = `${slug}-${providerId.slice(-4)}`;

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      email,
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      passwordHash: await hashPassword(parsed.data.password),
      role: 'provider',
      status: 'active',
    });
    await tx.insert(providers).values({
      id: providerId,
      ownerId: userId,
      name: parsed.data.companyName,
      slug,
      country: parsed.data.country,
      baseCurrency: parsed.data.country === 'ID' ? 'IDR' : 'AED',
      email,
      phone: parsed.data.phone || null,
      status: 'pending',
    });
  });

  await createSession({ id: userId, role: 'provider', name: parsed.data.name, email });
  await logAudit({
    actorId: userId,
    actorRole: 'provider',
    action: 'auth.register_provider',
    entity: 'provider',
    entityId: providerId,
  });
  redirect('/provider');
}

const registerAgentSchema = z.object({
  companyName: z.string().trim().min(2, 'Enter your company name.').max(120),
  name: z.string().trim().min(2, 'Enter your name.').max(80),
  email: z.email('Enter a valid email address.'),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  agentType: z.enum(['travel_agent', 'hotel_concierge', 'tour_operator', 'affiliate', 'reseller']),
  country: z.enum(['ID', 'AE', 'SG', 'TH', 'MY', 'IN', 'GB', 'US', 'AU']),
  website: z.string().trim().max(200).optional().or(z.literal('')),
  password: passwordSchema,
});

export async function registerAgentAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = registerAgentSchema.safeParse({
    companyName: formData.get('companyName'),
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone') ?? '',
    agentType: formData.get('agentType'),
    country: formData.get('country'),
    website: formData.get('website') ?? '',
    password: formData.get('password'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const email = parsed.data.email.toLowerCase();
  const db = await getDb();
  const clash = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (clash) return { fieldErrors: { email: ['An account with this email already exists — sign in instead.'] } };

  const userId = newId('usr');
  const agentId = newId('agt');
  let slug = slugify(parsed.data.companyName);
  const dupe = await db.query.agents.findFirst({ where: eq(agents.slug, slug) });
  if (dupe) slug = `${slug}-${agentId.slice(-4)}`;
  const referralCode = `${slugify(parsed.data.companyName).replace(/-/g, '').slice(0, 8).toUpperCase()}${agentId.slice(-3)}`.toUpperCase();

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      email,
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      passwordHash: await hashPassword(parsed.data.password),
      role: 'agent',
      status: 'active',
    });
    await tx.insert(agents).values({
      id: agentId,
      userId,
      companyName: parsed.data.companyName,
      slug,
      agentType: parsed.data.agentType,
      country: parsed.data.country,
      website: parsed.data.website || null,
      phone: parsed.data.phone || null,
      status: 'pending',
      referralCode,
    });
  });

  await createSession({ id: userId, role: 'agent', name: parsed.data.name, email });
  await logAudit({
    actorId: userId,
    actorRole: 'agent',
    action: 'auth.register_agent',
    entity: 'agent',
    entityId: agentId,
  });
  redirect('/agent');
}

/* ----------------------------- reset password -------------------------- */

/** We only ever store the digest — a leaked row can't be replayed as a link. */
function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const forgotSchema = z.object({
  email: z.email('Enter a valid email address.'),
});

/**
 * Always reports success so the form can't be used to probe which emails have
 * accounts. The link only lands when RESEND_API_KEY is configured; otherwise
 * the request is still recorded in the outbox for an operator to action.
 */
export async function forgotPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = forgotSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const email = parsed.data.email.toLowerCase();
  const ip = await clientIp();
  const wait = rateLimit(`forgot:${ip ?? 'anon'}:${email}`, 3, 15 * 60_000);
  if (wait > 0) {
    return { error: `Too many reset requests. Try again in ${Math.ceil(wait / 60)} minutes.` };
  }

  const db = await getDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });

  // Never reveal whether the address exists — issue nothing, say the same thing.
  if (user && user.status === 'active') {
    // One live link at a time: retire anything still outstanding.
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

    const token = randomBytes(32).toString('base64url');
    await db.insert(passwordResetTokens).values({
      id: newId('prt'),
      userId: user.id,
      tokenHash: hashResetToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });

    const resetUrl = await appUrl(`/reset-password?token=${encodeURIComponent(token)}`);
    const result = await sendPasswordResetEmail(user.email, user.name, resetUrl);
    await logAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'auth.password_reset_requested',
      entity: 'user',
      entityId: user.id,
      ip,
      meta: { delivery: result.status },
    });
  }

  return { success: `If an account exists for ${email}, a reset link is on its way. Check your inbox and spam folder.` };
}

const resetSchema = z.object({
  token: z.string().min(10, 'This reset link is not valid.'),
  password: passwordSchema,
  confirm: z.string().min(1, 'Confirm your new password.'),
});

export async function resetPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = resetSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  if (parsed.data.password !== parsed.data.confirm) {
    return { fieldErrors: { confirm: ['Passwords do not match.'] } };
  }

  const ip = await clientIp();
  const wait = rateLimit(`reset:${ip ?? 'anon'}`, 10, 15 * 60_000);
  if (wait > 0) return { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.` };

  const db = await getDb();
  const tokenHash = hashResetToken(parsed.data.token);
  const row = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.tokenHash, tokenHash),
    with: { user: true },
  });

  const usable =
    row &&
    !row.usedAt &&
    row.expiresAt > new Date() &&
    row.user &&
    row.user.status === 'active';

  if (!usable) {
    return { error: 'This reset link has expired or already been used. Request a new one.' };
  }

  // Consume the link first so it can never be replayed, even if the write below fails.
  const consumed = await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.id, row!.id), isNull(passwordResetTokens.usedAt)))
    .returning({ id: passwordResetTokens.id });
  if (!consumed.length) return { error: 'This reset link has already been used. Request a new one.' };

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.password) })
    .where(eq(users.id, row!.userId));

  await logAudit({
    actorId: row!.userId,
    actorRole: row!.user.role,
    action: 'auth.password_reset',
    entity: 'user',
    entityId: row!.userId,
    ip,
  });

  return {
    success: 'Your password has been updated. Sign in with your new password.',
    redirectTo: LOGIN_PAGES[row!.user.role],
  };
}

/* ------------------------------- logout ------------------------------- */

export async function logoutAction(): Promise<void> {
  const { getSession } = await import('@/lib/auth/session');
  const session = await getSession();
  await destroySession();
  if (session) {
    await logAudit({
      actorId: session.sub,
      actorRole: session.role,
      action: 'auth.logout',
      entity: 'user',
      entityId: session.sub,
    });
  }
  redirect('/');
}

export type { Role };

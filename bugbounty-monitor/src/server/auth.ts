import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { users, type User } from '@/db/schema';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth');
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password + session-cookie auth.
 *
 * scrypt is used rather than a native bcrypt/argon2 binding so the image stays
 * dependency-light and builds on any platform.
 */

const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  try {
    const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
    const expected = Buffer.from(hashHex, 'hex');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function secretKey(): Uint8Array {
  // Widen a short configured secret to a stable 32-byte key.
  return createHash('sha256').update(env().AUTH_SECRET).digest();
}

export interface SessionPayload {
  userId: number;
  email: string;
  role: string;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const ttlHours = env().SESSION_TTL_HOURS;
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlHours}h`)
    .sign(secretKey());
}

export async function readSessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.userId !== 'number' || typeof payload.email !== 'string') return null;
    return {
      userId: payload.userId,
      email: payload.email,
      role: typeof payload.role === 'string' ? payload.role : 'researcher',
    };
  } catch {
    return null;
  }
}

/** Current session from the request cookie, or null when signed out. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(env().AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return readSessionToken(token);
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) return null;
  const [user] = await db().select().from(users).where(eq(users.id, session.userId)).limit(1);
  return user ?? null;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(env().AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().NODE_ENV === 'production',
    path: '/',
    maxAge: env().SESSION_TTL_HOURS * 3600,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(env().AUTH_COOKIE_NAME);
}

export async function isAdmin(): Promise<boolean> {
  const session = await getSession();
  return session?.role === 'admin';
}

/* ------------------------------------------------------------------ */
/* Registration / login                                                */
/* ------------------------------------------------------------------ */

export interface AuthResult {
  ok: boolean;
  error?: string;
  user?: User;
  token?: string;
}

export async function register(email: string, password: string, name?: string): Promise<AuthResult> {
  const normalisedEmail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalisedEmail)) {
    return { ok: false, error: 'Enter a valid email address' };
  }
  if (password.length < 10) {
    return { ok: false, error: 'Password must be at least 10 characters' };
  }

  const [existing] = await db().select().from(users).where(eq(users.email, normalisedEmail)).limit(1);
  if (existing) return { ok: false, error: 'An account with that email already exists' };

  // The very first account is the administrator — otherwise a fresh install has
  // no way to reach the admin panel.
  const [{ count }] = await db().select({ count: sql<number>`count(*)::int` }).from(users);
  const role = count === 0 ? 'admin' : 'researcher';

  const [user] = await db()
    .insert(users)
    .values({
      email: normalisedEmail,
      name: name?.trim() || null,
      passwordHash: await hashPassword(password),
      role,
    })
    .returning();

  const token = await createSessionToken({ userId: user.id, email: user.email, role: user.role });
  log.info('User registered', { email: normalisedEmail, role });
  return { ok: true, user, token };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const normalisedEmail = email.trim().toLowerCase();
  const [user] = await db().select().from(users).where(eq(users.email, normalisedEmail)).limit(1);

  // Always run a hash comparison so a missing account and a wrong password take
  // the same time.
  const stored = user?.passwordHash ?? 'scrypt$00$00';
  const valid = await verifyPassword(password, stored);

  if (!user || !valid) return { ok: false, error: 'Incorrect email or password' };

  await db().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const token = await createSessionToken({ userId: user.id, email: user.email, role: user.role });
  return { ok: true, user, token };
}

/** Create the bootstrap admin from env vars, if configured and absent. */
export async function ensureBootstrapAdmin(): Promise<void> {
  const config = env();
  const email = config.BOOTSTRAP_ADMIN_EMAIL;
  const password = config.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;

  const normalised = email.trim().toLowerCase();
  const [existing] = await db().select().from(users).where(eq(users.email, normalised)).limit(1);
  if (existing) return;

  await db().insert(users).values({
    email: normalised,
    name: 'Administrator',
    passwordHash: await hashPassword(password),
    role: 'admin',
  });
  log.info('Bootstrap administrator created', { email: normalised });
}

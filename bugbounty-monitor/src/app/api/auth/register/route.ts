import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { fail, ok } from '@/server/api';
import { register, setSessionCookie } from '@/server/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!env().ALLOW_SIGNUP) return fail('Sign-up is disabled on this instance', 403);

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
  };
  if (!body.email || !body.password) return fail('Email and password are required', 400);

  const result = await register(body.email, body.password, body.name);
  if (!result.ok || !result.token) return fail(result.error ?? 'Registration failed', 400);

  await setSessionCookie(result.token);
  return ok({ data: { id: result.user!.id, email: result.user!.email, role: result.user!.role } });
}

import type { NextRequest } from 'next/server';
import { fail, ok } from '@/server/api';
import { login, setSessionCookie } from '@/server/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!body.email || !body.password) return fail('Email and password are required', 400);

  const result = await login(body.email, body.password);
  if (!result.ok || !result.token) return fail(result.error ?? 'Login failed', 401);

  await setSessionCookie(result.token);
  return ok({ data: { id: result.user!.id, email: result.user!.email, role: result.user!.role } });
}

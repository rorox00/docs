import { NextResponse } from 'next/server';
import { getSession } from './auth';

/** Shared helpers so every API route answers in the same shape. */

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export function paginated<T>(
  data: T[],
  page: number,
  pageSize: number,
  total: number,
): Paginated<T> {
  return {
    data,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

/**
 * Guard for mutating endpoints.
 *
 * Read endpoints are open so a researcher can script against their own
 * instance; anything that triggers crawling or changes data requires an
 * authenticated admin.
 */
export async function requireAdmin(): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: fail('Authentication required', 401) };
  }
  if (session.role !== 'admin') {
    return { ok: false, response: fail('Administrator role required', 403) };
  }
  return { ok: true };
}

export async function requireUser(): Promise<
  { ok: true; userId: number; role: string } | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session) return { ok: false, response: fail('Authentication required', 401) };
  return { ok: true, userId: session.userId, role: session.role };
}

/** Parse and clamp an integer query parameter. */
export function intParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min = 1,
  max = 1000,
): number {
  const raw = params.get(name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function csvParam(params: URLSearchParams, name: string): string[] | undefined {
  const raw = params.get(name);
  if (!raw) return undefined;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

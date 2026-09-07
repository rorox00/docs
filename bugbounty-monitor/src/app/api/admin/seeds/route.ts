import type { NextRequest } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { seedDomains } from '@/db/schema';
import { registrableDomain } from '@/lib/url';
import { fail, ok, requireAdmin } from '@/server/api';

export const dynamic = 'force-dynamic';

/** GET /api/admin/seeds — the domains discovery walks. */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const rows = await db().select().from(seedDomains).orderBy(asc(seedDomains.domain));
  return ok({ data: rows });
}

/** POST /api/admin/seeds — add domains. Body: { domains: string[] } */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { domains?: string[]; label?: string };
  const list = Array.isArray(body.domains) ? body.domains : [];
  const rows = list
    .map((raw) => registrableDomain(String(raw).trim()))
    .filter(Boolean)
    .map((domain) => ({ domain, label: body.label ?? null, enabled: true }));

  if (rows.length === 0) return fail('Provide a non-empty `domains` array', 400);

  const inserted = await db()
    .insert(seedDomains)
    .values(rows)
    .onConflictDoNothing({ target: seedDomains.domain })
    .returning();

  return ok({ data: { added: inserted.length, domains: inserted.map((r) => r.domain) } });
}

/** DELETE /api/admin/seeds?domain=example.com */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const domain = request.nextUrl.searchParams.get('domain');
  if (!domain) return fail('A `domain` parameter is required', 400);

  await db().delete(seedDomains).where(eq(seedDomains.domain, registrableDomain(domain)));
  return ok({ data: { ok: true } });
}

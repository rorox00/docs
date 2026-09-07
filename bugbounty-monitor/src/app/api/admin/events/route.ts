import type { NextRequest } from 'next/server';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { discoveryEvents } from '@/db/schema';
import { intParam, ok, paginated, requireAdmin } from '@/server/api';

export const dynamic = 'force-dynamic';

/** GET /api/admin/events — the crawler audit log, newest first. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const type = params.get('type');
  const page = intParam(params, 'page', 1);
  const pageSize = intParam(params, 'pageSize', 100, 1, 500);

  const where = type ? eq(discoveryEvents.eventType, type) : undefined;

  const rows = await db()
    .select()
    .from(discoveryEvents)
    .where(where)
    .orderBy(desc(discoveryEvents.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(discoveryEvents)
    .where(where);

  return ok(paginated(rows, page, pageSize, count));
}

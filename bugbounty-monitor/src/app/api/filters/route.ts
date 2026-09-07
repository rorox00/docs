import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { userFilters } from '@/db/schema';
import { fail, ok, requireUser } from '@/server/api';
import { programFilterSchema } from '@/server/filters';
import { allChannels } from '@/server/notifications/dispatcher';

export const dynamic = 'force-dynamic';

/** GET /api/filters — the user's saved notification subscriptions. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const rows = await db().select().from(userFilters).where(eq(userFilters.userId, auth.userId));
  return ok({
    data: rows,
    availableChannels: allChannels().map((c) => ({
      id: c.id,
      label: c.label,
      configured: c.isConfigured(),
      reason: c.unavailableReason?.() ?? null,
    })),
  });
}

/** POST /api/filters — create a subscription. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return fail('A filter `name` is required', 400);

  const criteria = programFilterSchema.safeParse(body.criteria ?? {});
  if (!criteria.success) return fail('Invalid filter criteria', 400, { issues: criteria.error.issues });

  const validChannelIds = new Set(allChannels().map((c) => c.id));
  const channels = Array.isArray(body.channels)
    ? (body.channels as unknown[]).filter((c): c is string => typeof c === 'string' && validChannelIds.has(c))
    : ['in_app'];

  const [row] = await db()
    .insert(userFilters)
    .values({
      userId: auth.userId,
      name: name.slice(0, 120),
      criteria: criteria.data as Record<string, unknown>,
      channels: channels.length > 0 ? channels : ['in_app'],
      onNewProgram: body.onNewProgram !== false,
      onScopeChange: body.onScopeChange === true,
      onRewardChange: body.onRewardChange === true,
      onProgramClosed: body.onProgramClosed === true,
    })
    .returning();

  return ok({ data: row }, { status: 201 });
}

/** DELETE /api/filters?id=1 */
export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const id = Number.parseInt(request.nextUrl.searchParams.get('id') ?? '', 10);
  if (!Number.isFinite(id)) return fail('A filter `id` is required', 400);

  await db()
    .delete(userFilters)
    .where(and(eq(userFilters.id, id), eq(userFilters.userId, auth.userId)));
  return ok({ data: { ok: true } });
}

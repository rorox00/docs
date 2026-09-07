import type { NextRequest } from 'next/server';
import { ok, requireUser } from '@/server/api';
import { markAllRead, markRead } from '@/server/notifications/dispatcher';

export const dynamic = 'force-dynamic';

/** POST /api/notifications/read — mark one notification, or all, as read. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { id?: number };
  if (body.id) await markRead(auth.userId, body.id);
  else await markAllRead(auth.userId);

  return ok({ data: { ok: true } });
}

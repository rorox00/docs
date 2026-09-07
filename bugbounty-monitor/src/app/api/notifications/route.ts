import type { NextRequest } from 'next/server';
import { intParam, ok, requireUser } from '@/server/api';
import { countUnread, listNotifications } from '@/server/notifications/dispatcher';

export const dynamic = 'force-dynamic';

/** GET /api/notifications — the signed-in user's in-app notifications. */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const limit = intParam(request.nextUrl.searchParams, 'limit', 50, 1, 200);
  const [items, unread] = await Promise.all([
    listNotifications(auth.userId, limit),
    countUnread(auth.userId),
  ]);
  return ok({ data: items, unread });
}

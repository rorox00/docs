import { pingDb } from '@/db';
import { getQueueCounts, isQueueAvailable } from '@/jobs/queue';
import { ok } from '@/server/api';

export const dynamic = 'force-dynamic';

/** GET /api/health — readiness probe for Docker/compose and uptime checks. */
export async function GET() {
  const [database, queue] = await Promise.all([pingDb(), isQueueAvailable()]);
  const counts = queue ? await getQueueCounts() : {};

  return ok(
    {
      status: database ? 'ok' : 'degraded',
      database,
      queue,
      queueCounts: counts,
      time: new Date().toISOString(),
    },
    { status: database ? 200 : 503 },
  );
}

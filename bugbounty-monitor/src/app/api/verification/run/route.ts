import type { NextRequest } from 'next/server';
import { enqueue, isQueueAvailable } from '@/jobs/queue';
import { ok, requireAdmin } from '@/server/api';
import { runVerification } from '@/pipeline/verify';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/verification/run — re-crawl programs that are due a check.
 * Body (optional): { programIds, limit, inline }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    programIds?: number[];
    limit?: number;
    inline?: boolean;
  };

  if (!body.inline && (await isQueueAvailable())) {
    const jobId = await enqueue('verification', {
      programIds: body.programIds,
      limit: body.limit,
      triggeredBy: 'api',
    });
    return ok({ queued: true, jobId });
  }

  const result = await runVerification({
    programIds: body.programIds,
    limit: body.limit ?? 10,
    triggeredBy: 'api',
  });
  return ok({
    queued: false,
    runId: result.runId,
    stats: { checked: result.checked, changed: result.changed, errors: result.errors },
  });
}

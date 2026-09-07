import type { NextRequest } from 'next/server';
import { enqueue, isQueueAvailable } from '@/jobs/queue';
import { ok, requireAdmin } from '@/server/api';
import { runDiscovery } from '@/pipeline/discovery';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/discovery/run — trigger a discovery run.
 *
 * Body (all optional): { domains, sourceIds, limitPerSource, ingestLimit, inline }
 * Queued by default; pass `inline: true` to run it in-request (useful when no
 * worker is deployed, but subject to the platform's request timeout).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    domains?: string[];
    sourceIds?: string[];
    limitPerSource?: number;
    ingestLimit?: number;
    inline?: boolean;
  };

  const payload = {
    domains: body.domains,
    sourceIds: body.sourceIds,
    limitPerSource: body.limitPerSource,
    ingestLimit: body.ingestLimit,
    triggeredBy: 'api',
  };

  if (!body.inline && (await isQueueAvailable())) {
    const jobId = await enqueue('discovery', payload);
    return ok({ queued: true, jobId });
  }

  const result = await runDiscovery({ ...payload, ingestLimit: body.ingestLimit ?? 25 });
  return ok({ queued: false, runId: result.runId, stats: result.stats });
}

import { ok, requireAdmin } from '@/server/api';
import { allSources } from '@/pipeline/discovery';
import { allChannels } from '@/server/notifications/dispatcher';
import { getCrawlerStats } from '@/server/repos/statsRepo';
import { getQueueCounts, isQueueAvailable } from '@/jobs/queue';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sources — which discovery sources and notification channels
 * are live, and why any are not. This is the page an operator checks first.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const config = env();
  const [stats, queueUp] = await Promise.all([getCrawlerStats(), isQueueAvailable()]);

  return ok({
    data: {
      sources: allSources().map((source) => ({
        id: source.id,
        label: source.label,
        kind: source.kind,
        enabled: source.isEnabled(),
        reason: source.disabledReason?.() ?? null,
      })),
      channels: allChannels().map((channel) => ({
        id: channel.id,
        label: channel.label,
        configured: channel.isConfigured(),
        reason: channel.unavailableReason?.() ?? null,
      })),
      crawler: {
        enabled: config.CRAWLER_ENABLED,
        respectRobots: config.CRAWLER_RESPECT_ROBOTS,
        userAgent: config.CRAWLER_USER_AGENT,
        perHostDelayMs: config.CRAWLER_PER_HOST_DELAY_MS,
        globalConcurrency: config.CRAWLER_GLOBAL_CONCURRENCY,
        requestTimeoutMs: config.CRAWLER_REQUEST_TIMEOUT_MS,
        minConfidenceToPublish: config.MIN_CONFIDENCE_TO_PUBLISH,
      },
      queue: { available: queueUp, counts: queueUp ? await getQueueCounts() : {} },
      stats,
    },
  });
}

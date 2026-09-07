import { runDiscovery } from '@/pipeline/discovery';
import { ingestCandidate } from '@/pipeline/ingest';
import { runVerification } from '@/pipeline/verify';
import { pruneHttpCache } from '@/pipeline/fetch/http';
import { notifyChanges, notifyNewPrograms } from '@/server/notifications/dispatcher';
import { sendDailyDigest } from '@/server/digest';
import { createLogger } from '@/lib/logger';
import type { SourceKind } from '@/lib/constants';
import type { JobName, JobPayloads } from '../queue';

const log = createLogger('jobs');

/**
 * Job handlers.
 *
 * Notification dispatch is deliberately part of the discovery/verification
 * handlers rather than a separate job: a program is only ever announced once,
 * in the same transaction-ish unit of work that created it.
 */
export const handlers: {
  [K in JobName]: (payload: JobPayloads[K]) => Promise<Record<string, unknown>>;
} = {
  async discovery(payload) {
    const result = await runDiscovery({
      domains: payload.domains,
      limitPerSource: payload.limitPerSource,
      ingestLimit: payload.ingestLimit,
      sourceIds: payload.sourceIds,
      triggeredBy: payload.triggeredBy ?? 'scheduler',
    });

    const createdIds = result.outcomes
      .filter((o) => o.status === 'created' && o.programId)
      .map((o) => o.programId!);
    if (createdIds.length > 0) await notifyNewPrograms(createdIds);

    await notifyPendingChanges();

    return { runId: result.runId, ...result.stats };
  },

  async verification(payload) {
    const result = await runVerification({
      programIds: payload.programIds,
      limit: payload.limit,
      triggeredBy: payload.triggeredBy ?? 'scheduler',
    });
    await notifyPendingChanges();
    return {
      runId: result.runId,
      checked: result.checked,
      changed: result.changed,
      errors: result.errors,
    };
  },

  async ingest(payload) {
    const outcome = await ingestCandidate(
      {
        url: payload.url,
        sourceKind: (payload.sourceKind as SourceKind) ?? 'manual',
        sourceDetail: payload.sourceDetail,
        priority: 100,
      },
      { force: payload.force ?? true, ignoreConfidenceFloor: true },
    );

    if (outcome.status === 'created' && outcome.programId) {
      await notifyNewPrograms([outcome.programId]);
    }
    await notifyPendingChanges();

    return { status: outcome.status, programId: outcome.programId ?? null, reason: outcome.reason ?? null };
  },

  async digest(payload) {
    const date = payload.date ? new Date(payload.date) : new Date();
    const summary = await sendDailyDigest(date);
    return { ...summary };
  },

  async maintenance() {
    const pruned = await pruneHttpCache(7);
    log.info('Maintenance complete', { prunedCacheRows: pruned });
    return { prunedCacheRows: pruned };
  },
};

/** Dispatch notifications for any change rows not yet announced. */
async function notifyPendingChanges(): Promise<void> {
  const { db } = await import('@/db');
  const { programChanges } = await import('@/db/schema');
  const { eq, sql } = await import('drizzle-orm');

  const pending = await db()
    .select({ id: programChanges.id })
    .from(programChanges)
    .where(eq(programChanges.notified, false))
    .orderBy(sql`${programChanges.detectedAt} desc`)
    .limit(500);

  if (pending.length > 0) await notifyChanges(pending.map((p) => p.id));
}

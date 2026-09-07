import { randomUUID } from 'node:crypto';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { programs, runs } from '@/db/schema';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { ingestCandidate, type IngestOutcome } from './ingest';

const log = createLogger('verify');

export interface VerifyRunResult {
  runId: string;
  checked: number;
  changed: number;
  unchanged: number;
  errors: number;
  outcomes: IngestOutcome[];
  durationMs: number;
}

export interface VerifyOptions {
  /** Verify these specific programs instead of the stale ones. */
  programIds?: number[];
  limit?: number;
  triggeredBy?: string;
  now?: Date;
}

/**
 * Re-crawl known programs to keep them current and to detect changes.
 *
 * Programs are picked least-recently-checked first, so the whole catalogue
 * rotates through verification without any one program being hammered.
 */
export async function runVerification(options: VerifyOptions = {}): Promise<VerifyRunResult> {
  const startedAt = Date.now();
  const runId = randomUUID();
  const now = options.now ?? new Date();
  const limit = options.limit ?? 50;

  await db().insert(runs).values({
    id: runId,
    kind: 'verification',
    status: 'running',
    startedAt: now,
    triggeredBy: options.triggeredBy ?? 'system',
  });

  const result: VerifyRunResult = {
    runId,
    checked: 0,
    changed: 0,
    unchanged: 0,
    errors: 0,
    outcomes: [],
    durationMs: 0,
  };

  try {
    const targets = await pickTargets(options.programIds, limit, now);
    log.info('Verification run started', { runId, targets: targets.length });

    for (const target of targets) {
      const outcome = await ingestCandidate(
        {
          url: target.programUrl,
          sourceKind: target.sourceKind ?? 'crawler',
          priority: 100,
          sourceDetail: 'Scheduled verification',
        },
        { runId, now, force: true, ignoreConfidenceFloor: true },
      );

      result.outcomes.push(outcome);
      result.checked += 1;
      if (outcome.status === 'updated') result.changed += 1;
      else if (outcome.status === 'unchanged' || outcome.status === 'created') result.unchanged += 1;
      else if (outcome.status === 'error') result.errors += 1;

      // A page that has vanished is a strong signal the program closed. We
      // record the check but never guess: status only moves on page evidence.
      if (outcome.status === 'error') {
        await db()
          .update(programs)
          .set({ lastCheckedAt: now })
          .where(eq(programs.id, target.id));
      }
    }

    await db()
      .update(runs)
      .set({
        status: 'completed',
        finishedAt: new Date(),
        stats: {
          checked: result.checked,
          changed: result.changed,
          unchanged: result.unchanged,
          errors: result.errors,
        },
      })
      .where(eq(runs.id, runId));

    log.info('Verification run finished', {
      runId,
      checked: result.checked,
      changed: result.changed,
      errors: result.errors,
    });
  } catch (error) {
    log.error('Verification run failed', { runId, error });
    await db()
      .update(runs)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      })
      .where(eq(runs.id, runId));
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}

async function pickTargets(programIds: number[] | undefined, limit: number, now: Date) {
  const staleBefore = new Date(now.getTime() - env().VERIFY_INTERVAL_HOURS * 3_600_000);

  const base = db()
    .select({
      id: programs.id,
      programUrl: programs.programUrl,
      sourceKind: sql<'crawler'>`'crawler'`.as('source_kind'),
    })
    .from(programs);

  if (programIds && programIds.length > 0) {
    return base.where(sql`${programs.id} = any(${programIds})`).limit(limit);
  }

  return base
    .where(
      and(
        eq(programs.falsePositive, false),
        eq(programs.hidden, false),
        or(isNull(programs.lastCheckedAt), lt(programs.lastCheckedAt, staleBefore)),
      ),
    )
    .orderBy(sql`${programs.lastCheckedAt} asc nulls first`)
    .limit(limit);
}


import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { candidates, discoveryEvents, runs, seedDomains } from '@/db/schema';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { hostnameOf, registrableDomain, safeNormalizeUrl } from '@/lib/url';
import { isAggregatorHost, isThirdPartyPlatformHost } from '@/lib/platforms';
import { ingestCandidate, type IngestOutcome } from '../ingest';
import type { CandidateUrl } from '../types';
import { CertificateTransparencySource } from './sources/crtsh';
import { RssSource } from './sources/rss';
import { SearchEngineSource } from './sources/searchEngine';
import { SeedListSource } from './sources/seeds';
import { SitemapSource } from './sources/sitemap';
import { WellKnownPathSource } from './sources/wellKnownPaths';
import type { DiscoverySource, DiscoveryRunContext } from './source';

const log = createLogger('discovery');

/** Every source the engine knows about. Adding one is a single line here. */
export function allSources(): DiscoverySource[] {
  return [
    new SeedListSource(),
    new WellKnownPathSource(),
    new SitemapSource(),
    new RssSource(),
    new SearchEngineSource(),
    new CertificateTransparencySource(),
  ];
}

export interface DiscoveryRunOptions {
  /** Restrict the run to these domains. Empty means "use the seed list". */
  domains?: string[];
  /** Maximum candidates each source may contribute. */
  limitPerSource?: number;
  /** Maximum candidates ingested in this run. */
  ingestLimit?: number;
  /** Only run these source ids. */
  sourceIds?: string[];
  triggeredBy?: string;
  now?: Date;
  /** Collect candidates without fetching/classifying them. */
  discoverOnly?: boolean;
}

export interface DiscoveryRunResult {
  runId: string;
  stats: {
    sourcesRun: number;
    candidatesFound: number;
    candidatesNew: number;
    ingested: number;
    created: number;
    updated: number;
    unchanged: number;
    rejected: number;
    errors: number;
    skipped: number;
  };
  outcomes: IngestOutcome[];
  durationMs: number;
}

/**
 * A full discovery run: gather candidates from every enabled source, store the
 * new ones, then ingest them in priority order.
 *
 * The two halves are separate on purpose — candidates persist between runs, so
 * a run that is cut short simply leaves work for the next one.
 */
export async function runDiscovery(options: DiscoveryRunOptions = {}): Promise<DiscoveryRunResult> {
  const startedAt = Date.now();
  const runId = randomUUID();
  const now = options.now ?? new Date();
  const config = env();

  const limitPerSource = options.limitPerSource ?? 200;
  const ingestLimit = options.ingestLimit ?? 100;

  const stats: DiscoveryRunResult['stats'] = {
    sourcesRun: 0,
    candidatesFound: 0,
    candidatesNew: 0,
    ingested: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    errors: 0,
    skipped: 0,
  };

  await db().insert(runs).values({
    id: runId,
    kind: 'discovery',
    status: 'running',
    startedAt: now,
    triggeredBy: options.triggeredBy ?? 'system',
  });

  log.info('Discovery run started', { runId, domains: options.domains?.length ?? 0 });

  try {
    if (!config.CRAWLER_ENABLED) {
      throw new Error('Crawler is disabled (CRAWLER_ENABLED=false)');
    }

    const domains = await resolveDomains(options.domains, ingestLimit);
    const context: DiscoveryRunContext = {
      runId,
      domains,
      limit: limitPerSource,
      now,
      log: (message, meta) => log.debug(message, { runId, ...meta }),
    };

    /* ---- 1. Gather candidates ---- */
    const sources = allSources().filter(
      (source) => (!options.sourceIds || options.sourceIds.includes(source.id)) && source.isEnabled(),
    );

    for (const source of sources) {
      try {
        const found = await source.discover(context);
        stats.sourcesRun += 1;
        stats.candidatesFound += found.length;
        const stored = await storeCandidates(found, runId);
        stats.candidatesNew += stored;
        log.info(`Source ${source.id} finished`, { found: found.length, stored });
      } catch (error) {
        log.error(`Source ${source.id} failed`, { error });
        await db().insert(discoveryEvents).values({
          runId,
          sourceKind: source.kind,
          eventType: 'error',
          outcome: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    /* ---- 2. Ingest pending candidates ---- */
    const outcomes: IngestOutcome[] = [];
    if (!options.discoverOnly) {
      const pending = await claimPendingCandidates(ingestLimit);

      for (const row of pending) {
        const input: CandidateUrl = {
          url: row.url,
          sourceKind: row.sourceKind,
          sourceDetail: row.sourceDetail ?? undefined,
          priority: row.priority,
        };
        const outcome = await ingestCandidate(input, { runId, now, candidateId: row.id });
        outcomes.push(outcome);
        stats.ingested += 1;
        switch (outcome.status) {
          case 'created': stats.created += 1; break;
          case 'updated': stats.updated += 1; break;
          case 'unchanged': stats.unchanged += 1; break;
          case 'rejected': stats.rejected += 1; break;
          case 'skipped': stats.skipped += 1; break;
          default: stats.errors += 1;
        }
      }
    }

    await db()
      .update(runs)
      .set({ status: 'completed', finishedAt: new Date(), stats })
      .where(eq(runs.id, runId));

    log.info('Discovery run finished', { runId, ...stats });
    return { runId, stats, outcomes, durationMs: Date.now() - startedAt };
  } catch (error) {
    log.error('Discovery run failed', { runId, error });
    await db()
      .update(runs)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        stats,
        error: error instanceof Error ? error.message : String(error),
      })
      .where(eq(runs.id, runId));
    return { runId, stats, outcomes: [], durationMs: Date.now() - startedAt };
  }
}

/* ------------------------------------------------------------------ */

/** Seed domains, least recently crawled first, unless the caller named some. */
async function resolveDomains(requested: string[] | undefined, limit: number): Promise<string[]> {
  if (requested && requested.length > 0) {
    return [...new Set(requested.map((d) => registrableDomain(d)).filter(Boolean))];
  }
  const rows = await db()
    .select({ domain: seedDomains.domain })
    .from(seedDomains)
    .where(eq(seedDomains.enabled, true))
    .orderBy(sql`${seedDomains.lastCrawledAt} asc nulls first`)
    .limit(Math.max(5, Math.ceil(limit / 6)));
  return rows.map((r) => r.domain);
}

/**
 * Store new candidates, ignoring ones we already know about.
 * Returns how many were genuinely new.
 */
export async function storeCandidates(found: CandidateUrl[], runId?: string): Promise<number> {
  if (found.length === 0) return 0;

  const rows = found
    .map((item) => {
      const normalized = safeNormalizeUrl(item.url);
      if (!normalized) return null;
      const host = hostnameOf(normalized);
      if (!host) return null;
      // Filter platforms and content farms here so they never enter the queue.
      if (isThirdPartyPlatformHost(host) || isAggregatorHost(host)) return null;
      return {
        url: normalized,
        normalizedUrl: normalized,
        domain: registrableDomain(host),
        sourceKind: item.sourceKind,
        sourceDetail: item.sourceDetail ?? null,
        status: 'pending' as const,
        priority: Math.round(item.priority),
        preScore: Math.round(item.priority),
        discoveredAt: new Date(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) return 0;

  // Deduplicate within the batch itself; `onConflictDoNothing` handles the
  // across-run case.
  const unique = new Map(rows.map((row) => [row.normalizedUrl, row]));

  const inserted = await db()
    .insert(candidates)
    .values([...unique.values()])
    .onConflictDoNothing({ target: candidates.normalizedUrl })
    .returning({ id: candidates.id, url: candidates.url });

  if (runId && inserted.length > 0) {
    await db().insert(discoveryEvents).values(
      inserted.slice(0, 500).map((row) => ({
        runId,
        candidateId: row.id,
        url: row.url,
        eventType: 'discovered',
        outcome: 'pending',
      })),
    );
  }

  return inserted.length;
}

/** Highest-priority pending candidates, marked as in-flight. */
async function claimPendingCandidates(limit: number) {
  const rows = await db()
    .select({
      id: candidates.id,
      url: candidates.url,
      sourceKind: candidates.sourceKind,
      sourceDetail: candidates.sourceDetail,
      priority: candidates.priority,
    })
    .from(candidates)
    .where(and(eq(candidates.status, 'pending'), sql`${candidates.attempts} < 3`))
    .orderBy(desc(candidates.priority), asc(candidates.discoveredAt))
    .limit(limit);

  if (rows.length > 0) {
    await db()
      .update(candidates)
      .set({ status: 'fetching' })
      .where(inArray(candidates.id, rows.map((r) => r.id)));
  }

  return rows;
}

/** Manual submission from the admin panel or the API. */
export async function submitCandidate(
  url: string,
  detail = 'Manually submitted',
): Promise<IngestOutcome> {
  const normalized = safeNormalizeUrl(url);
  if (!normalized) {
    return { url, status: 'error', reason: 'Malformed URL', durationMs: 0 };
  }

  await storeCandidates([{ url: normalized, sourceKind: 'manual', priority: 100, sourceDetail: detail }]);

  return ingestCandidate(
    { url: normalized, sourceKind: 'manual', priority: 100, sourceDetail: detail },
    { force: true, ignoreConfidenceFloor: true },
  );
}

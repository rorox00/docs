import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { candidates, discoveryEvents, programs, sources } from '@/db/schema';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { hostnameOf, safeNormalizeUrl } from '@/lib/url';
import { isThirdPartyPlatformHost } from '@/lib/platforms';
import { analyzePage } from './analyze';
import { chooseCanonicalUrl, findDuplicate } from './dedupe';
import { detectChanges, type DetectedChange } from './diff/changes';
import { fetchPage } from './fetch/http';
import { parseHtml } from './parse/page';
import { looksLikeSecurityTxt, parseSecurityTxt } from './parse/securityTxt';
import { scoreConfidence } from './score/confidence';
import {
  loadSnapshot,
  persistAssets,
  persistProgramRow,
  persistRewards,
  persistVersion,
  recordSource,
  refreshSearchVector,
  toSnapshot,
  upsertCompany,
  writeChanges,
} from '@/server/repos/programRepo';
import type { AnalysisContext, AnalyzedProgram, CandidateUrl } from './types';
import type { SourceKind } from '@/lib/constants';

const log = createLogger('ingest');

export interface IngestOutcome {
  url: string;
  status: 'created' | 'updated' | 'unchanged' | 'rejected' | 'error' | 'skipped';
  programId?: number;
  reason?: string;
  changes?: DetectedChange[];
  confidence?: number;
  durationMs: number;
}

export interface IngestOptions {
  runId?: string;
  /** Force a network fetch even when a cached copy is fresh. */
  force?: boolean;
  /** Bypass the confidence floor (used by manual admin verification). */
  ignoreConfidenceFloor?: boolean;
  now?: Date;
  candidateId?: number;
}

/**
 * Process one candidate URL end to end:
 *   fetch → parse → classify → self-hosted check → extract → score →
 *   dedupe → persist → diff → record sources and events.
 *
 * Never throws: every failure mode becomes an `IngestOutcome` and a
 * `discovery_events` row, so a bad page can never stop a run.
 */
export async function ingestCandidate(
  input: CandidateUrl,
  options: IngestOptions = {},
): Promise<IngestOutcome> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const normalized = safeNormalizeUrl(input.url);

  const finish = async (outcome: Omit<IngestOutcome, 'durationMs'>): Promise<IngestOutcome> => {
    const result = { ...outcome, durationMs: Date.now() - startedAt };
    await recordEvent(options.runId, result, input, options.candidateId);
    if (options.candidateId) await updateCandidate(options.candidateId, result);
    return result;
  };

  if (!normalized) {
    return finish({ url: input.url, status: 'error', reason: 'Malformed URL' });
  }

  const host = hostnameOf(normalized);
  if (!host) {
    return finish({ url: normalized, status: 'error', reason: 'Could not determine hostname' });
  }

  // Third-party platform URLs are rejected before we spend a request on them.
  if (isThirdPartyPlatformHost(host)) {
    return finish({
      url: normalized,
      status: 'rejected',
      reason: 'URL belongs to a third-party bug bounty platform',
    });
  }

  /* ---- Fetch ---- */
  const response = await fetchPage(normalized, { force: options.force });
  if (!response.ok || !response.body) {
    return finish({
      url: normalized,
      status: response.blockedByRobots ? 'skipped' : 'error',
      reason: response.blockedByRobots
        ? 'Skipped: disallowed by robots.txt'
        : (response.error ?? `HTTP ${response.status}`),
    });
  }

  /* ---- Parse ---- */
  const isSecurityTxt = looksLikeSecurityTxt(response.body);
  const page = isSecurityTxt
    ? securityTxtToPage(response.body, normalized, response.finalUrl)
    : parseHtml(response.body, normalized, response.finalUrl);

  const context: AnalysisContext = {
    sourceKind: input.sourceKind,
    sourceDetail: input.sourceDetail,
    hintedDate: input.hintedDate ?? null,
    hintedDateKind: input.hintedDateKind,
    httpLastModified: response.headerLastModified,
    securityTxtFound: isSecurityTxt,
    independentSignals: 1,
    now,
  };

  /* ---- Analyse ---- */
  const analysis = analyzePage(page, context);

  if (analysis.classification.isFalsePositive) {
    return finish({
      url: normalized,
      status: 'rejected',
      reason: analysis.classification.rejectionReason ?? 'Not a program page',
      confidence: analysis.confidence.score,
    });
  }

  if (!analysis.selfHosted.selfHosted) {
    return finish({
      url: normalized,
      status: 'rejected',
      reason:
        analysis.selfHosted.reasons.join('; ') || 'Program is not self-hosted',
      confidence: analysis.confidence.score,
    });
  }

  /* ---- Dedupe ---- */
  const duplicate = await findDuplicate(analysis);

  // A page corroborated by several sources is more trustworthy; recompute the
  // score with what we now know about how many signals point at it.
  const existingSourceKinds = duplicate
    ? await distinctSourceKinds(duplicate.programId)
    : new Set<SourceKind>();
  existingSourceKinds.add(input.sourceKind);

  const rescored = scoreConfidence({
    classification: analysis.classification,
    selfHosted: analysis.selfHosted,
    dates: analysis.dates,
    rewards: analysis.rewards,
    assets: analysis.assets,
    url: analysis.finalUrl,
    context: { ...context, independentSignals: existingSourceKinds.size },
    sourceKinds: [...existingSourceKinds],
  });
  const scored: AnalyzedProgram = { ...analysis, confidence: rescored };

  const floor = env().MIN_CONFIDENCE_TO_PUBLISH;
  if (!options.ignoreConfidenceFloor && !duplicate && rescored.score < floor) {
    return finish({
      url: normalized,
      status: 'rejected',
      reason: `Confidence ${rescored.score} is below the publication threshold of ${floor}`,
      confidence: rescored.score,
    });
  }

  /* ---- Persist ---- */
  try {
    const result = await persist(scored, duplicate?.programId ?? null, normalized, now);
    await recordSource(result.programId, input.sourceKind, normalized, input.sourceDetail);
    await refreshSearchVector(result.programId);

    return finish({
      url: normalized,
      status: result.created ? 'created' : result.changes.length > 0 ? 'updated' : 'unchanged',
      programId: result.programId,
      changes: result.changes,
      confidence: rescored.score,
      reason: duplicate?.reason,
    });
  } catch (error) {
    log.error('Failed to persist program', { url: normalized, error });
    return finish({
      url: normalized,
      status: 'error',
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ------------------------------------------------------------------ */

interface PersistResult {
  programId: number;
  created: boolean;
  changes: DetectedChange[];
}

async function persist(
  analysis: AnalyzedProgram,
  existingId: number | null,
  discoveredUrl: string,
  now: Date,
): Promise<PersistResult> {
  const companyId = await upsertCompany(analysis);

  const existing = existingId
    ? ((await db().select().from(programs).where(eq(programs.id, existingId)).limit(1))[0] ?? null)
    : null;

  const previousSnapshot = existing ? await loadSnapshot(existing.id) : null;
  const previousVersionId = existing?.currentVersionId ?? null;

  // When merging, keep whichever URL is the better canonical one.
  const canonicalUrl = existing
    ? chooseCanonicalUrl([existing.programUrl, discoveredUrl])
    : discoveredUrl;

  const programId = await persistProgramRow(companyId, analysis, canonicalUrl, existing, now);

  await persistAssets(programId, analysis, now);
  await persistRewards(programId, analysis, now);

  const contentChanged = !existing || existing.contentHash !== analysis.contentHash;
  let versionId: number | null = previousVersionId;
  let changes: DetectedChange[] = [];

  if (contentChanged) {
    versionId = await persistVersion(programId, analysis, now);

    if (previousSnapshot) {
      changes = detectChanges(previousSnapshot, toSnapshot(analysis));
      await writeChanges(programId, changes, previousVersionId, versionId, now);
    } else {
      // First sighting: one "discovered" entry so the timeline always starts
      // with something.
      changes = [
        {
          changeType: 'program_discovered',
          severity: 'info',
          summary: 'Program discovered',
          previousValue: null,
          newValue: analysis.programName,
        },
      ];
      await writeChanges(programId, changes, null, versionId, now);
    }
  }

  // If the canonical URL moved, keep the old one as a source.
  if (existing && existing.programUrl !== canonicalUrl) {
    await recordSource(programId, 'crawler', existing.programUrl, 'Previous canonical URL');
  }

  return { programId, created: !existing, changes };
}

async function distinctSourceKinds(programId: number): Promise<Set<SourceKind>> {
  const rows = await db()
    .selectDistinct({ kind: sources.kind })
    .from(sources)
    .where(eq(sources.programId, programId));
  return new Set(rows.map((r) => r.kind));
}

/**
 * Represent a security.txt as a `ParsedPage` so the same analysis path applies.
 * The synthesised text keeps the fields that carry meaning for classification.
 */
function securityTxtToPage(body: string, url: string, finalUrl: string) {
  const parsed = parseSecurityTxt(body, finalUrl);
  const lines = [
    'Security.txt vulnerability disclosure information.',
    'This organisation publishes a security contact for reporting vulnerabilities.',
    ...parsed.contact.map((c) => `Contact: ${c}`),
    ...parsed.policy.map((p) => `Policy: ${p}`),
    ...parsed.acknowledgments.map((a) => `Acknowledgments (hall of fame): ${a}`),
    ...parsed.encryption.map((e) => `Encryption (PGP key): ${e}`),
    'Please report any suspected security vulnerability using the contact above.',
  ];
  const text = lines.join('\n');

  return {
    url,
    finalUrl,
    title: 'security.txt',
    metaDescription: null,
    canonicalUrl: parsed.canonical[0] ?? null,
    lang: parsed.preferredLanguages[0] ?? null,
    text,
    lowerText: text.toLowerCase(),
    headings: [{ level: 1, text: 'security.txt' }],
    links: [...parsed.policy, ...parsed.acknowledgments, ...parsed.encryption]
      .filter((u) => /^https?:/i.test(u))
      .map((href) => ({ href, text: '', rel: null })),
    jsonLd: [],
    meta: {},
    lists: [],
    tables: [],
    emails: parsed.contact
      .filter((c) => c.toLowerCase().startsWith('mailto:') || c.includes('@'))
      .map((c) => c.replace(/^mailto:/i, '').toLowerCase()),
    timeElements: [],
  };
}

/* ------------------------- bookkeeping ---------------------------- */

async function recordEvent(
  runId: string | undefined,
  outcome: IngestOutcome,
  input: CandidateUrl,
  candidateId?: number,
): Promise<void> {
  const eventType =
    outcome.status === 'created' || outcome.status === 'updated' || outcome.status === 'unchanged'
      ? 'accepted'
      : outcome.status;

  try {
    await db().insert(discoveryEvents).values({
      runId: runId ?? null,
      programId: outcome.programId ?? null,
      candidateId: candidateId ?? null,
      sourceKind: input.sourceKind,
      url: outcome.url,
      eventType,
      outcome: outcome.status,
      message: outcome.reason ?? null,
      details: outcome.changes?.length
        ? { changes: outcome.changes.map((c) => c.summary), confidence: outcome.confidence }
        : { confidence: outcome.confidence },
      durationMs: outcome.durationMs,
    });
  } catch (error) {
    log.warn('Failed to record discovery event', { error });
  }
}

async function updateCandidate(candidateId: number, outcome: IngestOutcome): Promise<void> {
  const status =
    outcome.status === 'created' || outcome.status === 'updated' || outcome.status === 'unchanged'
      ? 'accepted'
      : outcome.status === 'rejected'
        ? 'rejected'
        : outcome.status === 'skipped'
          ? 'rejected'
          : 'error';

  try {
    await db()
      .update(candidates)
      .set({
        status,
        programId: outcome.programId ?? null,
        processedAt: new Date(),
        lastError: outcome.status === 'error' ? (outcome.reason ?? null) : null,
        rejectionReason: status === 'rejected' ? (outcome.reason ?? null) : null,
        attempts: sql`${candidates.attempts} + 1`,
      })
      .where(eq(candidates.id, candidateId));
  } catch (error) {
    log.warn('Failed to update candidate', { candidateId, error });
  }
}

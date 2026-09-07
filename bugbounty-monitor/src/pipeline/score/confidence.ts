import { SOURCE_RELIABILITY, confidenceBand } from '@/lib/constants';
import { daysSince } from '@/lib/dates';
import { isSecuritySubdomain, pathnameOf } from '@/lib/url';
import type {
  AnalysisContext,
  ClassificationResult,
  ConfidenceFactor,
  ConfidenceResult,
  ExtractedAsset,
  ExtractedDates,
  ExtractedRewards,
  SelfHostedResult,
} from '../types';

/**
 * Confidence scoring.
 *
 * The score answers one question: *how sure are we that this is a real,
 * self-hosted program, described accurately?* It is additive and every factor
 * is recorded so the UI can explain the number instead of asserting it.
 *
 * Bands: 95-100 Very High | 80-94 High | 60-79 Medium | 40-59 Low | 0-39 Unverified
 */

export interface ConfidenceInput {
  classification: ClassificationResult;
  selfHosted: SelfHostedResult;
  dates: ExtractedDates;
  rewards: ExtractedRewards;
  assets: ExtractedAsset[];
  url: string;
  context: AnalysisContext;
  /** Distinct source kinds that independently pointed at this page. */
  sourceKinds?: string[];
}

/** Paths that a company only creates when it runs a program. */
const STRONG_PATH_PATTERN =
  /^\/(?:\.well-known\/security\.txt|security\.txt|bug-?bounty|bugbounty|bug-bounty-program|responsible-disclosure|vulnerability-disclosure|security-research(?:ers)?|security\/(?:bug-?bounty|vulnerability-disclosure|responsible-disclosure|disclosure|report))/i;

const MODERATE_PATH_PATTERN = /^\/(?:security|trust|legal\/security|about\/security|help\/security)/i;

export function scoreConfidence(input: ConfidenceInput): ConfidenceResult {
  const factors: ConfidenceFactor[] = [];
  const add = (id: string, label: string, points: number) => {
    if (points !== 0) factors.push({ id, label, points });
  };

  const now = input.context.now ?? new Date();

  /* --- Is it a program at all? (0-30) --- */
  const programPoints = Math.round(input.classification.programScore * 30);
  add('program_evidence', 'Page describes a vulnerability reporting process', programPoints);

  if (input.classification.matchedSignals.includes('policy_terms')) {
    add('policy_language', 'Contains explicit disclosure policy terms', 6);
  }
  if (input.classification.matchedSignals.includes('security_contact')) {
    add('security_contact', 'Publishes a dedicated security contact', 6);
  }

  /* --- Self-hosted (0-16) --- */
  if (input.selfHosted.selfHosted) {
    add('self_hosted', 'Published on the organisation’s own domain', 10);
    if (isSecuritySubdomain(input.url)) {
      add('security_subdomain', 'Served from a dedicated security subdomain', 3);
    }
    const path = pathnameOf(input.url);
    if (STRONG_PATH_PATTERN.test(path)) {
      add('canonical_path', 'Uses a canonical program URL path', 3);
    } else if (MODERATE_PATH_PATTERN.test(path)) {
      add('security_path', 'Published under a security path', 1);
    }
  } else {
    add('not_self_hosted', 'Not a self-hosted program', -25);
  }

  /* --- Program language quality (0-12) --- */
  if (input.classification.programType === 'bug_bounty') {
    add('bounty_language', 'Language clearly indicates an active bounty program', 6);
  } else if (input.classification.programType !== 'unknown') {
    add('program_type_identified', 'Program type could be identified', 3);
  }
  if (input.classification.status === 'active') {
    add('status_active', 'Page states the program is active', 4);
  } else if (input.classification.status === 'inactive') {
    add('status_inactive', 'Page states the program is closed or paused', -6);
  }

  /* --- Reward information (0-10) --- */
  if (input.rewards.minBounty !== null || input.rewards.maxBounty !== null) {
    add('reward_amounts', 'Explicit bounty amounts published', 7);
  } else if (input.rewards.kind !== 'unknown') {
    add('reward_kind', 'Reward model is stated', 3);
  }
  if (input.rewards.tiers.length >= 2) {
    add('reward_tiers', 'Structured reward tiers published', 3);
  }

  /* --- Scope information (0-10) --- */
  const inScope = input.assets.filter((a) => a.inScope);
  const outOfScope = input.assets.filter((a) => !a.inScope);
  if (inScope.length >= 3) {
    add('scope_detailed', `Detailed scope published (${inScope.length} assets)`, 7);
  } else if (inScope.length > 0) {
    add('scope_present', 'Scope information present', 4);
  }
  if (outOfScope.length > 0) {
    add('out_of_scope', 'Out-of-scope exclusions published', 3);
  }

  /* --- Date evidence (0-12) --- */
  if (input.dates.launchDate) {
    add('explicit_launch_date', 'Launch date stated on the page', 8);
    const age = daysSince(input.dates.launchDate, now);
    if (age >= 0 && age <= 30) {
      add('recently_launched', 'Program launched within the last 30 days', 4);
    }
  } else if (input.dates.publishedDate) {
    add('publication_date', 'Publication date available in page metadata', 4);
  }
  if (input.dates.modifiedDate && daysSince(input.dates.modifiedDate, now) <= 90) {
    add('recently_modified', 'Page updated within the last 90 days', 2);
  }

  /* --- Discovery evidence (0-12) --- */
  const sourceKinds = new Set(input.sourceKinds ?? [input.context.sourceKind]);
  const bestReliability = Math.max(
    ...[...sourceKinds].map((k) => SOURCE_RELIABILITY[k as keyof typeof SOURCE_RELIABILITY] ?? 0.5),
  );
  add(
    'source_reliability',
    `Discovered via ${[...sourceKinds].join(', ')}`,
    Math.round(bestReliability * 6),
  );

  const independent = Math.max(input.context.independentSignals ?? 1, sourceKinds.size);
  if (independent >= 3) {
    add('multi_signal', `Corroborated by ${independent} independent discovery signals`, 6);
  } else if (independent === 2) {
    add('multi_signal', 'Corroborated by 2 independent discovery signals', 3);
  }

  if (input.context.securityTxtFound) {
    add('security_txt', 'A security.txt exists for this domain', 4);
  }

  /* --- Penalties --- */
  if (input.selfHosted.hasThirdPartyProgram && input.selfHosted.selfHosted) {
    // Not disqualifying — the page is still self-hosted — but a parallel
    // platform program means the self-hosted page may be a summary.
    add('third_party_parallel', 'A third-party platform program also exists', -3);
  }
  if (input.classification.isFalsePositive) {
    add('false_positive', 'Rejected by the false-positive filter', -60);
  }

  const raw = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  return { score, band: confidenceBand(score), factors };
}

/**
 * Is this program "newly launched"?
 *
 * Answered from the launch date when we have one, otherwise from first
 * discovery — and the caller is told which, so the UI never presents a
 * discovery date as a launch date.
 */
export function assessNewness(
  launchDate: Date | null,
  firstSeenAt: Date,
  windowDays: number,
  now = new Date(),
): { isNew: boolean; basis: 'launch_date' | 'first_seen'; ageDays: number } {
  if (launchDate) {
    const ageDays = daysSince(launchDate, now);
    return { isNew: ageDays >= 0 && ageDays <= windowDays, basis: 'launch_date', ageDays };
  }
  const ageDays = daysSince(firstSeenAt, now);
  return { isNew: ageDays >= 0 && ageDays <= windowDays, basis: 'first_seen', ageDays };
}

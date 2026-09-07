import type { SourceKind } from '@/lib/constants';
import type { CandidateUrl } from '../types';

/**
 * A discovery source proposes URLs that might be program pages.
 *
 * Sources never decide whether something *is* a program — that is the
 * classifier's job. Keeping the two apart is what lets new sources be added
 * without touching accuracy-critical code.
 */
export interface DiscoverySource {
  readonly id: string;
  readonly kind: SourceKind;
  /** Human label used in the admin UI. */
  readonly label: string;
  /** False when the source needs configuration the deployment has not supplied. */
  isEnabled(): boolean;
  /** Why the source is unavailable, shown in the admin panel. */
  disabledReason?(): string | null;
  /**
   * Produce candidate URLs. Implementations must be polite: they share the
   * global fetcher and should bound their own work.
   */
  discover(context: DiscoveryRunContext): Promise<CandidateUrl[]>;
}

export interface DiscoveryRunContext {
  runId: string;
  /** Domains this run should focus on, when the caller supplied any. */
  domains: string[];
  /** Upper bound on candidates a single source should return. */
  limit: number;
  now: Date;
  log: (message: string, meta?: Record<string, unknown>) => void;
}

export function candidate(
  url: string,
  kind: SourceKind,
  priority: number,
  detail?: string,
  extra?: Partial<CandidateUrl>,
): CandidateUrl {
  return { url, sourceKind: kind, priority, sourceDetail: detail, ...extra };
}

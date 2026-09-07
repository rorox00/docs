/** Shared domain vocabulary. Kept in one place so DB checks and UI agree. */

export const PROGRAM_TYPES = [
  'bug_bounty',
  'vdp',
  'responsible_disclosure',
  'security_research',
  'unknown',
] as const;
export type ProgramType = (typeof PROGRAM_TYPES)[number];

export const PROGRAM_TYPE_LABELS: Record<ProgramType, string> = {
  bug_bounty: 'Bug Bounty',
  vdp: 'Vulnerability Disclosure Program',
  responsible_disclosure: 'Responsible Disclosure',
  security_research: 'Security Research Program',
  unknown: 'Unknown',
};

export const PROGRAM_TYPE_SHORT: Record<ProgramType, string> = {
  bug_bounty: 'Bug Bounty',
  vdp: 'VDP',
  responsible_disclosure: 'Responsible Disclosure',
  security_research: 'Security Research',
  unknown: 'Unknown',
};

export const PROGRAM_STATUSES = ['active', 'inactive', 'unknown'] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

/** How a program compensates researchers. `unknown` means "we could not tell". */
export const REWARD_KINDS = [
  'paid',
  'hall_of_fame',
  'swag',
  'none',
  'unknown',
] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

export const REWARD_KIND_LABELS: Record<RewardKind, string> = {
  paid: 'Paid',
  hall_of_fame: 'Hall of Fame only',
  swag: 'Swag only',
  none: 'No reward',
  unknown: 'Reward unknown',
};

export const ASSET_CATEGORIES = [
  'web',
  'api',
  'android',
  'ios',
  'mobile',
  'cloud',
  'wildcard',
  'domain',
  'ip_range',
  'desktop',
  'hardware',
  'source_code',
  'other',
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const CHANGE_TYPES = [
  'program_discovered',
  'scope_expanded',
  'scope_reduced',
  'asset_added',
  'asset_removed',
  'reward_increased',
  'reward_decreased',
  'reward_tier_added',
  'reward_tier_removed',
  'program_closed',
  'program_reopened',
  'policy_changed',
  'contact_changed',
  'program_type_changed',
  'status_changed',
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_SEVERITIES = ['info', 'low', 'medium', 'high'] as const;
export type ChangeSeverity = (typeof CHANGE_SEVERITIES)[number];

export const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  program_discovered: 'Program discovered',
  scope_expanded: 'Scope expanded',
  scope_reduced: 'Scope reduced',
  asset_added: 'Asset added',
  asset_removed: 'Asset removed',
  reward_increased: 'Reward increased',
  reward_decreased: 'Reward decreased',
  reward_tier_added: 'New bounty tier',
  reward_tier_removed: 'Bounty tier removed',
  program_closed: 'Program closed',
  program_reopened: 'Program reopened',
  policy_changed: 'Policy changed',
  contact_changed: 'Contact / reporting method changed',
  program_type_changed: 'Program type changed',
  status_changed: 'Status changed',
};

/**
 * Discovery source kinds, ordered roughly by how much we trust what they say.
 * `reliability` is used both for confidence scoring and for UI labelling.
 */
export const SOURCE_KINDS = [
  'security_txt',
  'well_known_path',
  'sitemap',
  'rss',
  'crawler',
  'search_engine',
  'certificate_transparency',
  'seed_list',
  'manual',
  'api',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_RELIABILITY: Record<SourceKind, number> = {
  security_txt: 0.95,
  well_known_path: 0.8,
  sitemap: 0.75,
  manual: 0.95,
  seed_list: 0.7,
  crawler: 0.65,
  rss: 0.6,
  api: 0.6,
  search_engine: 0.55,
  certificate_transparency: 0.45,
};

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  security_txt: 'security.txt',
  well_known_path: 'Well-known path probe',
  sitemap: 'Sitemap',
  rss: 'RSS/Atom feed',
  crawler: 'Website crawler',
  search_engine: 'Search engine',
  certificate_transparency: 'Certificate transparency',
  seed_list: 'Seed list',
  manual: 'Manual entry',
  api: 'API submission',
};

export const CANDIDATE_STATUSES = [
  'pending',
  'fetching',
  'accepted',
  'rejected',
  'error',
  'needs_review',
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CONFIDENCE_BANDS = [
  { min: 95, label: 'Very High' },
  { min: 80, label: 'High' },
  { min: 60, label: 'Medium' },
  { min: 40, label: 'Low' },
  { min: 0, label: 'Unverified' },
] as const;

export function confidenceBand(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'Unknown';
  for (const band of CONFIDENCE_BANDS) {
    if (score >= band.min) return band.label;
  }
  return 'Unverified';
}

/** Value used across the UI whenever a field could not be established. */
export const UNKNOWN_LABEL = 'Unknown';
export const NOT_SPECIFIED_LABEL = 'Not specified';
export const UNVERIFIED_LABEL = 'Could not verify';

import { z } from 'zod';
import { PROGRAM_STATUSES, PROGRAM_TYPES, REWARD_KINDS } from '@/lib/constants';

/**
 * The single definition of "how programs can be filtered".
 *
 * The dashboard, the REST API and saved notification subscriptions all parse
 * into this shape, so a filter a researcher builds in the UI is exactly what
 * they can subscribe to.
 */

export const SORT_OPTIONS = [
  'newest',
  'oldest',
  'recently_verified',
  'recently_changed',
  'highest_bounty',
  'most_assets',
  'highest_confidence',
  'company',
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const SORT_LABELS: Record<SortOption, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  recently_verified: 'Recently verified',
  recently_changed: 'Recently changed',
  highest_bounty: 'Highest bounty',
  most_assets: 'Most assets',
  highest_confidence: 'Highest confidence',
  company: 'Company A–Z',
};

/** Presets for the "New Programs" date buttons. */
export const DATE_PRESETS = [
  { id: 'today', label: 'Today', days: 0 },
  { id: '24h', label: 'Last 24 hours', days: 1 },
  { id: '3d', label: 'Last 3 days', days: 3 },
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '14d', label: 'Last 14 days', days: 14 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: 'all', label: 'All time', days: null },
] as const;

const boolish = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === '') return undefined;
    if (typeof v === 'boolean') return v;
    if (/^(1|true|yes|on)$/i.test(v)) return true;
    if (/^(0|false|no|off)$/i.test(v)) return false;
    return undefined;
  });

const numish = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === '') return undefined;
    const n = typeof v === 'number' ? v : Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  });

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.enum(values))])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return undefined;
      const list = Array.isArray(v) ? v : v.split(',').map((s) => s.trim());
      const allowed = list.filter((item): item is T[number] => (values as readonly string[]).includes(item));
      return allowed.length > 0 ? allowed : undefined;
    });

export const programFilterSchema = z.object({
  /** Free-text query across company, domain, assets, technologies. */
  q: z.string().trim().max(200).optional(),

  /** Discovery window in days; `days=7` means "first seen in the last 7 days". */
  days: numish,
  /** Launch-date window in days. */
  launchedWithinDays: numish,
  /** Custom range, ISO dates. */
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  /** Which date field the range applies to. */
  dateField: z.enum(['discovered', 'launch', 'verified', 'changed']).optional(),

  type: csv(PROGRAM_TYPES),
  status: csv(PROGRAM_STATUSES),
  rewardKind: csv(REWARD_KINDS),

  paid: boolish,
  selfHostedOnly: boolish,
  hasApi: boolish,
  hasAndroid: boolish,
  hasIos: boolish,
  hasMobile: boolish,
  hasWildcard: boolish,
  hasCloud: boolish,
  hasWeb: boolish,
  recentlyChanged: boolish,
  isNew: boolish,
  hasThirdParty: boolish,

  minBounty: numish,
  maxBounty: numish,
  minConfidence: numish,
  maxConfidence: numish,
  minAssets: numish,

  country: z.string().trim().max(64).optional(),
  domain: z.string().trim().max(253).optional(),
  technology: z.string().trim().max(64).optional(),
  asset: z.string().trim().max(253).optional(),

  /** Operator views. */
  includeHidden: boolish,
  includeFalsePositives: boolish,
  reviewed: boolish,

  sort: z.enum(SORT_OPTIONS).optional(),
  page: numish,
  pageSize: numish,
});

export type ProgramFilter = z.infer<typeof programFilterSchema>;

/** Parse filters straight from a URLSearchParams (API and UI share this). */
export function parseFilters(params: URLSearchParams | Record<string, string | undefined>): ProgramFilter {
  const record =
    params instanceof URLSearchParams ? Object.fromEntries(params.entries()) : params;
  const parsed = programFilterSchema.safeParse(record);
  return parsed.success ? parsed.data : {};
}

export function normalisePaging(filter: ProgramFilter): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(filter.pageSize ?? 25)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Serialise a filter back into a query string for links and saved filters. */
export function toQueryString(filter: ProgramFilter): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params.toString();
}

/** Human summary of an active filter set, shown above the results table. */
export function describeFilter(filter: ProgramFilter): string[] {
  const parts: string[] = [];
  if (filter.q) parts.push(`search "${filter.q}"`);
  if (filter.days !== undefined) {
    parts.push(filter.days === 0 ? 'discovered today' : `discovered in the last ${filter.days} days`);
  }
  if (filter.launchedWithinDays !== undefined) {
    parts.push(`launched in the last ${filter.launchedWithinDays} days`);
  }
  if (filter.from || filter.to) parts.push(`${filter.from ?? '…'} → ${filter.to ?? '…'}`);
  if (filter.type) parts.push(filter.type.join(' / '));
  if (filter.status) parts.push(`status ${filter.status.join(' / ')}`);
  if (filter.paid) parts.push('paid');
  if (filter.hasApi) parts.push('API in scope');
  if (filter.hasAndroid) parts.push('Android in scope');
  if (filter.hasIos) parts.push('iOS in scope');
  if (filter.hasMobile) parts.push('mobile in scope');
  if (filter.hasWildcard) parts.push('wildcard domain');
  if (filter.hasCloud) parts.push('cloud assets');
  if (filter.minBounty !== undefined) parts.push(`bounty ≥ ${filter.minBounty}`);
  if (filter.maxBounty !== undefined) parts.push(`bounty ≤ ${filter.maxBounty}`);
  if (filter.minConfidence !== undefined) parts.push(`confidence ≥ ${filter.minConfidence}`);
  if (filter.country) parts.push(`country ${filter.country}`);
  if (filter.technology) parts.push(`tech ${filter.technology}`);
  if (filter.recentlyChanged) parts.push('recently changed');
  return parts;
}

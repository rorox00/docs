import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import {
  companies,
  programAssets,
  programChanges,
  programRewards,
  programVersions,
  programs,
  sources,
} from '@/db/schema';
import { subDays } from '@/lib/dates';
import { normalisePaging, type ProgramFilter, type SortOption } from '../filters';

/**
 * Read model for the dashboard and API.
 *
 * All filtering funnels through `buildConditions` so the UI, the API and
 * notification matching cannot drift apart.
 */

export interface ProgramListItem {
  id: number;
  name: string;
  programUrl: string;
  companyId: number;
  companyName: string;
  companyDomain: string;
  companyWebsite: string | null;
  countryCode: string | null;
  countryName: string | null;
  programType: string;
  status: string;
  selfHosted: boolean;
  hasThirdPartyProgram: boolean;
  thirdPartyPlatforms: string[];
  rewardKind: string;
  minBounty: number | null;
  maxBounty: number | null;
  bountyCurrency: string | null;
  launchDate: Date | null;
  launchDateSource: string | null;
  publishedDate: Date | null;
  modifiedDate: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastVerifiedAt: Date | null;
  lastChangedAt: Date | null;
  confidenceScore: number;
  isNew: boolean;
  summary: string | null;
  technologies: string[];
  hasApi: boolean;
  hasAndroid: boolean;
  hasIos: boolean;
  hasMobile: boolean;
  hasWildcard: boolean;
  hasCloud: boolean;
  hasWeb: boolean;
  assetCount: number;
  reviewed: boolean;
  falsePositive: boolean;
  hidden: boolean;
}

export interface ProgramListResult {
  items: ProgramListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const listColumns = {
  id: programs.id,
  name: programs.name,
  programUrl: programs.programUrl,
  companyId: programs.companyId,
  companyName: companies.name,
  companyDomain: programs.companyDomain,
  companyWebsite: companies.website,
  countryCode: companies.countryCode,
  countryName: companies.countryName,
  programType: programs.programType,
  status: programs.status,
  selfHosted: programs.selfHosted,
  hasThirdPartyProgram: programs.hasThirdPartyProgram,
  thirdPartyPlatforms: programs.thirdPartyPlatforms,
  rewardKind: programs.rewardKind,
  minBounty: programs.minBounty,
  maxBounty: programs.maxBounty,
  bountyCurrency: programs.bountyCurrency,
  launchDate: programs.launchDate,
  launchDateSource: programs.launchDateSource,
  publishedDate: programs.publishedDate,
  modifiedDate: programs.modifiedDate,
  firstSeenAt: programs.firstSeenAt,
  lastSeenAt: programs.lastSeenAt,
  lastVerifiedAt: programs.lastVerifiedAt,
  lastChangedAt: programs.lastChangedAt,
  confidenceScore: programs.confidenceScore,
  isNew: programs.isNew,
  summary: programs.summary,
  technologies: programs.technologies,
  hasApi: programs.hasApi,
  hasAndroid: programs.hasAndroid,
  hasIos: programs.hasIos,
  hasMobile: programs.hasMobile,
  hasWildcard: programs.hasWildcard,
  hasCloud: programs.hasCloud,
  hasWeb: programs.hasWeb,
  assetCount: programs.assetCount,
  reviewed: programs.reviewed,
  falsePositive: programs.falsePositive,
  hidden: programs.hidden,
};

/**
 * Turn a free-text query into a prefix tsquery so partial tokens match:
 * `andro` finds `android`. Returns a token that matches nothing when the input
 * has no usable characters, rather than producing invalid tsquery syntax.
 */
function prefixQuery(query: string): string {
  const tokens = query
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((token) => `${token}:*`);
  return tokens.length > 0 ? tokens.join(' & ') : 'zzzzzznomatch';
}

/** Translate a `ProgramFilter` into SQL predicates. */
export function buildConditions(filter: ProgramFilter, now = new Date()): SQL[] {
  const conditions: SQL[] = [];

  // Operator-only rows stay out of the researcher-facing views by default.
  if (!filter.includeFalsePositives) conditions.push(eq(programs.falsePositive, false));
  if (!filter.includeHidden) conditions.push(eq(programs.hidden, false));

  // Self-hosted is the product's whole premise, so it defaults to on.
  if (filter.selfHostedOnly !== false) conditions.push(eq(programs.selfHosted, true));

  if (filter.q) {
    const query = filter.q.trim();
    const like = `%${query}%`;
    // Full-text for phrase-ish queries, plus ILIKE so partial tokens ("api",
    // "andro") still match the way a researcher expects.
    conditions.push(
      or(
        sql`programs.search_vector @@ websearch_to_tsquery('english', ${query})`,
        sql`programs.search_vector @@ to_tsquery('simple', ${prefixQuery(query)})`,
        ilike(programs.name, like),
        ilike(companies.name, like),
        ilike(programs.companyDomain, like),
        ilike(programs.summary, like),
        sql`exists (select 1 from program_assets pa where pa.program_id = ${programs.id} and pa.removed_at is null and pa.identifier ilike ${like})`,
        sql`exists (select 1 from jsonb_array_elements_text(${programs.technologies}) t where t ilike ${like})`,
        ilike(companies.countryName, like),
      )!,
    );
  }

  /* ---- Dates ---- */
  const dateColumn =
    filter.dateField === 'launch'
      ? programs.launchDate
      : filter.dateField === 'verified'
        ? programs.lastVerifiedAt
        : filter.dateField === 'changed'
          ? programs.lastChangedAt
          : programs.firstSeenAt;

  if (filter.days !== undefined) {
    // `days=0` means "today", i.e. since midnight UTC.
    const cutoff =
      filter.days === 0
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        : subDays(now, filter.days);
    conditions.push(gte(programs.firstSeenAt, cutoff));
  }

  if (filter.launchedWithinDays !== undefined) {
    const cutoff =
      filter.launchedWithinDays === 0
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        : subDays(now, filter.launchedWithinDays);
    conditions.push(and(isNotNull(programs.launchDate), gte(programs.launchDate, cutoff))!);
  }

  if (filter.from) {
    const from = new Date(filter.from);
    if (!Number.isNaN(from.getTime())) conditions.push(gte(dateColumn, from));
  }
  if (filter.to) {
    const to = new Date(filter.to);
    if (!Number.isNaN(to.getTime())) {
      // An inclusive end date: `to=2026-09-07` covers all of the 7th.
      const end = filter.to.length <= 10 ? new Date(to.getTime() + 86_399_999) : to;
      conditions.push(lte(dateColumn, end));
    }
  }

  /* ---- Enumerations ---- */
  if (filter.type?.length) conditions.push(inArray(programs.programType, filter.type));
  if (filter.status?.length) conditions.push(inArray(programs.status, filter.status));
  if (filter.rewardKind?.length) conditions.push(inArray(programs.rewardKind, filter.rewardKind));

  /* ---- Booleans ---- */
  if (filter.paid === true) conditions.push(eq(programs.rewardKind, 'paid'));
  if (filter.paid === false) conditions.push(ne(programs.rewardKind, 'paid'));
  if (filter.hasApi !== undefined) conditions.push(eq(programs.hasApi, filter.hasApi));
  if (filter.hasAndroid !== undefined) conditions.push(eq(programs.hasAndroid, filter.hasAndroid));
  if (filter.hasIos !== undefined) conditions.push(eq(programs.hasIos, filter.hasIos));
  if (filter.hasMobile !== undefined) conditions.push(eq(programs.hasMobile, filter.hasMobile));
  if (filter.hasWildcard !== undefined) conditions.push(eq(programs.hasWildcard, filter.hasWildcard));
  if (filter.hasCloud !== undefined) conditions.push(eq(programs.hasCloud, filter.hasCloud));
  if (filter.hasWeb !== undefined) conditions.push(eq(programs.hasWeb, filter.hasWeb));
  if (filter.isNew !== undefined) conditions.push(eq(programs.isNew, filter.isNew));
  if (filter.reviewed !== undefined) conditions.push(eq(programs.reviewed, filter.reviewed));
  if (filter.hasThirdParty !== undefined) {
    conditions.push(eq(programs.hasThirdPartyProgram, filter.hasThirdParty));
  }
  if (filter.recentlyChanged) {
    conditions.push(and(isNotNull(programs.lastChangedAt), gte(programs.lastChangedAt, subDays(now, 7)))!);
  }

  /* ---- Numeric ---- */
  if (filter.minBounty !== undefined) {
    conditions.push(sql`${programs.maxBounty} is not null and ${programs.maxBounty} >= ${filter.minBounty}`);
  }
  if (filter.maxBounty !== undefined) {
    conditions.push(sql`${programs.maxBounty} is not null and ${programs.maxBounty} <= ${filter.maxBounty}`);
  }
  if (filter.minConfidence !== undefined) {
    conditions.push(gte(programs.confidenceScore, Math.round(filter.minConfidence)));
  }
  if (filter.maxConfidence !== undefined) {
    conditions.push(lte(programs.confidenceScore, Math.round(filter.maxConfidence)));
  }
  if (filter.minAssets !== undefined) {
    conditions.push(gte(programs.assetCount, Math.round(filter.minAssets)));
  }

  /* ---- Text scoped ---- */
  if (filter.country) {
    conditions.push(
      or(
        eq(companies.countryCode, filter.country.toUpperCase()),
        ilike(companies.countryName, `%${filter.country}%`),
      )!,
    );
  }
  if (filter.domain) conditions.push(ilike(programs.companyDomain, `%${filter.domain}%`));
  if (filter.technology) {
    conditions.push(
      sql`exists (select 1 from jsonb_array_elements_text(${programs.technologies}) t where t ilike ${`%${filter.technology}%`})`,
    );
  }
  if (filter.asset) {
    conditions.push(
      sql`exists (select 1 from program_assets pa where pa.program_id = ${programs.id} and pa.removed_at is null and pa.identifier ilike ${`%${filter.asset}%`})`,
    );
  }

  return conditions;
}

function orderFor(sort: SortOption | undefined): SQL[] {
  switch (sort) {
    case 'oldest':
      return [asc(sql`coalesce(${programs.launchDate}, ${programs.firstSeenAt})`), asc(programs.id)];
    case 'recently_verified':
      return [sql`${programs.lastVerifiedAt} desc nulls last`, desc(programs.id)];
    case 'recently_changed':
      return [sql`${programs.lastChangedAt} desc nulls last`, desc(programs.id)];
    case 'highest_bounty':
      return [sql`${programs.maxBounty} desc nulls last`, desc(programs.confidenceScore)];
    case 'most_assets':
      return [desc(programs.assetCount), desc(programs.confidenceScore)];
    case 'highest_confidence':
      return [desc(programs.confidenceScore), desc(programs.firstSeenAt)];
    case 'company':
      return [asc(companies.name), asc(programs.name)];
    case 'newest':
    default:
      // "Newest" means the launch date when known, otherwise first discovery —
      // which is exactly what the New Programs board should rank by.
      return [desc(sql`coalesce(${programs.launchDate}, ${programs.firstSeenAt})`), desc(programs.id)];
  }
}

export async function listPrograms(
  filter: ProgramFilter,
  now = new Date(),
): Promise<ProgramListResult> {
  const { page, pageSize, offset } = normalisePaging(filter);
  const conditions = buildConditions(filter, now);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db()
    .select(listColumns)
    .from(programs)
    .innerJoin(companies, eq(companies.id, programs.companyId))
    .where(where)
    .orderBy(...orderFor(filter.sort))
    .limit(pageSize)
    .offset(offset);

  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(programs)
    .innerJoin(companies, eq(companies.id, programs.companyId))
    .where(where);

  return {
    items: rows.map(toListItem),
    total: count,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(count / pageSize)),
  };
}

function toListItem(row: Record<string, unknown>): ProgramListItem {
  return {
    ...row,
    minBounty: row.minBounty === null || row.minBounty === undefined ? null : Number(row.minBounty),
    maxBounty: row.maxBounty === null || row.maxBounty === undefined ? null : Number(row.maxBounty),
  } as ProgramListItem;
}

/** Fetch specific programs by id, preserving the caller's ordering needs. */
export async function listProgramsByIds(ids: number[]): Promise<ProgramListItem[]> {
  if (ids.length === 0) return [];
  const rows = await db()
    .select(listColumns)
    .from(programs)
    .innerJoin(companies, eq(companies.id, programs.companyId))
    .where(inArray(programs.id, ids));
  return rows.map(toListItem);
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

export interface ProgramDetail extends ProgramListItem {
  policyText: string | null;
  contactMethods: string[];
  confidenceFactors: Array<{ id: string; label: string; points: number }>;
  lastCheckedAt: Date | null;
  notes: string | null;
  assets: Array<{
    id: number;
    identifier: string;
    category: string;
    inScope: boolean;
    description: string | null;
    firstSeenAt: Date;
    removedAt: Date | null;
  }>;
  rewards: Array<{
    id: number;
    tier: string;
    tierRank: number;
    minAmount: number | null;
    maxAmount: number | null;
    currency: string | null;
    rawText: string | null;
    removedAt: Date | null;
  }>;
  changes: Array<{
    id: number;
    changeType: string;
    severity: string;
    summary: string;
    previousValue: string | null;
    newValue: string | null;
    detectedAt: Date;
  }>;
  sources: Array<{
    id: number;
    kind: string;
    url: string;
    reliability: number;
    detail: string | null;
    firstSeenAt: Date;
  }>;
  versions: Array<{ id: number; version: number; contentHash: string; capturedAt: Date }>;
}

export async function getProgramDetail(id: number): Promise<ProgramDetail | null> {
  const [row] = await db()
    .select({
      ...listColumns,
      policyText: programs.policyText,
      contactMethods: programs.contactMethods,
      confidenceFactors: programs.confidenceFactors,
      lastCheckedAt: programs.lastCheckedAt,
      notes: programs.notes,
    })
    .from(programs)
    .innerJoin(companies, eq(companies.id, programs.companyId))
    .where(eq(programs.id, id))
    .limit(1);

  if (!row) return null;

  const [assets, rewards, changes, sourceRows, versions] = await Promise.all([
    db()
      .select()
      .from(programAssets)
      .where(eq(programAssets.programId, id))
      .orderBy(desc(programAssets.inScope), asc(programAssets.category), asc(programAssets.identifier)),
    db()
      .select()
      .from(programRewards)
      .where(eq(programRewards.programId, id))
      .orderBy(desc(programRewards.tierRank)),
    db()
      .select()
      .from(programChanges)
      .where(eq(programChanges.programId, id))
      .orderBy(desc(programChanges.detectedAt))
      .limit(100),
    db().select().from(sources).where(eq(sources.programId, id)).orderBy(desc(sources.reliability)),
    db()
      .select({
        id: programVersions.id,
        version: programVersions.version,
        contentHash: programVersions.contentHash,
        capturedAt: programVersions.capturedAt,
      })
      .from(programVersions)
      .where(eq(programVersions.programId, id))
      .orderBy(desc(programVersions.version))
      .limit(50),
  ]);

  return {
    ...toListItem(row),
    policyText: row.policyText,
    contactMethods: row.contactMethods,
    confidenceFactors: row.confidenceFactors,
    lastCheckedAt: row.lastCheckedAt,
    notes: row.notes,
    assets: assets.map((a) => ({
      id: a.id,
      identifier: a.identifier,
      category: a.category,
      inScope: a.inScope,
      description: a.description,
      firstSeenAt: a.firstSeenAt,
      removedAt: a.removedAt,
    })),
    rewards: rewards.map((r) => ({
      id: r.id,
      tier: r.tier,
      tierRank: r.tierRank,
      minAmount: r.minAmount === null ? null : Number(r.minAmount),
      maxAmount: r.maxAmount === null ? null : Number(r.maxAmount),
      currency: r.currency,
      rawText: r.rawText,
      removedAt: r.removedAt,
    })),
    changes: changes.map((c) => ({
      id: c.id,
      changeType: c.changeType,
      severity: c.severity,
      summary: c.summary,
      previousValue: c.previousValue,
      newValue: c.newValue,
      detectedAt: c.detectedAt,
    })),
    sources: sourceRows.map((s) => ({
      id: s.id,
      kind: s.kind,
      url: s.url,
      reliability: s.reliability,
      detail: s.detail,
      firstSeenAt: s.firstSeenAt,
    })),
    versions,
  };
}

/* ------------------------------------------------------------------ */
/* Changes feed                                                        */
/* ------------------------------------------------------------------ */

export interface ChangeFeedItem {
  id: number;
  programId: number;
  programName: string;
  companyName: string;
  companyDomain: string;
  changeType: string;
  severity: string;
  summary: string;
  previousValue: string | null;
  newValue: string | null;
  detectedAt: Date;
}

export async function listChanges(options: {
  days?: number;
  severity?: string[];
  changeType?: string[];
  programId?: number;
  page?: number;
  pageSize?: number;
  now?: Date;
}): Promise<{ items: ChangeFeedItem[]; total: number; page: number; pageSize: number }> {
  const now = options.now ?? new Date();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 50));

  const conditions: SQL[] = [eq(programs.falsePositive, false), eq(programs.hidden, false)];
  if (options.days !== undefined) {
    conditions.push(gte(programChanges.detectedAt, subDays(now, options.days)));
  }
  if (options.severity?.length) conditions.push(inArray(programChanges.severity, options.severity as never));
  if (options.changeType?.length) {
    conditions.push(inArray(programChanges.changeType, options.changeType as never));
  }
  if (options.programId) conditions.push(eq(programChanges.programId, options.programId));

  const where = and(...conditions);

  const rows = await db()
    .select({
      id: programChanges.id,
      programId: programChanges.programId,
      programName: programs.name,
      companyName: companies.name,
      companyDomain: programs.companyDomain,
      changeType: programChanges.changeType,
      severity: programChanges.severity,
      summary: programChanges.summary,
      previousValue: programChanges.previousValue,
      newValue: programChanges.newValue,
      detectedAt: programChanges.detectedAt,
    })
    .from(programChanges)
    .innerJoin(programs, eq(programs.id, programChanges.programId))
    .innerJoin(companies, eq(companies.id, programs.companyId))
    .where(where)
    .orderBy(desc(programChanges.detectedAt), desc(programChanges.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(programChanges)
    .innerJoin(programs, eq(programs.id, programChanges.programId))
    .innerJoin(companies, eq(companies.id, programs.companyId))
    .where(where);

  return { items: rows, total: count, page, pageSize };
}

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  companies,
  programAssets,
  programChanges,
  programRewards,
  programVersions,
  programs,
  sources,
  type Program,
} from '@/db/schema';
import { SOURCE_RELIABILITY, type SourceKind } from '@/lib/constants';
import { env } from '@/lib/env';
import { assessNewness } from '@/pipeline/score/confidence';
import type { DetectedChange, ProgramSnapshot } from '@/pipeline/diff/changes';
import type { AnalyzedProgram } from '@/pipeline/types';

/**
 * Persistence for programs and everything hanging off them.
 *
 * The guiding rule is that history is never overwritten: assets and reward
 * tiers are soft-removed with `removed_at`, and every content change writes a
 * new immutable `program_versions` row.
 */

export interface UpsertResult {
  programId: number;
  created: boolean;
  changes: DetectedChange[];
  versionId: number | null;
  previousSnapshot: ProgramSnapshot | null;
}

export async function upsertCompany(analysis: AnalyzedProgram): Promise<number> {
  const values = {
    domain: analysis.companyDomain,
    name: analysis.companyName,
    website: analysis.companyWebsite,
    countryCode: analysis.countryCode,
    countryName: analysis.countryName,
    updatedAt: new Date(),
  };

  const [row] = await db()
    .insert(companies)
    .values(values)
    .onConflictDoUpdate({
      target: companies.domain,
      set: {
        // Keep the better-quality name: never replace a real name with a
        // domain-derived fallback.
        name: sql`case when length(excluded.name) > 2 then excluded.name else ${companies.name} end`,
        website: sql`coalesce(excluded.website, ${companies.website})`,
        countryCode: sql`coalesce(excluded.country_code, ${companies.countryCode})`,
        countryName: sql`coalesce(excluded.country_name, ${companies.countryName})`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: companies.id });

  return row.id;
}

/** Build the comparable snapshot used by change detection. */
export function toSnapshot(analysis: AnalyzedProgram): ProgramSnapshot {
  return {
    programType: analysis.classification.programType,
    status: analysis.classification.status,
    rewardKind: analysis.rewards.kind,
    minBounty: analysis.rewards.minBounty,
    maxBounty: analysis.rewards.maxBounty,
    bountyCurrency: analysis.rewards.currency,
    assets: analysis.assets.map((a) => ({
      identifier: a.identifier,
      normalizedIdentifier: a.normalizedIdentifier,
      category: a.category,
      inScope: a.inScope,
    })),
    rewardTiers: analysis.rewards.tiers.map((t) => ({
      tier: t.tier,
      minAmount: t.minAmount,
      maxAmount: t.maxAmount,
      currency: t.currency,
    })),
    contactMethods: analysis.contactMethods,
    policyText: analysis.policyText,
    contentHash: analysis.contentHash,
  };
}

/** Reconstruct a snapshot from stored rows so we can diff against the last crawl. */
export async function loadSnapshot(programId: number): Promise<ProgramSnapshot | null> {
  const [program] = await db().select().from(programs).where(eq(programs.id, programId)).limit(1);
  if (!program) return null;

  const assets = await db()
    .select()
    .from(programAssets)
    .where(and(eq(programAssets.programId, programId), isNull(programAssets.removedAt)));

  const rewards = await db()
    .select()
    .from(programRewards)
    .where(and(eq(programRewards.programId, programId), isNull(programRewards.removedAt)));

  return {
    programType: program.programType,
    status: program.status,
    rewardKind: program.rewardKind,
    minBounty: program.minBounty === null ? null : Number(program.minBounty),
    maxBounty: program.maxBounty === null ? null : Number(program.maxBounty),
    bountyCurrency: program.bountyCurrency,
    assets: assets.map((a) => ({
      identifier: a.identifier,
      normalizedIdentifier: a.normalizedIdentifier,
      category: a.category,
      inScope: a.inScope,
    })),
    rewardTiers: rewards.map((r) => ({
      tier: r.tier,
      minAmount: r.minAmount === null ? null : Number(r.minAmount),
      maxAmount: r.maxAmount === null ? null : Number(r.maxAmount),
      currency: r.currency,
    })),
    contactMethods: program.contactMethods,
    policyText: program.policyText,
    contentHash: program.contentHash ?? '',
  };
}

/** Insert or update the program row itself. */
async function writeProgramRow(
  companyId: number,
  analysis: AnalyzedProgram,
  canonicalUrl: string,
  existing: Program | null,
  now: Date,
): Promise<number> {
  const newness = assessNewness(
    analysis.dates.launchDate,
    existing?.firstSeenAt ?? now,
    env().NEW_PROGRAM_WINDOW_DAYS,
    now,
  );

  const shared = {
    companyId,
    name: analysis.programName,
    programUrl: canonicalUrl,
    companyDomain: analysis.companyDomain,
    programType: analysis.classification.programType,
    status: analysis.classification.status,
    selfHosted: analysis.selfHosted.selfHosted,
    hasThirdPartyProgram: analysis.selfHosted.hasThirdPartyProgram,
    thirdPartyPlatforms: analysis.selfHosted.linkedPlatforms,
    rewardKind: analysis.rewards.kind,
    minBounty: analysis.rewards.minBounty === null ? null : String(analysis.rewards.minBounty),
    maxBounty: analysis.rewards.maxBounty === null ? null : String(analysis.rewards.maxBounty),
    bountyCurrency: analysis.rewards.currency,
    launchDate: analysis.dates.launchDate,
    launchDateSource: analysis.dates.launchDateSource,
    publishedDate: analysis.dates.publishedDate,
    modifiedDate: analysis.dates.modifiedDate,
    lastSeenAt: now,
    lastVerifiedAt: now,
    lastCheckedAt: now,
    confidenceScore: analysis.confidence.score,
    confidenceFactors: analysis.confidence.factors,
    isNew: newness.isNew,
    summary: analysis.summary,
    policyText: analysis.policyText,
    contactMethods: analysis.contactMethods,
    technologies: analysis.technologies,
    languages: analysis.languages,
    hasApi: analysis.facets.hasApi,
    hasAndroid: analysis.facets.hasAndroid,
    hasIos: analysis.facets.hasIos,
    hasMobile: analysis.facets.hasMobile,
    hasWildcard: analysis.facets.hasWildcard,
    hasCloud: analysis.facets.hasCloud,
    hasWeb: analysis.facets.hasWeb,
    assetCount: analysis.facets.assetCount,
    contentHash: analysis.contentHash,
    updatedAt: now,
  };

  if (existing) {
    await db()
      .update(programs)
      .set({
        ...shared,
        // `launch_date` is only ever improved, never downgraded to null: once
        // we have established when a program launched, a later crawl that
        // cannot find the date must not erase it.
        launchDate: analysis.dates.launchDate ?? existing.launchDate,
        launchDateSource: analysis.dates.launchDate
          ? analysis.dates.launchDateSource
          : existing.launchDateSource,
        publishedDate: analysis.dates.publishedDate ?? existing.publishedDate,
      })
      .where(eq(programs.id, existing.id));
    await refreshSearchVector(existing.id);
    return existing.id;
  }

  const [row] = await db()
    .insert(programs)
    .values({ ...shared, firstSeenAt: now, createdAt: now })
    .onConflictDoUpdate({ target: programs.programUrl, set: shared })
    .returning({ id: programs.id });

  await refreshSearchVector(row.id);
  return row.id;
}

/**
 * Rebuild the full-text vector for a program.
 *
 * Weights: A = company/program name, B = assets and technologies (what people
 * actually search for), C = summary, D = policy body.
 */
export async function refreshSearchVector(programId: number): Promise<void> {
  await db().execute(sql`
    update programs p set search_vector =
      setweight(to_tsvector('english', coalesce(p.name, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(c.name, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(p.company_domain, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce((
        select string_agg(a.identifier, ' ') from program_assets a
        where a.program_id = p.id and a.removed_at is null
      ), '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(array_to_string(
        array(select jsonb_array_elements_text(p.technologies)), ' '), '')), 'B') ||
      setweight(to_tsvector('english', coalesce(c.country_name, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(p.summary, '')), 'C') ||
      setweight(to_tsvector('english', left(coalesce(p.policy_text, ''), 20000)), 'D')
    from companies c
    where p.id = ${programId} and c.id = p.company_id
  `);
}

/** Replace the asset set, soft-removing anything that disappeared. */
async function syncAssets(programId: number, analysis: AnalyzedProgram, now: Date): Promise<void> {
  const incoming = analysis.assets;

  if (incoming.length > 0) {
    await db()
      .insert(programAssets)
      .values(
        incoming.map((asset) => ({
          programId,
          identifier: asset.identifier,
          normalizedIdentifier: asset.normalizedIdentifier,
          category: asset.category,
          inScope: asset.inScope,
          description: asset.description ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
          removedAt: null,
        })),
      )
      .onConflictDoUpdate({
        target: [programAssets.programId, programAssets.normalizedIdentifier, programAssets.inScope],
        set: {
          identifier: sql`excluded.identifier`,
          category: sql`excluded.category`,
          description: sql`coalesce(excluded.description, ${programAssets.description})`,
          lastSeenAt: now,
          removedAt: null,
        },
      });
  }

  // Anything not seen in this crawl is marked removed rather than deleted.
  await db()
    .update(programAssets)
    .set({ removedAt: now })
    .where(
      and(
        eq(programAssets.programId, programId),
        isNull(programAssets.removedAt),
        sql`${programAssets.lastSeenAt} < ${now}`,
      ),
    );
}

async function syncRewards(programId: number, analysis: AnalyzedProgram, now: Date): Promise<void> {
  const tiers = analysis.rewards.tiers;

  if (tiers.length > 0) {
    await db()
      .insert(programRewards)
      .values(
        tiers.map((tier) => ({
          programId,
          tier: tier.tier,
          tierRank: tier.tierRank,
          minAmount: tier.minAmount === null ? null : String(tier.minAmount),
          maxAmount: tier.maxAmount === null ? null : String(tier.maxAmount),
          currency: tier.currency,
          rawText: tier.rawText,
          firstSeenAt: now,
          lastSeenAt: now,
          removedAt: null,
        })),
      )
      .onConflictDoUpdate({
        target: [programRewards.programId, programRewards.tier],
        set: {
          tierRank: sql`excluded.tier_rank`,
          minAmount: sql`excluded.min_amount`,
          maxAmount: sql`excluded.max_amount`,
          currency: sql`excluded.currency`,
          rawText: sql`excluded.raw_text`,
          lastSeenAt: now,
          removedAt: null,
        },
      });
  }

  await db()
    .update(programRewards)
    .set({ removedAt: now })
    .where(
      and(
        eq(programRewards.programId, programId),
        isNull(programRewards.removedAt),
        sql`${programRewards.lastSeenAt} < ${now}`,
      ),
    );
}

/** Record every URL a program was found at, with its source reliability. */
export async function recordSource(
  programId: number,
  kind: SourceKind,
  url: string,
  detail?: string,
): Promise<void> {
  const now = new Date();
  await db()
    .insert(sources)
    .values({
      programId,
      kind,
      url,
      reliability: SOURCE_RELIABILITY[kind] ?? 0.5,
      detail: detail ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [sources.programId, sources.kind, sources.url],
      set: { lastSeenAt: now, detail: detail ?? null },
    });
}

/** Append an immutable version row when the content hash moved. */
async function writeVersion(
  programId: number,
  analysis: AnalyzedProgram,
  now: Date,
): Promise<number> {
  const [{ nextVersion }] = await db()
    .select({ nextVersion: sql<number>`coalesce(max(${programVersions.version}), 0) + 1` })
    .from(programVersions)
    .where(eq(programVersions.programId, programId));

  const [row] = await db()
    .insert(programVersions)
    .values({
      programId,
      version: nextVersion,
      contentHash: analysis.contentHash,
      snapshot: toSnapshot(analysis) as unknown as Record<string, unknown>,
      contentText: analysis.contentText.slice(0, 100_000),
      capturedAt: now,
    })
    .returning({ id: programVersions.id });

  await db().update(programs).set({ currentVersionId: row.id }).where(eq(programs.id, programId));
  return row.id;
}

export async function writeChanges(
  programId: number,
  changes: DetectedChange[],
  fromVersionId: number | null,
  toVersionId: number | null,
  now: Date,
): Promise<number[]> {
  if (changes.length === 0) return [];

  const rows = await db()
    .insert(programChanges)
    .values(
      changes.map((change) => ({
        programId,
        fromVersionId,
        toVersionId,
        changeType: change.changeType,
        severity: change.severity,
        summary: change.summary,
        previousValue: change.previousValue,
        newValue: change.newValue,
        details: change.details ?? null,
        detectedAt: now,
      })),
    )
    .returning({ id: programChanges.id });

  await db().update(programs).set({ lastChangedAt: now }).where(eq(programs.id, programId));
  return rows.map((r) => r.id);
}

export async function getProgram(programId: number): Promise<Program | null> {
  const [row] = await db().select().from(programs).where(eq(programs.id, programId)).limit(1);
  return row ?? null;
}

export {
  writeProgramRow as persistProgramRow,
  syncAssets as persistAssets,
  syncRewards as persistRewards,
  writeVersion as persistVersion,
};

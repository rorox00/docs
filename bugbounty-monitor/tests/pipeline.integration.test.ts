import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { programAssets, programChanges, programRewards, programVersions, programs, sources } from '@/db/schema';
import { ingestCandidate } from '@/pipeline/ingest';
import { getProgramDetail, listPrograms } from '@/server/repos/queryRepo';
import { getDailyDigest, getDashboardStats } from '@/server/repos/statsRepo';
import { closeDb, primeCache, resetDatabase } from './helpers/db';

/**
 * End-to-end pipeline tests against a real PostgreSQL database.
 *
 * The HTTP cache is primed with fixtures so no network request is made, but
 * everything downstream — parsing, classification, persistence, deduplication,
 * change detection, querying — is the production code path.
 */

const URL = 'https://acme-corp.com/security/bug-bounty';
const ALT_URL = 'https://acme-corp.com/bug-bounty';
const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');

/** The Acme page after the company raised its bounty and widened scope. */
const changedFixture = () =>
  fixture('acme-bug-bounty.html')
    .replace('up to $10,000', 'up to $25,000')
    .replace('<li>iOS application</li>', '<li>iOS application</li><li>staging.acme-corp.com</li>');

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

describe('ingest pipeline', () => {
  let programId: number;

  it('creates a program from a genuine self-hosted page', async () => {
    await primeCache(URL, fixture('acme-bug-bounty.html'));
    const outcome = await ingestCandidate({ url: URL, sourceKind: 'well_known_path', priority: 85 });

    expect(outcome.status).toBe('created');
    expect(outcome.programId).toBeDefined();
    programId = outcome.programId!;

    const detail = await getProgramDetail(programId);
    expect(detail).not.toBeNull();
    expect(detail!.companyName).toBe('Acme Corporation');
    expect(detail!.programType).toBe('bug_bounty');
    expect(detail!.status).toBe('active');
    expect(detail!.selfHosted).toBe(true);
    expect(detail!.maxBounty).toBe(10000);
    expect(detail!.minBounty).toBe(100);
    expect(detail!.bountyCurrency).toBe('USD');
    expect(detail!.hasApi).toBe(true);
    expect(detail!.hasAndroid).toBe(true);
    expect(detail!.hasWildcard).toBe(true);
  });

  it('stores scope, reward tiers, a version and a source', async () => {
    const detail = await getProgramDetail(programId);

    expect(detail!.assets.filter((a) => a.inScope).length).toBe(4);
    expect(detail!.assets.filter((a) => !a.inScope).length).toBe(3);
    expect(detail!.rewards.map((r) => r.tier)).toEqual(
      expect.arrayContaining(['Critical', 'High', 'Medium', 'Low']),
    );
    expect(detail!.versions).toHaveLength(1);
    expect(detail!.sources).toHaveLength(1);
    expect(detail!.sources[0].kind).toBe('well_known_path');
  });

  it('records the launch date and its provenance separately from discovery', async () => {
    const detail = await getProgramDetail(programId);

    expect(detail!.launchDate?.toISOString().slice(0, 10)).toBe('2026-09-05');
    expect(detail!.launchDateSource).toBe('explicit_launch_text');
    expect(detail!.firstSeenAt).toBeInstanceOf(Date);
    // The launch date is genuinely earlier than first discovery.
    expect(detail!.launchDate!.getTime()).toBeLessThan(detail!.firstSeenAt.getTime());
  });

  it('is idempotent when the page has not changed', async () => {
    const outcome = await ingestCandidate({ url: URL, sourceKind: 'sitemap', priority: 70 });

    expect(outcome.status).toBe('unchanged');
    expect(outcome.programId).toBe(programId);

    const versions = await db().select().from(programVersions).where(eq(programVersions.programId, programId));
    expect(versions).toHaveLength(1);

    // The new discovery route is still recorded as an extra source.
    const rows = await db().select().from(sources).where(eq(sources.programId, programId));
    expect(rows.map((r) => r.kind)).toEqual(expect.arrayContaining(['well_known_path', 'sitemap']));
  });

  it('detects changes on the next crawl and keeps the previous version', async () => {
    await primeCache(URL, changedFixture());
    const outcome = await ingestCandidate({ url: URL, sourceKind: 'well_known_path', priority: 85 });
    expect(outcome.status).toBe('updated');

    const changes = await db().select().from(programChanges).where(eq(programChanges.programId, programId));
    const kinds = changes.map((c) => c.changeType);
    expect(kinds).toContain('asset_added');
    expect(kinds).toContain('reward_increased');

    const versions = await db().select().from(programVersions).where(eq(programVersions.programId, programId));
    expect(versions).toHaveLength(2);

    const detail = await getProgramDetail(programId);
    expect(detail!.maxBounty).toBe(25000);
  });

  it('merges the same program discovered at a second URL', async () => {
    // A real duplicate serves the same content as the canonical URL.
    await primeCache(ALT_URL, changedFixture());
    const outcome = await ingestCandidate({ url: ALT_URL, sourceKind: 'search_engine', priority: 70 });

    expect(outcome.programId).toBe(programId);

    const all = await db().select().from(programs);
    expect(all).toHaveLength(1);

    const rows = await db().select().from(sources).where(eq(sources.programId, programId));
    expect(rows.map((r) => r.url)).toContain(ALT_URL);
  });

  it('soft-removes assets rather than deleting them, when scope shrinks', async () => {
    // Re-ingest the original page: staging.acme-corp.com disappears from scope.
    await primeCache(URL, fixture('acme-bug-bounty.html'));
    await ingestCandidate({ url: URL, sourceKind: 'well_known_path', priority: 85 });

    const rows = await db().select().from(programAssets).where(eq(programAssets.programId, programId));
    const staging = rows.find((r) => r.normalizedIdentifier === 'staging.acme-corp.com');

    // The row survives with a removal timestamp rather than being deleted.
    expect(staging).toBeDefined();
    expect(staging!.removedAt).not.toBeNull();

    const changes = await db().select().from(programChanges).where(eq(programChanges.programId, programId));
    expect(changes.map((c) => c.changeType)).toContain('asset_removed');
  });
});

describe('rejection paths', () => {
  it('rejects an editorial page and records why', async () => {
    const url = 'https://secblog.com/blog/top-10-bug-bounty-programs';
    await primeCache(url, fixture('blog-listicle.html'));
    const outcome = await ingestCandidate({ url, sourceKind: 'search_engine', priority: 60 });

    expect(outcome.status).toBe('rejected');
    expect(outcome.reason).toBeTruthy();
    expect(outcome.programId).toBeUndefined();
  });

  it('rejects a stub that only points at a third-party platform', async () => {
    const url = 'https://widgets-inc.com/security';
    await primeCache(url, fixture('stub-redirect-h1.html'));
    const outcome = await ingestCandidate({ url, sourceKind: 'well_known_path', priority: 55 });

    expect(outcome.status).toBe('rejected');
  });

  it('rejects a third-party platform URL without fetching it', async () => {
    const outcome = await ingestCandidate({
      url: 'https://hackerone.com/acme',
      sourceKind: 'search_engine',
      priority: 90,
    });

    expect(outcome.status).toBe('rejected');
    expect(outcome.reason).toMatch(/third-party/i);
  });

  it('keeps a self-hosted program that also has a platform program', async () => {
    const url = 'https://globex.com/security/vulnerability-disclosure';
    await primeCache(url, fixture('dual-hosted.html'));
    const outcome = await ingestCandidate({ url, sourceKind: 'well_known_path', priority: 82 });

    expect(outcome.status).toBe('created');

    const detail = await getProgramDetail(outcome.programId!);
    expect(detail!.selfHosted).toBe(true);
    expect(detail!.hasThirdPartyProgram).toBe(true);
    expect(detail!.thirdPartyPlatforms).toContain('hackerone');
    expect(detail!.programType).toBe('vdp');
  });
});

describe('query layer', () => {
  it('filters by facet and reward', async () => {
    const paidApi = await listPrograms({ paid: true, hasApi: true });
    expect(paidApi.items.every((p) => p.rewardKind === 'paid' && p.hasApi)).toBe(true);
    expect(paidApi.total).toBeGreaterThan(0);

    const expensive = await listPrograms({ minBounty: 5000 });
    expect(expensive.items.every((p) => (p.maxBounty ?? 0) >= 5000)).toBe(true);

    const tooExpensive = await listPrograms({ minBounty: 10_000_000 });
    expect(tooExpensive.total).toBe(0);
  });

  it('filters by program type and status', async () => {
    const vdps = await listPrograms({ type: ['vdp'] });
    expect(vdps.items.every((p) => p.programType === 'vdp')).toBe(true);
    expect(vdps.total).toBeGreaterThan(0);
  });

  it('searches across company, asset and technology', async () => {
    for (const query of ['Acme', 'acme-corp.com', 'android', 'api.acme-corp.com']) {
      const result = await listPrograms({ q: query });
      expect(result.total, `query "${query}" should match`).toBeGreaterThan(0);
    }

    const noMatch = await listPrograms({ q: 'zzzz-definitely-not-present' });
    expect(noMatch.total).toBe(0);
  });

  it('sorts by the requested field', async () => {
    const byBounty = await listPrograms({ sort: 'highest_bounty' });
    const amounts = byBounty.items.map((p) => p.maxBounty ?? -1);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);

    const byConfidence = await listPrograms({ sort: 'highest_confidence' });
    const scores = byConfidence.items.map((p) => p.confidenceScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('excludes non-self-hosted programs by default', async () => {
    const result = await listPrograms({});
    expect(result.items.every((p) => p.selfHosted)).toBe(true);
  });

  it('paginates', async () => {
    const page1 = await listPrograms({ pageSize: 1, page: 1 });
    const page2 = await listPrograms({ pageSize: 1, page: 2 });

    expect(page1.items).toHaveLength(1);
    expect(page1.total).toBeGreaterThan(1);
    expect(page1.items[0].id).not.toBe(page2.items[0]?.id);
  });
});

describe('statistics and digest', () => {
  it('counts the catalogue', async () => {
    const stats = await getDashboardStats();
    expect(stats.totalPrograms).toBeGreaterThan(0);
    expect(stats.paidPrograms).toBeGreaterThan(0);
    expect(stats.programsWithApi).toBeGreaterThan(0);
    expect(stats.highestBounty?.amount).toBe(10000);
  });

  it('builds a digest for today', async () => {
    const digest = await getDailyDigest(new Date());
    expect(digest.newProgramCount).toBeGreaterThan(0);
    expect(digest.highestReward?.amount).toBe(10000);
    expect(digest.apiCount).toBeGreaterThan(0);
  });
});

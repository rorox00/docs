import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFilters, programFilterSchema, toQueryString, type ProgramFilter } from '@/server/filters';
import { programMatchesFilter } from '@/server/notifications/matcher';
import { listPrograms, type ProgramListItem } from '@/server/repos/queryRepo';
import { primeCache, closeDb, resetDatabase } from './helpers/db';
import { ingestCandidate } from '@/pipeline/ingest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('filter parsing', () => {
  it('coerces query-string values into typed criteria', () => {
    const filter = parseFilters(
      new URLSearchParams('days=7&paid=true&hasApi=1&minBounty=5000&type=bug_bounty&sort=highest_bounty'),
    );

    expect(filter).toMatchObject({
      days: 7,
      paid: true,
      hasApi: true,
      minBounty: 5000,
      type: ['bug_bounty'],
      sort: 'highest_bounty',
    });
  });

  it('accepts comma-separated enumerations and drops invalid members', () => {
    const filter = parseFilters(new URLSearchParams('type=bug_bounty,vdp,not_a_type'));
    expect(filter.type).toEqual(['bug_bounty', 'vdp']);
  });

  it('ignores unparseable values rather than throwing', () => {
    const filter = parseFilters(new URLSearchParams('days=abc&paid=maybe&minBounty='));
    expect(filter.days).toBeUndefined();
    expect(filter.paid).toBeUndefined();
    expect(filter.minBounty).toBeUndefined();
  });

  it('round-trips through a query string', () => {
    const original = { days: 7, paid: true, hasApi: true, minBounty: 5000 };
    const parsed = parseFilters(new URLSearchParams(toQueryString(original)));
    expect(parsed).toMatchObject(original);
  });

  it('rejects an unknown sort option', () => {
    expect(programFilterSchema.safeParse({ sort: 'nonsense' }).success).toBe(false);
  });
});

/**
 * The dashboard filters in SQL; notifications evaluate the same criteria in
 * memory. These must agree, or a researcher would be alerted about programs
 * their saved view does not contain.
 */
describe('SQL and in-memory filtering agree', () => {
  const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');

  beforeAll(async () => {
    await resetDatabase();
    await primeCache('https://acme-corp.com/security/bug-bounty', fixture('acme-bug-bounty.html'));
    await ingestCandidate({
      url: 'https://acme-corp.com/security/bug-bounty',
      sourceKind: 'well_known_path',
      priority: 85,
    });
    await primeCache('https://globex.com/security/vulnerability-disclosure', fixture('dual-hosted.html'));
    await ingestCandidate({
      url: 'https://globex.com/security/vulnerability-disclosure',
      sourceKind: 'well_known_path',
      priority: 82,
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  const criteria: ProgramFilter[] = [
    { paid: true },
    { hasApi: true },
    { hasAndroid: true },
    { hasWildcard: true },
    { type: ['bug_bounty'] },
    { type: ['vdp'] },
    { status: ['active'] },
    { minBounty: 5000 },
    { minBounty: 50000 },
    { minConfidence: 80 },
    { hasThirdParty: true },
    { country: 'US' },
    { technology: 'Android' },
  ];

  it.each(criteria)('agrees for %j', async (filter) => {
    const all = await listPrograms({ pageSize: 200 });
    const viaSql = await listPrograms({ ...filter, pageSize: 200 });

    const expected = all.items
      .filter((program: ProgramListItem) => programMatchesFilter(program, filter))
      .map((p) => p.id)
      .sort();
    const actual = viaSql.items.map((p) => p.id).sort();

    expect(actual).toEqual(expected);
  });
});

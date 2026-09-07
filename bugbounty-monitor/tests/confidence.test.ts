import { describe, expect, it } from 'vitest';
import { assessNewness, scoreConfidence } from '@/pipeline/score/confidence';
import { confidenceBand } from '@/lib/constants';
import type { ConfidenceInput } from '@/pipeline/score/confidence';

const NOW = new Date('2026-09-07T00:00:00Z');

const input = (overrides: Partial<ConfidenceInput> = {}): ConfidenceInput => ({
  classification: {
    programType: 'bug_bounty',
    status: 'active',
    programScore: 0.9,
    isFalsePositive: false,
    rejectionReason: null,
    matchedSignals: ['reporting_instruction', 'security_contact', 'policy_terms', 'scope_statement'],
  },
  selfHosted: {
    selfHosted: true,
    hostedOnPlatform: null,
    linkedPlatforms: [],
    hasThirdPartyProgram: false,
    redirectsToPlatform: false,
    reasons: [],
  },
  dates: {
    launchDate: new Date('2026-09-05T00:00:00Z'),
    launchDateSource: 'explicit_launch_text',
    publishedDate: new Date('2026-09-05T00:00:00Z'),
    modifiedDate: new Date('2026-09-06T00:00:00Z'),
    signals: [],
  },
  rewards: { kind: 'paid', currency: 'USD', minBounty: 100, maxBounty: 10000, tiers: [] },
  assets: [
    { identifier: '*.acme.com', normalizedIdentifier: '*.acme.com', category: 'wildcard', inScope: true },
    { identifier: 'api.acme.com', normalizedIdentifier: 'api.acme.com', category: 'api', inScope: true },
    { identifier: 'app.acme.com', normalizedIdentifier: 'app.acme.com', category: 'web', inScope: true },
    { identifier: 'Social engineering', normalizedIdentifier: 'social engineering', category: 'other', inScope: false },
  ],
  url: 'https://acme.com/security/bug-bounty',
  context: { sourceKind: 'security_txt', now: NOW, securityTxtFound: true, independentSignals: 3 },
  sourceKinds: ['security_txt', 'well_known_path', 'sitemap'],
  ...overrides,
});

describe('scoreConfidence', () => {
  it('scores a complete, corroborated program very high', () => {
    const result = scoreConfidence(input());
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.band).toBe('Very High');
  });

  it('explains itself with named factors', () => {
    const result = scoreConfidence(input());
    const ids = result.factors.map((f) => f.id);

    expect(ids).toContain('self_hosted');
    expect(ids).toContain('explicit_launch_date');
    expect(ids).toContain('reward_amounts');
    expect(ids).toContain('scope_detailed');
    expect(result.factors.reduce((sum, f) => sum + f.points, 0)).toBeGreaterThan(0);
  });

  it('penalises a program that is not self-hosted', () => {
    const result = scoreConfidence(
      input({
        selfHosted: {
          selfHosted: false,
          hostedOnPlatform: 'hackerone',
          linkedPlatforms: ['hackerone'],
          hasThirdPartyProgram: true,
          redirectsToPlatform: true,
          reasons: [],
        },
      }),
    );
    expect(result.factors.some((f) => f.id === 'not_self_hosted')).toBe(true);
    expect(result.score).toBeLessThan(scoreConfidence(input()).score);
  });

  it('scores a sparse page much lower than a complete one', () => {
    const sparse = scoreConfidence(
      input({
        classification: {
          programType: 'vdp',
          status: 'unknown',
          programScore: 0.4,
          isFalsePositive: false,
          rejectionReason: null,
          matchedSignals: ['reporting_instruction'],
        },
        dates: { launchDate: null, launchDateSource: null, publishedDate: null, modifiedDate: null, signals: [] },
        rewards: { kind: 'unknown', currency: null, minBounty: null, maxBounty: null, tiers: [] },
        assets: [],
        context: { sourceKind: 'search_engine', now: NOW, independentSignals: 1 },
        sourceKinds: ['search_engine'],
      }),
    );

    expect(sparse.score).toBeLessThan(60);
    expect(sparse.score).toBeGreaterThan(0);
  });

  it('drives a rejected page to zero', () => {
    const result = scoreConfidence(
      input({
        classification: {
          programType: 'unknown',
          status: 'unknown',
          programScore: 0,
          isFalsePositive: true,
          rejectionReason: 'Editorial content',
          matchedSignals: [],
        },
      }),
    );
    expect(result.score).toBe(0);
    expect(result.band).toBe('Unverified');
  });

  it('never leaves the 0-100 range', () => {
    expect(scoreConfidence(input()).score).toBeLessThanOrEqual(100);
  });
});

describe('confidenceBand', () => {
  it('maps scores to the documented bands', () => {
    expect(confidenceBand(97)).toBe('Very High');
    expect(confidenceBand(85)).toBe('High');
    expect(confidenceBand(70)).toBe('Medium');
    expect(confidenceBand(45)).toBe('Low');
    expect(confidenceBand(10)).toBe('Unverified');
  });
});

describe('assessNewness', () => {
  it('uses the launch date when one is known', () => {
    const result = assessNewness(new Date('2026-09-05T00:00:00Z'), new Date('2026-09-06T00:00:00Z'), 30, NOW);
    expect(result).toMatchObject({ isNew: true, basis: 'launch_date', ageDays: 2 });
  });

  it('falls back to first discovery and says so', () => {
    const result = assessNewness(null, new Date('2026-09-01T00:00:00Z'), 30, NOW);
    expect(result).toMatchObject({ isNew: true, basis: 'first_seen', ageDays: 6 });
  });

  it('marks an old program as not new', () => {
    const result = assessNewness(new Date('2020-01-01T00:00:00Z'), new Date('2026-09-06T00:00:00Z'), 30, NOW);
    expect(result.isNew).toBe(false);
  });
});

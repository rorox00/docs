import { describe, expect, it } from 'vitest';
import { detectChanges, overallSeverity, type ProgramSnapshot } from '@/pipeline/diff/changes';

const base: ProgramSnapshot = {
  programType: 'bug_bounty',
  status: 'active',
  rewardKind: 'paid',
  minBounty: 100,
  maxBounty: 5000,
  bountyCurrency: 'USD',
  assets: [
    { identifier: '*.acme-corp.com', normalizedIdentifier: '*.acme-corp.com', category: 'wildcard', inScope: true },
    { identifier: 'www.acme-corp.com', normalizedIdentifier: 'acme-corp.com', category: 'domain', inScope: true },
    { identifier: 'Social engineering', normalizedIdentifier: 'social engineering', category: 'other', inScope: false },
  ],
  rewardTiers: [
    { tier: 'Critical', minAmount: 2000, maxAmount: 5000, currency: 'USD' },
    { tier: 'Low', minAmount: 100, maxAmount: 500, currency: 'USD' },
  ],
  contactMethods: ['mailto:security@acme-corp.com'],
  policyText: 'Safe harbor applies.',
  contentHash: 'hash-a',
};

const mutate = (patch: Partial<ProgramSnapshot>): ProgramSnapshot => ({ ...base, ...patch, contentHash: 'hash-b' });

const types = (snapshot: ProgramSnapshot) => detectChanges(base, snapshot).map((c) => c.changeType);

describe('detectChanges', () => {
  it('reports nothing when the content hash is unchanged', () => {
    expect(detectChanges(base, { ...base })).toHaveLength(0);
  });

  it('detects an added asset and the resulting scope expansion', () => {
    const next = mutate({
      assets: [
        ...base.assets,
        { identifier: 'api.acme-corp.com', normalizedIdentifier: 'api.acme-corp.com', category: 'api', inScope: true },
      ],
    });
    const changes = detectChanges(base, next);

    expect(changes.map((c) => c.changeType)).toEqual(
      expect.arrayContaining(['asset_added', 'scope_expanded']),
    );
    expect(changes.find((c) => c.changeType === 'asset_added')?.newValue).toBe('api.acme-corp.com');
  });

  it('detects a removed asset and the resulting scope reduction', () => {
    const next = mutate({ assets: base.assets.filter((a) => a.normalizedIdentifier !== 'acme-corp.com') });
    expect(types(next)).toEqual(expect.arrayContaining(['asset_removed', 'scope_reduced']));
  });

  it('flags a maximum-bounty increase as high severity', () => {
    const changes = detectChanges(base, mutate({ maxBounty: 10000 }));
    const increase = changes.find((c) => c.changeType === 'reward_increased');

    expect(increase).toBeDefined();
    expect(increase!.severity).toBe('high');
    expect(increase!.summary).toContain('$5,000');
    expect(increase!.summary).toContain('$10,000');
  });

  it('flags a maximum-bounty decrease', () => {
    const changes = detectChanges(base, mutate({ maxBounty: 2000 }));
    expect(changes.some((c) => c.changeType === 'reward_decreased')).toBe(true);
  });

  it('detects a change to an existing tier amount', () => {
    const next = mutate({
      rewardTiers: [
        { tier: 'Critical', minAmount: 5000, maxAmount: 12000, currency: 'USD' },
        { tier: 'Low', minAmount: 100, maxAmount: 500, currency: 'USD' },
      ],
    });
    const changes = detectChanges(base, next);
    const tierChange = changes.find((c) => c.details?.field === 'tier_amount');

    expect(tierChange).toBeDefined();
    expect(tierChange!.summary).toContain('Critical');
  });

  it('detects a new and a removed tier', () => {
    const added = mutate({
      rewardTiers: [...base.rewardTiers, { tier: 'High', minAmount: 500, maxAmount: 2000, currency: 'USD' }],
    });
    expect(types(added)).toContain('reward_tier_added');

    const removed = mutate({ rewardTiers: [base.rewardTiers[0]] });
    expect(types(removed)).toContain('reward_tier_removed');
  });

  it('detects closure and reopening', () => {
    const closed = detectChanges(base, mutate({ status: 'inactive' }));
    expect(closed[0]).toMatchObject({ changeType: 'program_closed', severity: 'high' });

    const reopened = detectChanges({ ...base, status: 'inactive' }, { ...base, status: 'active', contentHash: 'hash-b' });
    expect(reopened.some((c) => c.changeType === 'program_reopened')).toBe(true);
  });

  it('detects a changed reporting contact', () => {
    const changes = detectChanges(base, mutate({ contactMethods: ['mailto:vdp@acme-corp.com'] }));
    const contact = changes.find((c) => c.changeType === 'contact_changed');

    expect(contact).toBeDefined();
    expect(contact!.details).toMatchObject({ added: ['mailto:vdp@acme-corp.com'] });
  });

  it('detects a policy edit', () => {
    expect(types(mutate({ policyText: 'Safe harbor applies. Do not test production.' }))).toContain(
      'policy_changed',
    );
  });

  it('falls back to an informational note when nothing structural moved', () => {
    const changes = detectChanges(base, { ...base, contentHash: 'hash-b' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ changeType: 'policy_changed', severity: 'info' });
  });

  it('reports a newly published bounty amount', () => {
    const from: ProgramSnapshot = { ...base, maxBounty: null, minBounty: null };
    const changes = detectChanges(from, { ...base, contentHash: 'hash-b' });
    expect(changes.some((c) => c.changeType === 'reward_increased')).toBe(true);
  });
});

describe('synthetic maximum-bounty tier', () => {
  it('does not report the headline figure as a new tier', () => {
    // The extractor adds a "Maximum bounty" pseudo-tier for display; the max is
    // already diffed as its own field, so it must not also surface as a tier.
    const from: ProgramSnapshot = {
      ...base,
      rewardTiers: [{ tier: 'Maximum bounty', minAmount: null, maxAmount: 5000, currency: 'USD' }],
    };
    const to: ProgramSnapshot = {
      ...base,
      contentHash: 'hash-b',
      maxBounty: 30000,
      rewardTiers: [{ tier: 'Maximum bounty', minAmount: null, maxAmount: 30000, currency: 'USD' }],
    };

    const changes = detectChanges(from, to);
    expect(changes.some((c) => c.changeType === 'reward_tier_added')).toBe(false);
    expect(changes.filter((c) => c.changeType === 'reward_increased')).toHaveLength(1);
  });
});

describe('overallSeverity', () => {
  it('returns the worst severity present', () => {
    expect(overallSeverity(detectChanges(base, mutate({ maxBounty: 10000 })))).toBe('high');
    expect(overallSeverity([])).toBe('info');
  });
});

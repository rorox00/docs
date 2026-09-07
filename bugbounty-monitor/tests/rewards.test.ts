import { describe, expect, it } from 'vitest';
import { parseHtml } from '@/pipeline/parse/page';
import { extractRewards, findAmounts, formatAmount, formatAmountShort } from '@/pipeline/extract/rewards';

const page = (body: string) =>
  parseHtml(`<html><head><title>Bug Bounty</title></head><body>${body}</body></html>`, 'https://example.com/bug-bounty');

describe('findAmounts', () => {
  it('reads amounts with a leading symbol or a trailing code', () => {
    expect(findAmounts('up to $10,000')[0]).toMatchObject({ value: 10000, currency: 'USD' });
    expect(findAmounts('€5.000 maximum')[0]).toMatchObject({ value: 5000, currency: 'EUR' });
    expect(findAmounts('5000 GBP')[0]).toMatchObject({ value: 5000, currency: 'GBP' });
    expect(findAmounts('₹50,000')[0]).toMatchObject({ value: 50000, currency: 'INR' });
  });

  it('expands magnitude suffixes', () => {
    expect(findAmounts('$10k')[0].value).toBe(10000);
    expect(findAmounts('$1.5M')[0].value).toBe(1500000);
  });

  it('handles crypto amounts below the fiat floor', () => {
    expect(findAmounts('0.5 BTC')[0]).toMatchObject({ value: 0.5, currency: 'BTC' });
  });

  it('ignores bare numbers unless a currency is in scope', () => {
    expect(findAmounts('we received 5000 reports')).toHaveLength(0);
    expect(findAmounts('Critical 5000', 'USD')).toHaveLength(1);
  });

  it('never reads a year as an amount', () => {
    // Regression: "Top 10 ... in 2026" used to produce a $2,026 bounty.
    expect(findAmounts('published in 2026', 'USD')).toHaveLength(0);
    expect(findAmounts('top 10 programs of 2026', 'USD', true)).toHaveLength(0);
  });
});

describe('extractRewards', () => {
  it('extracts explicit minimum and maximum bounties', () => {
    const result = extractRewards(
      page(`<p>We offer rewards up to $20,000 for critical issues. Bounties start at $250.</p>`),
    );
    expect(result.kind).toBe('paid');
    expect(result.maxBounty).toBe(20000);
    expect(result.minBounty).toBe(250);
    expect(result.currency).toBe('USD');
  });

  it('extracts a severity reward table', () => {
    const result = extractRewards(
      page(`<h2>Rewards</h2><table>
        <tr><th>Severity</th><th>Reward</th></tr>
        <tr><td>Critical</td><td>$5,000 - $10,000</td></tr>
        <tr><td>High</td><td>$2,000 - $5,000</td></tr>
        <tr><td>Low</td><td>$100 - $500</td></tr>
      </table>`),
    );
    const tiers = Object.fromEntries(result.tiers.map((t) => [t.tier, [t.minAmount, t.maxAmount]]));
    expect(tiers.Critical).toEqual([5000, 10000]);
    expect(tiers.High).toEqual([2000, 5000]);
    expect(tiers.Low).toEqual([100, 500]);
    expect(result.maxBounty).toBe(10000);
  });

  it('classifies a hall-of-fame-only program', () => {
    const result = extractRewards(
      page(`<p>We do not offer monetary rewards, but we list researchers in our hall of fame.</p>`),
    );
    expect(result.kind).toBe('hall_of_fame');
    expect(result.maxBounty).toBeNull();
  });

  it('classifies a swag-only program', () => {
    const result = extractRewards(page(`<p>We do not pay monetary rewards. We send swag and t-shirts.</p>`));
    expect(result.kind).toBe('swag');
  });

  it('reports unknown rather than guessing when nothing is stated', () => {
    const result = extractRewards(page(`<p>Please report a security vulnerability to security@example.com.</p>`));
    expect(result.maxBounty).toBeNull();
    expect(result.minBounty).toBeNull();
    expect(result.tiers).toHaveLength(0);
  });

  it('swaps a reversed min/max pair', () => {
    const result = extractRewards(page(`<p>Maximum bounty of $100. Minimum bounty of $5,000.</p>`));
    expect(result.minBounty!).toBeLessThanOrEqual(result.maxBounty!);
  });
});

describe('formatting', () => {
  it('formats fiat and crypto', () => {
    expect(formatAmount(10000, 'USD')).toBe('$10,000');
    expect(formatAmount(0.5, 'BTC')).toBe('0.5 BTC');
    expect(formatAmount(null, 'USD')).toBe('Not specified');
  });

  it('abbreviates for dense tables', () => {
    expect(formatAmountShort(10000, 'USD')).toBe('$10K');
    expect(formatAmountShort(1500000, 'USD')).toBe('$1.5M');
    expect(formatAmountShort(null, 'USD')).toBe('—');
  });
});

import { describe, expect, it } from 'vitest';
import { isAggregatorHost, isThirdPartyPlatformHost, platformForHost } from '@/lib/platforms';

describe('third-party platform detection', () => {
  it('identifies the major platforms', () => {
    expect(platformForHost('hackerone.com')?.id).toBe('hackerone');
    expect(platformForHost('www.bugcrowd.com')?.id).toBe('bugcrowd');
    expect(platformForHost('app.intigriti.com')?.id).toBe('intigriti');
    expect(platformForHost('yeswehack.com')?.id).toBe('yeswehack');
    expect(platformForHost('immunefi.com')?.id).toBe('immunefi');
  });

  it('matches subdomains of a platform', () => {
    expect(isThirdPartyPlatformHost('docs.hackerone.com')).toBe(true);
  });

  it('does not match a company domain that merely contains the name', () => {
    expect(isThirdPartyPlatformHost('hackerone.example.com')).toBe(false);
    expect(isThirdPartyPlatformHost('example.com')).toBe(false);
  });

  it('flags general-purpose hosting as an aggregator', () => {
    expect(isAggregatorHost('github.com')).toBe(true);
    expect(isAggregatorHost('gist.github.com')).toBe(true);
    expect(isAggregatorHost('example.com')).toBe(false);
  });
});

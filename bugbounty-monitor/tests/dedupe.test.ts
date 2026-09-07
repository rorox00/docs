import { describe, expect, it } from 'vitest';
import { canonicalRank, chooseCanonicalUrl, normalizeCompanyName, urlsAreEquivalent } from '@/pipeline/dedupe';
import { scoreCandidatePath } from '@/pipeline/discovery/paths';

describe('canonical URL selection', () => {
  it('prefers the most specific program path', () => {
    expect(chooseCanonicalUrl(['https://acme.com/security', 'https://acme.com/security/bug-bounty'])).toBe(
      'https://acme.com/security/bug-bounty',
    );
    expect(chooseCanonicalUrl(['https://acme.com/about/security', 'https://acme.com/bug-bounty'])).toBe(
      'https://acme.com/bug-bounty',
    );
  });

  it('prefers a shallower path when the keyword score ties', () => {
    expect(canonicalRank('https://acme.com/bug-bounty')).toBeGreaterThan(
      canonicalRank('https://acme.com/bug-bounty/scope/details'),
    );
  });

  it('ranks security.txt highest of all', () => {
    expect(canonicalRank('https://acme.com/.well-known/security.txt')).toBeGreaterThan(
      canonicalRank('https://acme.com/security'),
    );
  });
});

describe('urlsAreEquivalent', () => {
  it('treats trailing slashes, www and index files as the same URL', () => {
    expect(urlsAreEquivalent('https://acme.com/security', 'https://www.acme.com/security/')).toBe(true);
    expect(urlsAreEquivalent('https://acme.com/security', 'https://acme.com/security/index')).toBe(true);
  });

  it('keeps different organisations and different paths apart', () => {
    expect(urlsAreEquivalent('https://acme.com/security', 'https://other.com/security')).toBe(false);
    expect(urlsAreEquivalent('https://acme.com/security', 'https://acme.com/bug-bounty')).toBe(false);
  });
});

describe('normalizeCompanyName', () => {
  it('collapses legal suffixes and punctuation', () => {
    expect(normalizeCompanyName('Acme, Inc.')).toBe(normalizeCompanyName('Acme Inc'));
    expect(normalizeCompanyName('Globex GmbH')).toBe(normalizeCompanyName('Globex'));
  });
});

describe('scoreCandidatePath', () => {
  it('scores canonical program paths above generic ones', () => {
    expect(scoreCandidatePath('/.well-known/security.txt')!).toBeGreaterThan(scoreCandidatePath('/security')!);
    expect(scoreCandidatePath('/bug-bounty')!).toBeGreaterThan(scoreCandidatePath('/security')!);
  });

  it('scores sub-paths of a program path slightly lower', () => {
    expect(scoreCandidatePath('/bug-bounty/scope')!).toBeLessThan(scoreCandidatePath('/bug-bounty')!);
  });

  it('returns null for paths that are not worth a request', () => {
    expect(scoreCandidatePath('/careers')).toBeNull();
    expect(scoreCandidatePath('/products/widget')).toBeNull();
    expect(scoreCandidatePath('/')).toBeNull();
  });
});

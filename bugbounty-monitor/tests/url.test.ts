import { describe, expect, it } from 'vitest';
import {
  displayUrl,
  isSecuritySubdomain,
  normalizeUrl,
  registrableDomain,
  resolveUrl,
  safeNormalizeUrl,
  sameRegistrableDomain,
} from '@/lib/url';

describe('registrableDomain', () => {
  it('reduces a hostname to its apex', () => {
    expect(registrableDomain('www.example.com')).toBe('example.com');
    expect(registrableDomain('a.b.c.example.com')).toBe('example.com');
    expect(registrableDomain('example.com')).toBe('example.com');
  });

  it('handles multi-label public suffixes', () => {
    expect(registrableDomain('security.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('www.example.com.au')).toBe('example.com.au');
    expect(registrableDomain('api.foo.co.jp')).toBe('foo.co.jp');
  });

  it('accepts a full URL', () => {
    expect(registrableDomain('https://security.example.com/bug-bounty')).toBe('example.com');
  });

  it('leaves IP literals alone', () => {
    expect(registrableDomain('192.168.1.1')).toBe('192.168.1.1');
  });
});

describe('normalizeUrl', () => {
  it('produces one canonical form for equivalent URLs', () => {
    const canonical = 'https://example.com/security/bug-bounty';
    for (const variant of [
      'https://example.com/security/bug-bounty',
      'https://www.example.com/security/bug-bounty/',
      'HTTP://WWW.EXAMPLE.COM/security/bug-bounty#scope',
      'https://example.com//security//bug-bounty',
      'https://example.com/security/bug-bounty/index.html',
    ]) {
      expect(normalizeUrl(variant)).toBe(canonical);
    }
  });

  it('strips tracking parameters but keeps meaningful ones', () => {
    expect(normalizeUrl('https://example.com/security?utm_source=x&page=2&fbclid=y')).toBe(
      'https://example.com/security?page=2',
    );
  });

  it('sorts remaining query parameters so order does not matter', () => {
    expect(normalizeUrl('https://example.com/s?b=2&a=1')).toBe(normalizeUrl('https://example.com/s?a=1&b=2'));
  });

  it('adds a scheme when one is missing', () => {
    expect(normalizeUrl('example.com/security')).toBe('https://example.com/security');
  });

  it('returns null from the safe variant on malformed input', () => {
    expect(safeNormalizeUrl('not a url at all %%%')).toBeNull();
    expect(safeNormalizeUrl('')).toBeNull();
  });
});

describe('sameRegistrableDomain', () => {
  it('matches across subdomains', () => {
    expect(sameRegistrableDomain('https://security.example.com/a', 'https://example.com/b')).toBe(true);
  });
  it('does not match different organisations', () => {
    expect(sameRegistrableDomain('https://example.com', 'https://example.org')).toBe(false);
  });
});

describe('isSecuritySubdomain', () => {
  it('recognises dedicated security hostnames', () => {
    expect(isSecuritySubdomain('https://security.example.com/')).toBe(true);
    expect(isSecuritySubdomain('https://bugbounty.example.com/')).toBe(true);
  });
  it('rejects ordinary hostnames and apex domains', () => {
    expect(isSecuritySubdomain('https://www.example.com/security')).toBe(false);
    expect(isSecuritySubdomain('https://example.com/')).toBe(false);
  });
});

describe('resolveUrl', () => {
  it('resolves relative links', () => {
    expect(resolveUrl('https://example.com/security/', './policy')).toBe('https://example.com/security/policy');
  });
  it('rejects non-http schemes', () => {
    expect(resolveUrl('https://example.com/', 'javascript:alert(1)')).toBeNull();
    expect(resolveUrl('https://example.com/', 'mailto:a@b.com')).toBeNull();
  });
});

describe('displayUrl', () => {
  it('strips the scheme and truncates', () => {
    expect(displayUrl('https://www.example.com/security')).toBe('example.com/security');
    expect(displayUrl('https://example.com/very/long/path/that/keeps/going/on', 20)).toHaveLength(20);
  });
});

import { describe, expect, it } from 'vitest';
import { parseHtml } from '@/pipeline/parse/page';
import { categorizeAsset, computeFacets, extractScope, normalizeAssetIdentifier } from '@/pipeline/extract/scope';

const page = (body: string, url = 'https://acme-corp.com/bug-bounty') =>
  parseHtml(`<html><head><title>Bug Bounty</title></head><body>${body}</body></html>`, url);

describe('extractScope', () => {
  it('separates in-scope from out-of-scope lists', () => {
    const assets = extractScope(
      page(`<h2>In Scope</h2><ul><li>*.acme-corp.com</li><li>api.acme-corp.com</li></ul>
            <h2>Out of Scope</h2><ul><li>Social engineering</li><li>legacy.acme-corp.com</li></ul>`),
      'acme-corp.com',
    );

    const inScope = assets.filter((a) => a.inScope).map((a) => a.identifier);
    const outOfScope = assets.filter((a) => !a.inScope).map((a) => a.identifier);

    expect(inScope).toContain('*.acme-corp.com');
    expect(inScope).toContain('api.acme-corp.com');
    expect(outOfScope).toContain('legacy.acme-corp.com');
    expect(outOfScope).toContain('Social engineering');
  });

  it('reads scope from a table', () => {
    const assets = extractScope(
      page(`<h2>Targets</h2><table>
        <tr><th>Asset</th><th>Type</th></tr>
        <tr><td>shop.acme-corp.com</td><td>Web</td></tr>
        <tr><td>api.acme-corp.com</td><td>API</td></tr>
      </table>`),
      'acme-corp.com',
    );
    expect(assets.map((a) => a.identifier)).toEqual(
      expect.arrayContaining(['shop.acme-corp.com', 'api.acme-corp.com']),
    );
  });

  it('ignores navigation and unrelated lists', () => {
    const assets = extractScope(
      page(`<nav><ul><li>evil.com</li></ul></nav>
            <h2>Hall of Fame</h2><ul><li>researcher.researcher-site.net</li></ul>`),
      'acme-corp.com',
    );
    expect(assets.map((a) => a.identifier)).not.toContain('evil.com');
    expect(assets.map((a) => a.identifier)).not.toContain('researcher.researcher-site.net');
  });

  it('falls back to prose only for the company own domain', () => {
    const assets = extractScope(
      page(`<p>The scope includes app.acme-corp.com and api.acme-corp.com. Assets of partner.other-corp.net are excluded from this policy.</p>`),
      'acme-corp.com',
    );
    const identifiers = assets.map((a) => a.identifier);
    expect(identifiers).toContain('app.acme-corp.com');
    expect(identifiers).not.toContain('partner.other-corp.net');
  });

  it('returns nothing rather than guessing when no scope is published', () => {
    const assets = extractScope(page(`<p>Report issues to security@acme-corp.com.</p>`), 'acme-corp.com');
    expect(assets).toHaveLength(0);
  });
});

describe('reserved documentation domains', () => {
  it('ignores example.com and friends, which are never real scope', () => {
    const assets = extractScope(
      page(`<h2>In Scope</h2><ul><li>*.example.com</li><li>api.example.org</li></ul>`, 'https://example.com/b'),
      'example.com',
    );
    expect(assets).toHaveLength(0);
  });
});

describe('categorizeAsset', () => {
  it('assigns the right category', () => {
    expect(categorizeAsset('*.acme-corp.com')).toBe('wildcard');
    expect(categorizeAsset('api.acme-corp.com')).toBe('api');
    expect(categorizeAsset('Android application')).toBe('android');
    expect(categorizeAsset('iOS app')).toBe('ios');
    expect(categorizeAsset('AWS S3 buckets')).toBe('cloud');
    expect(categorizeAsset('192.168.0.0/16')).toBe('ip_range');
    expect(categorizeAsset('shop.acme-corp.com')).toBe('domain');
  });
});

describe('normalizeAssetIdentifier', () => {
  it('reduces URLs and hosts to a stable key', () => {
    expect(normalizeAssetIdentifier('https://WWW.Acme-Corp.com/app/')).toBe('acme-corp.com/app');
    expect(normalizeAssetIdentifier('www.acme-corp.com')).toBe('acme-corp.com');
  });
});

describe('computeFacets', () => {
  it('derives filter facets from the in-scope assets', () => {
    const assets = extractScope(
      page(`<h2>In Scope</h2><ul>
        <li>*.acme-corp.com</li><li>api.acme-corp.com</li>
        <li>Android application</li><li>iOS application</li>
      </ul>`),
      'acme-corp.com',
    );
    const facets = computeFacets(assets, 'android application ios application api');

    expect(facets).toMatchObject({
      hasApi: true,
      hasAndroid: true,
      hasIos: true,
      hasMobile: true,
      hasWildcard: true,
      assetCount: 4,
    });
  });
});

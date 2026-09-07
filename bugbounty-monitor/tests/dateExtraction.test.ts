import { describe, expect, it } from 'vitest';
import { parseHtml } from '@/pipeline/parse/page';
import { extractDates } from '@/pipeline/extract/dates';
import { toIsoDate } from '@/lib/dates';

const NOW = new Date('2026-09-07T00:00:00Z');
const page = (head: string, body: string) =>
  parseHtml(`<html><head><title>Bug Bounty</title>${head}</head><body>${body}</body></html>`, 'https://acme-corp.com/bug-bounty');

describe('launch date extraction', () => {
  it('prefers an explicit launch statement over metadata', () => {
    const result = extractDates(
      page(
        `<meta property="article:published_time" content="2026-08-01T00:00:00Z">
         <meta property="article:modified_time" content="2026-09-06T00:00:00Z">`,
        `<p>Our bug bounty program was launched on September 5, 2026.</p>`,
      ),
      { sourceKind: 'crawler', now: NOW },
    );

    expect(toIsoDate(result.launchDate)).toBe('2026-09-05');
    expect(result.launchDateSource).toBe('explicit_launch_text');
  });

  it('uses datePublished from JSON-LD when there is no explicit statement', () => {
    const result = extractDates(
      page(
        `<script type="application/ld+json">{"@type":"WebPage","datePublished":"2026-09-02","dateModified":"2026-09-06"}</script>`,
        `<p>Report a vulnerability to security@acme-corp.com.</p>`,
      ),
      { sourceKind: 'crawler', now: NOW },
    );

    expect(toIsoDate(result.launchDate)).toBe('2026-09-02');
    expect(result.launchDateSource).toBe('json_ld_date_published');
    expect(toIsoDate(result.modifiedDate)).toBe('2026-09-06');
  });

  it('NEVER treats a last-modified date as a launch date', () => {
    const result = extractDates(
      page(
        `<meta property="article:modified_time" content="2026-09-06T00:00:00Z">`,
        `<p>Last updated: September 6, 2026. Report a vulnerability to security@acme-corp.com.</p>`,
      ),
      { sourceKind: 'crawler', now: NOW },
    );

    expect(result.launchDate).toBeNull();
    expect(result.launchDateSource).toBeNull();
    expect(toIsoDate(result.modifiedDate)).toBe('2026-09-06');
  });

  it('NEVER treats a sitemap lastmod as a launch date', () => {
    const result = extractDates(page('', `<p>Report a vulnerability.</p>`), {
      sourceKind: 'sitemap',
      hintedDate: new Date('2026-09-04T00:00:00Z'),
      hintedDateKind: 'sitemap_lastmod',
      now: NOW,
    });

    expect(result.launchDate).toBeNull();
    expect(toIsoDate(result.modifiedDate)).toBe('2026-09-04');
  });

  it('NEVER treats an HTTP Last-Modified header as a launch date', () => {
    const result = extractDates(page('', `<p>Report a vulnerability.</p>`), {
      sourceKind: 'well_known_path',
      httpLastModified: new Date('2026-09-03T00:00:00Z'),
      now: NOW,
    });

    expect(result.launchDate).toBeNull();
    expect(toIsoDate(result.modifiedDate)).toBe('2026-09-03');
  });

  it('accepts an RSS publication date as a launch signal', () => {
    const result = extractDates(page('', `<p>Announcing our new bug bounty program.</p>`), {
      sourceKind: 'rss',
      hintedDate: new Date('2026-09-01T00:00:00Z'),
      hintedDateKind: 'rss_published',
      now: NOW,
    });

    expect(toIsoDate(result.launchDate)).toBe('2026-09-01');
    expect(result.launchDateSource).toBe('rss_published');
  });

  it('records every signal it found for auditing', () => {
    const result = extractDates(
      page(
        `<meta property="article:published_time" content="2026-09-02T00:00:00Z">
         <meta property="article:modified_time" content="2026-09-06T00:00:00Z">`,
        `<p>Launched on September 1, 2026. <time datetime="2026-09-05">5 Sep</time></p>`,
      ),
      { sourceKind: 'crawler', now: NOW },
    );

    const kinds = result.signals.map((s) => s.kind);
    expect(kinds).toContain('explicit_launch_text');
    expect(kinds).toContain('meta_published_time');
    expect(kinds).toContain('meta_modified_time');
    expect(kinds).toContain('time_element');
  });

  it('reports nothing when the page carries no usable dates', () => {
    const result = extractDates(page('', `<p>Report a vulnerability to security@acme-corp.com.</p>`), {
      sourceKind: 'crawler',
      now: NOW,
    });

    expect(result.launchDate).toBeNull();
    expect(result.publishedDate).toBeNull();
    expect(result.modifiedDate).toBeNull();
  });
});

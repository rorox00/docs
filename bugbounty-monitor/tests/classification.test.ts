import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeHtml } from '@/pipeline/analyze';
import { parseHtml } from '@/pipeline/parse/page';
import { classifyProgram } from '@/pipeline/classify/programClassifier';
import { detectSelfHosted } from '@/pipeline/classify/selfHosted';

const NOW = new Date('2026-09-07T00:00:00Z');
const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');

function analyse(file: string, url: string) {
  return analyzeHtml(fixture(file), url, url, { sourceKind: 'well_known_path', now: NOW });
}

describe('program classification', () => {
  it('recognises a genuine self-hosted bug bounty program', () => {
    const result = analyse('acme-bug-bounty.html', 'https://acme-corp.com/security/bug-bounty');

    expect(result.classification.isFalsePositive).toBe(false);
    expect(result.classification.programType).toBe('bug_bounty');
    expect(result.classification.status).toBe('active');
    expect(result.classification.programScore).toBeGreaterThan(0.7);
    expect(result.selfHosted.selfHosted).toBe(true);
    expect(result.companyName).toBe('Acme Corporation');
    expect(result.companyDomain).toBe('acme-corp.com');
  });

  it('classifies a non-paying program as a VDP, not a bug bounty', () => {
    const result = analyse('dual-hosted.html', 'https://globex.com/security/vulnerability-disclosure');

    expect(result.classification.isFalsePositive).toBe(false);
    expect(result.classification.programType).toBe('vdp');
    expect(result.rewards.kind).toBe('hall_of_fame');
    expect(result.rewards.maxBounty).toBeNull();
  });
});

describe('false-positive rejection', () => {
  it('rejects an editorial listicle that merely discusses bug bounties', () => {
    const result = analyse('blog-listicle.html', 'https://secblog.com/blog/top-10-bug-bounty-programs');

    expect(result.classification.isFalsePositive).toBe(true);
    expect(result.classification.rejectionReason).toBeTruthy();
  });

  it('rejects a page with no reporting process', () => {
    const html = `<!doctype html><html><head><title>About us</title></head><body>
      <h1>About us</h1><p>We care deeply about security and our bug bounty program.</p></body></html>`;
    const result = analyzeHtml(html, 'https://example.com/about', 'https://example.com/about', {
      sourceKind: 'crawler',
      now: NOW,
    });

    expect(result.classification.isFalsePositive).toBe(true);
    expect(result.classification.rejectionReason).toMatch(/does not describe how to report/i);
  });

  it('rejects any page served from a third-party platform', () => {
    const html = fixture('acme-bug-bounty.html');
    const result = analyzeHtml(html, 'https://hackerone.com/acme', 'https://hackerone.com/acme', {
      sourceKind: 'search_engine',
      now: NOW,
    });

    expect(result.classification.isFalsePositive).toBe(true);
    expect(result.selfHosted.selfHosted).toBe(false);
    expect(result.selfHosted.hostedOnPlatform).toBe('hackerone');
  });
});

describe('self-hosted vs third-party', () => {
  it('marks a self-hosted page that ALSO links to HackerOne as self-hosted', () => {
    const result = analyse('dual-hosted.html', 'https://globex.com/security/vulnerability-disclosure');

    // This is the exact product rule: both flags true.
    expect(result.selfHosted.selfHosted).toBe(true);
    expect(result.selfHosted.hasThirdPartyProgram).toBe(true);
    expect(result.selfHosted.linkedPlatforms).toContain('hackerone');
    expect(result.selfHosted.redirectsToPlatform).toBe(false);
  });

  it('rejects a stub page that only points at a platform', () => {
    const result = analyse('stub-redirect-h1.html', 'https://widgets-inc.com/security');

    expect(result.selfHosted.selfHosted).toBe(false);
    expect(result.selfHosted.redirectsToPlatform).toBe(true);
    expect(result.selfHosted.hasThirdPartyProgram).toBe(true);
  });

  it('detects a platform named in prose even without a link', () => {
    const page = parseHtml(
      `<html><body><h1>Security</h1>
       <p>Please report any security vulnerability to security@example.com.
       We operate under safe harbor and will not pursue legal action. In scope: www.example.com.
       We also run a program on Bugcrowd.</p></body></html>`,
      'https://example.com/security',
    );
    const result = detectSelfHosted(page);

    expect(result.selfHosted).toBe(true);
    expect(result.linkedPlatforms).toContain('bugcrowd');
  });
});

describe('program type determination', () => {
  const base = (body: string) =>
    classifyProgram(
      parseHtml(`<html><head><title>Security</title></head><body>${body}</body></html>`, 'https://example.com/security'),
    );

  it('treats an explicit "we do not pay" page as a VDP even with bounty vocabulary', () => {
    const result = base(`<h1>Vulnerability Disclosure Policy</h1>
      <p>Please report a security vulnerability to security@example.com. We will respond within 5 days.</p>
      <p>We do not offer monetary rewards for reported vulnerabilities.</p>
      <p>Safe harbor applies to good faith research.</p>`);

    expect(result.isFalsePositive).toBe(false);
    expect(result.programType).toBe('vdp');
  });

  it('detects a closed program', () => {
    const result = base(`<h1>Responsible Disclosure</h1>
      <p>Report a security vulnerability to security@example.com. Safe harbor applies.</p>
      <p>Our bug bounty program is currently paused and we are no longer accepting new reports.</p>`);

    expect(result.status).toBe('inactive');
  });
});

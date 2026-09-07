import { describe, expect, it } from 'vitest';
import { looksLikeSecurityTxt, parseSecurityTxt, programUrlsFromSecurityTxt } from '@/pipeline/parse/securityTxt';
import { toIsoDate } from '@/lib/dates';

const SAMPLE = `# Our security policy
Contact: mailto:security@acme-corp.com
Contact: https://acme-corp.com/security/report
Expires: 2027-01-01T00:00:00Z
Encryption: https://acme-corp.com/pgp-key.txt
Acknowledgments: https://acme-corp.com/security/hall-of-fame
Policy: https://acme-corp.com/security/bug-bounty
Preferred-Languages: en, nl
Canonical: https://acme-corp.com/.well-known/security.txt
`;

describe('parseSecurityTxt', () => {
  it('reads every RFC 9116 field it understands', () => {
    const parsed = parseSecurityTxt(SAMPLE, 'https://acme-corp.com/.well-known/security.txt');

    expect(parsed.contact).toEqual([
      'mailto:security@acme-corp.com',
      'https://acme-corp.com/security/report',
    ]);
    expect(parsed.policy).toEqual(['https://acme-corp.com/security/bug-bounty']);
    expect(parsed.acknowledgments).toHaveLength(1);
    expect(parsed.preferredLanguages).toEqual(['en', 'nl']);
    expect(toIsoDate(parsed.expires)).toBe('2027-01-01');
  });

  it('resolves a relative Policy URL against the file location', () => {
    const parsed = parseSecurityTxt(
      'Contact: mailto:a@b.com\nPolicy: /security/vdp',
      'https://acme-corp.com/.well-known/security.txt',
    );
    expect(parsed.policy[0]).toBe('https://acme-corp.com/security/vdp');
  });

  it('ignores comments and unknown fields', () => {
    const parsed = parseSecurityTxt('# note\nUnknown-Field: x\nContact: mailto:a@b.com');
    expect(parsed.contact).toEqual(['mailto:a@b.com']);
  });
});

describe('looksLikeSecurityTxt', () => {
  it('accepts a real file and rejects an HTML error page', () => {
    expect(looksLikeSecurityTxt(SAMPLE)).toBe(true);
    expect(looksLikeSecurityTxt('<!doctype html><html><body>404 Not Found</body></html>')).toBe(false);
    expect(looksLikeSecurityTxt('')).toBe(false);
  });
});

describe('programUrlsFromSecurityTxt', () => {
  it('returns the policy and web-contact URLs', () => {
    const urls = programUrlsFromSecurityTxt(parseSecurityTxt(SAMPLE));
    expect(urls).toContain('https://acme-corp.com/security/bug-bounty');
    expect(urls).toContain('https://acme-corp.com/security/report');
    // mailto: contacts are not fetchable pages.
    expect(urls.some((u) => u.startsWith('mailto:'))).toBe(false);
  });
});

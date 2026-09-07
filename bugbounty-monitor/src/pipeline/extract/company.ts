import { hostnameOf, registrableDomain } from '@/lib/url';
import type { ParsedPage } from '../types';

/**
 * Company identity and locale.
 *
 * All of this is best-effort: when a name cannot be established we fall back to
 * the registrable domain rather than guessing, and country stays null unless a
 * concrete signal supports it.
 */

/** Words that appear in page titles but are not part of a company name. */
const TITLE_NOISE =
  /\b(?:bug\s*bounty|vulnerability\s+disclosure|responsible\s+disclosure|security\s+research|security\s+policy|disclosure\s+policy|report\s+a\s+vulnerability|security\.txt|security|policy|program(?:me)?|vdp|home|welcome)\b/gi;

const TITLE_SEPARATORS = /\s+[|–—·»:-]\s+/;

export function extractCompanyName(page: ParsedPage, domain: string): string {
  const candidates: string[] = [];

  // 1. JSON-LD Organization / publisher is the most reliable source.
  for (const block of page.jsonLd) {
    const type = String(block['@type'] ?? '').toLowerCase();
    if (/organization|corporation|localbusiness|company/.test(type)) {
      const name = block.name;
      if (typeof name === 'string' && name.trim()) candidates.push(name.trim());
    }
    const publisher = block.publisher;
    if (publisher && typeof publisher === 'object' && !Array.isArray(publisher)) {
      const name = (publisher as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) candidates.push(name.trim());
    }
  }

  // 2. OpenGraph site name.
  if (page.meta['og:site_name']) candidates.push(page.meta['og:site_name']);
  if (page.meta['application-name']) candidates.push(page.meta['application-name']);

  // 3. The last segment of a `Security | Acme Corp` style title.
  if (page.title) {
    const parts = page.title.split(TITLE_SEPARATORS).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      const tail = parts[parts.length - 1];
      const head = parts[0];
      // Whichever side is not program vocabulary is the company.
      candidates.push(TITLE_NOISE.test(tail) ? head : tail);
      TITLE_NOISE.lastIndex = 0;
    }
  }

  // 4. Copyright line, e.g. "© 2026 Acme Corporation".
  const copyright = page.text.match(/©\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?\s*)?([A-Z][\w&.,'’-]*(?:\s+[A-Z][\w&.,'’-]*){0,4})/);
  if (copyright?.[1]) candidates.push(copyright[1]);

  for (const raw of candidates) {
    const cleaned = cleanCompanyName(raw);
    if (cleaned) return cleaned;
  }

  return domainToName(domain);
}

function cleanCompanyName(raw: string): string | null {
  let name = raw
    .replace(TITLE_NOISE, ' ')
    .replace(/[|–—·»]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
    .trim();
  TITLE_NOISE.lastIndex = 0;

  if (name.length < 2 || name.length > 80) return null;
  // Reject leftovers that are just generic words.
  if (/^(?:the|our|a|an|and|inc|llc|ltd|gmbh|corp)$/i.test(name)) return null;
  if (!/[a-z]/i.test(name)) return null;
  // Reject anything that is really a sentence.
  if (name.split(/\s+/).length > 8) return null;
  return name;
}

/** `acme-corp.co.uk` -> `Acme Corp`. */
export function domainToName(domain: string): string {
  const apex = registrableDomain(domain) || domain;
  const label = apex.split('.')[0] ?? apex;
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

/** A short human name for the program itself. */
export function extractProgramName(page: ParsedPage, companyName: string, programTypeLabel: string): string {
  const heading = page.headings.find((h) => h.level <= 2 && h.text.length >= 4 && h.text.length <= 90);
  if (heading) {
    const text = heading.text.trim();
    if (/\b(?:bug\s*bounty|vulnerability\s+disclosure|responsible\s+disclosure|security\s+research|disclosure\s+policy|security\s+policy)\b/i.test(text)) {
      return text.slice(0, 120);
    }
  }

  if (page.title) {
    const parts = page.title.split(TITLE_SEPARATORS).map((p) => p.trim());
    const programPart = parts.find((p) =>
      /\b(?:bug\s*bounty|vulnerability\s+disclosure|responsible\s+disclosure|security\s+research)\b/i.test(p),
    );
    if (programPart && programPart.length <= 90) return programPart;
  }

  return `${companyName} ${programTypeLabel}`.slice(0, 120);
}

/* ------------------------------------------------------------------ */
/* Country / region                                                    */
/* ------------------------------------------------------------------ */

/** ccTLD -> ISO country. Only unambiguous, geography-bound TLDs are listed. */
const CCTLD_COUNTRIES: Record<string, { code: string; name: string }> = {
  uk: { code: 'GB', name: 'United Kingdom' },
  de: { code: 'DE', name: 'Germany' },
  fr: { code: 'FR', name: 'France' },
  nl: { code: 'NL', name: 'Netherlands' },
  be: { code: 'BE', name: 'Belgium' },
  es: { code: 'ES', name: 'Spain' },
  it: { code: 'IT', name: 'Italy' },
  pt: { code: 'PT', name: 'Portugal' },
  se: { code: 'SE', name: 'Sweden' },
  no: { code: 'NO', name: 'Norway' },
  dk: { code: 'DK', name: 'Denmark' },
  fi: { code: 'FI', name: 'Finland' },
  pl: { code: 'PL', name: 'Poland' },
  cz: { code: 'CZ', name: 'Czechia' },
  at: { code: 'AT', name: 'Austria' },
  ch: { code: 'CH', name: 'Switzerland' },
  ie: { code: 'IE', name: 'Ireland' },
  in: { code: 'IN', name: 'India' },
  jp: { code: 'JP', name: 'Japan' },
  kr: { code: 'KR', name: 'South Korea' },
  cn: { code: 'CN', name: 'China' },
  sg: { code: 'SG', name: 'Singapore' },
  au: { code: 'AU', name: 'Australia' },
  nz: { code: 'NZ', name: 'New Zealand' },
  br: { code: 'BR', name: 'Brazil' },
  mx: { code: 'MX', name: 'Mexico' },
  ar: { code: 'AR', name: 'Argentina' },
  ca: { code: 'CA', name: 'Canada' },
  za: { code: 'ZA', name: 'South Africa' },
  ae: { code: 'AE', name: 'United Arab Emirates' },
  sa: { code: 'SA', name: 'Saudi Arabia' },
  il: { code: 'IL', name: 'Israel' },
  tr: { code: 'TR', name: 'Turkey' },
  ru: { code: 'RU', name: 'Russia' },
  ua: { code: 'UA', name: 'Ukraine' },
  gr: { code: 'GR', name: 'Greece' },
  hu: { code: 'HU', name: 'Hungary' },
  ro: { code: 'RO', name: 'Romania' },
  my: { code: 'MY', name: 'Malaysia' },
  id: { code: 'ID', name: 'Indonesia' },
  th: { code: 'TH', name: 'Thailand' },
  vn: { code: 'VN', name: 'Vietnam' },
  ph: { code: 'PH', name: 'Philippines' },
  hk: { code: 'HK', name: 'Hong Kong' },
  tw: { code: 'TW', name: 'Taiwan' },
  cl: { code: 'CL', name: 'Chile' },
  co: { code: 'CO', name: 'Colombia' },
  pk: { code: 'PK', name: 'Pakistan' },
  ng: { code: 'NG', name: 'Nigeria' },
  ke: { code: 'KE', name: 'Kenya' },
  eg: { code: 'EG', name: 'Egypt' },
};

/** Address-shaped country mentions carry more weight than a passing mention. */
const ADDRESS_COUNTRY_PATTERNS: Array<{ code: string; name: string; pattern: RegExp }> = [
  { code: 'US', name: 'United States', pattern: /\b(?:United States|USA|U\.S\.A?\.)\b/ },
  { code: 'GB', name: 'United Kingdom', pattern: /\b(?:United Kingdom|England|Scotland|Wales)\b/ },
  { code: 'DE', name: 'Germany', pattern: /\b(?:Germany|Deutschland)\b/ },
  { code: 'FR', name: 'France', pattern: /\bFrance\b/ },
  { code: 'NL', name: 'Netherlands', pattern: /\b(?:Netherlands|Nederland)\b/ },
  { code: 'IN', name: 'India', pattern: /\bIndia\b/ },
  { code: 'CA', name: 'Canada', pattern: /\bCanada\b/ },
  { code: 'AU', name: 'Australia', pattern: /\bAustralia\b/ },
  { code: 'SG', name: 'Singapore', pattern: /\bSingapore\b/ },
  { code: 'JP', name: 'Japan', pattern: /\bJapan\b/ },
  { code: 'CH', name: 'Switzerland', pattern: /\b(?:Switzerland|Schweiz|Suisse)\b/ },
  { code: 'SE', name: 'Sweden', pattern: /\b(?:Sweden|Sverige)\b/ },
  { code: 'ES', name: 'Spain', pattern: /\b(?:Spain|España)\b/ },
  { code: 'IT', name: 'Italy', pattern: /\b(?:Italy|Italia)\b/ },
  { code: 'BR', name: 'Brazil', pattern: /\b(?:Brazil|Brasil)\b/ },
  { code: 'IL', name: 'Israel', pattern: /\bIsrael\b/ },
  { code: 'IE', name: 'Ireland', pattern: /\bIreland\b/ },
];

export function extractCountry(
  page: ParsedPage,
  domain: string,
): { code: string | null; name: string | null } {
  // 1. Structured data wins.
  for (const block of page.jsonLd) {
    const address = block.address;
    if (address && typeof address === 'object' && !Array.isArray(address)) {
      const country = (address as Record<string, unknown>).addressCountry;
      const value =
        typeof country === 'string'
          ? country
          : country && typeof country === 'object'
            ? String((country as Record<string, unknown>).name ?? '')
            : '';
      if (value) {
        const resolved = resolveCountry(value.trim());
        if (resolved) return resolved;
      }
    }
  }

  // 2. ccTLD is a strong, cheap signal.
  const host = hostnameOf(domain) ?? domain;
  const tld = registrableDomain(host).split('.').pop() ?? '';
  const byTld = CCTLD_COUNTRIES[tld];
  if (byTld) return { code: byTld.code, name: byTld.name };

  // 3. A country named near an address block in the footer.
  const tail = page.text.slice(-3000);
  for (const entry of ADDRESS_COUNTRY_PATTERNS) {
    if (entry.pattern.test(tail)) return { code: entry.code, name: entry.name };
  }

  return { code: null, name: null };
}

function resolveCountry(value: string): { code: string; name: string } | null {
  const upper = value.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) {
    const known = ADDRESS_COUNTRY_PATTERNS.find((c) => c.code === upper);
    if (known) return { code: known.code, name: known.name };
    const byTld = Object.values(CCTLD_COUNTRIES).find((c) => c.code === upper);
    if (byTld) return byTld;
    return { code: upper, name: upper };
  }
  const match = ADDRESS_COUNTRY_PATTERNS.find((c) => c.pattern.test(value));
  return match ? { code: match.code, name: match.name } : null;
}

/** Reporting channels a researcher can actually use. */
export function extractContactMethods(page: ParsedPage): string[] {
  const methods = new Set<string>();

  for (const email of page.emails) {
    if (/^(?:security|psirt|vulnerability|vuln|disclosure|bugbounty|bug-bounty|abuse|infosec|soc|report)@/i.test(email)) {
      methods.add(`mailto:${email}`);
    }
  }

  for (const link of page.links) {
    const href = link.href.toLowerCase();
    if (href.startsWith('mailto:')) {
      const address = href.slice(7).split('?')[0];
      if (address) methods.add(`mailto:${address}`);
    } else if (/\/(?:report|submit|disclosure|vulnerability|security)[-/]?(?:form|report|submit)?/.test(href) && /\bform\b|\breport\b|\bsubmit\b/i.test(link.text)) {
      methods.add(`form:${link.href}`);
    }
  }

  if (/\bpgp\s+(?:key|public\s+key|fingerprint)\b/i.test(page.text)) methods.add('pgp');
  if (/\bsecurity\.txt\b/i.test(page.text)) methods.add('security.txt');
  if (/\bhackerone\b/i.test(page.text)) methods.add('platform:hackerone');
  if (/\bbugcrowd\b/i.test(page.text)) methods.add('platform:bugcrowd');

  return [...methods].slice(0, 20);
}

/** One- or two-sentence description, preferring the page's own summary. */
export function extractSummary(page: ParsedPage): string | null {
  const meta = page.metaDescription?.trim();
  if (meta && meta.length >= 40 && meta.length <= 400) return meta;

  // First substantial sentence that reads like policy rather than navigation.
  const sentences = page.text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const text = sentence.trim();
    if (text.length < 60 || text.length > 400) continue;
    if (!/\b(?:security|vulnerabilit|disclosure|report|bounty|researcher)\b/i.test(text)) continue;
    if (/\b(?:cookie|javascript|browser|menu|navigation|skip\s+to)\b/i.test(text)) continue;
    return text;
  }

  return meta && meta.length > 0 ? meta.slice(0, 400) : null;
}

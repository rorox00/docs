import type { AssetCategory } from '@/lib/constants';
import { registrableDomain } from '@/lib/url';
import type { ExtractedAsset, ParsedPage, ScopeFacets } from '../types';

/**
 * Scope extraction.
 *
 * Scope is almost always published as a list or a table under an "In scope" /
 * "Out of scope" heading, so we walk those structures rather than regexing the
 * flattened page text. Anything we cannot attribute to a scope section is left
 * out — an invented asset is worse than a missing one.
 */

const IN_SCOPE_HEADINGS =
  /\b(?:in[- ]scope|within\s+scope|scope|targets?|assets?|eligible\s+(?:domains?|assets?|targets?|properties)|covered\s+(?:systems?|services?|assets?)|qualifying\s+(?:assets?|domains?|targets?)|applications?|domains?|systems?\s+in\s+scope|what'?s\s+in\s+scope)\b/i;

const OUT_OF_SCOPE_HEADINGS =
  /\b(?:out[- ]of[- ]scope|not\s+in\s+scope|excluded|exclusions?|non[- ]qualifying|ineligible|what'?s\s+(?:not|out\s+of)\s+scope|non[- ]?eligible)\b/i;

/** Section headings that are never scope even though they look list-shaped. */
const NON_SCOPE_HEADINGS =
  /\b(?:hall\s+of\s+fame|acknowledg|thank|reward|bounty\s+(?:table|amount)|severity|contact|pgp|faq|table\s+of\s+contents|navigation|related\s+(?:links|articles)|share)\b/i;

/** Wildcard, bare and sub-domains: `*.example.com`, `api.example.com`. */
const DOMAIN_PATTERN =
  /(?:^|[\s(<"'|,;])((?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?=$|[\s)>"'|,;.:/])/gi;

const URL_PATTERN = /https?:\/\/[^\s"'<>)]+/gi;

const IP_RANGE_PATTERN = /\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\b/g;

/** Any host-shaped token, used to tell "a domain we rejected" from prose. */
const DOMAIN_LIKE = /(?:^|[\s(<"'|,;])(?:\*\.)?(?:[a-z0-9][a-z0-9-]{0,61}\.)+[a-z]{2,24}(?=$|[\s)>"'|,;.:/])/i;

/** Words that look like domains but are file names or version strings. */
const DOMAIN_BLOCKLIST =
  /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|json|xml|txt|pdf|zip|md|yml|yaml|html?|php)$/i;

const COMMON_NON_ASSET_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'e.g', 'i.e',
  'schema.org', 'w3.org', 'gnupg.org', 'openpgp.org', 'ietf.org',
  'creativecommons.org', 'google.com', 'gstatic.com', 'googleapis.com',
  'gravatar.com', 'jquery.com', 'bootstrapcdn.com', 'cloudflare.com',
  'twitter.com', 'x.com', 'facebook.com', 'linkedin.com', 'youtube.com',
  'instagram.com', 'github.com', 'hackerone.com', 'bugcrowd.com',
]);

interface ScopeSection {
  inScope: boolean;
  heading: string | null;
  items: string[];
}

/** Collect list/table blocks that sit under a scope heading. */
function collectSections(page: ParsedPage): ScopeSection[] {
  const sections: ScopeSection[] = [];

  const classify = (heading: string | null): boolean | null => {
    if (!heading) return null;
    if (NON_SCOPE_HEADINGS.test(heading)) return null;
    // Order matters: "out of scope" also matches the "scope" pattern.
    if (OUT_OF_SCOPE_HEADINGS.test(heading)) return false;
    if (IN_SCOPE_HEADINGS.test(heading)) return true;
    return null;
  };

  for (const list of page.lists) {
    const inScope = classify(list.heading);
    if (inScope === null) continue;
    sections.push({ inScope, heading: list.heading, items: list.items });
  }

  for (const table of page.tables) {
    const inScope = classify(table.heading);
    if (inScope === null) continue;
    // Flatten rows, skipping the header row when it looks like one.
    const rows = table.rows.length > 1 && looksLikeHeaderRow(table.rows[0]) ? table.rows.slice(1) : table.rows;
    sections.push({ inScope, heading: table.heading, items: rows.map((cells) => cells.join(' — ')) });
  }

  return sections;
}

function looksLikeHeaderRow(cells: string[]): boolean {
  return cells.some((c) => /^(asset|target|domain|scope|type|description|url|application|severity|reward)$/i.test(c.trim()));
}

/**
 * Fallback for pages that state scope in prose. Only runs when no structured
 * scope section was found, and only accepts domains under the company's own
 * registrable domain — anything else is too speculative.
 */
function extractProseDomains(page: ParsedPage, companyDomain: string): ExtractedAsset[] {
  const sentences = page.text.split(/(?<=[.!?])\s+/);
  const found = new Map<string, ExtractedAsset>();

  for (const sentence of sentences) {
    const isScopeSentence = /\b(?:in\s+scope|scope\s+(?:includes?|covers?)|eligible|applies\s+to|covered\s+by|targets?\s+(?:include|are))\b/i.test(sentence);
    const isOutSentence = /\b(?:out\s+of\s+scope|not\s+(?:in\s+scope|eligible|covered)|excluded|exclude)\b/i.test(sentence);
    if (!isScopeSentence && !isOutSentence) continue;

    for (const domain of matchDomains(sentence)) {
      if (registrableDomain(domain.replace(/^\*\./, '')) !== companyDomain) continue;
      const asset = buildAsset(domain, !isOutSentence, sentence.slice(0, 200));
      if (asset && !found.has(`${asset.normalizedIdentifier}:${asset.inScope}`)) {
        found.set(`${asset.normalizedIdentifier}:${asset.inScope}`, asset);
      }
    }
  }

  return [...found.values()];
}

function matchDomains(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(DOMAIN_PATTERN)) {
    const value = match[1];
    if (!value || DOMAIN_BLOCKLIST.test(value)) continue;
    const bare = value.replace(/^\*\./, '').toLowerCase();
    if (COMMON_NON_ASSET_DOMAINS.has(bare)) continue;
    if (COMMON_NON_ASSET_DOMAINS.has(registrableDomain(bare))) continue;
    out.push(value.toLowerCase());
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Categorisation                                                      */
/* ------------------------------------------------------------------ */

const CATEGORY_RULES: Array<{ category: AssetCategory; pattern: RegExp }> = [
  { category: 'android', pattern: /\b(?:android|google\s+play|play\s+store|\.apk\b|com\.[a-z0-9_.]+\s*\(android\))/i },
  { category: 'ios', pattern: /\b(?:ios|iphone|ipad|app\s*store|testflight|\.ipa\b)\b/i },
  { category: 'mobile', pattern: /\bmobile\s+(?:app|application|client)\b/i },
  { category: 'api', pattern: /\b(?:api|apis|rest|graphql|grpc|soap|webhook|endpoint)\b|(?:^|[/.])api[./-]/i },
  { category: 'cloud', pattern: /\b(?:aws|amazon\s+web\s+services|s3\s+bucket|azure|gcp|google\s+cloud|kubernetes|k8s|cloudfront|lambda|ec2|cloud\s+infrastructure)\b/i },
  { category: 'desktop', pattern: /\b(?:desktop|windows\s+(?:app|client)|macos\s+(?:app|client)|linux\s+client|electron)\b/i },
  { category: 'hardware', pattern: /\b(?:hardware|firmware|iot|device|embedded|router|camera)\b/i },
  { category: 'source_code', pattern: /\b(?:source\s+code|repositor|open\s+source|npm\s+package|github\.com\/)\b/i },
  { category: 'ip_range', pattern: /\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\b/ },
];

export function categorizeAsset(identifier: string, description?: string): AssetCategory {
  const text = `${identifier} ${description ?? ''}`;

  if (/^\*\./.test(identifier.trim())) return 'wildcard';

  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }

  if (/^https?:\/\//i.test(identifier)) return 'web';
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,24}$/i.test(identifier.trim())) return 'domain';
  if (/\b(?:web|website|web\s+app|portal|dashboard|www\.)\b/i.test(text)) return 'web';

  return 'other';
}

function buildAsset(raw: string, inScope: boolean, description?: string): ExtractedAsset | null {
  const identifier = raw.trim().replace(/[.,;]+$/, '');
  if (!identifier || identifier.length > 500) return null;

  const normalized = normalizeAssetIdentifier(identifier);
  if (!normalized) return null;

  return {
    identifier: identifier.slice(0, 500),
    normalizedIdentifier: normalized,
    category: categorizeAsset(identifier, description),
    inScope,
    description: description?.slice(0, 500),
  };
}

/** Canonical asset key used for dedup and change detection. */
export function normalizeAssetIdentifier(value: string): string {
  let text = value.trim().toLowerCase();
  if (!text) return '';
  // Strip a URL down to host + path.
  const urlMatch = text.match(/^https?:\/\/([^/\s]+)(\/[^\s]*)?/);
  if (urlMatch) {
    const host = urlMatch[1].replace(/^www\./, '').replace(/:\d+$/, '');
    const path = (urlMatch[2] ?? '').replace(/\/+$/, '');
    text = `${host}${path}`;
  } else {
    text = text.replace(/^www\./, '');
  }
  text = text.replace(/\s+/g, ' ').replace(/[.,;:]+$/, '');
  return text.slice(0, 500);
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function extractScope(page: ParsedPage, companyDomain: string): ExtractedAsset[] {
  const sections = collectSections(page);
  const assets = new Map<string, ExtractedAsset>();

  const add = (asset: ExtractedAsset | null) => {
    if (!asset) return;
    const key = `${asset.normalizedIdentifier}:${asset.inScope}`;
    const existing = assets.get(key);
    // Prefer the entry that carries a description.
    if (!existing || (!existing.description && asset.description)) assets.set(key, asset);
  };

  for (const section of sections) {
    for (const item of section.items) {
      const trimmed = item.trim();
      if (!trimmed || trimmed.length > 500) continue;

      // A bullet may name a concrete target, or describe a class of activity
      // ("Social engineering"). Both are useful; only the former is parsed for
      // domains.
      const urls = [...trimmed.matchAll(URL_PATTERN)].map((m) => m[0]);
      const domains = matchDomains(trimmed);
      const ips = [...trimmed.matchAll(IP_RANGE_PATTERN)].map((m) => m[0]);

      const concrete = [...urls, ...domains, ...ips];
      if (concrete.length > 0) {
        for (const value of concrete) add(buildAsset(value, section.inScope, trimmed));
        continue;
      }

      // The item names a host but every candidate was filtered out (a reserved
      // documentation domain, a CDN, a social link). Keeping the raw text would
      // smuggle the rejected host back in, so drop the item entirely.
      if (DOMAIN_LIKE.test(trimmed)) continue;

      // Descriptive scope items are kept verbatim when they are short enough to
      // be a target name rather than a paragraph of policy.
      if (trimmed.length <= 160 && /\b(?:android|ios|mobile|api|web|application|app|desktop|cloud|infrastructure|hardware|firmware|social\s+engineering|physical|denial\s+of\s+service|third[- ]party|spam|phishing|source\s+code)\b/i.test(trimmed)) {
        add(buildAsset(trimmed, section.inScope, undefined));
      }
    }
  }

  if (assets.size === 0) {
    for (const asset of extractProseDomains(page, companyDomain)) add(asset);
  }

  // Guard against a runaway page dumping thousands of "assets".
  return [...assets.values()].slice(0, 400);
}

export function computeFacets(assets: ExtractedAsset[], pageText: string): ScopeFacets {
  const inScope = assets.filter((a) => a.inScope);
  const has = (category: AssetCategory) => inScope.some((a) => a.category === category);

  const text = pageText.toLowerCase();
  // Scope facets prefer structured assets, but a program that says "our Android
  // app is in scope" in prose still counts.
  const mentions = (pattern: RegExp) => pattern.test(text);

  const hasAndroid = has('android') || mentions(/\bandroid\s+(?:app|application)\b/);
  const hasIos = has('ios') || mentions(/\b(?:ios|iphone)\s+(?:app|application)\b/);

  return {
    hasApi: has('api') || mentions(/\bapi\b.{0,40}\b(?:in\s+scope|is\s+eligible|are\s+eligible)\b/),
    hasAndroid,
    hasIos,
    hasMobile: hasAndroid || hasIos || has('mobile'),
    hasWildcard: has('wildcard') || inScope.some((a) => a.identifier.startsWith('*.')),
    hasCloud: has('cloud'),
    hasWeb: has('web') || has('domain') || has('wildcard'),
    assetCount: inScope.length,
  };
}

/** Coarse technology tags surfaced in the UI and searchable. */
const TECHNOLOGY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'API', pattern: /\bapi\b/i },
  { label: 'GraphQL', pattern: /\bgraphql\b/i },
  { label: 'REST', pattern: /\brest(?:ful)?\s+api\b/i },
  { label: 'Android', pattern: /\bandroid\b/i },
  { label: 'iOS', pattern: /\bios\b|\biphone\b/i },
  { label: 'AWS', pattern: /\baws\b|\bamazon\s+web\s+services\b/i },
  { label: 'Azure', pattern: /\bazure\b/i },
  { label: 'GCP', pattern: /\bgoogle\s+cloud\b|\bgcp\b/i },
  { label: 'Kubernetes', pattern: /\bkubernetes\b|\bk8s\b/i },
  { label: 'Docker', pattern: /\bdocker\b/i },
  { label: 'Blockchain', pattern: /\bblockchain\b|\bsmart\s+contract\b|\bweb3\b/i },
  { label: 'IoT', pattern: /\biot\b|\bembedded\s+device\b/i },
  { label: 'Firmware', pattern: /\bfirmware\b/i },
  { label: 'SAML', pattern: /\bsaml\b/i },
  { label: 'OAuth', pattern: /\boauth\b/i },
  { label: 'SSO', pattern: /\bsso\b|\bsingle\s+sign[- ]on\b/i },
  { label: 'Webhooks', pattern: /\bwebhooks?\b/i },
  { label: 'Open Source', pattern: /\bopen\s+source\b/i },
];

export function extractTechnologies(page: ParsedPage, assets: ExtractedAsset[]): string[] {
  const haystack = `${page.text} ${assets.map((a) => `${a.identifier} ${a.description ?? ''}`).join(' ')}`;
  const found = TECHNOLOGY_PATTERNS.filter((t) => t.pattern.test(haystack)).map((t) => t.label);
  return [...new Set(found)];
}

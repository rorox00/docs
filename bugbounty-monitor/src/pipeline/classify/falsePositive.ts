import { isAggregatorHost, platformForHost } from '@/lib/platforms';
import { hostnameOf, pathnameOf } from '@/lib/url';
import type { ParsedPage } from '../types';

/**
 * The crawler meets far more pages *about* bug bounties than actual programs.
 * This module rejects the former.
 *
 * The rule of thumb: a program page speaks in the first person plural about the
 * publisher's own systems ("report vulnerabilities in our services"). Editorial
 * content speaks in the third person about the industry ("how bug bounties
 * work", "top 10 bug bounty platforms").
 */

export interface FalsePositiveResult {
  isFalsePositive: boolean;
  reason: string | null;
  matched: string[];
}

/** Editorial / listicle / marketing shapes. */
const EDITORIAL_TITLE_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'how_to_guide', pattern: /\bhow\s+(?:to|do|does|bug\s*bount(?:y|ies))\b/i },
  { id: 'what_is', pattern: /\bwhat\s+(?:is|are)\s+(?:a\s+)?bug\s*bount/i },
  { id: 'listicle', pattern: /\b(?:top|best|\d+)\s+(?:\d+\s+)?(?:best\s+)?bug\s*bounty\s+(?:program|platform|site|hunter|tool|tip)/i },
  { id: 'platform_roundup', pattern: /\bbug\s*bounty\s+platforms?\b/i },
  { id: 'jobs', pattern: /\b(?:jobs?|career|hiring|salary|salaries|internship)\b/i },
  { id: 'news', pattern: /\bbug\s*bounty\s+news\b/i },
  { id: 'course', pattern: /\b(?:course|tutorial|training|bootcamp|certification|learn|beginner'?s?\s+guide|roadmap)\b/i },
  { id: 'writeup', pattern: /\b(?:write-?up|how\s+i\s+(?:found|hacked|earned)|my\s+first\s+bounty|poc)\b/i },
  { id: 'statistics', pattern: /\bbug\s*bounty\s+(?:statistics|report\s+20\d\d|trends|market)\b/i },
];

/** URL shapes that indicate editorial content rather than a policy page. */
const EDITORIAL_PATH_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'blog_path', pattern: /\/(?:blog|news|press|article|post|stories|insights|resources|magazine)\//i },
  { id: 'docs_path', pattern: /\/(?:tutorial|course|guide|learn|academy|training|wiki|glossary|faq-general)\//i },
  { id: 'careers_path', pattern: /\/(?:careers?|jobs?|hiring|vacanc)/i },
  { id: 'forum_path', pattern: /\/(?:forum|community|discuss|thread|topic|comments?)\//i },
  { id: 'search_path', pattern: /\/(?:search|tag|tags|category|categories|archive|author)\//i },
];

/**
 * Third-person, industry-wide phrasing. A company's own policy does not talk
 * about "companies that run bug bounty programs".
 */
const THIRD_PERSON_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'about_companies', pattern: /\b(?:companies|organi[sz]ations|businesses|firms)\s+(?:that\s+)?(?:run|offer|operate|launch|host)\s+bug\s*bounty/i },
  { id: 'industry_overview', pattern: /\bbug\s*bounty\s+(?:industry|ecosystem|landscape|market|scene)\b/i },
  { id: 'platform_comparison', pattern: /\b(?:hackerone|bugcrowd|intigriti|yeswehack)\s+(?:vs\.?|versus|compared\s+to)\s+(?:hackerone|bugcrowd|intigriti|yeswehack)/i },
  { id: 'definition', pattern: /\bbug\s*bount(?:y|ies)\s+(?:is|are)\s+(?:a|an|programs?|initiatives?|deals?)\b/i },
  { id: 'advice', pattern: /\b(?:you\s+can|hunters?\s+can|researchers?\s+can)\s+earn\b/i },
];

/** Directory / aggregator pages that list other people's programs. */
const AGGREGATOR_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'program_directory', pattern: /\b(?:list|directory|database|index)\s+of\s+(?:all\s+)?(?:bug\s*bounty|vulnerability\s+disclosure|vdp)\s+program/i },
  { id: 'browse_programs', pattern: /\b(?:browse|explore|discover|search)\s+(?:\d+\+?\s+)?(?:bug\s*bounty\s+)?programs?\b/i },
  { id: 'many_programs', pattern: /\b\d{2,}\s+(?:bug\s*bounty\s+)?programs?\s+(?:available|listed|found)/i },
];

export function detectFalsePositive(page: ParsedPage): FalsePositiveResult {
  const matched: string[] = [];
  const title = page.title ?? '';
  const headingText = page.headings.map((h) => h.text).join(' ');
  const titleish = `${title} ${headingText}`;
  const path = pathnameOf(page.finalUrl);
  const host = hostnameOf(page.finalUrl) ?? '';
  const text = page.text;

  // 1. The page is hosted on a third-party platform: never a self-hosted program.
  const platform = platformForHost(host);
  if (platform) {
    return {
      isFalsePositive: true,
      reason: `Page is hosted on the third-party platform ${platform.name}`,
      matched: ['third_party_host'],
    };
  }

  // 2. Content farms and code hosts are not company policy pages.
  if (isAggregatorHost(host)) {
    return {
      isFalsePositive: true,
      reason: 'Page is hosted on a general-purpose content or code-hosting site',
      matched: ['aggregator_host'],
    };
  }

  for (const { id, pattern } of EDITORIAL_PATH_PATTERNS) {
    if (pattern.test(path)) matched.push(id);
  }
  for (const { id, pattern } of EDITORIAL_TITLE_PATTERNS) {
    if (pattern.test(titleish)) matched.push(id);
  }
  for (const { id, pattern } of THIRD_PERSON_PATTERNS) {
    if (pattern.test(text)) matched.push(id);
  }
  for (const { id, pattern } of AGGREGATOR_PATTERNS) {
    if (pattern.test(text)) matched.push(id);
  }

  // 3. A page linking out to many different companies' program pages is a
  //    directory, not a program.
  const externalProgramLinks = countExternalProgramLinks(page, host);
  if (externalProgramLinks >= 8) matched.push('links_to_many_programs');

  // 4. Ownership language is the strongest counter-evidence: even a blog-path
  //    URL is a real program page if it says "our security team", "we will".
  const ownershipScore = countOwnershipSignals(page);

  if (matched.length === 0) {
    return { isFalsePositive: false, reason: null, matched };
  }

  // Strong editorial markers (a listicle title, a directory) are decisive.
  const decisive = matched.some((m) =>
    ['listicle', 'platform_roundup', 'jobs', 'course', 'writeup', 'program_directory', 'links_to_many_programs', 'careers_path', 'forum_path'].includes(m),
  );
  if (decisive && ownershipScore < 4) {
    return {
      isFalsePositive: true,
      reason: `Page looks like editorial or directory content (${matched.join(', ')})`,
      matched,
    };
  }

  // Weaker markers only win when the page has little ownership language.
  if (matched.length >= 2 && ownershipScore < 2) {
    return {
      isFalsePositive: true,
      reason: `Page discusses bug bounties without publishing its own program (${matched.join(', ')})`,
      matched,
    };
  }

  return { isFalsePositive: false, reason: null, matched };
}

/**
 * First-person-plural policy language. This is what separates "our program"
 * from "bug bounty programs".
 */
const OWNERSHIP_PATTERNS: RegExp[] = [
  /\bour\s+(?:security\s+team|security\s+program|bug\s*bounty\s+program|vulnerability\s+disclosure|systems?|services?|products?|websites?|applications?|infrastructure|customers?|users?)\b/i,
  /\bwe\s+(?:will|would|are|have|take|welcome|encourage|ask|request|commit|appreciate|investigate|respond|review|aim)\b/i,
  /\b(?:report|disclose)\s+(?:it\s+)?to\s+us\b/i,
  /\bcontact\s+us\b/i,
  /\bplease\s+(?:do\s+not|don'?t|include|provide|allow|give)\s+us\b/i,
  /\bthis\s+(?:policy|program(?:me)?|page)\s+(?:applies|covers|describes|outlines)\b/i,
  /\bsecurity@[\w.-]+/i,
  /\bwithin\s+\d+\s+(?:business\s+)?(?:hours?|days?)\b/i,
];

function countOwnershipSignals(page: ParsedPage): number {
  const text = `${page.title ?? ''}\n${page.text}`;
  let score = 0;
  for (const pattern of OWNERSHIP_PATTERNS) {
    if (pattern.test(text)) score += 1;
  }
  return score;
}

const PROGRAM_LINK_PATTERN =
  /\/(security|bug-?bounty|vulnerability-disclosure|responsible-disclosure|security-research|\.well-known\/security\.txt)/i;

/** Distinct external domains this page links to using program-shaped paths. */
function countExternalProgramLinks(page: ParsedPage, host: string): number {
  const domains = new Set<string>();
  for (const link of page.links) {
    const linkHost = hostnameOf(link.href);
    if (!linkHost || linkHost === host) continue;
    if (PROGRAM_LINK_PATTERN.test(link.href)) domains.add(linkHost);
  }
  return domains.size;
}

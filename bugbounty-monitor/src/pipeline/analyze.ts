import { PROGRAM_TYPE_SHORT } from '@/lib/constants';
import { registrableDomain } from '@/lib/url';
import { classifyProgram } from './classify/programClassifier';
import { detectSelfHosted } from './classify/selfHosted';
import {
  extractCompanyName,
  extractContactMethods,
  extractCountry,
  extractProgramName,
  extractSummary,
} from './extract/company';
import { extractDates } from './extract/dates';
import { extractRewards } from './extract/rewards';
import { computeFacets, extractScope, extractTechnologies } from './extract/scope';
import { contentHash, parseHtml } from './parse/page';
import { scoreConfidence } from './score/confidence';
import type { AnalysisContext, AnalyzedProgram, ParsedPage } from './types';

/**
 * The analysis stage of the pipeline: HTML in, a fully-described program out.
 *
 * This function is pure — it performs no I/O — which is what lets the whole
 * classification surface be tested against fixtures.
 */
export function analyzePage(
  page: ParsedPage,
  context: AnalysisContext = { sourceKind: 'crawler' },
): AnalyzedProgram {
  const companyDomain = registrableDomain(page.finalUrl);

  const classification = classifyProgram(page);
  const selfHosted = detectSelfHosted(page);
  const dates = extractDates(page, context);
  const assets = extractScope(page, companyDomain);
  const rewards = extractRewards(page);
  const facets = computeFacets(assets, page.text);
  const technologies = extractTechnologies(page, assets);

  const companyName = extractCompanyName(page, companyDomain);
  const programName = extractProgramName(
    page,
    companyName,
    PROGRAM_TYPE_SHORT[classification.programType],
  );
  const country = extractCountry(page, page.finalUrl);

  const confidence = scoreConfidence({
    classification,
    selfHosted,
    dates,
    rewards,
    assets,
    url: page.finalUrl,
    context,
    sourceKinds: [context.sourceKind],
  });

  return {
    url: page.url,
    finalUrl: page.finalUrl,
    companyDomain,
    companyName,
    companyWebsite: `https://${companyDomain}`,
    programName,
    summary: extractSummary(page),
    classification,
    selfHosted,
    dates,
    assets,
    rewards,
    confidence,
    contactMethods: extractContactMethods(page),
    technologies,
    countryCode: country.code,
    countryName: country.name,
    policyText: extractPolicyExcerpt(page),
    contentHash: contentHash(page.text),
    contentText: page.text.slice(0, 200_000),
    languages: page.lang ? [page.lang] : [],
    facets,
  };
}

/** Convenience wrapper for callers holding raw HTML. */
export function analyzeHtml(
  html: string,
  url: string,
  finalUrl = url,
  context: AnalysisContext = { sourceKind: 'crawler' },
): AnalyzedProgram {
  return analyzePage(parseHtml(html, url, finalUrl), context);
}

/**
 * The part of the page that reads like policy, kept for the detail view and
 * for diffing. Capped so one enormous page cannot bloat the database.
 */
function extractPolicyExcerpt(page: ParsedPage): string | null {
  const POLICY_HEADING =
    /\b(?:policy|safe\s+harbou?r|guidelines?|rules|terms|legal|expectations|what\s+(?:we|you)\s+(?:ask|expect)|disclosure)\b/i;

  const parts: string[] = [];
  for (const list of page.lists) {
    if (list.heading && POLICY_HEADING.test(list.heading)) {
      parts.push(`${list.heading}\n${list.items.map((i) => `- ${i}`).join('\n')}`);
    }
  }

  if (parts.length === 0) {
    const sentences = page.text.split(/(?<=[.!?])\s+/);
    const policySentences = sentences.filter((s) =>
      /\b(?:safe\s+harbou?r|good\s+faith|legal\s+action|we\s+(?:ask|request|expect|will)|please\s+do\s+not|must\s+not)\b/i.test(s),
    );
    if (policySentences.length > 0) parts.push(policySentences.slice(0, 20).join(' '));
  }

  const text = parts.join('\n\n').trim();
  return text ? text.slice(0, 20_000) : null;
}

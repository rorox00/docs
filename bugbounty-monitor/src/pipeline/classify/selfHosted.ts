import { platformForHost, THIRD_PARTY_PLATFORMS } from '@/lib/platforms';
import { hostnameOf, isSecuritySubdomain, registrableDomain, sameRegistrableDomain } from '@/lib/url';
import type { ParsedPage, SelfHostedResult } from '../types';

/**
 * Decide whether a program is *self-hosted*.
 *
 * Product rules:
 *  - A page served from a third-party platform domain is never self-hosted.
 *  - A page on the company's own domain that publishes its own policy IS
 *    self-hosted, even when it also links to a HackerOne/Bugcrowd program —
 *    in that case we additionally record `hasThirdPartyProgram: true`.
 *  - A stub page whose only content is "our program lives on HackerOne" is NOT
 *    a self-hosted program: there is no self-published policy to monitor.
 */

/** Phrases that mean "the real program is somewhere else". */
const DELEGATION_PATTERNS: RegExp[] = [
  /\b(?:our|the)\s+(?:bug\s*bounty|vulnerability\s+disclosure|security)\s+program(?:me)?\s+is\s+(?:hosted|run|managed|operated)\s+(?:on|by|through|via)\b/i,
  /\b(?:please\s+)?(?:submit|report|send)\b.{0,60}\b(?:via|through|on|using|at)\s+(?:our\s+)?(?:hackerone|bugcrowd|intigriti|yeswehack|immunefi|hackenproof|synack|cobalt|zerocopter)\b/i,
  /\bwe\s+(?:run|host|manage|operate|partner)\b.{0,50}\b(?:with\s+)?(?:hackerone|bugcrowd|intigriti|yeswehack|immunefi)\b/i,
  /\b(?:visit|see|go\s+to)\s+our\s+(?:hackerone|bugcrowd|intigriti|yeswehack|immunefi)\s+(?:page|program)/i,
  /\ball\s+(?:reports|submissions)\s+must\s+be\s+(?:submitted|made)\s+(?:via|through|on)\b.{0,40}\b(?:hackerone|bugcrowd|intigriti|yeswehack|immunefi)/i,
];

/**
 * Evidence that the page carries a policy of its own worth monitoring,
 * regardless of whether a platform link also exists.
 */
const OWN_POLICY_PATTERNS: RegExp[] = [
  /\bsafe\s+harbou?r\b/i,
  /\b(?:in|out\s+of)\s+scope\b/i,
  /\bqualifying\s+vulnerabilit/i,
  /\bnon[- ]qualifying\b/i,
  /\bdisclosure\s+policy\b/i,
  /\brules\s+of\s+engagement\b/i,
  /\bsecurity@[\w.-]+\.\w+/i,
  /\bpgp\s+(?:key|fingerprint)\b/i,
  /\bwe\s+will\s+(?:respond|acknowledge|triage|review)\b/i,
  /\bplease\s+do\s+not\b.{0,80}\b(?:denial\s+of\s+service|social\s+engineering|physical|spam|automated\s+scan)/i,
  /\bbounty\s+(?:table|tiers?|amounts?|ranges?)\b/i,
  /\bresponse\s+targets?\b/i,
];

export function detectSelfHosted(page: ParsedPage): SelfHostedResult {
  const reasons: string[] = [];
  const host = hostnameOf(page.finalUrl) ?? '';
  const apex = registrableDomain(host);

  // 1. Hosted on a platform => not self-hosted, full stop.
  const hostingPlatform = platformForHost(host);
  if (hostingPlatform) {
    return {
      selfHosted: false,
      hostedOnPlatform: hostingPlatform.id,
      linkedPlatforms: [hostingPlatform.id],
      hasThirdPartyProgram: true,
      redirectsToPlatform: true,
      reasons: [`Program page is served from ${hostingPlatform.name} (${host})`],
    };
  }

  // 2. Which platforms does the page point at?
  const linkedPlatforms = new Set<string>();
  for (const link of page.links) {
    const linkHost = hostnameOf(link.href);
    if (!linkHost) continue;
    const platform = platformForHost(linkHost);
    if (platform) linkedPlatforms.add(platform.id);
  }
  // Platforms named in prose but not linked still indicate a parallel program.
  for (const platform of THIRD_PARTY_PLATFORMS) {
    if (linkedPlatforms.has(platform.id)) continue;
    const name = platform.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${name}\\b`, 'i').test(page.text)) linkedPlatforms.add(platform.id);
  }

  const hasThirdPartyProgram = linkedPlatforms.size > 0;
  if (hasThirdPartyProgram) {
    reasons.push(`Also references third-party platform(s): ${[...linkedPlatforms].join(', ')}`);
  }

  // 3. Does the page publish a policy of its own?
  const ownPolicyHits = OWN_POLICY_PATTERNS.filter((p) => p.test(page.text)).length;
  const delegates = DELEGATION_PATTERNS.some((p) => p.test(page.text));

  // A short page that only delegates is a signpost, not a program.
  const isThinPage = page.text.length < 1200;
  const redirectsToPlatform =
    hasThirdPartyProgram && delegates && (ownPolicyHits < 2 || isThinPage);

  if (redirectsToPlatform) {
    return {
      selfHosted: false,
      hostedOnPlatform: null,
      linkedPlatforms: [...linkedPlatforms],
      hasThirdPartyProgram: true,
      redirectsToPlatform: true,
      reasons: [
        ...reasons,
        'Page only directs researchers to a third-party platform and publishes no policy of its own',
      ],
    };
  }

  if (apex) reasons.push(`Published on the organisation's own domain (${apex})`);
  if (isSecuritySubdomain(page.finalUrl)) {
    reasons.push('Served from a dedicated security subdomain');
  }
  if (ownPolicyHits > 0) {
    reasons.push(`Publishes its own policy content (${ownPolicyHits} policy signals)`);
  }

  return {
    selfHosted: true,
    hostedOnPlatform: null,
    linkedPlatforms: [...linkedPlatforms],
    hasThirdPartyProgram,
    redirectsToPlatform: false,
    reasons,
  };
}

/**
 * True when `candidateUrl` belongs to the same organisation as `programUrl`.
 * Used by the deduplicator to merge `/security` and `/bug-bounty` on one site.
 */
export function belongsToSameOrganisation(a: string, b: string): boolean {
  return sameRegistrableDomain(a, b);
}

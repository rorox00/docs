import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { seedDomains } from '@/db/schema';
import { env } from '@/lib/env';
import { registrableDomain, safeNormalizeUrl } from '@/lib/url';
import { fetchPage } from '../../fetch/http';
import { looksLikeSecurityTxt, parseSecurityTxt, programUrlsFromSecurityTxt } from '../../parse/securityTxt';
import { PROGRAM_PATHS, SECURITY_SUBDOMAIN_PREFIXES } from '../paths';
import { candidate, type DiscoverySource, type DiscoveryRunContext } from '../source';
import type { CandidateUrl } from '../../types';

/**
 * Probes the conventional program paths on a set of domains.
 *
 * This is the backbone of discovery: a company that runs a self-hosted program
 * almost always publishes it at one of a small number of well-known URLs.
 *
 * Politeness: the number of paths tried per domain is capped by
 * `CRAWLER_MAX_PATHS_PER_DOMAIN`, and every request goes through the shared
 * rate limiter, so a domain sees one request every few seconds at most.
 */
export class WellKnownPathSource implements DiscoverySource {
  readonly id = 'well_known_paths';
  readonly kind = 'well_known_path' as const;
  readonly label = 'Well-known path probe';

  isEnabled(): boolean {
    return env().ENABLE_SOURCE_WELLKNOWN;
  }

  async discover(context: DiscoveryRunContext): Promise<CandidateUrl[]> {
    const domains = context.domains.length > 0 ? context.domains : await pickDomains(context.limit);
    if (domains.length === 0) {
      context.log('No domains available to probe; add seeds in the admin panel');
      return [];
    }

    const maxPaths = env().CRAWLER_MAX_PATHS_PER_DOMAIN;
    const paths = [...PROGRAM_PATHS].sort((a, b) => b.weight - a.weight).slice(0, maxPaths);
    const results: CandidateUrl[] = [];

    for (const domain of domains) {
      const found = await this.probeDomain(domain, paths, context);
      results.push(...found);
      await markCrawled(domain);
      if (results.length >= context.limit) break;
    }

    return results;
  }

  private async probeDomain(
    domain: string,
    paths: Array<{ path: string; weight: number }>,
    context: DiscoveryRunContext,
  ): Promise<CandidateUrl[]> {
    const out: CandidateUrl[] = [];
    const apex = registrableDomain(domain);
    if (!apex) return out;

    // security.txt first: when present it usually names the program URL
    // outright, which saves probing every other path.
    const securityTxt = await this.probeSecurityTxt(apex, context);
    out.push(...securityTxt.candidates);

    for (const { path, weight } of paths) {
      if (path.includes('security.txt')) continue; // already handled
      const url = `https://${apex}${path}`;
      const result = await fetchPage(url);

      if (!result.ok || !result.body) continue;
      // A soft 404 returns 200 with an error page; the classifier will reject
      // it, but skipping obvious ones here saves downstream work.
      if (isLikelySoft404(result.body)) continue;

      out.push(
        candidate(result.finalUrl, this.kind, weight, `Probed ${path} on ${apex}`, {
          hintedDate: result.headerLastModified,
          hintedDateKind: result.headerLastModified ? 'http_last_modified' : undefined,
        }),
      );
    }

    // Dedicated security subdomains.
    for (const prefix of SECURITY_SUBDOMAIN_PREFIXES) {
      const url = `https://${prefix}.${apex}/`;
      const result = await fetchPage(url);
      if (result.ok && result.body && !isLikelySoft404(result.body)) {
        out.push(candidate(result.finalUrl, this.kind, 80, `Security subdomain ${prefix}.${apex}`));
      }
    }

    context.log(`Probed ${apex}`, { candidates: out.length });
    return out;
  }

  /** Fetches `/.well-known/security.txt` and follows its `Policy:` field. */
  private async probeSecurityTxt(
    apex: string,
    context: DiscoveryRunContext,
  ): Promise<{ candidates: CandidateUrl[]; found: boolean }> {
    const out: CandidateUrl[] = [];

    for (const path of ['/.well-known/security.txt', '/security.txt']) {
      const url = `https://${apex}${path}`;
      const result = await fetchPage(url, { accept: 'text/plain, */*;q=0.5' });
      if (!result.ok || !result.body || !looksLikeSecurityTxt(result.body)) continue;

      const parsed = parseSecurityTxt(result.body, url);
      context.log(`security.txt found for ${apex}`, { policies: parsed.policy.length });

      // The security.txt itself is a candidate: for many organisations it is
      // the only machine-readable disclosure statement they publish.
      out.push(
        candidate(url, 'security_txt', 100, `security.txt for ${apex}`, {
          hintedDate: result.headerLastModified,
          hintedDateKind: result.headerLastModified ? 'http_last_modified' : undefined,
        }),
      );

      // The pages it points at are much richer candidates.
      for (const policyUrl of programUrlsFromSecurityTxt(parsed)) {
        const normalized = safeNormalizeUrl(policyUrl);
        if (!normalized) continue;
        out.push(candidate(normalized, 'security_txt', 98, `Policy field of ${url}`));
      }

      return { candidates: out, found: true };
    }

    return { candidates: out, found: false };
  }
}

/** Pages that answer 200 but are really "not found". */
export function isLikelySoft404(body: string): boolean {
  const head = body.slice(0, 4000).toLowerCase();
  if (body.trim().length < 200) return true;
  return /\b(?:404|page\s+not\s+found|not\s+found|no\s+such\s+page|doesn'?t\s+exist|page\s+you\s+(?:are\s+looking\s+for|requested))\b/.test(
    head,
  ) && !/\b(?:bug\s*bounty|vulnerability\s+disclosure|responsible\s+disclosure)\b/.test(head);
}

/** Least-recently-crawled enabled seed domains. */
async function pickDomains(limit: number): Promise<string[]> {
  const rows = await db()
    .select({ domain: seedDomains.domain })
    .from(seedDomains)
    .where(eq(seedDomains.enabled, true))
    .orderBy(sql`${seedDomains.lastCrawledAt} asc nulls first`)
    .limit(Math.max(1, Math.ceil(limit / 8)));
  return rows.map((r) => r.domain);
}

async function markCrawled(domain: string): Promise<void> {
  await db()
    .update(seedDomains)
    .set({ lastCrawledAt: new Date() })
    .where(eq(seedDomains.domain, registrableDomain(domain)));
}

import { env } from '@/lib/env';
import { parseLooseDate } from '@/lib/dates';
import { registrableDomain, safeNormalizeUrl } from '@/lib/url';
import { fetchPage, getRobots } from '../../fetch/http';
import { scoreCandidatePath } from '../paths';
import { candidate, type DiscoverySource, type DiscoveryRunContext } from '../source';
import type { CandidateUrl } from '../../types';

/**
 * Reads sitemaps and picks out program-shaped URLs.
 *
 * Sitemaps are valuable twice over: they reveal pages no path probe would
 * guess, and their `<lastmod>` is a genuine (if weak) recency signal — a brand
 * new sitemap entry for `/security/bug-bounty` is exactly what this product is
 * looking for.
 */
export class SitemapSource implements DiscoverySource {
  readonly id = 'sitemap';
  readonly kind = 'sitemap' as const;
  readonly label = 'Sitemap';

  isEnabled(): boolean {
    return env().ENABLE_SOURCE_SITEMAP;
  }

  async discover(context: DiscoveryRunContext): Promise<CandidateUrl[]> {
    const results: CandidateUrl[] = [];

    for (const domain of context.domains) {
      const apex = registrableDomain(domain);
      if (!apex) continue;

      for (const sitemapUrl of await this.locateSitemaps(apex)) {
        const found = await this.readSitemap(sitemapUrl, context, 0);
        results.push(...found);
        if (results.length >= context.limit) return results.slice(0, context.limit);
      }
    }

    return results;
  }

  /** robots.txt `Sitemap:` lines first, then the conventional locations. */
  private async locateSitemaps(apex: string): Promise<string[]> {
    const urls = new Set<string>();
    try {
      const robots = await getRobots(`https://${apex}/`);
      for (const sitemap of robots.sitemaps.slice(0, 5)) urls.add(sitemap);
    } catch {
      /* robots unavailable; fall back to conventions */
    }
    urls.add(`https://${apex}/sitemap.xml`);
    urls.add(`https://${apex}/sitemap_index.xml`);
    return [...urls].slice(0, 6);
  }

  /** Recursive: a sitemap index points at further sitemaps. */
  private async readSitemap(
    url: string,
    context: DiscoveryRunContext,
    depth: number,
  ): Promise<CandidateUrl[]> {
    if (depth > 2) return [];

    const result = await fetchPage(url, { accept: 'application/xml, text/xml, */*;q=0.5' });
    if (!result.ok || !result.body) return [];

    const body = result.body;
    const out: CandidateUrl[] = [];

    // A sitemap index: recurse into children that look security-related, plus
    // a couple of general ones.
    if (/<sitemapindex/i.test(body)) {
      const children = [...body.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)]
        .map((m) => m[1])
        .filter(Boolean);
      const prioritised = [
        ...children.filter((c) => /secur|legal|trust|polic|page/i.test(c)),
        ...children.filter((c) => !/secur|legal|trust|polic|page/i.test(c)),
      ].slice(0, 5);

      for (const child of prioritised) {
        out.push(...(await this.readSitemap(child, context, depth + 1)));
        if (out.length >= context.limit) break;
      }
      return out;
    }

    // A URL set: keep entries whose path looks like a program page.
    for (const match of body.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
      const entry = match[1];
      const loc = entry.match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1];
      if (!loc) continue;

      const normalized = safeNormalizeUrl(decodeXml(loc));
      if (!normalized) continue;

      let pathname: string;
      try {
        pathname = new URL(normalized).pathname;
      } catch {
        continue;
      }

      const score = scoreCandidatePath(pathname);
      if (score === null) continue;

      const lastmodRaw = entry.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1];
      const lastmod = lastmodRaw ? parseLooseDate(lastmodRaw, context.now) : null;

      out.push(
        candidate(normalized, this.kind, score, `Sitemap entry from ${url}`, {
          hintedDate: lastmod,
          hintedDateKind: lastmod ? 'sitemap_lastmod' : undefined,
        }),
      );

      if (out.length >= context.limit) break;
    }

    if (out.length > 0) context.log(`Sitemap ${url} yielded ${out.length} candidates`);
    return out;
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

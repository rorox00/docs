import { env } from '@/lib/env';
import { isAggregatorHost, isThirdPartyPlatformHost } from '@/lib/platforms';
import { parseLooseDate } from '@/lib/dates';
import { hostnameOf, safeNormalizeUrl } from '@/lib/url';
import { scoreCandidatePath, SEARCH_QUERIES } from '../paths';
import { candidate, type DiscoverySource, type DiscoveryRunContext } from '../source';
import type { CandidateUrl } from '../../types';

/**
 * Search-engine discovery.
 *
 * Providers are behind a small adapter interface so a deployment can use
 * whichever API it has a key for — and so the source degrades to a clear
 * "not configured" state rather than silently returning nothing.
 *
 * No provider is bundled with credentials; this source is inert until
 * `SEARCH_PROVIDER` and `SEARCH_API_KEY` are set.
 */

export interface SearchHit {
  url: string;
  title?: string;
  snippet?: string;
  /** Some APIs expose when they indexed or the page was published. */
  publishedAt?: Date | null;
}

export interface SearchProvider {
  readonly id: string;
  readonly label: string;
  search(query: string, count: number): Promise<SearchHit[]>;
}

/* ------------------------------- Providers ------------------------------ */

class BraveProvider implements SearchProvider {
  readonly id = 'brave';
  readonly label = 'Brave Search API';
  constructor(private readonly apiKey: string) {}

  async search(query: string, count: number): Promise<SearchHit[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(count, 20)));
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'x-subscription-token': this.apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Brave search failed: HTTP ${response.status}`);
    const data = (await response.json()) as {
      web?: { results?: Array<{ url: string; title?: string; description?: string; age?: string; page_age?: string }> };
    };
    return (data.web?.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.description,
      publishedAt: parseLooseDate(r.page_age ?? r.age ?? null),
    }));
  }
}

class GoogleCseProvider implements SearchProvider {
  readonly id = 'google_cse';
  readonly label = 'Google Programmable Search';
  constructor(
    private readonly apiKey: string,
    private readonly cx: string,
  ) {}

  async search(query: string, count: number): Promise<SearchHit[]> {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('cx', this.cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', String(Math.min(count, 10)));
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Google CSE failed: HTTP ${response.status}`);
    const data = (await response.json()) as {
      items?: Array<{ link: string; title?: string; snippet?: string; pagemap?: Record<string, unknown> }>;
    };
    return (data.items ?? []).map((item) => ({
      url: item.link,
      title: item.title,
      snippet: item.snippet,
      publishedAt: extractCseDate(item.pagemap),
    }));
  }
}

class BingProvider implements SearchProvider {
  readonly id = 'bing';
  readonly label = 'Bing Web Search';
  constructor(private readonly apiKey: string) {}

  async search(query: string, count: number): Promise<SearchHit[]> {
    const url = new URL('https://api.bing.microsoft.com/v7.0/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(count, 50)));
    const response = await fetch(url, {
      headers: { 'Ocp-Apim-Subscription-Key': this.apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Bing search failed: HTTP ${response.status}`);
    const data = (await response.json()) as {
      webPages?: { value?: Array<{ url: string; name?: string; snippet?: string; dateLastCrawled?: string }> };
    };
    return (data.webPages?.value ?? []).map((r) => ({
      url: r.url,
      title: r.name,
      snippet: r.snippet,
      publishedAt: parseLooseDate(r.dateLastCrawled ?? null),
    }));
  }
}

class SerpApiProvider implements SearchProvider {
  readonly id = 'serpapi';
  readonly label = 'SerpApi';
  constructor(private readonly apiKey: string) {}

  async search(query: string, count: number): Promise<SearchHit[]> {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('q', query);
    url.searchParams.set('num', String(Math.min(count, 20)));
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('engine', 'google');
    const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(`SerpApi failed: HTTP ${response.status}`);
    const data = (await response.json()) as {
      organic_results?: Array<{ link: string; title?: string; snippet?: string; date?: string }>;
    };
    return (data.organic_results ?? []).map((r) => ({
      url: r.link,
      title: r.title,
      snippet: r.snippet,
      publishedAt: parseLooseDate(r.date ?? null),
    }));
  }
}

function extractCseDate(pagemap: Record<string, unknown> | undefined): Date | null {
  if (!pagemap) return null;
  const metatags = pagemap.metatags;
  if (Array.isArray(metatags) && metatags.length > 0) {
    const tags = metatags[0] as Record<string, string>;
    return parseLooseDate(tags['article:published_time'] ?? tags['og:updated_time'] ?? null);
  }
  return null;
}

/** Builds the configured provider, or null when none is set up. */
export function resolveSearchProvider(): SearchProvider | null {
  const config = env();
  const key = config.SEARCH_API_KEY;
  switch (config.SEARCH_PROVIDER) {
    case 'brave':
      return key ? new BraveProvider(key) : null;
    case 'google_cse':
      return key && config.GOOGLE_CSE_ID ? new GoogleCseProvider(key, config.GOOGLE_CSE_ID) : null;
    case 'bing':
      return key ? new BingProvider(key) : null;
    case 'serpapi':
      return key ? new SerpApiProvider(key) : null;
    default:
      return null;
  }
}

/* -------------------------------- Source -------------------------------- */

export class SearchEngineSource implements DiscoverySource {
  readonly id = 'search_engine';
  readonly kind = 'search_engine' as const;
  readonly label = 'Search engine';

  isEnabled(): boolean {
    return env().ENABLE_SOURCE_SEARCH && resolveSearchProvider() !== null;
  }

  disabledReason(): string | null {
    if (!env().ENABLE_SOURCE_SEARCH) return 'Disabled via ENABLE_SOURCE_SEARCH';
    if (!resolveSearchProvider()) {
      return `No search provider configured (set SEARCH_PROVIDER and SEARCH_API_KEY; current: ${env().SEARCH_PROVIDER})`;
    }
    return null;
  }

  async discover(context: DiscoveryRunContext): Promise<CandidateUrl[]> {
    const provider = resolveSearchProvider();
    if (!provider) {
      context.log('Search source skipped: no provider configured');
      return [];
    }

    const config = env();
    const queries = buildQueries(context.domains).slice(0, config.SEARCH_MAX_QUERIES_PER_RUN);
    const seen = new Set<string>();
    const out: CandidateUrl[] = [];

    for (const query of queries) {
      let hits: SearchHit[];
      try {
        hits = await provider.search(query, config.SEARCH_RESULTS_PER_QUERY);
      } catch (error) {
        context.log(`Search query failed: ${query}`, { error: String(error) });
        continue;
      }

      for (const hit of hits) {
        const normalized = safeNormalizeUrl(hit.url);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);

        const host = hostnameOf(normalized);
        if (!host) continue;
        // Third-party platforms and content farms are filtered here rather than
        // downstream so they never even cost us a page fetch.
        if (isThirdPartyPlatformHost(host) || isAggregatorHost(host)) continue;

        let pathname: string;
        try {
          pathname = new URL(normalized).pathname;
        } catch {
          continue;
        }

        // Search results are noisy: only keep program-shaped URLs, unless the
        // title itself names a program.
        const pathScore = scoreCandidatePath(pathname);
        const titleLooksLikeProgram =
          !!hit.title &&
          /\b(?:bug\s*bounty|vulnerability\s+disclosure|responsible\s+disclosure|security\s+research)\b/i.test(hit.title);

        if (pathScore === null && !titleLooksLikeProgram) continue;

        out.push(
          candidate(normalized, this.kind, Math.min(90, (pathScore ?? 40) + (titleLooksLikeProgram ? 10 : 0)), `${provider.label}: ${query}`, {
            hintedDate: hit.publishedAt ?? null,
            hintedDateKind: hit.publishedAt ? 'search_engine_indexed' : undefined,
          }),
        );

        if (out.length >= context.limit) return out;
      }
    }

    context.log(`Search engine produced ${out.length} candidates from ${queries.length} queries`);
    return out;
  }
}

/** Generic queries, plus site-scoped ones when the run targets given domains. */
function buildQueries(domains: string[]): string[] {
  if (domains.length === 0) return SEARCH_QUERIES;
  const scoped: string[] = [];
  for (const domain of domains.slice(0, 10)) {
    scoped.push(`site:${domain} ("bug bounty" OR "vulnerability disclosure" OR "responsible disclosure")`);
  }
  return scoped;
}

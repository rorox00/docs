import { env } from '@/lib/env';
import { parseLooseDate } from '@/lib/dates';
import { registrableDomain, safeNormalizeUrl } from '@/lib/url';
import { fetchPage } from '../../fetch/http';
import { candidate, type DiscoverySource, type DiscoveryRunContext } from '../source';
import type { CandidateUrl } from '../../types';

/**
 * Watches company blog/news feeds for program announcements.
 *
 * A "we're launching a bug bounty program" post carries a real publication
 * date, which is one of the few signals that can legitimately establish a
 * launch date rather than a modification date.
 */
export class RssSource implements DiscoverySource {
  readonly id = 'rss';
  readonly kind = 'rss' as const;
  readonly label = 'RSS/Atom feeds';

  isEnabled(): boolean {
    return env().ENABLE_SOURCE_RSS;
  }

  async discover(context: DiscoveryRunContext): Promise<CandidateUrl[]> {
    const out: CandidateUrl[] = [];

    for (const domain of context.domains) {
      const apex = registrableDomain(domain);
      if (!apex) continue;

      for (const feedUrl of feedCandidates(apex)) {
        const result = await fetchPage(feedUrl, { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5' });
        if (!result.ok || !result.body) continue;
        if (!/<(?:rss|feed)\b/i.test(result.body.slice(0, 2000))) continue;

        out.push(...parseFeed(result.body, feedUrl, context));
        if (out.length >= context.limit) return out.slice(0, context.limit);
        break; // one working feed per domain is enough
      }
    }

    return out;
  }
}

function feedCandidates(apex: string): string[] {
  return [
    `https://${apex}/feed`,
    `https://${apex}/rss.xml`,
    `https://${apex}/blog/feed`,
    `https://${apex}/blog/rss.xml`,
    `https://${apex}/atom.xml`,
  ];
}

const ANNOUNCEMENT_PATTERN =
  /\b(?:bug\s*bounty|vulnerability\s+disclosure|responsible\s+disclosure|security\s+research(?:er)?\s+program|security\s+bounty|vdp)\b/i;

function parseFeed(xml: string, feedUrl: string, context: DiscoveryRunContext): CandidateUrl[] {
  const out: CandidateUrl[] = [];
  const entries = [
    ...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi),
  ];

  for (const match of entries) {
    const entry = match[1];
    const title = decodeXml(entry.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    if (!ANNOUNCEMENT_PATTERN.test(title)) continue;

    // RSS uses <link>text</link>; Atom uses <link href="...">.
    const link =
      entry.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ??
      entry.match(/<link[^>]*>\s*([^<\s]+)\s*<\/link>/i)?.[1];
    if (!link) continue;

    const normalized = safeNormalizeUrl(decodeXml(link));
    if (!normalized) continue;

    const dateText =
      entry.match(/<(?:pubDate|published|updated|dc:date)>\s*([^<]+?)\s*<\/(?:pubDate|published|updated|dc:date)>/i)?.[1];
    const published = dateText ? parseLooseDate(dateText, context.now) : null;

    out.push(
      candidate(normalized, 'rss', 65, `Feed announcement: ${title.slice(0, 120)}`, {
        hintedDate: published,
        hintedDateKind: published ? 'rss_published' : undefined,
      }),
    );
  }

  if (out.length > 0) context.log(`Feed ${feedUrl} yielded ${out.length} announcements`);
  return out;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

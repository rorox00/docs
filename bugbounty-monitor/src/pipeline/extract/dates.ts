import { parseLooseDate, plausible } from '@/lib/dates';
import type { AnalysisContext, DateSignal, DateSignalKind, ExtractedDates, ParsedPage } from '../types';

/**
 * Launch-date detection.
 *
 * The accuracy rule that shapes this whole module: *last modified is not a
 * launch date*. Signals are collected separately, kept in `signals`, and only a
 * signal that genuinely indicates a launch is allowed to populate `launchDate`.
 * When nothing qualifies, `launchDate` stays null and the UI shows "Unknown".
 */

/** How strongly each signal indicates the program's launch, 0..1. */
const SIGNAL_WEIGHTS: Record<DateSignalKind, number> = {
  explicit_launch_text: 1.0,
  json_ld_date_published: 0.85,
  meta_published_time: 0.8,
  rss_published: 0.7,
  time_element: 0.5,
  page_text_date: 0.4,
  sitemap_lastmod: 0.25,
  json_ld_date_modified: 0.2,
  meta_modified_time: 0.2,
  http_last_modified: 0.15,
  search_engine_indexed: 0.3,
  security_txt_expires: 0.1,
  first_discovered: 0.05,
};

/** Only these may be promoted to `launchDate`. */
const LAUNCH_QUALIFYING: DateSignalKind[] = [
  'explicit_launch_text',
  'json_ld_date_published',
  'meta_published_time',
  'rss_published',
];

/**
 * Sentences that state when the program started. Captured group 1 must contain
 * the date text.
 */
const EXPLICIT_LAUNCH_PATTERNS: RegExp[] = [
  /\b(?:program(?:me)?|polic(?:y|ies)|initiative)\s+(?:was\s+)?(?:launched|started|established|introduced|created|went\s+live|opened)\s+(?:on|in)?\s*([A-Za-z0-9 ,./-]{4,40})/i,
  /\b(?:launched|established|effective|live|in\s+effect|introduced|published)\s+(?:on|since|as\s+of|from)\s+([A-Za-z0-9 ,./-]{4,40})/i,
  /\b(?:launch|start|effective|publication|publish(?:ed)?)\s+date\s*[:–-]\s*([A-Za-z0-9 ,./-]{4,40})/i,
  /\bsince\s+((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})/i,
  /\bwe\s+(?:launched|started|introduced)\s+(?:our|this)\s+(?:bug\s*bounty|vulnerability\s+disclosure|security)?\s*program(?:me)?\s+(?:on|in)\s+([A-Za-z0-9 ,./-]{4,40})/i,
  /\b(?:this\s+)?(?:policy|program(?:me)?)\s+(?:is\s+)?effective\s+(?:as\s+of\s+|from\s+|on\s+)?([A-Za-z0-9 ,./-]{4,40})/i,
];

/** Dates that describe a revision, not a launch. */
const MODIFIED_PATTERNS: RegExp[] = [
  /\b(?:last\s+)?(?:updated|modified|revised|amended|changed|reviewed)\s*(?:on|at|:)?\s*([A-Za-z0-9 ,./-]{4,40})/i,
  /\b(?:version|revision)\s+[\d.]+\s*[,–-]\s*([A-Za-z0-9 ,./-]{4,40})/i,
];

function jsonLdValue(blocks: Array<Record<string, unknown>>, key: string): string | null {
  for (const block of blocks) {
    const value = block[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function extractDates(page: ParsedPage, context: AnalysisContext = { sourceKind: 'crawler' }): ExtractedDates {
  const now = context.now ?? new Date();
  const signals: DateSignal[] = [];

  const push = (kind: DateSignalKind, raw: string | null | undefined, parsed?: Date | null) => {
    if (!raw && !parsed) return;
    const date = parsed ?? parseLooseDate(raw, now);
    if (!date || !plausible(date, now)) return;
    signals.push({ kind, date, weight: SIGNAL_WEIGHTS[kind], raw: (raw ?? date.toISOString()).slice(0, 200) });
  };

  /* 1. Explicit launch statements in the page copy. */
  for (const pattern of EXPLICIT_LAUNCH_PATTERNS) {
    const match = page.text.match(pattern);
    if (match?.[1]) {
      const parsed = parseLooseDate(match[1], now);
      if (parsed) {
        push('explicit_launch_text', match[0].slice(0, 200), parsed);
        break;
      }
    }
  }

  /* 2. JSON-LD. */
  push('json_ld_date_published', jsonLdValue(page.jsonLd, 'datePublished'));
  push('json_ld_date_modified', jsonLdValue(page.jsonLd, 'dateModified'));
  // `dateCreated` behaves like datePublished for our purposes.
  push('json_ld_date_published', jsonLdValue(page.jsonLd, 'dateCreated'));

  /* 3. OpenGraph / article metadata. */
  push('meta_published_time', page.meta['article:published_time'] ?? page.meta['og:published_time']);
  push('meta_published_time', page.meta['datepublished'] ?? page.meta['publish_date']);
  push('meta_modified_time', page.meta['article:modified_time'] ?? page.meta['og:updated_time']);
  push('meta_modified_time', page.meta['datemodified'] ?? page.meta['last-modified']);

  /* 4. <time> elements. */
  for (const element of page.timeElements.slice(0, 10)) {
    push('time_element', element.datetime ?? element.text);
  }

  /* 5. Explicit "last updated" copy — recorded as modified, never as launch. */
  for (const pattern of MODIFIED_PATTERNS) {
    const match = page.text.match(pattern);
    if (match?.[1]) {
      const parsed = parseLooseDate(match[1], now);
      if (parsed) {
        signals.push({
          kind: 'meta_modified_time',
          date: parsed,
          weight: SIGNAL_WEIGHTS.meta_modified_time,
          raw: match[0].slice(0, 200),
        });
        break;
      }
    }
  }

  /* 6. Signals handed in by the discovery source and the HTTP layer. */
  if (context.hintedDate && context.hintedDateKind) {
    push(context.hintedDateKind, null, context.hintedDate);
  }
  if (context.httpLastModified) {
    push('http_last_modified', null, context.httpLastModified);
  }

  /* -------- Resolve the separate fields -------- */

  const best = (kinds: DateSignalKind[]): DateSignal | null => {
    const matching = signals.filter((s) => kinds.includes(s.kind));
    if (matching.length === 0) return null;
    // Highest weight wins; ties break toward the earlier date, because a
    // program cannot have launched later than its earliest publication signal.
    matching.sort((a, b) => b.weight - a.weight || a.date.getTime() - b.date.getTime());
    return matching[0];
  };

  const publishedSignal = best([
    'explicit_launch_text',
    'json_ld_date_published',
    'meta_published_time',
    'rss_published',
  ]);

  const modifiedSignal = best([
    'json_ld_date_modified',
    'meta_modified_time',
    'http_last_modified',
    'sitemap_lastmod',
  ]);

  const launchSignal = best(LAUNCH_QUALIFYING);

  let launchDate = launchSignal?.date ?? null;
  let launchDateSource = launchSignal?.kind ?? null;

  // Sanity: a launch date after the last modification is contradictory, so drop
  // it rather than publish something we cannot defend.
  if (launchDate && modifiedSignal && launchDate.getTime() > modifiedSignal.date.getTime() + 86_400_000) {
    if (launchSignal && launchSignal.weight < 0.9) {
      launchDate = null;
      launchDateSource = null;
    }
  }

  return {
    launchDate,
    launchDateSource,
    publishedDate: publishedSignal?.date ?? null,
    modifiedDate: modifiedSignal?.date ?? null,
    signals: signals.sort((a, b) => b.weight - a.weight),
  };
}

/**
 * The date the UI should sort "new programs" by: the launch date when we know
 * it, otherwise the date we first saw the program. Never invents a date.
 */
export function effectiveNewDate(
  launchDate: Date | null,
  firstSeenAt: Date,
): { date: Date; isLaunchDate: boolean } {
  if (launchDate) return { date: launchDate, isLaunchDate: true };
  return { date: firstSeenAt, isLaunchDate: false };
}

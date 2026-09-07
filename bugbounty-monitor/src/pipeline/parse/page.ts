import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { createHash } from 'node:crypto';
import { resolveUrl } from '@/lib/url';
import type { ParsedPage } from '../types';

/** Any cheerio selection, whatever node type it wraps. */
type CheerioNodes = cheerio.Cheerio<never>;

/** Elements whose text is never part of the page's meaning. */
const STRIP_SELECTORS = 'script, style, noscript, svg, iframe, template, canvas';

/**
 * Turn raw HTML into the structured view the rest of the pipeline works on.
 *
 * Everything downstream reads `ParsedPage` rather than HTML, which keeps the
 * classifiers testable with plain fixtures.
 */
export function parseHtml(html: string, url: string, finalUrl = url): ParsedPage {
  const $ = cheerio.load(html);

  const meta: Record<string, string> = {};
  $('meta').each((_, el) => {
    const key = ($(el).attr('property') || $(el).attr('name') || $(el).attr('itemprop') || '')
      .trim()
      .toLowerCase();
    const value = ($(el).attr('content') || '').trim();
    if (key && value && !meta[key]) meta[key] = value;
  });

  const jsonLd: Array<Record<string, unknown>> = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      collectJsonLd(JSON.parse(raw), jsonLd);
    } catch {
      /* malformed JSON-LD is common; ignore it rather than failing the page */
    }
  });

  const timeElements: Array<{ datetime: string | null; text: string }> = [];
  $('time').each((_, el) => {
    timeElements.push({
      datetime: $(el).attr('datetime') ?? null,
      text: collapse($(el).text()),
    });
  });

  const links: ParsedPage['links'] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const resolved = resolveUrl(finalUrl, href);
    if (!resolved) return;
    links.push({
      href: resolved,
      text: collapse($(el).text()).slice(0, 300),
      rel: $(el).attr('rel') ?? null,
    });
  });

  // Structured blocks are captured before the DOM is stripped for plain text,
  // because scope lists lose all meaning once flattened.
  const lists = extractLists($);
  const tables = extractTables($);

  const headings: ParsedPage['headings'] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const text = collapse($(el).text());
    if (text) headings.push({ level: Number(el.tagName.slice(1)), text: text.slice(0, 300) });
  });

  const title = collapse($('title').first().text()) || null;
  const canonicalUrl = (() => {
    const href = $('link[rel="canonical"]').first().attr('href');
    return href ? resolveUrl(finalUrl, href) : null;
  })();
  const lang = $('html').attr('lang')?.trim().toLowerCase() ?? null;

  $(STRIP_SELECTORS).remove();
  const text = extractText($);

  const emails = Array.from(
    new Set(
      [...text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)]
        .map((m) => m[0].toLowerCase())
        .concat(
          links
            .filter((l) => l.href.toLowerCase().startsWith('mailto:'))
            .map((l) => l.href.slice(7).split('?')[0].toLowerCase()),
        )
        .filter((e) => e.length < 120),
    ),
  );

  return {
    url,
    finalUrl,
    title,
    metaDescription: meta.description || meta['og:description'] || null,
    canonicalUrl,
    lang,
    text,
    lowerText: text.toLowerCase(),
    headings,
    links,
    jsonLd,
    meta,
    lists,
    tables,
    emails,
    timeElements,
  };
}

/** JSON-LD may be an array, or wrap its real payload in `@graph`. */
function collectJsonLd(node: unknown, out: Array<Record<string, unknown>>, depth = 0): void {
  if (depth > 6 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectJsonLd(child, out, depth + 1);
    return;
  }
  const record = node as Record<string, unknown>;
  out.push(record);
  if (record['@graph']) collectJsonLd(record['@graph'], out, depth + 1);
}

/**
 * Collect `ul`/`ol` and definition lists together with the nearest preceding
 * heading, which is what tells us "in scope" from "out of scope".
 */
function extractLists($: cheerio.CheerioAPI): ParsedPage['lists'] {
  const lists: ParsedPage['lists'] = [];

  $('ul, ol, dl').each((_, el) => {
    const $el = $(el);
    // Skip navigation and menus — they are never scope tables.
    if ($el.closest('nav, header, footer, [role="navigation"]').length > 0) return;

    const items: string[] = [];
    $el.children('li, dt, dd').each((__, child) => {
      const text = collapse($(child).clone().find('ul, ol, dl').remove().end().text());
      if (text && text.length <= 500) items.push(text);
    });
    if (items.length === 0) return;

    lists.push({ heading: nearestHeading($, $el as unknown as CheerioNodes), items });
  });

  return lists;
}

function extractTables($: cheerio.CheerioAPI): ParsedPage['tables'] {
  const tables: ParsedPage['tables'] = [];
  $('table').each((_, el) => {
    const $el = $(el);
    const rows: string[][] = [];
    $el.find('tr').each((__, tr) => {
      const cells: string[] = [];
      $(tr)
        .find('th, td')
        .each((___, cell) => {
          cells.push(collapse($(cell).text()).slice(0, 300));
        });
      if (cells.some((c) => c.length > 0)) rows.push(cells);
    });
    if (rows.length > 0) {
      const caption = collapse($el.find('caption').first().text());
      tables.push({ heading: caption || nearestHeading($, $el as unknown as CheerioNodes), rows });
    }
  });
  return tables;
}

/** Walks backwards through previous siblings and ancestors for a heading. */
function nearestHeading($: cheerio.CheerioAPI, $el: CheerioNodes): string | null {
  let node = $el;
  for (let hops = 0; hops < 6; hops += 1) {
    const heading = node.prevAll('h1, h2, h3, h4, h5, h6, p > strong, strong, b').first();
    if (heading.length > 0) {
      const text = collapse(heading.text());
      if (text) return text.slice(0, 200);
    }
    const parent = node.parent();
    if (parent.length === 0 || parent.is('body, html')) break;
    node = parent as CheerioNodes;
  }
  return null;
}

/** Elements after which a line break belongs when flattening to text. */
const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

/**
 * Flatten the document to text, inserting a newline at every block boundary.
 *
 * cheerio's `.text()` concatenates adjacent cells with no separator, which
 * turns a reward table into `Critical$5,000High$2,000` and makes both severity
 * matching and amount parsing unreliable. Walking the tree ourselves keeps
 * table rows and list items on separate lines.
 */
function extractText($: cheerio.CheerioAPI): string {
  const parts: string[] = [];

  const walk = (node: AnyNode): void => {
    if (node.type === 'text') {
      parts.push(node.data ?? '');
      return;
    }
    if (node.type !== 'tag') return;

    const tag = node.name.toLowerCase();
    if (tag === 'br') {
      parts.push('\n');
      return;
    }

    const isBlock = BLOCK_ELEMENTS.has(tag);
    if (isBlock) parts.push('\n');
    for (const child of node.children ?? []) walk(child as AnyNode);
    if (isBlock) parts.push('\n');
  };

  const root = $('body').get(0) ?? $.root().get(0);
  if (root) walk(root as AnyNode);

  return parts
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function collapse(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Stable hash of the page's meaningful content. Used to decide whether a page
 * changed between crawls, so it must ignore volatile noise (whitespace, case,
 * cache-busting query strings, CSRF tokens and timestamps).
 */
export function contentHash(text: string): string {
  const normalised = text
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, '')
    .replace(/\b[0-9a-f]{16,}\b/g, '')
    .replace(/[^a-z0-9$€£₹%*.@\/:\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(normalised).digest('hex');
}

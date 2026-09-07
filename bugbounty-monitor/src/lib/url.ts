/**
 * URL and domain normalisation helpers.
 *
 * Deduplication leans heavily on these: two candidate URLs that normalise to
 * the same string are treated as the same page, and two programs on the same
 * registrable domain are treated as the same company.
 */

/**
 * Public suffixes that need two labels to reach the registrable domain.
 * This is a pragmatic subset of the PSL covering the suffixes we actually meet;
 * anything not listed falls back to "last two labels".
 */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'net.uk', 'sch.uk', 'ltd.uk', 'plc.uk',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'ad.jp', 'ed.jp', 'gr.jp', 'lg.jp',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'ac.in', 'edu.in', 'gov.in', 'res.in',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 're.kr', 'pe.kr',
  'co.za', 'org.za', 'net.za', 'gov.za', 'ac.za',
  'com.mx', 'org.mx', 'net.mx', 'gob.mx', 'edu.mx',
  'com.ar', 'net.ar', 'org.ar', 'gob.ar', 'edu.ar',
  'com.sg', 'net.sg', 'org.sg', 'gov.sg', 'edu.sg',
  'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr',
  'com.tw', 'net.tw', 'org.tw', 'gov.tw', 'edu.tw',
  'com.hk', 'net.hk', 'org.hk', 'gov.hk', 'edu.hk',
  'com.my', 'net.my', 'org.my', 'gov.my', 'edu.my',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
  'co.il', 'org.il', 'net.il', 'gov.il', 'ac.il',
  'co.id', 'or.id', 'go.id', 'ac.id', 'web.id',
  'com.pl', 'net.pl', 'org.pl', 'gov.pl', 'edu.pl',
  'com.ua', 'net.ua', 'org.ua', 'gov.ua', 'edu.ua',
  'com.co', 'net.co', 'org.co', 'gov.co', 'edu.co',
  'com.ph', 'net.ph', 'org.ph', 'gov.ph', 'edu.ph',
  'com.vn', 'net.vn', 'org.vn', 'gov.vn', 'edu.vn',
  'com.pk', 'net.pk', 'org.pk', 'gov.pk', 'edu.pk',
  'com.eg', 'net.eg', 'org.eg', 'gov.eg', 'edu.eg',
  'com.sa', 'net.sa', 'org.sa', 'gov.sa', 'edu.sa',
  'co.th', 'in.th', 'go.th', 'ac.th', 'or.th',
]);

/** Tracking / session parameters that never change page identity. */
const NOISE_QUERY_PARAMS = [
  /^utm_/i, /^ga_/i, /^gclid$/i, /^fbclid$/i, /^msclkid$/i, /^mc_(cid|eid)$/i,
  /^ref$/i, /^referrer$/i, /^source$/i, /^_ga$/i, /^_gl$/i, /^igshid$/i,
  /^yclid$/i, /^vero_(id|conv)$/i, /^hsa_/i, /^__hs/i, /^trk$/i, /^cmpid$/i,
];

export function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/** Returns the registrable ("apex") domain, e.g. `a.b.example.co.uk` -> `example.co.uk`. */
export function registrableDomain(hostnameOrUrl: string): string {
  let host = hostnameOrUrl;
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname;
    } catch {
      /* fall through and treat as a bare hostname */
    }
  }
  host = host.toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
  if (!host || host === 'localhost') return host;
  // IPv4 / IPv6 literals have no registrable domain.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return host;

  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');

  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

/** True when both URLs/hosts share a registrable domain. */
export function sameRegistrableDomain(a: string, b: string): boolean {
  const da = registrableDomain(a);
  const db = registrableDomain(b);
  return da !== '' && da === db;
}

export interface NormalizeOptions {
  /** Keep the query string (minus tracking noise). Defaults to true. */
  keepQuery?: boolean;
  /** Force the scheme to https for identity purposes. Defaults to true. */
  forceHttps?: boolean;
}

/**
 * Canonical form of a URL used as the deduplication key.
 * Lowercases host, drops `www.`, default ports, fragments, tracking params and
 * a trailing slash; sorts remaining query parameters.
 */
export function normalizeUrl(input: string, options: NormalizeOptions = {}): string {
  const { keepQuery = true, forceHttps = true } = options;
  const raw = input.trim();
  if (!raw) throw new Error('Cannot normalise an empty URL');

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);

  url.protocol = forceHttps ? 'https:' : url.protocol.toLowerCase();
  url.hostname = stripWww(url.hostname);
  url.hash = '';
  if ((url.port === '80' && url.protocol === 'http:') || (url.port === '443' && url.protocol === 'https:')) {
    url.port = '';
  }

  if (!keepQuery) {
    url.search = '';
  } else {
    const params = [...url.searchParams.entries()].filter(
      ([key]) => !NOISE_QUERY_PARAMS.some((re) => re.test(key)),
    );
    params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    url.search = params.length
      ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
      : '';
  }

  let path = url.pathname.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  // Common index files add nothing to identity.
  path = path.replace(/\/index\.(html?|php|aspx?|jsp)$/i, '') || '/';
  url.pathname = path;

  return url.toString();
}

/** Normalise without throwing; returns null for malformed input. */
export function safeNormalizeUrl(input: string, options?: NormalizeOptions): string | null {
  try {
    return normalizeUrl(input, options);
  } catch {
    return null;
  }
}

export function hostnameOf(input: string): string | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function pathnameOf(input: string): string {
  try {
    return new URL(input).pathname.toLowerCase();
  } catch {
    return '';
  }
}

export function originOf(input: string): string | null {
  try {
    return new URL(input).origin;
  } catch {
    return null;
  }
}

/** Resolve a possibly relative href against a base URL. */
export function resolveUrl(base: string, href: string): string | null {
  try {
    const resolved = new URL(href, base);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

/** True when the URL points at a downloadable asset rather than a document. */
const NON_DOCUMENT_EXT =
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|woff2?|ttf|eot|zip|gz|tar|pdf|mp4|mp3|avi|mov|dmg|exe|apk|ipa|csv|xlsx?|docx?|pptx?)$/i;

export function looksLikeDocumentUrl(input: string): boolean {
  const path = pathnameOf(input);
  if (!path) return false;
  return !NON_DOCUMENT_EXT.test(path);
}

/** Human label for a URL, e.g. `https://example.com/security` -> `example.com/security`. */
export function displayUrl(input: string, maxLength = 60): string {
  let text = input.replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (text.endsWith('/')) text = text.slice(0, -1);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/**
 * A subdomain dedicated to security, e.g. `security.example.com`.
 * These are a strong self-hosting signal even when the path is `/`.
 */
const SECURITY_SUBDOMAIN_LABELS = new Set([
  'security', 'bugbounty', 'bug-bounty', 'bounty', 'vdp', 'psirt',
  'disclosure', 'responsibledisclosure', 'responsible-disclosure', 'trust', 'hackerone',
]);

export function isSecuritySubdomain(hostnameOrUrl: string): boolean {
  const host = hostnameOf(hostnameOrUrl);
  if (!host) return false;
  const apex = registrableDomain(host);
  if (host === apex) return false;
  const prefix = host.slice(0, host.length - apex.length - 1);
  const labels = prefix.split('.');
  const first = labels[labels.length - 1] ?? '';
  // `hackerone` only counts as a security subdomain of the company's own domain.
  if (first === 'hackerone' && apex === 'hackerone.com') return false;
  return SECURITY_SUBDOMAIN_LABELS.has(first);
}

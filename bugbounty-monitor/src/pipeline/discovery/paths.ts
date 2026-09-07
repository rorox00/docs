/**
 * The URL paths a company uses when it publishes its own program.
 *
 * `weight` seeds the candidate priority: a hit on `/.well-known/security.txt`
 * is far more meaningful than a hit on `/security`, which many sites use for a
 * marketing page.
 */
export interface ProbePath {
  path: string;
  weight: number;
}

export const PROGRAM_PATHS: ProbePath[] = [
  { path: '/.well-known/security.txt', weight: 100 },
  { path: '/security.txt', weight: 90 },
  { path: '/bug-bounty', weight: 85 },
  { path: '/bugbounty', weight: 85 },
  { path: '/bug-bounty-program', weight: 85 },
  { path: '/security/bug-bounty', weight: 85 },
  { path: '/security/vulnerability-disclosure', weight: 82 },
  { path: '/vulnerability-disclosure', weight: 82 },
  { path: '/vulnerability-disclosure-policy', weight: 82 },
  { path: '/responsible-disclosure', weight: 80 },
  { path: '/security/responsible-disclosure', weight: 80 },
  { path: '/security-research', weight: 72 },
  { path: '/security-researchers', weight: 72 },
  { path: '/security/disclosure', weight: 72 },
  { path: '/security/report', weight: 70 },
  { path: '/report-a-vulnerability', weight: 70 },
  { path: '/security/policy', weight: 62 },
  { path: '/security', weight: 55 },
  { path: '/trust/security', weight: 52 },
  { path: '/legal/security', weight: 48 },
  { path: '/about/security', weight: 45 },
  { path: '/vdp', weight: 78 },
  { path: '/disclosure', weight: 60 },
  { path: '/security/vdp', weight: 78 },
];

/** Security-dedicated subdomains worth probing at `/`. */
export const SECURITY_SUBDOMAIN_PREFIXES = ['security', 'bugbounty', 'trust', 'psirt'];

/** Search phrases used by the search-engine source. */
export const SEARCH_QUERIES: string[] = [
  '"bug bounty program" -site:hackerone.com -site:bugcrowd.com -site:intigriti.com',
  '"security bounty" "report a vulnerability"',
  '"vulnerability disclosure program" "in scope"',
  '"responsible disclosure" "safe harbor"',
  '"security researchers" "report a vulnerability" "we will not pursue legal action"',
  '"security research program" "out of scope"',
  '"report a security vulnerability" "security@"',
  'inurl:/security/bug-bounty',
  'inurl:/responsible-disclosure',
  'inurl:/vulnerability-disclosure',
  'inurl:/.well-known/security.txt "Policy:"',
  '"hall of fame" security researchers vulnerability disclosure',
  '"bug bounty" "maximum bounty" -site:hackerone.com -site:bugcrowd.com',
  '"we offer rewards" "security vulnerabilities"',
];

/**
 * Cheap pre-filter run on a URL before it is fetched. Returns a priority, or
 * null when the URL is not worth a request at all.
 */
export function scoreCandidatePath(pathname: string): number | null {
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/';

  const exact = PROGRAM_PATHS.find((p) => p.path === path);
  if (exact) return exact.weight;

  // Sub-paths of a program path, e.g. `/security/bug-bounty/scope`.
  const prefix = PROGRAM_PATHS.filter((p) => p.path !== '/security' && path.startsWith(`${p.path}/`))
    .sort((a, b) => b.weight - a.weight)[0];
  if (prefix) return Math.max(30, prefix.weight - 15);

  if (/bug-?bounty/.test(path)) return 70;
  if (/vulnerability[-_]?disclosure|responsible[-_]?disclosure|\bvdp\b/.test(path)) return 68;
  if (/security[-_]?research/.test(path)) return 60;
  if (/(^|\/)security(\/|$)/.test(path)) return 45;
  if (/disclosure|report[-_]?(?:a[-_]?)?vulnerability/.test(path)) return 40;

  return null;
}

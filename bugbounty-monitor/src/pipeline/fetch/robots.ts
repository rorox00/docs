/**
 * Minimal robots.txt parser covering the directives that matter for a polite
 * read-only crawler: User-agent grouping, Allow/Disallow with `*` and `$`
 * wildcards, Crawl-delay and Sitemap.
 *
 * Longest-match-wins is applied per RFC 9309; Allow beats Disallow on ties.
 */

export interface RobotsRule {
  type: 'allow' | 'disallow';
  path: string;
  pattern: RegExp;
  length: number;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds?: number;
}

export interface RobotsTxt {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export const EMPTY_ROBOTS: RobotsTxt = { groups: [], sitemaps: [] };

function toPattern(path: string): RegExp {
  const anchored = path.endsWith('$');
  const body = anchored ? path.slice(0, -1) : path;
  const escaped = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

export function parseRobots(text: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];

  let current: RobotsGroup | null = null;
  // A blank line or a rule ends an agent block; consecutive User-agent lines
  // share one group.
  let acceptingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    switch (field) {
      case 'user-agent': {
        if (!current || !acceptingAgents) {
          current = { agents: [], rules: [] };
          groups.push(current);
          acceptingAgents = true;
        }
        current.agents.push(value.toLowerCase());
        break;
      }
      case 'allow':
      case 'disallow': {
        if (!current) {
          current = { agents: ['*'], rules: [] };
          groups.push(current);
        }
        acceptingAgents = false;
        // `Disallow:` with an empty value means "allow everything".
        if (field === 'disallow' && value === '') break;
        if (!value.startsWith('/')) break;
        current.rules.push({
          type: field,
          path: value,
          pattern: toPattern(value),
          length: value.length,
        });
        break;
      }
      case 'crawl-delay': {
        if (current) {
          const parsed = Number.parseFloat(value);
          if (Number.isFinite(parsed) && parsed >= 0) current.crawlDelaySeconds = parsed;
          acceptingAgents = false;
        }
        break;
      }
      case 'sitemap': {
        if (/^https?:\/\//i.test(value)) sitemaps.push(value);
        break;
      }
      default:
        break;
    }
  }

  return { groups, sitemaps };
}

/** Picks the most specific group matching `userAgent`, else the `*` group. */
export function groupFor(robots: RobotsTxt, userAgent: string): RobotsGroup | null {
  const ua = userAgent.toLowerCase();
  let best: RobotsGroup | null = null;
  let bestLength = -1;

  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent === '*') {
        if (bestLength < 0) best = best ?? group;
        continue;
      }
      if (ua.includes(agent) && agent.length > bestLength) {
        best = group;
        bestLength = agent.length;
      }
    }
  }

  if (bestLength >= 0) return best;
  return robots.groups.find((g) => g.agents.includes('*')) ?? null;
}

export function isAllowed(robots: RobotsTxt, userAgent: string, pathname: string): boolean {
  const group = groupFor(robots, userAgent);
  if (!group || group.rules.length === 0) return true;

  const path = pathname || '/';
  let decision: 'allow' | 'disallow' = 'allow';
  let matchedLength = -1;

  for (const rule of group.rules) {
    if (!rule.pattern.test(path)) continue;
    if (rule.length > matchedLength || (rule.length === matchedLength && rule.type === 'allow')) {
      matchedLength = rule.length;
      decision = rule.type;
    }
  }

  return decision === 'allow';
}

export function crawlDelayMs(robots: RobotsTxt, userAgent: string): number | null {
  const group = groupFor(robots, userAgent);
  if (!group?.crawlDelaySeconds) return null;
  // Cap absurd values so one site cannot stall a whole run.
  return Math.min(group.crawlDelaySeconds * 1000, 60_000);
}

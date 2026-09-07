/**
 * Registry of third-party bug bounty / VDP platforms.
 *
 * The product rule is: a program page hosted on one of these domains is NOT
 * self-hosted. A company page that merely *links* to one of these is still
 * self-hosted, but we record that a third-party program also exists.
 */
export interface ThirdPartyPlatform {
  id: string;
  name: string;
  /** Registrable domains owned by the platform. */
  domains: string[];
  /** Extra hostname fragments that also indicate the platform. */
  hostFragments?: string[];
}

export const THIRD_PARTY_PLATFORMS: ThirdPartyPlatform[] = [
  { id: 'hackerone', name: 'HackerOne', domains: ['hackerone.com', 'h1.community', 'hackerone.net'] },
  { id: 'bugcrowd', name: 'Bugcrowd', domains: ['bugcrowd.com', 'bugcrowdusercontent.com'] },
  { id: 'intigriti', name: 'Intigriti', domains: ['intigriti.com', 'intigriti.io'] },
  { id: 'yeswehack', name: 'YesWeHack', domains: ['yeswehack.com'] },
  { id: 'immunefi', name: 'Immunefi', domains: ['immunefi.com'] },
  { id: 'hackenproof', name: 'HackenProof', domains: ['hackenproof.com'] },
  { id: 'openbugbounty', name: 'Open Bug Bounty', domains: ['openbugbounty.org'] },
  { id: 'synack', name: 'Synack', domains: ['synack.com'] },
  { id: 'cobalt', name: 'Cobalt', domains: ['cobalt.io'] },
  { id: 'safehats', name: 'SafeHats', domains: ['safehats.com'] },
  { id: 'zerocopter', name: 'Zerocopter', domains: ['zerocopter.com'] },
  { id: 'huntr', name: 'huntr', domains: ['huntr.com', 'huntr.dev'] },
  { id: 'federacy', name: 'Federacy', domains: ['federacy.com'] },
  { id: 'antihack', name: 'AntiHack', domains: ['antihack.me'] },
  { id: 'bugbase', name: 'BugBase', domains: ['bugbase.ai'] },
  { id: 'bugbounter', name: 'BugBounter', domains: ['bugbounter.com'] },
  { id: 'bugv', name: 'BugV', domains: ['bugv.io'] },
  { id: 'code4rena', name: 'Code4rena', domains: ['code4rena.com'] },
  { id: 'sherlock', name: 'Sherlock', domains: ['sherlock.xyz'] },
  { id: 'cantina', name: 'Cantina', domains: ['cantina.xyz'] },
  { id: 'hats_finance', name: 'Hats Finance', domains: ['hats.finance'] },
  { id: 'vulnerability_lab', name: 'Vulnerability Lab', domains: ['vulnerability-lab.com'] },
  { id: 'disclose_io', name: 'disclose.io', domains: ['disclose.io'] },
  { id: 'inspectiv', name: 'Inspectiv', domains: ['inspectiv.com'] },
  { id: 'topcoder_bb', name: 'Bugbounty.jp', domains: ['bugbounty.jp'] },
  { id: 'securebug', name: 'SecureBug', domains: ['securebug.se'] },
  { id: 'redstorm', name: 'RedStorm', domains: ['redstorm.io'] },
];

const DOMAIN_INDEX: Map<string, ThirdPartyPlatform> = (() => {
  const map = new Map<string, ThirdPartyPlatform>();
  for (const platform of THIRD_PARTY_PLATFORMS) {
    for (const domain of platform.domains) map.set(domain.toLowerCase(), platform);
  }
  return map;
})();

/** Returns the platform that owns `hostname`, or null when it is not one. */
export function platformForHost(hostname: string): ThirdPartyPlatform | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i += 1) {
    const suffix = labels.slice(i).join('.');
    const hit = DOMAIN_INDEX.get(suffix);
    if (hit) return hit;
  }
  return null;
}

export function isThirdPartyPlatformHost(hostname: string): boolean {
  return platformForHost(hostname) !== null;
}

export function platformById(id: string): ThirdPartyPlatform | undefined {
  return THIRD_PARTY_PLATFORMS.find((p) => p.id === id);
}

/**
 * Hosts that legitimately host *someone else's* content. A program page on one
 * of these is not evidence that the company runs a self-hosted program.
 */
export const AGGREGATOR_AND_DOC_HOSTS = new Set([
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'medium.com',
  'wordpress.com',
  'blogspot.com',
  'notion.site',
  'notion.so',
  'gitbook.io',
  'readthedocs.io',
  'zendesk.com',
  'freshdesk.com',
  'atlassian.net',
  'reddit.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'facebook.com',
  'youtube.com',
  'stackoverflow.com',
  'quora.com',
  'wikipedia.org',
  'archive.org',
  'web.archive.org',
]);

export function isAggregatorHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i += 1) {
    if (AGGREGATOR_AND_DOC_HOSTS.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}

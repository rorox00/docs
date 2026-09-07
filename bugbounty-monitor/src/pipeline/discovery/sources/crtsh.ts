import { env } from '@/lib/env';
import { registrableDomain } from '@/lib/url';
import { candidate, type DiscoverySource, type DiscoveryRunContext } from '../source';
import type { CandidateUrl } from '../../types';

/**
 * Certificate-transparency discovery.
 *
 * CT logs are public and often reveal a `security.` or `bugbounty.` subdomain
 * days before anything links to it — which is exactly the "before it becomes
 * widely known" window this product targets.
 *
 * Off by default: crt.sh is a community service and this source should only be
 * enabled deliberately.
 */
export class CertificateTransparencySource implements DiscoverySource {
  readonly id = 'crtsh';
  readonly kind = 'certificate_transparency' as const;
  readonly label = 'Certificate transparency (crt.sh)';

  isEnabled(): boolean {
    return env().ENABLE_SOURCE_CRTSH;
  }

  disabledReason(): string | null {
    return this.isEnabled() ? null : 'Disabled via ENABLE_SOURCE_CRTSH';
  }

  async discover(context: DiscoveryRunContext): Promise<CandidateUrl[]> {
    if (context.domains.length === 0) {
      context.log('Certificate transparency source needs target domains');
      return [];
    }

    const out: CandidateUrl[] = [];

    for (const domain of context.domains.slice(0, 20)) {
      const apex = registrableDomain(domain);
      if (!apex) continue;

      let names: string[];
      try {
        names = await queryCrtSh(apex);
      } catch (error) {
        context.log(`crt.sh query failed for ${apex}`, { error: String(error) });
        continue;
      }

      for (const name of names) {
        // Only security-flavoured hostnames are interesting here.
        if (!/^(?:security|bugbounty|bug-bounty|vdp|psirt|disclosure|trust)\./i.test(name)) continue;
        out.push(
          candidate(`https://${name}/`, this.kind, 70, `Certificate transparency log for ${apex}`),
        );
        if (out.length >= context.limit) return out;
      }
    }

    return out;
  }
}

async function queryCrtSh(domain: string): Promise<string[]> {
  const url = `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`;
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': env().CRAWLER_USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`crt.sh returned HTTP ${response.status}`);

  const data = (await response.json()) as Array<{ name_value?: string }>;
  const names = new Set<string>();
  for (const row of data.slice(0, 2000)) {
    for (const name of (row.name_value ?? '').split('\n')) {
      const clean = name.trim().toLowerCase();
      if (!clean || clean.startsWith('*.')) continue;
      names.add(clean);
    }
  }
  return [...names];
}

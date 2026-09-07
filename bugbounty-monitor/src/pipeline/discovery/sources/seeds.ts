import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { seedDomains } from '@/db/schema';
import { env } from '@/lib/env';
import { registrableDomain } from '@/lib/url';
import { candidate, type DiscoverySource, type DiscoveryRunContext } from '../source';
import type { CandidateUrl } from '../../types';

/**
 * Turns the curated seed-domain list into candidates for the highest-value
 * paths. This is the source that makes a fresh install produce results
 * immediately, before any search-engine key is configured.
 */
export class SeedListSource implements DiscoverySource {
  readonly id = 'seed_list';
  readonly kind = 'seed_list' as const;
  readonly label = 'Seed domain list';

  isEnabled(): boolean {
    return env().ENABLE_SOURCE_SEEDS;
  }

  async discover(context: DiscoveryRunContext): Promise<CandidateUrl[]> {
    const domains =
      context.domains.length > 0
        ? context.domains
        : (
            await db()
              .select({ domain: seedDomains.domain })
              .from(seedDomains)
              .where(eq(seedDomains.enabled, true))
              .orderBy(sql`${seedDomains.lastCrawledAt} asc nulls first`)
              .limit(Math.max(4, Math.ceil(context.limit / 4)))
          ).map((r) => r.domain);

    const out: CandidateUrl[] = [];
    for (const domain of domains) {
      const apex = registrableDomain(domain);
      if (!apex) continue;
      // Only the two highest-signal entry points; the path prober takes it from
      // here for domains that look promising.
      out.push(candidate(`https://${apex}/.well-known/security.txt`, this.kind, 95, 'Seed domain'));
      out.push(candidate(`https://${apex}/security`, this.kind, 55, 'Seed domain'));
      if (out.length >= context.limit) break;
    }

    context.log(`Seed list produced ${out.length} candidates from ${domains.length} domains`);
    return out.slice(0, context.limit);
  }
}

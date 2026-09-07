import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { programs, sources } from '@/db/schema';
import { normalizeUrl, pathnameOf, registrableDomain, safeNormalizeUrl } from '@/lib/url';
import { scoreCandidatePath } from './discovery/paths';
import type { AnalyzedProgram } from './types';

/**
 * Deduplication.
 *
 * One organisation frequently publishes the same program at several URLs
 * (`/security`, `/bug-bounty`, `/security/research`). Treating those as three
 * programs would wreck the "new programs" feed, so they are merged into one
 * record and every URL is kept as a source.
 */

export interface DedupeMatch {
  programId: number;
  /** Why we consider this the same program. */
  reason: string;
  /** True when the incoming URL is a better canonical URL than the stored one. */
  shouldReplaceCanonical: boolean;
}

/**
 * How canonical a URL is for a program. `/security/bug-bounty` beats
 * `/security/bug-bounty/faq`, and a shorter path beats a longer one.
 */
export function canonicalRank(url: string): number {
  const path = pathnameOf(url);
  const base = scoreCandidatePath(path) ?? 0;
  // Prefer shallower paths when the keyword score ties.
  const depthPenalty = Math.max(0, path.split('/').filter(Boolean).length - 1) * 2;
  return base - depthPenalty;
}

/**
 * Find an existing program that the analysed page is a duplicate of.
 *
 * Matching is deliberately conservative: same organisation is necessary but not
 * sufficient, because a company can legitimately run separate programs (e.g. a
 * VDP and a paid bounty). We merge when the URLs are equivalent, when one page
 * is already recorded as a source of the other, or when the content is
 * byte-identical.
 */
export async function findDuplicate(analysis: AnalyzedProgram): Promise<DedupeMatch | null> {
  const normalized = safeNormalizeUrl(analysis.finalUrl);
  if (!normalized) return null;

  const domain = analysis.companyDomain;

  // 1. Exact canonical URL match.
  const [exact] = await db()
    .select({ id: programs.id, programUrl: programs.programUrl })
    .from(programs)
    .where(eq(programs.programUrl, normalized))
    .limit(1);
  if (exact) {
    return { programId: exact.id, reason: 'Identical program URL', shouldReplaceCanonical: false };
  }

  // 2. This URL is already recorded as a source of some program.
  const [viaSource] = await db()
    .select({ programId: sources.programId })
    .from(sources)
    .where(eq(sources.url, normalized))
    .limit(1);
  if (viaSource) {
    return {
      programId: viaSource.programId,
      reason: 'URL already recorded as a source of an existing program',
      shouldReplaceCanonical: false,
    };
  }

  // 3. Same organisation — compare against its known programs.
  const siblings = await db()
    .select({
      id: programs.id,
      programUrl: programs.programUrl,
      name: programs.name,
      programType: programs.programType,
      contentHash: programs.contentHash,
    })
    .from(programs)
    .where(eq(programs.companyDomain, domain))
    .limit(50);

  if (siblings.length === 0) return null;

  for (const sibling of siblings) {
    // 3a. Identical content is unambiguously the same page behind two URLs.
    if (sibling.contentHash && sibling.contentHash === analysis.contentHash) {
      return {
        programId: sibling.id,
        reason: 'Identical page content',
        shouldReplaceCanonical: canonicalRank(normalized) > canonicalRank(sibling.programUrl),
      };
    }

    // 3b. Same organisation and same program type: one program described on
    //     two pages (e.g. `/security` summarising `/security/bug-bounty`).
    if (sibling.programType === analysis.classification.programType) {
      return {
        programId: sibling.id,
        reason: `Same organisation (${domain}) and program type`,
        shouldReplaceCanonical: canonicalRank(normalized) > canonicalRank(sibling.programUrl),
      };
    }
  }

  return null;
}

/**
 * Pick the canonical URL for a program from all the URLs we have seen for it.
 * Used when merging: the best URL becomes `programs.program_url`, the rest stay
 * as sources.
 */
export function chooseCanonicalUrl(urls: string[]): string {
  const ranked = urls
    .map((url) => ({ url, rank: canonicalRank(url) }))
    .sort((a, b) => b.rank - a.rank || a.url.length - b.url.length);
  return ranked[0]?.url ?? urls[0];
}

/**
 * Normalise a company name for comparison: strips legal suffixes and
 * punctuation so `Acme, Inc.` and `Acme Inc` collapse together.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(?:inc|llc|ltd|limited|gmbh|corp|corporation|company|co|plc|ag|sa|bv|nv|oy|ab|as|pty|pte|srl|spa|kk)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when two program URLs almost certainly describe one program. */
export function urlsAreEquivalent(a: string, b: string): boolean {
  try {
    const na = normalizeUrl(a);
    const nb = normalizeUrl(b);
    if (na === nb) return true;
    if (registrableDomain(na) !== registrableDomain(nb)) return false;
    // `/security/bug-bounty` vs `/security/bug-bounty/` handled by normalise;
    // treat `/x` and `/x/index` style variants as equal too.
    const pa = pathnameOf(na).replace(/\/(?:index|home|default)$/, '');
    const pb = pathnameOf(nb).replace(/\/(?:index|home|default)$/, '');
    return pa === pb;
  } catch {
    return false;
  }
}

/** Programs whose ids appear more than once for a domain — used by the admin panel. */
export async function findPotentialDuplicates(domain: string): Promise<number[]> {
  const rows = await db()
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.companyDomain, domain), eq(programs.falsePositive, false)));
  return rows.map((r) => r.id);
}


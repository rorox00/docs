import type { ProgramFilter } from '../filters';
import type { ProgramListItem } from '../repos/queryRepo';

/**
 * In-memory evaluation of a saved filter against one program.
 *
 * The dashboard filters in SQL; notifications need the same answer for a single
 * row without a round trip, so the predicates are mirrored here. Keep the two
 * in step — `tests/filters.test.ts` checks that they agree.
 */
export function programMatchesFilter(program: ProgramListItem, filter: ProgramFilter, now = new Date()): boolean {
  if (filter.selfHostedOnly !== false && !program.selfHosted) return false;
  if (!filter.includeFalsePositives && program.falsePositive) return false;
  if (!filter.includeHidden && program.hidden) return false;

  if (filter.type?.length && !filter.type.includes(program.programType as never)) return false;
  if (filter.status?.length && !filter.status.includes(program.status as never)) return false;
  if (filter.rewardKind?.length && !filter.rewardKind.includes(program.rewardKind as never)) return false;

  if (filter.paid === true && program.rewardKind !== 'paid') return false;
  if (filter.paid === false && program.rewardKind === 'paid') return false;

  const facets: Array<[boolean | undefined, boolean]> = [
    [filter.hasApi, program.hasApi],
    [filter.hasAndroid, program.hasAndroid],
    [filter.hasIos, program.hasIos],
    [filter.hasMobile, program.hasMobile],
    [filter.hasWildcard, program.hasWildcard],
    [filter.hasCloud, program.hasCloud],
    [filter.hasWeb, program.hasWeb],
    [filter.isNew, program.isNew],
    [filter.hasThirdParty, program.hasThirdPartyProgram],
    [filter.reviewed, program.reviewed],
  ];
  for (const [expected, actual] of facets) {
    if (expected !== undefined && expected !== actual) return false;
  }

  if (filter.minBounty !== undefined) {
    if (program.maxBounty === null || program.maxBounty < filter.minBounty) return false;
  }
  if (filter.maxBounty !== undefined) {
    if (program.maxBounty === null || program.maxBounty > filter.maxBounty) return false;
  }
  if (filter.minConfidence !== undefined && program.confidenceScore < filter.minConfidence) return false;
  if (filter.maxConfidence !== undefined && program.confidenceScore > filter.maxConfidence) return false;
  if (filter.minAssets !== undefined && program.assetCount < filter.minAssets) return false;

  if (filter.country) {
    const wanted = filter.country.toLowerCase();
    const matches =
      program.countryCode?.toLowerCase() === wanted ||
      (program.countryName ?? '').toLowerCase().includes(wanted);
    if (!matches) return false;
  }

  if (filter.domain && !program.companyDomain.toLowerCase().includes(filter.domain.toLowerCase())) {
    return false;
  }

  if (filter.technology) {
    const wanted = filter.technology.toLowerCase();
    if (!program.technologies.some((t) => t.toLowerCase().includes(wanted))) return false;
  }

  if (filter.days !== undefined) {
    const cutoff =
      filter.days === 0
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        : new Date(now.getTime() - filter.days * 86_400_000);
    if (program.firstSeenAt < cutoff) return false;
  }

  if (filter.launchedWithinDays !== undefined) {
    if (!program.launchDate) return false;
    const cutoff = new Date(now.getTime() - filter.launchedWithinDays * 86_400_000);
    if (program.launchDate < cutoff) return false;
  }

  if (filter.q) {
    const haystack = [
      program.name,
      program.companyName,
      program.companyDomain,
      program.summary ?? '',
      program.countryName ?? '',
      ...program.technologies,
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(filter.q.toLowerCase())) return false;
  }

  return true;
}

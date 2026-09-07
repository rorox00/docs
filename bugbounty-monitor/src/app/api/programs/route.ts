import type { NextRequest } from 'next/server';
import { ok, paginated } from '@/server/api';
import { parseFilters } from '@/server/filters';
import { listPrograms } from '@/server/repos/queryRepo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/programs
 *
 * Every filter and sort the dashboard offers is available here, e.g.
 * `?days=7&paid=true&has_api=true&sort=highest_bounty`.
 * Both snake_case and camelCase parameter names are accepted.
 */
export async function GET(request: NextRequest) {
  const params = normaliseParams(request.nextUrl.searchParams);
  const filter = parseFilters(params);
  const result = await listPrograms(filter);
  return ok(paginated(result.items, result.page, result.pageSize, result.total));
}

/** Accept `has_api` as well as `hasApi`, which is friendlier from curl. */
export function normaliseParams(input: URLSearchParams): URLSearchParams {
  const output = new URLSearchParams();
  for (const [key, value] of input.entries()) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    output.set(camel, value);
  }
  return output;
}

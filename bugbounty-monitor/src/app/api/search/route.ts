import type { NextRequest } from 'next/server';
import { ok, paginated } from '@/server/api';
import { parseFilters } from '@/server/filters';
import { listPrograms } from '@/server/repos/queryRepo';
import { normaliseParams } from '../programs/route';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search?q=api
 *
 * Searches company, domain, program name, technologies, country and every
 * in-scope asset — so `q=android` returns programs with Android targets.
 */
export async function GET(request: NextRequest) {
  const params = normaliseParams(request.nextUrl.searchParams);
  const result = await listPrograms(parseFilters(params));
  return ok({
    query: params.get('q') ?? '',
    ...paginated(result.items, result.page, result.pageSize, result.total),
  });
}

import type { NextRequest } from 'next/server';
import { ok, paginated } from '@/server/api';
import { parseFilters } from '@/server/filters';
import { listPrograms } from '@/server/repos/queryRepo';
import { normaliseParams } from '../route';

export const dynamic = 'force-dynamic';

/**
 * GET /api/programs/new — the New Programs board.
 * Defaults to the last 7 days, newest first, self-hosted only.
 */
export async function GET(request: NextRequest) {
  const params = normaliseParams(request.nextUrl.searchParams);
  if (!params.has('days') && !params.has('from') && !params.has('launchedWithinDays')) {
    params.set('days', '7');
  }
  if (!params.has('sort')) params.set('sort', 'newest');

  const result = await listPrograms(parseFilters(params));
  return ok(paginated(result.items, result.page, result.pageSize, result.total));
}

import type { NextRequest } from 'next/server';
import { ok, paginated } from '@/server/api';
import { parseFilters } from '@/server/filters';
import { listPrograms } from '@/server/repos/queryRepo';
import { normaliseParams } from '../route';

export const dynamic = 'force-dynamic';

/** GET /api/programs/recent — most recently verified programs. */
export async function GET(request: NextRequest) {
  const params = normaliseParams(request.nextUrl.searchParams);
  if (!params.has('sort')) params.set('sort', 'recently_verified');
  const result = await listPrograms(parseFilters(params));
  return ok(paginated(result.items, result.page, result.pageSize, result.total));
}

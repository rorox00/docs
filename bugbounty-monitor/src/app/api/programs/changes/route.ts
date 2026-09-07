import type { NextRequest } from 'next/server';
import { csvParam, intParam, ok, paginated } from '@/server/api';
import { listChanges } from '@/server/repos/queryRepo';

export const dynamic = 'force-dynamic';

/** GET /api/programs/changes — the change feed across all programs. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const result = await listChanges({
    days: params.has('days') ? intParam(params, 'days', 7, 0, 3650) : undefined,
    severity: csvParam(params, 'severity'),
    changeType: csvParam(params, 'type') ?? csvParam(params, 'change_type'),
    page: intParam(params, 'page', 1),
    pageSize: intParam(params, 'pageSize', 50, 1, 200),
  });
  return ok(paginated(result.items, result.page, result.pageSize, result.total));
}

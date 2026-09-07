import type { NextRequest } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { candidates } from '@/db/schema';
import { fail, intParam, ok, paginated, requireAdmin } from '@/server/api';
import { ingestCandidate } from '@/pipeline/ingest';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET /api/admin/candidates — the discovery queue, for review. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const status = params.get('status');
  const page = intParam(params, 'page', 1);
  const pageSize = intParam(params, 'pageSize', 50, 1, 200);

  const where = status ? eq(candidates.status, status as never) : undefined;

  const rows = await db()
    .select()
    .from(candidates)
    .where(where)
    .orderBy(desc(candidates.priority), desc(candidates.discoveredAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(candidates)
    .where(where);

  return ok(paginated(rows, page, pageSize, count));
}

/**
 * POST /api/admin/candidates — approve or reject a candidate.
 * Body: { id: number, action: 'approve' | 'reject', reason?: string }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    id?: number;
    action?: string;
    reason?: string;
  };
  if (!body.id || !body.action) return fail('`id` and `action` are required', 400);

  const [candidate] = await db().select().from(candidates).where(eq(candidates.id, body.id)).limit(1);
  if (!candidate) return fail('Candidate not found', 404);

  if (body.action === 'reject') {
    await db()
      .update(candidates)
      .set({
        status: 'rejected',
        rejectionReason: body.reason ?? 'Rejected by administrator',
        processedAt: new Date(),
      })
      .where(eq(candidates.id, body.id));
    return ok({ data: { id: body.id, status: 'rejected' } });
  }

  if (body.action === 'approve') {
    // Approval bypasses the confidence floor: an operator has judged it real.
    const outcome = await ingestCandidate(
      {
        url: candidate.url,
        sourceKind: candidate.sourceKind,
        sourceDetail: candidate.sourceDetail ?? 'Approved by administrator',
        priority: candidate.priority,
      },
      { force: true, ignoreConfidenceFloor: true, candidateId: candidate.id },
    );
    return ok({ data: outcome });
  }

  return fail('`action` must be "approve" or "reject"', 400);
}

/** DELETE /api/admin/candidates?status=rejected — clear processed candidates. */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const status = request.nextUrl.searchParams.get('status');
  if (!status) return fail('A `status` parameter is required', 400);

  const result = await db()
    .delete(candidates)
    .where(and(eq(candidates.status, status as never)));
  return ok({ data: { deleted: result.rowCount ?? 0 } });
}

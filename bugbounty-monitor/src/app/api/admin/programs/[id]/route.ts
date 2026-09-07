import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { programs } from '@/db/schema';
import { PROGRAM_STATUSES, PROGRAM_TYPES } from '@/lib/constants';
import { fail, ok, requireAdmin } from '@/server/api';
import { refreshSearchVector } from '@/server/repos/programRepo';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/programs/:id — operator corrections.
 *
 * Lets an admin fix a misclassification, mark a false positive, hide a record
 * or leave a note. Corrections set `reviewed`, which keeps them out of the
 * "needs review" queue.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const programId = Number.parseInt(id, 10);
  if (!Number.isFinite(programId)) return fail('Invalid program id', 400);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date(), reviewed: true };

  if (typeof body.falsePositive === 'boolean') updates.falsePositive = body.falsePositive;
  if (typeof body.hidden === 'boolean') updates.hidden = body.hidden;
  if (typeof body.selfHosted === 'boolean') updates.selfHosted = body.selfHosted;
  if (typeof body.notes === 'string') updates.notes = body.notes.slice(0, 5000);
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim().slice(0, 255);

  if (typeof body.programType === 'string') {
    if (!(PROGRAM_TYPES as readonly string[]).includes(body.programType)) {
      return fail(`programType must be one of: ${PROGRAM_TYPES.join(', ')}`, 400);
    }
    updates.programType = body.programType;
  }
  if (typeof body.status === 'string') {
    if (!(PROGRAM_STATUSES as readonly string[]).includes(body.status)) {
      return fail(`status must be one of: ${PROGRAM_STATUSES.join(', ')}`, 400);
    }
    updates.status = body.status;
  }
  if (typeof body.reviewed === 'boolean') updates.reviewed = body.reviewed;

  if (Object.keys(updates).length <= 2) return fail('No supported fields to update', 400);

  const [row] = await db()
    .update(programs)
    .set(updates)
    .where(eq(programs.id, programId))
    .returning();

  if (!row) return fail('Program not found', 404);
  await refreshSearchVector(programId);

  return ok({ data: row });
}

/** DELETE /api/admin/programs/:id — permanently remove a record. */
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const programId = Number.parseInt(id, 10);
  if (!Number.isFinite(programId)) return fail('Invalid program id', 400);

  const result = await db().delete(programs).where(eq(programs.id, programId));
  if ((result.rowCount ?? 0) === 0) return fail('Program not found', 404);
  return ok({ data: { deleted: true, id: programId } });
}

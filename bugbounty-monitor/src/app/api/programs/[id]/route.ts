import { fail, ok } from '@/server/api';
import { getProgramDetail } from '@/server/repos/queryRepo';

export const dynamic = 'force-dynamic';

/** GET /api/programs/:id — the full record including scope, rewards and history. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const programId = Number.parseInt(id, 10);
  if (!Number.isFinite(programId)) return fail('Invalid program id', 400);

  const program = await getProgramDetail(programId);
  if (!program) return fail('Program not found', 404);
  return ok({ data: program });
}

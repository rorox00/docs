import { enqueue, isQueueAvailable } from '@/jobs/queue';
import { fail, ok, requireAdmin } from '@/server/api';
import { getProgramDetail } from '@/server/repos/queryRepo';
import { runVerification } from '@/pipeline/verify';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/programs/:id/verify — re-crawl one program now.
 *
 * Queued when Redis is available so the request returns immediately; run
 * inline otherwise, so a single-container deployment still works.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const programId = Number.parseInt(id, 10);
  if (!Number.isFinite(programId)) return fail('Invalid program id', 400);

  const program = await getProgramDetail(programId);
  if (!program) return fail('Program not found', 404);

  if (await isQueueAvailable()) {
    const jobId = await enqueue('verification', { programIds: [programId], triggeredBy: 'api' });
    return ok({ queued: true, jobId, programId });
  }

  const result = await runVerification({ programIds: [programId], triggeredBy: 'api' });
  return ok({
    queued: false,
    programId,
    checked: result.checked,
    changed: result.changed,
    outcomes: result.outcomes,
  });
}

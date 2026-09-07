import type { NextRequest } from 'next/server';
import { fail, ok, requireAdmin } from '@/server/api';
import { submitCandidate } from '@/pipeline/discovery';
import { safeNormalizeUrl } from '@/lib/url';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/discovery/submit — hand the pipeline a URL directly.
 * Body: { url: string }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { url?: string };
  if (!body.url || !safeNormalizeUrl(body.url)) return fail('A valid `url` is required', 400);

  const outcome = await submitCandidate(body.url, 'Submitted via API');
  return ok({ data: outcome });
}

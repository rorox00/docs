import { clearSessionCookie } from '@/server/auth';
import { ok } from '@/server/api';

export const dynamic = 'force-dynamic';

export async function POST() {
  await clearSessionCookie();
  return ok({ data: { ok: true } });
}

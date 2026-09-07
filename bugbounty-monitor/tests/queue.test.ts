import { afterAll, describe, expect, it } from 'vitest';

/**
 * Redis is optional: the dashboard and API must stay responsive when it is
 * unavailable, falling back to running jobs inline.
 *
 * Regression guard — `isQueueAvailable()` used to await an ioredis `ping()`
 * directly, and ioredis retries a dead server forever, so `/api/health` and the
 * admin page hung indefinitely instead of reporting "queue unavailable".
 */
describe('queue availability with Redis down', () => {
  // Point at a closed port before the module reads its configuration.
  process.env.REDIS_URL = 'redis://127.0.0.1:59999';

  afterAll(async () => {
    const { closeQueue } = await import('@/jobs/queue');
    await closeQueue();
  });

  it('reports unavailable quickly instead of hanging', async () => {
    const { isQueueAvailable } = await import('@/jobs/queue');

    const startedAt = Date.now();
    const available = await isQueueAvailable(500);
    const elapsed = Date.now() - startedAt;

    expect(available).toBe(false);
    expect(elapsed).toBeLessThan(3_000);
  });

  it('returns empty job counts rather than throwing', async () => {
    const { getQueueCounts } = await import('@/jobs/queue');
    await expect(getQueueCounts(500)).resolves.toEqual({});
  });
});

import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import { closeDb, pingDb } from '@/db';
import { runMigrations } from '@/db/migrate';
import { ensureBootstrapAdmin } from '@/server/auth';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { closeQueue, getRedis, QUEUE_NAME, type JobName } from './queue';
import { handlers } from './handlers';
import { registerSchedules } from './schedules';

const log = createLogger('worker');

/**
 * Background worker entry point.
 *
 * Runs migrations, registers the repeatable schedules, then processes jobs.
 * Concurrency is 1 on purpose: the crawler's politeness limits are per-process,
 * and running several jobs at once would multiply outbound request pressure.
 */
async function main(): Promise<void> {
  log.info('Worker starting', {
    redis: env().REDIS_URL.replace(/\/\/.*@/, '//***@'),
    crawlerEnabled: env().CRAWLER_ENABLED,
  });

  await runMigrations();
  await ensureBootstrapAdmin();

  if (!(await pingDb())) throw new Error('Database is not reachable');

  await registerSchedules();

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const started = Date.now();
      log.info('Job started', { name: job.name, id: job.id });
      const handler = handlers[job.name as JobName];
      if (!handler) throw new Error(`No handler registered for job "${job.name}"`);

      const result = await (handler as (payload: unknown) => Promise<Record<string, unknown>>)(job.data);
      log.info('Job finished', { name: job.name, id: job.id, ms: Date.now() - started, ...result });
      return result;
    },
    {
      connection: getRedis(),
      concurrency: 1,
      // A discovery run over many domains is slow by design; give it room.
      lockDuration: 30 * 60_000,
      stalledInterval: 60_000,
    },
  );

  worker.on('failed', (job, error) => {
    log.error('Job failed', { name: job?.name, id: job?.id, attempt: job?.attemptsMade, error });
  });
  worker.on('error', (error) => log.error('Worker error', { error }));

  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down`);
    await worker.close();
    await closeQueue();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  log.info('Worker ready');
}

main().catch((error) => {
  log.error('Worker failed to start', { error });
  process.exit(1);
});

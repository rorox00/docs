import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { getQueue } from './queue';

const log = createLogger('schedules');

/**
 * Repeatable jobs.
 *
 * Registration is idempotent: existing schedulers with the same key are
 * replaced, so changing a cron expression in `.env` takes effect on restart
 * without leaving an orphaned repeat behind.
 */
export async function registerSchedules(): Promise<void> {
  const config = env();
  const queue = getQueue();

  const schedules: Array<{ key: string; cron: string; name: string; data: Record<string, unknown> }> = [
    {
      key: 'discovery-scheduled',
      cron: config.SCHEDULE_DISCOVERY_CRON,
      name: 'discovery',
      data: { triggeredBy: 'scheduler' },
    },
    {
      key: 'verification-scheduled',
      cron: config.SCHEDULE_VERIFY_CRON,
      name: 'verification',
      data: { triggeredBy: 'scheduler' },
    },
    {
      key: 'digest-scheduled',
      cron: config.SCHEDULE_DIGEST_CRON,
      name: 'digest',
      data: {},
    },
    {
      key: 'maintenance-scheduled',
      cron: '0 4 * * 0',
      name: 'maintenance',
      data: {},
    },
  ];

  // Drop schedulers that are no longer declared.
  try {
    const existing = await queue.getJobSchedulers(0, 100, true);
    const declared = new Set(schedules.map((s) => s.key));
    for (const scheduler of existing) {
      if (scheduler.key && !declared.has(scheduler.key)) {
        await queue.removeJobScheduler(scheduler.key);
        log.info('Removed stale schedule', { key: scheduler.key });
      }
    }
  } catch (error) {
    log.warn('Could not enumerate existing schedules', { error });
  }

  for (const schedule of schedules) {
    try {
      await queue.upsertJobScheduler(
        schedule.key,
        { pattern: schedule.cron },
        { name: schedule.name, data: schedule.data },
      );
      log.info('Schedule registered', { key: schedule.key, cron: schedule.cron });
    } catch (error) {
      log.error('Failed to register schedule', { key: schedule.key, error });
    }
  }
}

import { Queue, QueueEvents, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const log = createLogger('queue');

/** Job names and their payloads, in one place so producers and the worker agree. */
export interface JobPayloads {
  discovery: {
    domains?: string[];
    limitPerSource?: number;
    ingestLimit?: number;
    sourceIds?: string[];
    triggeredBy?: string;
  };
  verification: { programIds?: number[]; limit?: number; triggeredBy?: string };
  ingest: { url: string; sourceKind?: string; sourceDetail?: string; force?: boolean };
  digest: { date?: string };
  maintenance: Record<string, never>;
}

export type JobName = keyof JobPayloads;

export const QUEUE_NAME = 'bbm';

let connection: Redis | null = null;
let queue: Queue | null = null;
let events: QueueEvents | null = null;

export function getRedis(): Redis {
  if (!connection) {
    connection = new IORedis(env().REDIS_URL, {
      // BullMQ requires this to be null so blocking commands are not cut off.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    connection.on('error', (error) => log.error('Redis connection error', { error: error.message }));
  }
  return connection;
}

export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 86_400, count: 500 },
        removeOnFail: { age: 7 * 86_400, count: 500 },
      },
    });
  }
  return queue;
}

export function getQueueEvents(): QueueEvents {
  if (!events) events = new QueueEvents(QUEUE_NAME, { connection: getRedis().duplicate() });
  return events;
}

export async function enqueue<T extends JobName>(
  name: T,
  payload: JobPayloads[T],
  options: JobsOptions = {},
): Promise<string | undefined> {
  const job = await getQueue().add(name, payload, options);
  log.debug('Job enqueued', { name, jobId: job.id });
  return job.id;
}

/** True when Redis is reachable — the UI degrades gracefully when it is not. */
export async function isQueueAvailable(): Promise<boolean> {
  try {
    const pong = await getRedis().ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function getQueueCounts(): Promise<Record<string, number>> {
  try {
    return await getQueue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
  } catch {
    return {};
  }
}

export async function closeQueue(): Promise<void> {
  await events?.close();
  await queue?.close();
  connection?.disconnect();
  events = null;
  queue = null;
  connection = null;
}

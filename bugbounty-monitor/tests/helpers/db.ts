import { closeDb, db, getPool } from '@/db';
import { runMigrations } from '@/db/migrate';

/** Truncate every application table, keeping the schema. */
export async function resetDatabase(): Promise<void> {
  await runMigrations();
  await getPool().query(`
    truncate table
      companies, programs, program_versions, program_assets, program_rewards,
      program_changes, sources, discovery_events, candidates, http_cache,
      robots_cache, notifications, user_filters, users, seed_domains, runs
    restart identity cascade
  `);
}

/** Seed the HTTP cache so ingest reads a fixture instead of the network. */
export async function primeCache(url: string, body: string, contentType = 'text/html'): Promise<void> {
  const { httpCache } = await import('@/db/schema');
  const values = {
    url,
    host: new URL(url).hostname,
    status: 200,
    etag: null,
    lastModified: null,
    contentType,
    body,
    fetchedAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
  };
  await db().insert(httpCache).values(values).onConflictDoUpdate({ target: httpCache.url, set: values });
}

export { closeDb };

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '@/lib/env';
import * as schema from './schema';

export * as schema from './schema';

/**
 * `numeric` columns come back as strings from node-postgres by default, which
 * is right for money — but we want plain numbers in the app layer, so parse
 * them once here. (OID 1700 = numeric.)
 */
pg.types.setTypeParser(1700, (value) => (value === null ? null : Number.parseFloat(value)));

let pool: pg.Pool | null = null;
let database: NodePgDatabase<typeof schema> | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const config = env();
    pool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: /sslmode=require/.test(config.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', (error) => {
      // A pooled client dying in the background must not take the process down.
      console.error('[db] idle client error', error);
    });
  }
  return pool;
}

export function db(): NodePgDatabase<typeof schema> {
  if (!database) {
    database = drizzle(getPool(), { schema });
  }
  return database;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    database = null;
  }
}

/** Simple readiness probe used by the health endpoint and the worker boot. */
export async function pingDb(): Promise<boolean> {
  try {
    await getPool().query('select 1');
    return true;
  } catch {
    return false;
  }
}

import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getPool } from './index';
import { createLogger } from '@/lib/logger';

const log = createLogger('migrate');
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

/**
 * Deliberately tiny forward-only migration runner: reads `drizzle/*.sql` in
 * lexical order and applies anything not yet recorded. Each file runs inside a
 * transaction so a failed migration leaves nothing half-applied.
 */
export async function runMigrations(): Promise<string[]> {
  const pool = getPool();
  await pool.query(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows } = await pool.query<{ name: string }>('select name from _migrations');
  const applied = new Set(rows.map((r) => r.name));

  let files: string[];
  try {
    files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    log.warn('No migrations directory found', { dir: MIGRATIONS_DIR });
    return [];
  }

  const executed: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      // `--> statement-breakpoint` is drizzle-kit's separator; the driver is
      // happy with the whole file at once, so we only strip the marker.
      await client.query(sql.replace(/-->\s*statement-breakpoint/g, ''));
      await client.query('insert into _migrations (name) values ($1)', [file]);
      await client.query('commit');
      executed.push(file);
      log.info('Applied migration', { file });
    } catch (error) {
      await client.query('rollback');
      log.error('Migration failed', { file, error });
      throw error;
    } finally {
      client.release();
    }
  }

  if (executed.length === 0) log.info('Database already up to date');
  return executed;
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\\/g, '/');

if (invokedDirectly) {
  runMigrations()
    .then(async (files) => {
      log.info(`Migration complete (${files.length} applied)`);
      await closeDb();
      process.exit(0);
    })
    .catch(async (error) => {
      log.error('Migration run failed', { error });
      await closeDb();
      process.exit(1);
    });
}

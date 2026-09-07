import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { closeDb, db } from './index';
import { seedDomains } from './schema';
import { DEFAULT_SEED_DOMAINS, type SeedEntry } from './seedDomains';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { registrableDomain } from '@/lib/url';
import { runMigrations } from './migrate';

const log = createLogger('seed');

/**
 * Loads the seed domain list. A deployment can override the built-in list with
 * `DISCOVERY_SEED_FILE`, which accepts either JSON or one domain per line.
 */
export async function loadSeedEntries(): Promise<SeedEntry[]> {
  const path = env().DISCOVERY_SEED_FILE;
  if (!path) return DEFAULT_SEED_DOMAINS;

  try {
    const raw = await readFile(path, 'utf8');
    if (path.endsWith('.json')) {
      const parsed = JSON.parse(raw) as SeedEntry[];
      return parsed.filter((e) => typeof e?.domain === 'string');
    }
    return raw
      .split(/\r?\n/)
      .map((line) => line.split('#')[0].trim())
      .filter(Boolean)
      .map((domain) => ({ domain }));
  } catch (error) {
    log.warn('Could not read DISCOVERY_SEED_FILE; using the built-in list', { path, error });
    return DEFAULT_SEED_DOMAINS;
  }
}

export async function seedDatabase(): Promise<number> {
  const entries = await loadSeedEntries();
  const rows = entries
    .map((entry) => ({
      domain: registrableDomain(entry.domain),
      label: entry.label ?? null,
      countryCode: entry.countryCode ?? null,
      enabled: true,
    }))
    .filter((row) => row.domain.length > 0);

  if (rows.length === 0) return 0;

  const inserted = await db()
    .insert(seedDomains)
    .values(rows)
    .onConflictDoNothing({ target: seedDomains.domain })
    .returning({ id: seedDomains.id });

  log.info(`Seeded ${inserted.length} new domains (${rows.length} in list)`);
  return inserted.length;
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\\/g, '/');

if (invokedDirectly) {
  runMigrations()
    .then(seedDatabase)
    .then(async (count) => {
      log.info(`Seed complete (${count} added)`);
      await closeDb();
      process.exit(0);
    })
    .catch(async (error) => {
      log.error('Seeding failed', { error });
      await closeDb();
      process.exit(1);
    });
}

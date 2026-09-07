import 'dotenv/config';
import { closeDb } from '@/db';
import { runMigrations } from '@/db/migrate';
import { createLogger } from '@/lib/logger';
import { runVerification } from '@/pipeline/verify';

const log = createLogger('cli:verify');

/**
 * Re-crawl stored programs and record any changes.
 *
 *   npm run verify -- --limit 25
 *   npm run verify -- --ids 3,7,12
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const limit = numberFlag(argv, '--limit') ?? 25;
  const ids = listFlag(argv, '--ids')?.map((v) => Number.parseInt(v, 10)).filter(Number.isFinite);

  await runMigrations();

  const result = await runVerification({ programIds: ids, limit, triggeredBy: 'cli' });

  log.info('Verification finished', {
    runId: result.runId,
    checked: result.checked,
    changed: result.changed,
    errors: result.errors,
  });

  for (const outcome of result.outcomes.filter((o) => o.status === 'updated')) {
    process.stdout.write(`\nChanged: ${outcome.url}\n`);
    for (const change of outcome.changes ?? []) {
      process.stdout.write(`  [${change.severity}] ${change.summary}\n`);
    }
  }

  await closeDb();
}

function numberFlag(argv: string[], flag: string): number | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = Number.parseInt(argv[index + 1] ?? '', 10);
  return Number.isFinite(value) ? value : undefined;
}

function listFlag(argv: string[], flag: string): string[] | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  return argv[index + 1]?.split(',').map((v) => v.trim()).filter(Boolean);
}

main().catch(async (error) => {
  log.error('Verification failed', { error });
  await closeDb();
  process.exit(1);
});

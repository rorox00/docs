import 'dotenv/config';
import { closeDb } from '@/db';
import { runMigrations } from '@/db/migrate';
import { seedDatabase } from '@/db/seed';
import { createLogger } from '@/lib/logger';
import { runDiscovery } from '@/pipeline/discovery';

const log = createLogger('cli:discover');

/**
 * Run a discovery pass from the command line.
 *
 *   npm run discover -- --domains example.com,acme.io --limit 50
 *   npm run discover -- --sources well_known_paths,sitemap
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  await runMigrations();
  if (args.seed) await seedDatabase();

  const result = await runDiscovery({
    domains: args.domains,
    sourceIds: args.sources,
    limitPerSource: args.limitPerSource,
    ingestLimit: args.limit,
    triggeredBy: 'cli',
    discoverOnly: args.discoverOnly,
  });

  log.info('Discovery finished', { runId: result.runId, ...result.stats });

  const created = result.outcomes.filter((o) => o.status === 'created');
  if (created.length > 0) {
    process.stdout.write(`\nNew programs (${created.length}):\n`);
    for (const outcome of created) {
      process.stdout.write(`  ${String(outcome.confidence ?? '?').padStart(3)}%  ${outcome.url}\n`);
    }
  }

  const rejected = result.outcomes.filter((o) => o.status === 'rejected');
  if (rejected.length > 0 && args.verbose) {
    process.stdout.write(`\nRejected (${rejected.length}):\n`);
    for (const outcome of rejected) {
      process.stdout.write(`  ${outcome.url}\n    ↳ ${outcome.reason ?? 'no reason given'}\n`);
    }
  }

  await closeDb();
}

interface Args {
  domains?: string[];
  sources?: string[];
  limit?: number;
  limitPerSource?: number;
  seed: boolean;
  verbose: boolean;
  discoverOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { seed: false, verbose: false, discoverOnly: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--domains':
        args.domains = value?.split(',').map((d) => d.trim()).filter(Boolean);
        i += 1;
        break;
      case '--sources':
        args.sources = value?.split(',').map((s) => s.trim()).filter(Boolean);
        i += 1;
        break;
      case '--limit':
        args.limit = Number.parseInt(value ?? '', 10) || undefined;
        i += 1;
        break;
      case '--limit-per-source':
        args.limitPerSource = Number.parseInt(value ?? '', 10) || undefined;
        i += 1;
        break;
      case '--seed':
        args.seed = true;
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--discover-only':
        args.discoverOnly = true;
        break;
      case '--help':
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      default:
        break;
    }
  }
  return args;
}

const USAGE = `
Usage: npm run discover -- [options]

  --domains a.com,b.com     Restrict the run to these domains
  --sources id1,id2         Only run these discovery sources
  --limit N                 Maximum candidates to ingest (default 100)
  --limit-per-source N      Maximum candidates each source may contribute
  --discover-only           Collect candidates without fetching or classifying
  --seed                    Load the seed domain list first
  --verbose                 Print rejected candidates and why
  --help                    Show this message
`;

main().catch(async (error) => {
  log.error('Discovery failed', { error });
  await closeDb();
  process.exit(1);
});

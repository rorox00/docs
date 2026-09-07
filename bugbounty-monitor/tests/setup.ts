import 'dotenv/config';

/**
 * Test bootstrap.
 *
 * Integration tests run against a real PostgreSQL database (they exercise the
 * SQL that filtering and change detection depend on). Point `TEST_DATABASE_URL`
 * at a throwaway database; it is migrated and truncated by the tests that use it.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://bbm:bbm@localhost:5432/bbm_test';

// Keep test output readable and disable outbound crawling by default.
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'error';
// NODE_ENV is typed read-only, but tests genuinely need it set before the
// config module is first imported.
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.CRAWLER_PER_HOST_DELAY_MS = '0';
process.env.AUTH_SECRET = 'test-secret-value-not-used-in-production-0000000';

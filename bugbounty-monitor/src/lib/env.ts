import 'dotenv/config';
import { z } from 'zod';

/**
 * Central, validated configuration. Everything the app can be tuned with lives
 * here so that deployments only ever have to touch `.env`.
 */
const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(v)));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number.parseInt(v, 10)))
    .pipe(z.number().int());

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number.parseFloat(v)))
    .pipe(z.number());

const str = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v));

const optStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v));

const schema = z.object({
  NODE_ENV: str('development'),
  APP_URL: str('http://localhost:3000'),
  DATABASE_URL: str('postgres://bbm:bbm@localhost:5432/bbm'),
  DATABASE_POOL_MAX: int(10),
  REDIS_URL: str('redis://localhost:6379'),

  // Auth
  AUTH_SECRET: str('dev-only-insecure-secret-change-me-in-production-000000'),
  AUTH_COOKIE_NAME: str('bbm_session'),
  SESSION_TTL_HOURS: int(24 * 14),
  ALLOW_SIGNUP: bool(true),
  BOOTSTRAP_ADMIN_EMAIL: optStr,
  BOOTSTRAP_ADMIN_PASSWORD: optStr,

  // Crawler identity + politeness. These defaults are deliberately conservative.
  CRAWLER_USER_AGENT: str(
    'BugBountyMonitor/1.0 (+https://github.com/rorox00/docs; responsible-disclosure-program-monitor; contact: security-monitor@example.com)',
  ),
  CRAWLER_CONTACT_EMAIL: str('security-monitor@example.com'),
  CRAWLER_RESPECT_ROBOTS: bool(true),
  CRAWLER_REQUEST_TIMEOUT_MS: int(15_000),
  CRAWLER_MAX_RETRIES: int(2),
  CRAWLER_RETRY_BASE_MS: int(1_000),
  /** Minimum delay between two requests to the same host. */
  CRAWLER_PER_HOST_DELAY_MS: int(4_000),
  /** Hard ceiling of concurrent outbound requests across all hosts. */
  CRAWLER_GLOBAL_CONCURRENCY: int(4),
  /** Max bytes read from a single response body. */
  CRAWLER_MAX_BODY_BYTES: int(2_500_000),
  /** How long a fetched page stays fresh in the HTTP cache. */
  CRAWLER_CACHE_TTL_MINUTES: int(60 * 12),
  /** Max candidate URLs probed per domain in one discovery run. */
  CRAWLER_MAX_PATHS_PER_DOMAIN: int(14),
  CRAWLER_ENABLED: bool(true),

  // Scheduling (cron expressions for the BullMQ scheduler)
  SCHEDULE_DISCOVERY_CRON: str('0 */6 * * *'),
  SCHEDULE_VERIFY_CRON: str('30 3 * * *'),
  SCHEDULE_DIGEST_CRON: str('0 8 * * *'),
  /** A program is re-verified when it has not been checked for this long. */
  VERIFY_INTERVAL_HOURS: int(72),
  /** Programs discovered within this window are highlighted as "new". */
  NEW_PROGRAM_WINDOW_DAYS: int(30),

  // Discovery sources
  DISCOVERY_SEED_FILE: optStr,
  ENABLE_SOURCE_SEEDS: bool(true),
  ENABLE_SOURCE_WELLKNOWN: bool(true),
  ENABLE_SOURCE_SITEMAP: bool(true),
  ENABLE_SOURCE_CRTSH: bool(false),
  ENABLE_SOURCE_RSS: bool(true),
  ENABLE_SOURCE_SEARCH: bool(true),

  /** Search provider: brave | google_cse | bing | serpapi | none */
  SEARCH_PROVIDER: str('none'),
  SEARCH_API_KEY: optStr,
  GOOGLE_CSE_ID: optStr,
  SEARCH_RESULTS_PER_QUERY: int(20),
  SEARCH_MAX_QUERIES_PER_RUN: int(12),

  // Notifications
  NOTIFY_EMAIL_ENABLED: bool(false),
  SMTP_HOST: optStr,
  SMTP_PORT: int(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: optStr,
  SMTP_PASSWORD: optStr,
  MAIL_FROM: str('Bug Bounty Monitor <no-reply@localhost>'),

  NOTIFY_SLACK_WEBHOOK_URL: optStr,
  NOTIFY_DISCORD_WEBHOOK_URL: optStr,
  NOTIFY_TELEGRAM_BOT_TOKEN: optStr,
  NOTIFY_TELEGRAM_CHAT_ID: optStr,

  LOG_LEVEL: str('info'),
  LOG_FORMAT: str('pretty'),

  MIN_CONFIDENCE_TO_PUBLISH: num(40),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the memoised config after mutating process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = () => env().NODE_ENV === 'production';

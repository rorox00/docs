import { eq, lt } from 'drizzle-orm';
import { db } from '@/db';
import { httpCache, robotsCache } from '@/db/schema';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { hostnameOf, originOf } from '@/lib/url';
import { HostRateLimiter, Semaphore, backoffDelay, sleep } from './ratelimit';
import { EMPTY_ROBOTS, crawlDelayMs, isAllowed, parseRobots, type RobotsTxt } from './robots';

const log = createLogger('fetch');

export interface FetchResult {
  ok: boolean;
  url: string;
  /** Final URL after redirects. */
  finalUrl: string;
  status: number;
  body: string | null;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  /** `Last-Modified` / `Date` header parsed into a Date, when present. */
  headerLastModified: Date | null;
  fromCache: boolean;
  /** Set when the request could not be completed. */
  error?: string;
  /** Set when robots.txt told us not to fetch this path. */
  blockedByRobots?: boolean;
  durationMs: number;
}

export interface FetchOptions {
  /** Skip the persistent cache and force a network round-trip. */
  force?: boolean;
  /** Override the default cache freshness window. */
  cacheTtlMinutes?: number;
  accept?: string;
  /** Bypass robots (only ever used for /robots.txt itself). */
  ignoreRobots?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}

/* -------------------------------------------------------------- */

let limiter: HostRateLimiter | null = null;
let gate: Semaphore | null = null;

function getLimiter(): HostRateLimiter {
  if (!limiter) limiter = new HostRateLimiter(env().CRAWLER_PER_HOST_DELAY_MS);
  return limiter;
}

function getGate(): Semaphore {
  if (!gate) gate = new Semaphore(env().CRAWLER_GLOBAL_CONCURRENCY);
  return gate;
}

/** Test hook: rebuild the limiters after changing configuration. */
export function resetFetchLimiters(): void {
  limiter = null;
  gate = null;
}

/* -------------------------------------------------------------- */
/* robots.txt                                                      */
/* -------------------------------------------------------------- */

const ROBOTS_TTL_MINUTES = 60 * 24;
const robotsMemo = new Map<string, { robots: RobotsTxt; expiresAt: number }>();

export async function getRobots(url: string): Promise<RobotsTxt> {
  const origin = originOf(url);
  if (!origin) return EMPTY_ROBOTS;

  const memo = robotsMemo.get(origin);
  if (memo && memo.expiresAt > Date.now()) return memo.robots;

  const now = new Date();
  const [cached] = await db()
    .select()
    .from(robotsCache)
    .where(eq(robotsCache.origin, origin))
    .limit(1);

  if (cached && cached.expiresAt > now) {
    const robots = cached.body ? parseRobots(cached.body) : EMPTY_ROBOTS;
    robotsMemo.set(origin, { robots, expiresAt: cached.expiresAt.getTime() });
    return robots;
  }

  const result = await rawFetch(`${origin}/robots.txt`, {
    accept: 'text/plain,*/*;q=0.8',
    timeoutMs: 10_000,
    maxRetries: 0,
  });

  // A missing or broken robots.txt means "no restrictions stated".
  const body = result.ok && result.status === 200 ? result.body : null;
  const robots = body ? parseRobots(body) : EMPTY_ROBOTS;
  const expiresAt = new Date(Date.now() + ROBOTS_TTL_MINUTES * 60_000);

  await db()
    .insert(robotsCache)
    .values({ origin, body, fetchedAt: new Date(), expiresAt })
    .onConflictDoUpdate({
      target: robotsCache.origin,
      set: { body, fetchedAt: new Date(), expiresAt },
    });

  robotsMemo.set(origin, { robots, expiresAt: expiresAt.getTime() });
  return robots;
}

export async function robotsAllows(url: string): Promise<boolean> {
  if (!env().CRAWLER_RESPECT_ROBOTS) return true;
  try {
    const robots = await getRobots(url);
    const pathname = new URL(url).pathname;
    return isAllowed(robots, env().CRAWLER_USER_AGENT, pathname);
  } catch (error) {
    log.warn('robots check failed, allowing by default', { url, error });
    return true;
  }
}

/* -------------------------------------------------------------- */
/* Core fetch                                                      */
/* -------------------------------------------------------------- */

/**
 * Fetch without cache or robots handling. Applies timeout, retries, the global
 * concurrency gate, the per-host delay and a body size ceiling.
 */
async function rawFetch(
  url: string,
  options: FetchOptions & { conditional?: { etag?: string | null; lastModified?: string | null } } = {},
): Promise<FetchResult> {
  const config = env();
  const startedAt = Date.now();
  const host = hostnameOf(url) ?? 'unknown';
  const timeoutMs = options.timeoutMs ?? config.CRAWLER_REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? config.CRAWLER_MAX_RETRIES;

  const base = (partial: Partial<FetchResult>): FetchResult => ({
    ok: false,
    url,
    finalUrl: url,
    status: 0,
    body: null,
    contentType: null,
    etag: null,
    lastModified: null,
    headerLastModified: null,
    fromCache: false,
    durationMs: Date.now() - startedAt,
    ...partial,
  });

  let lastError = 'unknown error';

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const releaseGate = await getGate().acquire();
    try {
      await getLimiter().acquire(host);

      const headers: Record<string, string> = {
        'user-agent': config.CRAWLER_USER_AGENT,
        accept: options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        from: config.CRAWLER_CONTACT_EMAIL,
      };
      if (options.conditional?.etag) headers['if-none-match'] = options.conditional.etag;
      if (options.conditional?.lastModified) {
        headers['if-modified-since'] = options.conditional.lastModified;
      }

      const response = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });

      // 304 means our cached copy is still good.
      if (response.status === 304) {
        return base({
          ok: true,
          status: 304,
          finalUrl: response.url || url,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
        });
      }

      if (response.status === 429 || response.status === 503) {
        const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
        const penalty = Number.isFinite(retryAfter)
          ? Math.min(retryAfter * 1000, 120_000)
          : backoffDelay(attempt + 1, config.CRAWLER_RETRY_BASE_MS, 60_000);
        getLimiter().penalise(host, penalty);
        lastError = `HTTP ${response.status} (throttled)`;
        if (attempt < maxRetries) {
          releaseGate();
          await sleep(penalty);
          continue;
        }
        return base({ status: response.status, error: lastError, finalUrl: response.url || url });
      }

      const contentType = response.headers.get('content-type');
      let body: string | null = null;

      if (response.ok && response.body) {
        body = await readCapped(response, config.CRAWLER_MAX_BODY_BYTES);
      } else if (!response.ok) {
        // Drain so the socket can be reused.
        await response.arrayBuffer().catch(() => undefined);
      }

      const lastModifiedHeader = response.headers.get('last-modified');
      return base({
        ok: response.ok,
        status: response.status,
        finalUrl: response.url || url,
        body,
        contentType,
        etag: response.headers.get('etag'),
        lastModified: lastModifiedHeader,
        headerLastModified: parseHttpDate(lastModifiedHeader),
        error: response.ok ? undefined : `HTTP ${response.status}`,
      });
    } catch (error) {
      lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const retriable =
        error instanceof Error &&
        (error.name === 'TimeoutError' ||
          error.name === 'AbortError' ||
          /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed/i.test(error.message));
      if (attempt < maxRetries && retriable) {
        releaseGate();
        await sleep(backoffDelay(attempt, config.CRAWLER_RETRY_BASE_MS));
        continue;
      }
      return base({ error: lastError });
    } finally {
      releaseGate();
    }
  }

  return base({ error: lastError });
}

/** Reads a response body but stops after `maxBytes` to bound memory use. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(value.slice(0, Math.max(0, value.byteLength - (total - maxBytes))));
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
    }
  } catch {
    /* return whatever we managed to read */
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

export function parseHttpDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* -------------------------------------------------------------- */
/* Public API: cached + robots-aware fetch                         */
/* -------------------------------------------------------------- */

/**
 * The crawler's single entry point for retrieving a page.
 *
 * Order of operations: cache lookup → robots check → conditional request →
 * cache write. Never throws; failures come back as `ok: false` with `error`.
 */
export async function fetchPage(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const config = env();
  const startedAt = Date.now();

  if (!config.CRAWLER_ENABLED) {
    return failure(url, 'Crawler is disabled (CRAWLER_ENABLED=false)', startedAt);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return failure(url, 'Malformed URL', startedAt);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return failure(url, `Unsupported protocol ${parsed.protocol}`, startedAt);
  }

  const ttlMinutes = options.cacheTtlMinutes ?? config.CRAWLER_CACHE_TTL_MINUTES;
  const cached = options.force ? null : await readCache(url);

  if (cached && cached.expiresAt && cached.expiresAt > new Date()) {
    return {
      ok: cached.status >= 200 && cached.status < 300,
      url,
      finalUrl: url,
      status: cached.status,
      body: cached.body,
      contentType: cached.contentType,
      etag: cached.etag,
      lastModified: cached.lastModified,
      headerLastModified: parseHttpDate(cached.lastModified),
      fromCache: true,
      durationMs: Date.now() - startedAt,
    };
  }

  if (!options.ignoreRobots && config.CRAWLER_RESPECT_ROBOTS) {
    const allowed = await robotsAllows(url);
    if (!allowed) {
      log.debug('Blocked by robots.txt', { url });
      return {
        ...failure(url, 'Disallowed by robots.txt', startedAt),
        blockedByRobots: true,
      };
    }
    // Honour Crawl-delay when the site asks for a slower pace than our default.
    const robots = await getRobots(url);
    const delay = crawlDelayMs(robots, config.CRAWLER_USER_AGENT);
    if (delay && delay > config.CRAWLER_PER_HOST_DELAY_MS) {
      getLimiter().penalise(parsed.hostname, delay);
    }
  }

  const result = await rawFetch(url, {
    ...options,
    conditional: cached ? { etag: cached.etag, lastModified: cached.lastModified } : undefined,
  });

  // Server says nothing changed — serve the stored body and extend freshness.
  if (result.status === 304 && cached) {
    await touchCache(url, ttlMinutes);
    return {
      ...result,
      ok: true,
      status: cached.status,
      body: cached.body,
      contentType: cached.contentType,
      fromCache: true,
      durationMs: Date.now() - startedAt,
    };
  }

  if (result.ok && result.body !== null) {
    await writeCache(url, result, ttlMinutes);
  } else if (!result.ok && cached?.body) {
    // Transient failure: fall back to the last good copy rather than losing the
    // program, but flag it so callers know it was not re-verified.
    log.debug('Serving stale cache after fetch failure', { url, error: result.error });
    return {
      ...result,
      ok: true,
      status: cached.status,
      body: cached.body,
      contentType: cached.contentType,
      fromCache: true,
      error: result.error,
    };
  }

  return { ...result, durationMs: Date.now() - startedAt };
}

function failure(url: string, error: string, startedAt: number): FetchResult {
  return {
    ok: false,
    url,
    finalUrl: url,
    status: 0,
    body: null,
    contentType: null,
    etag: null,
    lastModified: null,
    headerLastModified: null,
    fromCache: false,
    error,
    durationMs: Date.now() - startedAt,
  };
}

async function readCache(url: string) {
  const [row] = await db().select().from(httpCache).where(eq(httpCache.url, url)).limit(1);
  return row ?? null;
}

async function writeCache(url: string, result: FetchResult, ttlMinutes: number) {
  const now = new Date();
  const values = {
    url,
    host: hostnameOf(url) ?? '',
    status: result.status,
    etag: result.etag,
    lastModified: result.lastModified,
    contentType: result.contentType,
    body: result.body,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
  };
  await db()
    .insert(httpCache)
    .values(values)
    .onConflictDoUpdate({ target: httpCache.url, set: values });
}

async function touchCache(url: string, ttlMinutes: number) {
  await db()
    .update(httpCache)
    .set({ fetchedAt: new Date(), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) })
    .where(eq(httpCache.url, url));
}

/** Housekeeping: drop cache rows that expired more than a day ago. */
export async function pruneHttpCache(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const result = await db().delete(httpCache).where(lt(httpCache.fetchedAt, cutoff));
  return result.rowCount ?? 0;
}

/** Quick existence probe that avoids downloading a body. */
export async function probeUrl(url: string): Promise<{ exists: boolean; status: number }> {
  const result = await fetchPage(url, { accept: 'text/html,*/*;q=0.8' });
  return { exists: result.ok, status: result.status };
}


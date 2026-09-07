/**
 * Politeness controls for outbound crawling.
 *
 * Two independent limits apply to every request:
 *   1. a per-host minimum delay, so we never hammer a single site, and
 *   2. a global concurrency cap, so the crawler stays a light background load.
 *
 * Both are in-process. A multi-worker deployment gets per-worker limits, which
 * is why the defaults are conservative.
 */

export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = Math.max(1, permits);
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return this.makeRelease();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    return this.makeRelease();
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.available += 1;
    };
  }

  get pending(): number {
    return this.waiters.length;
  }
}

export class HostRateLimiter {
  private readonly nextAllowedAt = new Map<string, number>();
  /** Serialises waiters per host so N callers queue rather than all racing. */
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly minDelayMs: number) {}

  /** Resolves once it is polite to issue a request to `host`. */
  async acquire(host: string): Promise<void> {
    const key = host.toLowerCase();
    const previous = this.chains.get(key) ?? Promise.resolve();

    const current = previous.then(async () => {
      const now = Date.now();
      const earliest = this.nextAllowedAt.get(key) ?? 0;
      const waitMs = earliest - now;
      if (waitMs > 0) await sleep(waitMs);
      this.nextAllowedAt.set(key, Date.now() + this.minDelayMs);
    });

    this.chains.set(
      key,
      current.catch(() => undefined),
    );
    await current;
  }

  /**
   * Honour a `Retry-After` / 429 by pushing this host's next slot further out.
   */
  penalise(host: string, delayMs: number): void {
    const key = host.toLowerCase();
    const earliest = Math.max(this.nextAllowedAt.get(key) ?? 0, Date.now() + delayMs);
    this.nextAllowedAt.set(key, earliest);
  }

  /** Milliseconds until this host may be contacted again. */
  cooldownRemaining(host: string): number {
    return Math.max(0, (this.nextAllowedAt.get(host.toLowerCase()) ?? 0) - Date.now());
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Exponential backoff with jitter, so retries never synchronise. */
export function backoffDelay(attempt: number, baseMs: number, maxMs = 30_000): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

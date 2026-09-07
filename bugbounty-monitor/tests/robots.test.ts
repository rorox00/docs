import { describe, expect, it } from 'vitest';
import { crawlDelayMs, isAllowed, parseRobots } from '@/pipeline/fetch/robots';
import { backoffDelay, HostRateLimiter, Semaphore } from '@/pipeline/fetch/ratelimit';

const UA = 'BugBountyMonitor/1.0';

describe('parseRobots', () => {
  it('honours a group that targets our agent over the wildcard group', () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /

User-agent: BugBountyMonitor
Disallow: /private
Allow: /security
`);
    expect(isAllowed(robots, UA, '/security')).toBe(true);
    expect(isAllowed(robots, UA, '/private')).toBe(false);
    expect(isAllowed(robots, UA, '/anything')).toBe(true);
  });

  it('applies longest-match-wins with Allow winning ties', () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /docs
Allow: /docs/security
`);
    expect(isAllowed(robots, UA, '/docs/other')).toBe(false);
    expect(isAllowed(robots, UA, '/docs/security/policy')).toBe(true);
  });

  it('supports * and $ wildcards', () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /*.pdf$
Disallow: /tmp/*/private
`);
    expect(isAllowed(robots, UA, '/report.pdf')).toBe(false);
    expect(isAllowed(robots, UA, '/report.pdf.html')).toBe(true);
    expect(isAllowed(robots, UA, '/tmp/a/private')).toBe(false);
  });

  it('treats an empty Disallow as "allow everything"', () => {
    const robots = parseRobots('User-agent: *\nDisallow:');
    expect(isAllowed(robots, UA, '/anything')).toBe(true);
  });

  it('allows everything when robots.txt is empty or absent', () => {
    expect(isAllowed(parseRobots(''), UA, '/security')).toBe(true);
  });

  it('collects sitemaps and crawl-delay', () => {
    const robots = parseRobots(`
Sitemap: https://example.com/sitemap.xml
User-agent: *
Crawl-delay: 10
Disallow: /admin
`);
    expect(robots.sitemaps).toEqual(['https://example.com/sitemap.xml']);
    expect(crawlDelayMs(robots, UA)).toBe(10_000);
  });

  it('caps an absurd crawl-delay so one site cannot stall a run', () => {
    const robots = parseRobots('User-agent: *\nCrawl-delay: 86400');
    expect(crawlDelayMs(robots, UA)).toBe(60_000);
  });

  it('ignores comments and malformed lines', () => {
    const robots = parseRobots(`# comment\nnot a directive\nUser-agent: *\nDisallow: /x # trailing`);
    expect(isAllowed(robots, UA, '/x')).toBe(false);
    expect(isAllowed(robots, UA, '/y')).toBe(true);
  });
});

describe('rate limiting', () => {
  it('spaces out requests to the same host', async () => {
    const limiter = new HostRateLimiter(60);
    const started = Date.now();
    await limiter.acquire('example.com');
    await limiter.acquire('example.com');
    await limiter.acquire('example.com');
    expect(Date.now() - started).toBeGreaterThanOrEqual(110);
  });

  it('does not make one host wait for another', async () => {
    const limiter = new HostRateLimiter(150);
    await limiter.acquire('a.com');
    const started = Date.now();
    await limiter.acquire('b.com');
    expect(Date.now() - started).toBeLessThan(60);
  });

  it('extends the cooldown after a 429 penalty', async () => {
    const limiter = new HostRateLimiter(0);
    limiter.penalise('slow.com', 500);
    expect(limiter.cooldownRemaining('slow.com')).toBeGreaterThan(400);
  });
});

describe('Semaphore', () => {
  it('caps concurrency and releases waiters in order', async () => {
    const semaphore = new Semaphore(2);
    const releaseA = await semaphore.acquire();
    await semaphore.acquire();

    let third = false;
    const pending = semaphore.acquire().then(() => {
      third = true;
    });

    expect(third).toBe(false);
    releaseA();
    await pending;
    expect(third).toBe(true);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and stays within the ceiling', () => {
    expect(backoffDelay(0, 1000)).toBeLessThanOrEqual(1000);
    expect(backoffDelay(3, 1000)).toBeLessThanOrEqual(8000);
    expect(backoffDelay(20, 1000, 30_000)).toBeLessThanOrEqual(30_000);
  });
});

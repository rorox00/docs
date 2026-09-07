# Bug Bounty Monitor

A monitoring platform that continuously discovers **newly launched, self-hosted**
bug bounty and vulnerability disclosure programs — the ones a company publishes
on its own domain, before they become widely known on the big third-party
platforms.

> **Self-hosted** means the program lives at `company.com/security`,
> `company.com/bug-bounty`, `security.company.com`, a `security.txt`, or a
> similar company-owned page — *not* on HackerOne, Bugcrowd, Intigriti,
> YesWeHack, Immunefi or any other third-party platform.

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [How discovery works](#how-discovery-works)
- [Accuracy rules](#accuracy-rules)
- [Responsible crawling](#responsible-crawling)
- [Configuration](#configuration)
- [REST API](#rest-api)
- [Architecture](#architecture)
- [Development](#development)
- [Extending it](#extending-it)

---

## What it does

**Finds programs.** Six pluggable discovery sources propose candidate URLs:
`security.txt`, well-known path probing, sitemaps (including `<lastmod>`),
RSS/Atom announcement feeds, search engines, and certificate-transparency logs.

**Decides whether they're real.** A candidate only becomes a program if the page
shows evidence that it tells researchers *how to report a vulnerability to this
organisation*. Pages that merely discuss bug bounties — listicles, tutorials,
job ads, platform directories — are rejected.

**Distinguishes self-hosted from third-party.** A page served from
`hackerone.com` is never self-hosted. A page on the company's own domain that
*also links to* HackerOne **is** self-hosted, and is flagged as having a
parallel platform program. A stub page whose only content is "our program is on
Bugcrowd" is not a program at all.

**Extracts the details.** Program type, status, scope (in and out), reward tiers
across multiple currencies, contact methods, technologies, country — and, where
it can be established, the actual **launch date**.

**Watches for change.** Every program is re-crawled on a schedule. Scope
expansions, reward increases, new bounty tiers, closures, policy edits and
contact changes are detected, versioned and can be notified on.

**Surfaces it.** A dense, dark/light dashboard with New Programs as the primary
screen, a full filter panel, global search, a change feed, a daily digest,
statistics, a per-program detail page with timeline and provenance, and an
admin console.

---

## Quick start

### Docker Compose (recommended)

```bash
cp .env.example .env
# Edit .env — at minimum set AUTH_SECRET and CRAWLER_USER_AGENT.
docker compose up -d --build
```

Then open <http://localhost:3000> and register. **The first account created
becomes the administrator.**

Compose starts PostgreSQL, Redis, a one-shot migration/seed job, the web app,
and the background worker (crawler + scheduler + notifications).

### Local development

Requires Node 20.11+, PostgreSQL 14+ and (optionally) Redis.

```bash
npm install
cp .env.example .env          # point DATABASE_URL at your database

npm run db:migrate            # create the schema
npm run db:seed               # load the starter seed-domain list

npm run dev                   # dashboard on http://localhost:3000
npm run worker                # background crawler + scheduler (separate terminal)
```

### Get data in

The database starts empty. Any of these will populate it:

```bash
# Crawl specific domains
npm run discover -- --domains mozilla.org,gitlab.com --verbose

# Walk the seed list
npm run discover -- --limit 50

# Re-check what you already have, and record changes
npm run verify -- --limit 25
```

…or use **Admin → Manual actions** in the UI, which can also classify a single
URL so you can see exactly how the pipeline reads a page.

Without a worker running, nothing is scheduled — use the CLI or the admin panel.

---

## How discovery works

```
       ┌──────────────────────────────────────────────┐
       │  Discovery sources (pluggable, independent)  │
       │  security.txt · paths · sitemap · RSS ·      │
       │  search engine · certificate transparency    │
       └───────────────────┬──────────────────────────┘
                           ▼
                     Candidate URLs        ← deduplicated, prioritised, persisted
                           ▼
                     Page fetcher          ← robots.txt, rate limit, cache, retry
                           ▼
                    Content parser         ← text, JSON-LD, OpenGraph, lists, tables
                           ▼
       ┌───────────────────┴──────────────────────────┐
       │  False-positive gate → Program classifier    │
       │  Self-hosted detector → Third-party detector │
       └───────────────────┬──────────────────────────┘
                           ▼
     Date extractor · Scope extractor · Reward extractor
                           ▼
                    Confidence scoring
                           ▼
                     Deduplication         ← merges one program across many URLs
                           ▼
              Database (versioned history)
                           ▼
              Change detection → Notifications → Dashboard
```

Each stage is a separate module with no I/O in the analysis path, which is why
the classification surface is covered by fixture-driven tests.

### Confidence score

Every program carries a 0–100 score and **the list of factors that produced
it**, shown on the detail page. Nothing asserts a number without explaining it.

| Score  | Band      |
|--------|-----------|
| 95–100 | Very High |
| 80–94  | High      |
| 60–79  | Medium    |
| 40–59  | Low       |
| 0–39   | Unverified |

Factors include: explicit launch date, published reward amounts, structured
scope, a dedicated security contact, safe-harbour language, a canonical program
path, a security subdomain, corroboration by multiple independent sources, and
the reliability of the source that found it. Programs below
`MIN_CONFIDENCE_TO_PUBLISH` (default 40) are not published.

---

## Accuracy rules

These are enforced in code and covered by tests, because a wrong answer is worse
than no answer for this kind of tool.

**Nothing is fabricated.** Launch dates, bounty amounts, scope, status and
company details are only ever stored when they appear on the page. When they
cannot be established the UI shows *Unknown*, *Not specified* or *Could not
verify* — never a guess.

**Four date fields, never conflated:**

| Field | Meaning |
|---|---|
| **Launch date** | When the program went live. Only set from an explicit statement, `datePublished`, an OpenGraph publish time, or a dated announcement feed. |
| **Published date** | When the page was published, per its metadata. |
| **Last modified** | When the page last changed. **Never** promoted to a launch date. |
| **First discovered** | When *this tool* first saw it. Never presented as a launch date. |
| **Last verified** | When the page was last successfully re-crawled. |

A sitemap `<lastmod>`, an HTTP `Last-Modified` header and a "last updated" line
are all recorded as *modification* signals and can never become the launch date.
Ambiguous numeric dates (`07/09/2026` — 7 September or 9 July?) are rejected
outright rather than guessed.

**Rewards trace back to source text.** Every reward tier stores the literal text
it was read from, shown on the detail page so you can check the reading. Bare
numbers are not treated as amounts unless a currency is in scope, and a
four-digit year is never read as a bounty.

**Scope is structural.** Assets are read from lists and tables under scope
headings, not scraped from anywhere on the page. Reserved documentation domains
(`example.com` and friends) are ignored. When no scope can be attributed, the
detail page says so and tells you to read the policy at the source.

**History is never overwritten.** Assets and reward tiers are soft-removed with
a timestamp; every content change writes a new immutable version row.

---

## Responsible crawling

This is a **monitoring and research tool**. It reads publicly published program
information and nothing else.

It does **not** implement — and must not be extended to implement — vulnerability
scanning, exploitation, credential attacks, brute force, authentication bypass,
aggressive endpoint enumeration, or any automated testing against the programs
it discovers.

Built-in protections:

- **robots.txt is respected** by default, including `Crawl-delay`, with
  longest-match-wins Allow/Disallow handling.
- **Rate limiting**: a per-host minimum delay (4s default) and a global
  concurrency cap (4 default).
- **Caching**: conditional requests with `ETag`/`If-Modified-Since`, and a
  persistent body cache, so re-verification usually costs a `304`.
- **Backoff**: `429`/`503` responses extend that host's cooldown, honouring
  `Retry-After`.
- **Bounded work**: request timeouts, a response body ceiling, and a cap on
  paths probed per domain per run.
- **Honest identification**: set `CRAWLER_USER_AGENT` and
  `CRAWLER_CONTACT_EMAIL` to something that identifies you and lets a site owner
  reach you. Please do this before pointing it at the internet.

Setting `CRAWLER_ENABLED=false` disables all outbound fetching.

---

## Configuration

Everything lives in `.env`; see [`.env.example`](.env.example) for the full,
commented list. The values worth knowing about:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://bbm:bbm@localhost:5432/bbm` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379` | Job queue; jobs run inline without it |
| `AUTH_SECRET` | — | **Change this.** Signs session cookies |
| `CRAWLER_USER_AGENT` | identifying string | How you introduce yourself |
| `CRAWLER_PER_HOST_DELAY_MS` | `4000` | Minimum gap between requests to one host |
| `CRAWLER_GLOBAL_CONCURRENCY` | `4` | Concurrent outbound requests |
| `CRAWLER_RESPECT_ROBOTS` | `true` | Honour robots.txt |
| `MIN_CONFIDENCE_TO_PUBLISH` | `40` | Confidence floor for new programs |
| `NEW_PROGRAM_WINDOW_DAYS` | `30` | What counts as "new" |
| `SCHEDULE_DISCOVERY_CRON` | `0 */6 * * *` | Discovery schedule |
| `SCHEDULE_VERIFY_CRON` | `30 3 * * *` | Re-verification schedule |
| `SCHEDULE_DIGEST_CRON` | `0 8 * * *` | Daily digest schedule |
| `SEARCH_PROVIDER` | `none` | `brave`, `google_cse`, `bing`, `serpapi` |

### Optional integrations

Everything below is inert until configured, and the admin panel tells you
exactly what is missing for each one.

- **Search engines** — set `SEARCH_PROVIDER` + `SEARCH_API_KEY`
  (plus `GOOGLE_CSE_ID` for Google Programmable Search).
- **Email** — `NOTIFY_EMAIL_ENABLED=true` plus the `SMTP_*` variables.
- **Slack / Discord / Telegram** — set the matching webhook URL or bot token.

---

## REST API

Read endpoints are open so you can script against your own instance; anything
that triggers crawling or mutates data requires an authenticated admin session.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/programs` | List with every filter and sort |
| `GET` | `/api/programs/new` | New programs (defaults to 7 days) |
| `GET` | `/api/programs/recent` | Most recently verified |
| `GET` | `/api/programs/:id` | Full record: scope, rewards, changes, sources, versions |
| `GET` | `/api/programs/changes` | Change feed (also `/api/changes`) |
| `GET` | `/api/search?q=…` | Search company, domain, asset, technology, country |
| `GET` | `/api/statistics` | Dashboard counters and every chart series |
| `GET` | `/api/notifications` | Your in-app notifications |
| `GET` | `/api/filters` | Your saved subscriptions |
| `GET` | `/api/health` | Readiness probe |
| `POST` | `/api/discovery/run` | Trigger discovery *(admin)* |
| `POST` | `/api/discovery/submit` | Classify one URL *(admin)* |
| `POST` | `/api/verification/run` | Re-verify due programs *(admin)* |
| `POST` | `/api/programs/:id/verify` | Re-verify one program *(admin)* |
| `PATCH` | `/api/admin/programs/:id` | Correct a classification, mark a false positive *(admin)* |
| `GET`/`POST` | `/api/admin/candidates` | Review, approve or reject candidates *(admin)* |
| `GET` | `/api/admin/events` | Crawler audit log *(admin)* |
| `GET` | `/api/admin/sources` | Source and channel status *(admin)* |
| `GET`/`POST`/`DELETE` | `/api/admin/seeds` | Manage seed domains *(admin)* |

Filters accept `snake_case` or `camelCase` and combine freely:

```bash
# Self-hosted + last 7 days + paid + API in scope + max bounty over $5,000
curl 'http://localhost:3000/api/programs?days=7&paid=true&has_api=true&min_bounty=5000&sort=highest_bounty'

# Programs with Android targets
curl 'http://localhost:3000/api/search?q=android'
```

All list endpoints return `{ data, pagination: { page, pageSize, total, totalPages } }`.

---

## Architecture

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 ·
PostgreSQL + Drizzle ORM · BullMQ + Redis · Docker.

```
src/
  db/              schema, migrations, seed data
  lib/             env, logging, URL/date utilities, platform registry
  pipeline/
    fetch/         robots parser, rate limiter, caching HTTP client
    parse/         HTML → structured page, security.txt parser
    classify/      false-positive gate, program classifier, self-hosted detector
    extract/       dates, scope, rewards, company, country
    score/         confidence scoring
    discovery/     source interface + six sources, run orchestration
    diff/          change detection
    analyze.ts     pure HTML → analysed program
    ingest.ts      candidate → verified, persisted program
    dedupe.ts      canonical URL selection and merging
  jobs/            BullMQ queue, worker, schedules, handlers
  server/          filters, repositories, auth, notifications, digest
  app/             dashboard pages and REST API routes
  components/      UI components
  cli/             `discover` and `verify` commands
tests/             155 tests — unit + integration against real PostgreSQL
```

The analysis path (`parse` → `classify` → `extract` → `score`) performs **no
I/O**, which is what makes it testable against fixtures and safe to reason about.

### Data model

`companies`, `programs`, `program_versions`, `program_assets`,
`program_rewards`, `program_changes`, `sources`, `discovery_events`,
`candidates`, `notifications`, `users`, `user_filters`, `seed_domains`, `runs`,
plus `http_cache` and `robots_cache`.

---

## Development

```bash
npm run dev          # dashboard with hot reload
npm run worker:dev   # worker with hot reload
npm run typecheck    # tsc --noEmit
npm test             # full test suite
npm run build        # production build
```

### Tests

```bash
# Unit tests need nothing but Node.
npm test

# Integration tests run against a real PostgreSQL database.
createdb bbm_test
TEST_DATABASE_URL=postgres://bbm:bbm@localhost:5432/bbm_test npm test
```

The suite covers URL normalisation, third-party platform detection, date
parsing, the false-positive gate, program classification, self-hosted detection,
scope and reward extraction, confidence scoring, change detection, robots.txt
handling, rate limiting, deduplication, and a full ingest-to-query integration
path. It also asserts that SQL filtering and in-memory notification matching
agree, so a saved subscription always matches what its dashboard view shows.

### Database changes

```bash
# Edit src/db/schema.ts, then:
npx drizzle-kit generate --name your_change
npm run db:migrate
```

---

## Extending it

**A new discovery source** — implement `DiscoverySource`
(`src/pipeline/discovery/source.ts`) and add it to `allSources()`. It proposes
URLs; it never decides what is or isn't a program, so accuracy-critical code
stays untouched.

**A new notification channel** — implement `NotificationChannel`
(`src/server/notifications/channel.ts`) and register it in `allChannels()`. It
becomes selectable on saved filters automatically, and reports its own
configuration status in the admin panel.

**A new classification signal** — the classifier, false-positive gate and
extractors are plain pattern tables in `src/pipeline/classify/` and
`src/pipeline/extract/`. Add a pattern, add a fixture, add a test.

**A new third-party platform** — one entry in `THIRD_PARTY_PLATFORMS`
(`src/lib/platforms.ts`).

---

## Licence and use

Use this to find programs to participate in legitimately. Always read a
program's own policy before testing anything, and stay within its stated scope
and rules.

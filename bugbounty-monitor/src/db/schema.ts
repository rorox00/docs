import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import type {
  AssetCategory,
  CandidateStatus,
  ChangeSeverity,
  ChangeType,
  ProgramStatus,
  ProgramType,
  RewardKind,
  SourceKind,
} from '@/lib/constants';

/* ------------------------------------------------------------------ */
/* Companies                                                           */
/* ------------------------------------------------------------------ */

export const companies = pgTable(
  'companies',
  {
    id: serial('id').primaryKey(),
    /** Registrable domain — the company's identity key. */
    domain: varchar('domain', { length: 253 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    website: text('website'),
    /** ISO 3166-1 alpha-2 where known; null when we could not determine it. */
    countryCode: varchar('country_code', { length: 2 }),
    countryName: varchar('country_name', { length: 100 }),
    description: text('description'),
    logoUrl: text('logo_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('companies_domain_key').on(t.domain), index('companies_name_idx').on(t.name)],
);

/* ------------------------------------------------------------------ */
/* Programs                                                            */
/* ------------------------------------------------------------------ */

export const programs = pgTable(
  'programs',
  {
    id: serial('id').primaryKey(),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 255 }).notNull(),
    /** Canonical, normalised program URL (dedup key). */
    programUrl: text('program_url').notNull(),
    /** Company domain the program is published on. */
    companyDomain: varchar('company_domain', { length: 253 }).notNull(),

    programType: varchar('program_type', { length: 32 })
      .notNull()
      .$type<ProgramType>()
      .default('unknown'),
    status: varchar('status', { length: 16 }).notNull().$type<ProgramStatus>().default('unknown'),

    /** True when the program is published on the company's own infrastructure. */
    selfHosted: boolean('self_hosted').notNull().default(true),
    /** A third-party platform program also exists (does not disqualify self-hosting). */
    hasThirdPartyProgram: boolean('has_third_party_program').notNull().default(false),
    thirdPartyPlatforms: jsonb('third_party_platforms').$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    rewardKind: varchar('reward_kind', { length: 24 }).notNull().$type<RewardKind>().default('unknown'),
    /** Amounts are only ever set from text found on the page. */
    minBounty: numeric('min_bounty', { precision: 14, scale: 2 }),
    maxBounty: numeric('max_bounty', { precision: 14, scale: 2 }),
    bountyCurrency: varchar('bounty_currency', { length: 8 }),

    /* Date fields are deliberately kept apart — see docs/accuracy rules. */
    launchDate: timestamp('launch_date', { withTimezone: true }),
    launchDateSource: varchar('launch_date_source', { length: 48 }),
    publishedDate: timestamp('published_date', { withTimezone: true }),
    modifiedDate: timestamp('modified_date', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastChangedAt: timestamp('last_changed_at', { withTimezone: true }),

    confidenceScore: integer('confidence_score').notNull().default(0),
    confidenceFactors: jsonb('confidence_factors')
      .$type<Array<{ id: string; label: string; points: number }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Cached flag: discovered/launched inside the "new program" window. */
    isNew: boolean('is_new').notNull().default(true),

    summary: text('summary'),
    policyText: text('policy_text'),
    contactMethods: jsonb('contact_methods').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    technologies: jsonb('technologies').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    languages: jsonb('languages').$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    /* Denormalised scope facets so filters stay index-friendly. */
    hasApi: boolean('has_api').notNull().default(false),
    hasAndroid: boolean('has_android').notNull().default(false),
    hasIos: boolean('has_ios').notNull().default(false),
    hasMobile: boolean('has_mobile').notNull().default(false),
    hasWildcard: boolean('has_wildcard').notNull().default(false),
    hasCloud: boolean('has_cloud').notNull().default(false),
    hasWeb: boolean('has_web').notNull().default(false),
    assetCount: integer('asset_count').notNull().default(0),

    /*
     * NOTE: the table also carries a `search_vector tsvector` column, created in
     * the initial migration and maintained by `refreshSearchVector()`. It is
     * intentionally not declared here: it is a derived index artifact rather
     * than application state, and keeping it out of the schema stops drizzle-kit
     * from trying to manage it. Queries reference it as raw SQL.
     */

    /** Content hash of the meaningful page text; drives change detection. */
    contentHash: varchar('content_hash', { length: 64 }),
    currentVersionId: integer('current_version_id'),

    /** Operator overrides. */
    reviewed: boolean('reviewed').notNull().default(false),
    falsePositive: boolean('false_positive').notNull().default(false),
    hidden: boolean('hidden').notNull().default(false),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('programs_program_url_key').on(t.programUrl),
    index('programs_company_idx').on(t.companyId),
    index('programs_first_seen_idx').on(t.firstSeenAt),
    index('programs_launch_date_idx').on(t.launchDate),
    index('programs_status_idx').on(t.status),
    index('programs_type_idx').on(t.programType),
    index('programs_confidence_idx').on(t.confidenceScore),
    index('programs_domain_idx').on(t.companyDomain),
    index('programs_last_changed_idx').on(t.lastChangedAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Versions — a full immutable snapshot per observed change            */
/* ------------------------------------------------------------------ */

export const programVersions = pgTable(
  'program_versions',
  {
    id: serial('id').primaryKey(),
    programId: integer('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    /** Structured snapshot of everything we extracted at this point in time. */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    /** Normalised, whitespace-collapsed page text used to produce diffs. */
    contentText: text('content_text'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('program_versions_program_version_key').on(t.programId, t.version),
    index('program_versions_program_idx').on(t.programId, t.capturedAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Assets (scope)                                                      */
/* ------------------------------------------------------------------ */

export const programAssets = pgTable(
  'program_assets',
  {
    id: serial('id').primaryKey(),
    programId: integer('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    /** Raw identifier as written on the page, e.g. `*.example.com`. */
    identifier: varchar('identifier', { length: 512 }).notNull(),
    normalizedIdentifier: varchar('normalized_identifier', { length: 512 }).notNull(),
    category: varchar('category', { length: 24 }).notNull().$type<AssetCategory>().default('other'),
    inScope: boolean('in_scope').notNull().default(true),
    description: text('description'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the asset disappeared from the page; keeps history intact. */
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('program_assets_unique').on(t.programId, t.normalizedIdentifier, t.inScope),
    index('program_assets_program_idx').on(t.programId),
    index('program_assets_category_idx').on(t.category),
    index('program_assets_normalized_idx').on(t.normalizedIdentifier),
  ],
);

/* ------------------------------------------------------------------ */
/* Reward tiers                                                        */
/* ------------------------------------------------------------------ */

export const programRewards = pgTable(
  'program_rewards',
  {
    id: serial('id').primaryKey(),
    programId: integer('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    /** e.g. `Critical`, `High`, `Maximum bounty`. */
    tier: varchar('tier', { length: 64 }).notNull(),
    tierRank: integer('tier_rank').notNull().default(0),
    minAmount: numeric('min_amount', { precision: 14, scale: 2 }),
    maxAmount: numeric('max_amount', { precision: 14, scale: 2 }),
    currency: varchar('currency', { length: 8 }),
    /** Verbatim source text so a researcher can check our reading. */
    rawText: text('raw_text'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('program_rewards_unique').on(t.programId, t.tier),
    index('program_rewards_program_idx').on(t.programId),
  ],
);

/* ------------------------------------------------------------------ */
/* Detected changes                                                    */
/* ------------------------------------------------------------------ */

export const programChanges = pgTable(
  'program_changes',
  {
    id: serial('id').primaryKey(),
    programId: integer('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    fromVersionId: integer('from_version_id').references(() => programVersions.id, {
      onDelete: 'set null',
    }),
    toVersionId: integer('to_version_id').references(() => programVersions.id, {
      onDelete: 'set null',
    }),
    changeType: varchar('change_type', { length: 32 }).notNull().$type<ChangeType>(),
    severity: varchar('severity', { length: 12 }).notNull().$type<ChangeSeverity>().default('info'),
    summary: text('summary').notNull(),
    previousValue: text('previous_value'),
    newValue: text('new_value'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    notified: boolean('notified').notNull().default(false),
  },
  (t) => [
    index('program_changes_program_idx').on(t.programId, t.detectedAt),
    index('program_changes_detected_idx').on(t.detectedAt),
    index('program_changes_type_idx').on(t.changeType),
    index('program_changes_notified_idx').on(t.notified),
  ],
);

/* ------------------------------------------------------------------ */
/* Sources — how each program was found (many per program)             */
/* ------------------------------------------------------------------ */

export const sources = pgTable(
  'sources',
  {
    id: serial('id').primaryKey(),
    programId: integer('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 32 }).notNull().$type<SourceKind>(),
    url: text('url').notNull(),
    /** 0..1 — how much this source kind is trusted. */
    reliability: real('reliability').notNull().default(0.5),
    detail: text('detail'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sources_program_kind_url_key').on(t.programId, t.kind, t.url),
    index('sources_program_idx').on(t.programId),
  ],
);

/* ------------------------------------------------------------------ */
/* Discovery events — audit trail of every crawl decision              */
/* ------------------------------------------------------------------ */

export const discoveryEvents = pgTable(
  'discovery_events',
  {
    id: serial('id').primaryKey(),
    runId: varchar('run_id', { length: 64 }),
    programId: integer('program_id').references(() => programs.id, { onDelete: 'set null' }),
    candidateId: integer('candidate_id'),
    sourceKind: varchar('source_kind', { length: 32 }).$type<SourceKind>(),
    url: text('url'),
    /** discovered | fetched | accepted | rejected | error | verified | changed */
    eventType: varchar('event_type', { length: 32 }).notNull(),
    outcome: varchar('outcome', { length: 32 }),
    message: text('message'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('discovery_events_created_idx').on(t.createdAt),
    index('discovery_events_run_idx').on(t.runId),
    index('discovery_events_type_idx').on(t.eventType),
    index('discovery_events_program_idx').on(t.programId),
  ],
);

/* ------------------------------------------------------------------ */
/* Candidate URLs awaiting classification                              */
/* ------------------------------------------------------------------ */

export const candidates = pgTable(
  'candidates',
  {
    id: serial('id').primaryKey(),
    url: text('url').notNull(),
    normalizedUrl: text('normalized_url').notNull(),
    domain: varchar('domain', { length: 253 }).notNull(),
    sourceKind: varchar('source_kind', { length: 32 }).notNull().$type<SourceKind>(),
    sourceDetail: text('source_detail'),
    status: varchar('status', { length: 16 }).notNull().$type<CandidateStatus>().default('pending'),
    /** Higher runs first. */
    priority: integer('priority').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    rejectionReason: text('rejection_reason'),
    /** Score from the cheap pre-filter, before the page is fetched. */
    preScore: integer('pre_score').notNull().default(0),
    programId: integer('program_id').references(() => programs.id, { onDelete: 'set null' }),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('candidates_normalized_url_key').on(t.normalizedUrl),
    index('candidates_status_idx').on(t.status, t.priority),
    index('candidates_domain_idx').on(t.domain),
    index('candidates_discovered_idx').on(t.discoveredAt),
  ],
);

/* ------------------------------------------------------------------ */
/* HTTP cache — conditional requests + politeness                      */
/* ------------------------------------------------------------------ */

export const httpCache = pgTable(
  'http_cache',
  {
    url: text('url').primaryKey(),
    host: varchar('host', { length: 253 }).notNull(),
    status: integer('status').notNull(),
    etag: text('etag'),
    lastModified: text('last_modified'),
    contentType: text('content_type'),
    body: text('body'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [index('http_cache_host_idx').on(t.host), index('http_cache_fetched_idx').on(t.fetchedAt)],
);

export const robotsCache = pgTable('robots_cache', {
  origin: text('origin').primaryKey(),
  body: text('body'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

/* ------------------------------------------------------------------ */
/* Users, saved filters, notifications                                 */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    name: varchar('name', { length: 120 }),
    passwordHash: text('password_hash').notNull(),
    role: varchar('role', { length: 16 }).notNull().default('researcher'),
    emailNotifications: boolean('email_notifications').notNull().default(true),
    digestEnabled: boolean('digest_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

/** A saved subscription: filter criteria + which channels to notify on. */
export const userFilters = pgTable(
  'user_filters',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Which events this subscription reacts to. */
    onNewProgram: boolean('on_new_program').notNull().default(true),
    onScopeChange: boolean('on_scope_change').notNull().default(false),
    onRewardChange: boolean('on_reward_change').notNull().default(false),
    onProgramClosed: boolean('on_program_closed').notNull().default(false),
    /** Serialised ProgramFilter criteria. */
    criteria: jsonb('criteria').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    channels: jsonb('channels').$type<string[]>().notNull().default(sql`'["in_app"]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_filters_user_idx').on(t.userId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    filterId: integer('filter_id').references(() => userFilters.id, { onDelete: 'set null' }),
    programId: integer('program_id').references(() => programs.id, { onDelete: 'cascade' }),
    changeId: integer('change_id').references(() => programChanges.id, { onDelete: 'cascade' }),
    /** new_program | change | digest */
    kind: varchar('kind', { length: 32 }).notNull(),
    title: text('title').notNull(),
    body: text('body'),
    url: text('url'),
    severity: varchar('severity', { length: 12 }).notNull().default('info'),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** Per-channel delivery state, e.g. `{"email":"sent"}`. */
    deliveries: jsonb('deliveries').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    index('notifications_unread_idx').on(t.userId, t.readAt),
    uniqueIndex('notifications_dedupe_key').on(t.userId, t.kind, t.programId, t.changeId),
  ],
);

/* ------------------------------------------------------------------ */
/* Seed domains for the discovery engine                               */
/* ------------------------------------------------------------------ */

export const seedDomains = pgTable(
  'seed_domains',
  {
    id: serial('id').primaryKey(),
    domain: varchar('domain', { length: 253 }).notNull(),
    label: varchar('label', { length: 255 }),
    countryCode: varchar('country_code', { length: 2 }),
    enabled: boolean('enabled').notNull().default(true),
    lastCrawledAt: timestamp('last_crawled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('seed_domains_domain_key').on(t.domain)],
);

/** Bookkeeping for a single discovery/verification run. */
export const runs = pgTable(
  'runs',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    kind: varchar('kind', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    stats: jsonb('stats').$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    error: text('error'),
    triggeredBy: varchar('triggered_by', { length: 64 }),
  },
  (t) => [index('runs_started_idx').on(t.startedAt)],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const companiesRelations = relations(companies, ({ many }) => ({
  programs: many(programs),
}));

export const programsRelations = relations(programs, ({ one, many }) => ({
  company: one(companies, { fields: [programs.companyId], references: [companies.id] }),
  assets: many(programAssets),
  rewards: many(programRewards),
  versions: many(programVersions),
  changes: many(programChanges),
  sources: many(sources),
}));

export const programAssetsRelations = relations(programAssets, ({ one }) => ({
  program: one(programs, { fields: [programAssets.programId], references: [programs.id] }),
}));

export const programRewardsRelations = relations(programRewards, ({ one }) => ({
  program: one(programs, { fields: [programRewards.programId], references: [programs.id] }),
}));

export const programVersionsRelations = relations(programVersions, ({ one }) => ({
  program: one(programs, { fields: [programVersions.programId], references: [programs.id] }),
}));

export const programChangesRelations = relations(programChanges, ({ one }) => ({
  program: one(programs, { fields: [programChanges.programId], references: [programs.id] }),
}));

export const sourcesRelations = relations(sources, ({ one }) => ({
  program: one(programs, { fields: [sources.programId], references: [programs.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  filters: many(userFilters),
  notifications: many(notifications),
}));

export const userFiltersRelations = relations(userFilters, ({ one }) => ({
  user: one(users, { fields: [userFilters.userId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  program: one(programs, { fields: [notifications.programId], references: [programs.id] }),
  change: one(programChanges, { fields: [notifications.changeId], references: [programChanges.id] }),
}));

/* ------------------------------------------------------------------ */
/* Inferred types                                                      */
/* ------------------------------------------------------------------ */

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Program = typeof programs.$inferSelect;
export type NewProgram = typeof programs.$inferInsert;
export type ProgramVersion = typeof programVersions.$inferSelect;
export type ProgramAsset = typeof programAssets.$inferSelect;
export type ProgramReward = typeof programRewards.$inferSelect;
export type ProgramChange = typeof programChanges.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type DiscoveryEvent = typeof discoveryEvents.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;
export type User = typeof users.$inferSelect;
export type UserFilter = typeof userFilters.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type SeedDomain = typeof seedDomains.$inferSelect;
export type Run = typeof runs.$inferSelect;

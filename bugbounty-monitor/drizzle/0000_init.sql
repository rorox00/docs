CREATE TABLE "candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"domain" varchar(253) NOT NULL,
	"source_kind" varchar(32) NOT NULL,
	"source_detail" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"rejection_reason" text,
	"pre_score" integer DEFAULT 0 NOT NULL,
	"program_id" integer,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" varchar(253) NOT NULL,
	"name" varchar(255) NOT NULL,
	"website" text,
	"country_code" varchar(2),
	"country_name" varchar(100),
	"description" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" varchar(64),
	"program_id" integer,
	"candidate_id" integer,
	"source_kind" varchar(32),
	"url" text,
	"event_type" varchar(32) NOT NULL,
	"outcome" varchar(32),
	"message" text,
	"details" jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "http_cache" (
	"url" text PRIMARY KEY NOT NULL,
	"host" varchar(253) NOT NULL,
	"status" integer NOT NULL,
	"etag" text,
	"last_modified" text,
	"content_type" text,
	"body" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"filter_id" integer,
	"program_id" integer,
	"change_id" integer,
	"kind" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"url" text,
	"severity" varchar(12) DEFAULT 'info' NOT NULL,
	"read_at" timestamp with time zone,
	"deliveries" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"identifier" varchar(512) NOT NULL,
	"normalized_identifier" varchar(512) NOT NULL,
	"category" varchar(24) DEFAULT 'other' NOT NULL,
	"in_scope" boolean DEFAULT true NOT NULL,
	"description" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "program_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"from_version_id" integer,
	"to_version_id" integer,
	"change_type" varchar(32) NOT NULL,
	"severity" varchar(12) DEFAULT 'info' NOT NULL,
	"summary" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"details" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"tier" varchar(64) NOT NULL,
	"tier_rank" integer DEFAULT 0 NOT NULL,
	"min_amount" numeric(14, 2),
	"max_amount" numeric(14, 2),
	"currency" varchar(8),
	"raw_text" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "program_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"version" integer NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"content_text" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"program_url" text NOT NULL,
	"company_domain" varchar(253) NOT NULL,
	"program_type" varchar(32) DEFAULT 'unknown' NOT NULL,
	"status" varchar(16) DEFAULT 'unknown' NOT NULL,
	"self_hosted" boolean DEFAULT true NOT NULL,
	"has_third_party_program" boolean DEFAULT false NOT NULL,
	"third_party_platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reward_kind" varchar(24) DEFAULT 'unknown' NOT NULL,
	"min_bounty" numeric(14, 2),
	"max_bounty" numeric(14, 2),
	"bounty_currency" varchar(8),
	"launch_date" timestamp with time zone,
	"launch_date_source" varchar(48),
	"published_date" timestamp with time zone,
	"modified_date" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_changed_at" timestamp with time zone,
	"confidence_score" integer DEFAULT 0 NOT NULL,
	"confidence_factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_new" boolean DEFAULT true NOT NULL,
	"summary" text,
	"policy_text" text,
	"contact_methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"technologies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"has_api" boolean DEFAULT false NOT NULL,
	"has_android" boolean DEFAULT false NOT NULL,
	"has_ios" boolean DEFAULT false NOT NULL,
	"has_mobile" boolean DEFAULT false NOT NULL,
	"has_wildcard" boolean DEFAULT false NOT NULL,
	"has_cloud" boolean DEFAULT false NOT NULL,
	"has_web" boolean DEFAULT false NOT NULL,
	"asset_count" integer DEFAULT 0 NOT NULL,
	"content_hash" varchar(64),
	"current_version_id" integer,
	"reviewed" boolean DEFAULT false NOT NULL,
	"false_positive" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "robots_cache" (
	"origin" text PRIMARY KEY NOT NULL,
	"body" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"kind" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"triggered_by" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "seed_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" varchar(253) NOT NULL,
	"label" varchar(255),
	"country_code" varchar(2),
	"enabled" boolean DEFAULT true NOT NULL,
	"last_crawled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"kind" varchar(32) NOT NULL,
	"url" text NOT NULL,
	"reliability" real DEFAULT 0.5 NOT NULL,
	"detail" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_filters" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"on_new_program" boolean DEFAULT true NOT NULL,
	"on_scope_change" boolean DEFAULT false NOT NULL,
	"on_reward_change" boolean DEFAULT false NOT NULL,
	"on_program_closed" boolean DEFAULT false NOT NULL,
	"criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channels" jsonb DEFAULT '["in_app"]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(120),
	"password_hash" text NOT NULL,
	"role" varchar(16) DEFAULT 'researcher' NOT NULL,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_events" ADD CONSTRAINT "discovery_events_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_filter_id_user_filters_id_fk" FOREIGN KEY ("filter_id") REFERENCES "public"."user_filters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_change_id_program_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."program_changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_assets" ADD CONSTRAINT "program_assets_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_changes" ADD CONSTRAINT "program_changes_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_changes" ADD CONSTRAINT "program_changes_from_version_id_program_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."program_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_changes" ADD CONSTRAINT "program_changes_to_version_id_program_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."program_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_rewards" ADD CONSTRAINT "program_rewards_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_versions" ADD CONSTRAINT "program_versions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_filters" ADD CONSTRAINT "user_filters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_normalized_url_key" ON "candidates" USING btree ("normalized_url");--> statement-breakpoint
CREATE INDEX "candidates_status_idx" ON "candidates" USING btree ("status","priority");--> statement-breakpoint
CREATE INDEX "candidates_domain_idx" ON "candidates" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "candidates_discovered_idx" ON "candidates" USING btree ("discovered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_domain_key" ON "companies" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "companies_name_idx" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "discovery_events_created_idx" ON "discovery_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "discovery_events_run_idx" ON "discovery_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "discovery_events_type_idx" ON "discovery_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "discovery_events_program_idx" ON "discovery_events" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "http_cache_host_idx" ON "http_cache" USING btree ("host");--> statement-breakpoint
CREATE INDEX "http_cache_fetched_idx" ON "http_cache" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key" ON "notifications" USING btree ("user_id","kind","program_id","change_id");--> statement-breakpoint
CREATE UNIQUE INDEX "program_assets_unique" ON "program_assets" USING btree ("program_id","normalized_identifier","in_scope");--> statement-breakpoint
CREATE INDEX "program_assets_program_idx" ON "program_assets" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "program_assets_category_idx" ON "program_assets" USING btree ("category");--> statement-breakpoint
CREATE INDEX "program_assets_normalized_idx" ON "program_assets" USING btree ("normalized_identifier");--> statement-breakpoint
CREATE INDEX "program_changes_program_idx" ON "program_changes" USING btree ("program_id","detected_at");--> statement-breakpoint
CREATE INDEX "program_changes_detected_idx" ON "program_changes" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "program_changes_type_idx" ON "program_changes" USING btree ("change_type");--> statement-breakpoint
CREATE INDEX "program_changes_notified_idx" ON "program_changes" USING btree ("notified");--> statement-breakpoint
CREATE UNIQUE INDEX "program_rewards_unique" ON "program_rewards" USING btree ("program_id","tier");--> statement-breakpoint
CREATE INDEX "program_rewards_program_idx" ON "program_rewards" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "program_versions_program_version_key" ON "program_versions" USING btree ("program_id","version");--> statement-breakpoint
CREATE INDEX "program_versions_program_idx" ON "program_versions" USING btree ("program_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_program_url_key" ON "programs" USING btree ("program_url");--> statement-breakpoint
CREATE INDEX "programs_company_idx" ON "programs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "programs_first_seen_idx" ON "programs" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "programs_launch_date_idx" ON "programs" USING btree ("launch_date");--> statement-breakpoint
CREATE INDEX "programs_status_idx" ON "programs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "programs_type_idx" ON "programs" USING btree ("program_type");--> statement-breakpoint
CREATE INDEX "programs_confidence_idx" ON "programs" USING btree ("confidence_score");--> statement-breakpoint
CREATE INDEX "programs_domain_idx" ON "programs" USING btree ("company_domain");--> statement-breakpoint
CREATE INDEX "programs_last_changed_idx" ON "programs" USING btree ("last_changed_at");--> statement-breakpoint
CREATE INDEX "runs_started_idx" ON "runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seed_domains_domain_key" ON "seed_domains" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_program_kind_url_key" ON "sources" USING btree ("program_id","kind","url");--> statement-breakpoint
CREATE INDEX "sources_program_idx" ON "sources" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "user_filters_user_idx" ON "user_filters" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");
--> statement-breakpoint
-- Full-text search vector across the fields a researcher would search on.
ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "programs_search_idx" ON "programs" USING gin ("search_vector");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "program_assets_search_idx" ON "program_assets" USING gin (to_tsvector('simple', "identifier"));

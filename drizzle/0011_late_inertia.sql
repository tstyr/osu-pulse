ALTER TYPE "public"."cloud_render_input" ADD VALUE 'composition';--> statement-breakpoint
CREATE TABLE "overlay_feeds" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"created_by_discord_user_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overlay_feeds_guild_id_unique" UNIQUE("guild_id")
);
--> statement-breakpoint
CREATE TABLE "rivalries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"owner_discord_user_id" text NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"rival_discord_user_id" text,
	"rival_account_id" uuid NOT NULL,
	"mode" "osu_mode" DEFAULT 'osu' NOT NULL,
	"notification_channel_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_notified_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_heartbeats" (
	"service" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'operational' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"severity" text DEFAULT 'degraded' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_metric_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"renderer_id" text NOT NULL,
	"sampled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cpu_percent" double precision DEFAULT 0 NOT NULL,
	"gpu_percent" double precision,
	"memory_used_bytes" bigint DEFAULT 0 NOT NULL,
	"memory_total_bytes" bigint DEFAULT 0 NOT NULL,
	"disk_used_bytes" bigint DEFAULT 0 NOT NULL,
	"disk_total_bytes" bigint DEFAULT 0 NOT NULL,
	"network_received_bytes" bigint DEFAULT 0 NOT NULL,
	"network_sent_bytes" bigint DEFAULT 0 NOT NULL,
	"active_renders" integer DEFAULT 0 NOT NULL,
	"queue_size" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloud_render_jobs" ADD COLUMN "requested_by_discord_user_id" text;--> statement-breakpoint
ALTER TABLE "cloud_render_jobs" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "control_panel_sessions" ADD COLUMN "auth_method" text DEFAULT 'keyphrase' NOT NULL;--> statement-breakpoint
ALTER TABLE "control_panel_sessions" ADD COLUMN "discord_user_id" text;--> statement-breakpoint
ALTER TABLE "control_panel_sessions" ADD COLUMN "discord_username" text;--> statement-breakpoint
ALTER TABLE "control_panel_sessions" ADD COLUMN "discord_avatar_url" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "monthly_montage_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "monthly_montage_channel_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "monthly_montage_mode" "osu_mode" DEFAULT 'osu' NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "last_monthly_montage_month" text;--> statement-breakpoint
ALTER TABLE "rivalries" ADD CONSTRAINT "rivalries_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rivalries" ADD CONSTRAINT "rivalries_rival_account_id_accounts_id_fk" FOREIGN KEY ("rival_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rivalries_owner_rival_mode_idx" ON "rivalries" USING btree ("guild_id","owner_discord_user_id","rival_account_id","mode");--> statement-breakpoint
CREATE INDEX "rivalries_enabled_idx" ON "rivalries" USING btree ("enabled","guild_id");--> statement-breakpoint
CREATE INDEX "service_incidents_started_idx" ON "service_incidents" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "system_metric_samples_renderer_time_idx" ON "system_metric_samples" USING btree ("renderer_id","sampled_at");--> statement-breakpoint
CREATE INDEX "cloud_render_jobs_scheduled_idx" ON "cloud_render_jobs" USING btree ("status","scheduled_at");
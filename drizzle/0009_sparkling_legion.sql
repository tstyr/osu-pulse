CREATE TABLE "bot_errors" (
	"trace_id" text PRIMARY KEY NOT NULL,
	"command" text NOT NULL,
	"discord_user_id" text,
	"guild_id" text,
	"message" text NOT NULL,
	"stack" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bot_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" text NOT NULL,
	"guild_id" text,
	"kind" text DEFAULT 'request' NOT NULL,
	"title" text NOT NULL,
	"details" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"sent_by" text DEFAULT 'control-panel' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" text NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"uri" text NOT NULL,
	"source" text NOT NULL,
	"duration" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_queue_snapshots" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"voice_channel_id" text NOT NULL,
	"text_channel_id" text NOT NULL,
	"volume" integer DEFAULT 80 NOT NULL,
	"tracks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_usage_daily" (
	"service" text NOT NULL,
	"usage_date" date NOT NULL,
	"operations" integer DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"alerted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_usage_daily_service_usage_date_pk" PRIMARY KEY("service","usage_date")
);
--> statement-breakpoint
CREATE TABLE "user_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"mode" "osu_mode" NOT NULL,
	"target_pp" double precision,
	"target_global_rank" integer,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"achieved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "utility_panel_channel_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "utility_panel_message_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "updates_channel_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "last_announced_version" text;--> statement-breakpoint
ALTER TABLE "score_events" ADD COLUMN "star_rating" double precision;--> statement-breakpoint
ALTER TABLE "score_events" ADD COLUMN "bpm" double precision;--> statement-breakpoint
ALTER TABLE "score_events" ADD COLUMN "ar" double precision;--> statement-breakpoint
ALTER TABLE "score_events" ADD COLUMN "od" double precision;--> statement-breakpoint
ALTER TABLE "score_events" ADD COLUMN "cs" double precision;--> statement-breakpoint
ALTER TABLE "score_events" ADD COLUMN "is_personal_best" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "score_events" ADD COLUMN "anomaly_score" double precision;--> statement-breakpoint
ALTER TABLE "user_goals" ADD CONSTRAINT "user_goals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_errors_created_idx" ON "bot_errors" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bot_feedback_status_created_idx" ON "bot_feedback" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "music_favorites_user_uri_idx" ON "music_favorites" USING btree ("discord_user_id","uri");--> statement-breakpoint
CREATE INDEX "music_favorites_user_created_idx" ON "music_favorites" USING btree ("discord_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_goals_discord_mode_idx" ON "user_goals" USING btree ("discord_user_id","mode");--> statement-breakpoint
CREATE INDEX "user_goals_account_idx" ON "user_goals" USING btree ("account_id");
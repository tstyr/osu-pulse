CREATE TYPE "public"."focus_status" AS ENUM('running', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."osu_mode" AS ENUM('osu', 'taiko', 'fruits', 'mania');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('scheduled', 'delivered', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "account_guilds" (
	"account_id" uuid NOT NULL,
	"guild_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_guilds_account_id_guild_id_pk" PRIMARY KEY("account_id","guild_id")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" text NOT NULL,
	"osu_user_id" bigint NOT NULL,
	"username" text NOT NULL,
	"country_code" text,
	"avatar_url" text,
	"primary_mode" "osu_mode" DEFAULT 'osu' NOT NULL,
	"timezone" text DEFAULT 'Asia/Tokyo' NOT NULL,
	"daily_dm_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_discord_user_id_unique" UNIQUE("discord_user_id"),
	CONSTRAINT "accounts_osu_user_id_unique" UNIQUE("osu_user_id")
);
--> statement-breakpoint
CREATE TABLE "daily_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"mode" "osu_mode" NOT NULL,
	"snapshot_date" date NOT NULL,
	"global_rank" integer,
	"country_rank" integer,
	"pp" double precision DEFAULT 0 NOT NULL,
	"accuracy" double precision DEFAULT 0 NOT NULL,
	"play_count" integer DEFAULT 0 NOT NULL,
	"total_score" text DEFAULT '0' NOT NULL,
	"ranked_score" text DEFAULT '0' NOT NULL,
	"level" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "focus_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" text NOT NULL,
	"guild_id" text,
	"channel_id" text NOT NULL,
	"focus_minutes" integer DEFAULT 25 NOT NULL,
	"break_minutes" integer DEFAULT 5 NOT NULL,
	"rounds" integer DEFAULT 4 NOT NULL,
	"completed_rounds" integer DEFAULT 0 NOT NULL,
	"status" "focus_status" DEFAULT 'running' NOT NULL,
	"workflow_run_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "guild_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"result_channel_id" text,
	"announcements_enabled" boolean DEFAULT true NOT NULL,
	"minimum_pp" double precision DEFAULT 0 NOT NULL,
	"locale" text DEFAULT 'ja' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" text NOT NULL,
	"guild_id" text,
	"channel_id" text,
	"message" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "reminder_status" DEFAULT 'scheduled' NOT NULL,
	"workflow_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "score_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"osu_score_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"mode" "osu_mode" NOT NULL,
	"beatmap_id" bigint NOT NULL,
	"beatmapset_id" bigint,
	"artist" text NOT NULL,
	"title" text NOT NULL,
	"difficulty" text NOT NULL,
	"mapper" text,
	"cover_url" text,
	"pp" double precision,
	"accuracy" double precision NOT NULL,
	"rank" text NOT NULL,
	"max_combo" integer,
	"score" text,
	"mods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"passed" boolean DEFAULT true NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_events_osu_score_id_unique" UNIQUE("osu_score_id")
);
--> statement-breakpoint
ALTER TABLE "account_guilds" ADD CONSTRAINT "account_guilds_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_guilds" ADD CONSTRAINT "account_guilds_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_snapshots" ADD CONSTRAINT "daily_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_osu_user_idx" ON "accounts" USING btree ("osu_user_id");--> statement-breakpoint
CREATE INDEX "accounts_discord_user_idx" ON "accounts" USING btree ("discord_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_snapshot_account_mode_date_idx" ON "daily_snapshots" USING btree ("account_id","mode","snapshot_date");--> statement-breakpoint
CREATE INDEX "focus_sessions_user_status_idx" ON "focus_sessions" USING btree ("discord_user_id","status");--> statement-breakpoint
CREATE INDEX "reminders_due_status_idx" ON "reminders" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "score_events_account_mode_time_idx" ON "score_events" USING btree ("account_id","mode","ended_at");
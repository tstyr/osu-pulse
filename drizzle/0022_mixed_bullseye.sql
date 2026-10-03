CREATE TABLE "community_event_entries" (
	"event_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"choice_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_event_entries_event_id_discord_user_id_pk" PRIMARY KEY("event_id","discord_user_id")
);
--> statement-breakpoint
CREATE TABLE "community_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"winner_count" integer DEFAULT 1 NOT NULL,
	"created_by_discord_user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "community_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"opener_discord_user_id" text NOT NULL,
	"subject" text DEFAULT 'Support request' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_by_discord_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "community_tickets_channel_id_unique" UNIQUE("channel_id")
);
--> statement-breakpoint
CREATE TABLE "discord_activity_buckets" (
	"guild_id" text NOT NULL,
	"bucket_hour" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"voice_join_count" integer DEFAULT 0 NOT NULL,
	"voice_leave_count" integer DEFAULT 0 NOT NULL,
	"active_discord_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_activity_buckets_guild_id_bucket_hour_pk" PRIMARY KEY("guild_id","bucket_hour")
);
--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "onboarding_channel_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "onboarding_role_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "onboarding_panel_message_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "ticket_category_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "ticket_log_channel_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "ticket_support_role_id" text;--> statement-breakpoint
ALTER TABLE "music_playback_states" ADD COLUMN "voice_ping_ms" integer;--> statement-breakpoint
ALTER TABLE "music_playback_states" ADD COLUMN "frame_loss_percent" double precision;--> statement-breakpoint
ALTER TABLE "music_playback_states" ADD COLUMN "node_uptime_ms" bigint;--> statement-breakpoint
ALTER TABLE "music_playback_states" ADD COLUMN "reconnect_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "music_playback_states" ADD COLUMN "last_recovered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_event_entries" ADD CONSTRAINT "community_event_entries_event_id_community_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."community_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_event_entries_event_idx" ON "community_event_entries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "community_events_guild_status_idx" ON "community_events" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "community_events_due_idx" ON "community_events" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "community_tickets_guild_status_idx" ON "community_tickets" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "community_tickets_created_idx" ON "community_tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "discord_activity_bucket_hour_idx" ON "discord_activity_buckets" USING btree ("bucket_hour");
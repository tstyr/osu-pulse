CREATE TABLE "music_resolver_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text,
	"resolver" text NOT NULL,
	"outcome" text NOT NULL,
	"query_kind" text DEFAULT 'search' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_control_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"action" text DEFAULT 'restart' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "music_control_commands" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "music_control_commands" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "music_playback_states" ADD COLUMN "available_voice_channels" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "music_resolver_events_created_idx" ON "music_resolver_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "music_resolver_events_resolver_created_idx" ON "music_resolver_events" USING btree ("resolver","created_at");--> statement-breakpoint
CREATE INDEX "service_control_commands_status_requested_idx" ON "service_control_commands" USING btree ("status","requested_at");
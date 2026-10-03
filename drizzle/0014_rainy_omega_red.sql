CREATE TABLE "music_control_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"action" text NOT NULL,
	"value" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "music_control_commands_status_requested_idx" ON "music_control_commands" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "music_control_commands_guild_requested_idx" ON "music_control_commands" USING btree ("guild_id","requested_at");
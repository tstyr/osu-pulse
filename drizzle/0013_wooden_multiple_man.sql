CREATE TABLE "music_playback_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"uri" text NOT NULL,
	"source" text NOT NULL,
	"duration" integer DEFAULT 0 NOT NULL,
	"requested_by_discord_user_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text
);
--> statement-breakpoint
CREATE TABLE "music_playback_states" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"guild_name" text,
	"voice_channel_id" text,
	"voice_channel_name" text,
	"text_channel_id" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"current_track" jsonb,
	"queue" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position_ms" integer DEFAULT 0 NOT NULL,
	"volume" integer DEFAULT 80 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"issue" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_playlist_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"playlist_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"uri" text NOT NULL,
	"source" text NOT NULL,
	"duration" integer DEFAULT 0 NOT NULL,
	"added_by_discord_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by_discord_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "music_playlist_tracks" ADD CONSTRAINT "music_playlist_tracks_playlist_id_music_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."music_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "music_playback_history_guild_started_idx" ON "music_playback_history" USING btree ("guild_id","started_at");--> statement-breakpoint
CREATE INDEX "music_playback_history_started_idx" ON "music_playback_history" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "music_playlist_tracks_playlist_position_idx" ON "music_playlist_tracks" USING btree ("playlist_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "music_playlists_guild_name_idx" ON "music_playlists" USING btree ("guild_id","name");--> statement-breakpoint
CREATE INDEX "music_playlists_guild_updated_idx" ON "music_playlists" USING btree ("guild_id","updated_at");
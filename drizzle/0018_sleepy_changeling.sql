CREATE TABLE "music_local_audio_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"artist" text DEFAULT 'Unknown artist' NOT NULL,
	"original_filename" text NOT NULL,
	"file_name" text NOT NULL,
	"format" text NOT NULL,
	"codec" text NOT NULL,
	"bitrate_kbps" integer NOT NULL,
	"sample_rate_hz" integer,
	"channels" integer,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"uploaded_by" text,
	"uploaded_via" text DEFAULT 'discord' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "music_local_audio_tracks_created_idx" ON "music_local_audio_tracks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "music_local_audio_tracks_title_idx" ON "music_local_audio_tracks" USING btree ("title");
CREATE TABLE "render_videos" (
	"video_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"privacy_status" text DEFAULT 'public' NOT NULL,
	"score_id" bigint,
	"source_size" bigint DEFAULT 0 NOT NULL,
	"cleanup" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"delete_requested" boolean DEFAULT false NOT NULL,
	"delete_error" text,
	"uploaded_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "render_videos_uploaded_idx" ON "render_videos" USING btree ("uploaded_at");--> statement-breakpoint
CREATE INDEX "render_videos_delete_idx" ON "render_videos" USING btree ("delete_requested","updated_at");
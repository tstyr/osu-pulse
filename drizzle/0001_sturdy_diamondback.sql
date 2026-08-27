CREATE TYPE "public"."cloud_render_input" AS ENUM('score_url', 'replay');--> statement-breakpoint
CREATE TYPE "public"."cloud_render_status" AS ENUM('queued', 'claimed', 'resolving_score', 'downloading_replay', 'resolving_beatmap', 'rendering', 'encoding', 'uploading', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "cloud_render_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"access_token_hash" text NOT NULL,
	"input_type" "cloud_render_input" NOT NULL,
	"source_hash" text NOT NULL,
	"score_url" text,
	"replay_data" text,
	"options" jsonb NOT NULL,
	"status" "cloud_render_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"message" text DEFAULT 'ローカル Renderer の待機中' NOT NULL,
	"metadata" jsonb,
	"local_job_id" text,
	"claimed_by" text,
	"lease_expires_at" timestamp with time zone,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"video_url" text,
	"video_size" bigint,
	"error_code" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cloud_renderer_state" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"busy" boolean DEFAULT false NOT NULL,
	"queue_size" integer DEFAULT 0 NOT NULL,
	"active_cloud_job_id" uuid,
	"dependencies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cloud_render_jobs_status_created_idx" ON "cloud_render_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "cloud_render_jobs_lease_idx" ON "cloud_render_jobs" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "cloud_render_jobs_expiry_idx" ON "cloud_render_jobs" USING btree ("expires_at");
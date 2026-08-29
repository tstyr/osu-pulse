CREATE TABLE "control_panel_login_attempts" (
	"fingerprint_hash" text PRIMARY KEY NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_panel_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_panel_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"values" jsonb NOT NULL,
	"encrypted_secrets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloud_renderer_state" ADD COLUMN "configuration_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_renderer_state" ADD COLUMN "restart_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "control_panel_sessions_expiry_idx" ON "control_panel_sessions" USING btree ("expires_at");
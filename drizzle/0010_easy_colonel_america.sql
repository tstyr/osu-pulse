CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text,
	"actor_discord_user_id" text,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"account_id" uuid,
	"conditions" jsonb NOT NULL,
	"created_by" text,
	"last_matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_deliveries" (
	"guild_id" text NOT NULL,
	"report_type" text NOT NULL,
	"report_date" date NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_deliveries_guild_id_report_type_report_date_pk" PRIMARY KEY("guild_id","report_type","report_date")
);
--> statement-breakpoint
ALTER TABLE "cloud_render_jobs" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_render_jobs" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "daily_report_channel_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "weekly_awards_channel_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "audit_log_channel_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "console_log_channel_id" text;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_logs_guild_created_idx" ON "admin_audit_logs" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_rules_guild_enabled_idx" ON "notification_rules" USING btree ("guild_id","enabled");--> statement-breakpoint
CREATE INDEX "notification_rules_account_idx" ON "notification_rules" USING btree ("account_id");
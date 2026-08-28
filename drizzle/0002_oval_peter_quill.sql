ALTER TABLE "guild_settings" ADD COLUMN "status_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "status_category_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "status_channel_ids" jsonb;
CREATE TABLE "discord_account_links" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"primary_mode" "osu_mode" DEFAULT 'osu' NOT NULL,
	"daily_dm_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "discord_account_links" (
	"discord_user_id",
	"account_id",
	"primary_mode",
	"daily_dm_enabled",
	"created_at",
	"updated_at"
)
SELECT DISTINCT ON ("discord_user_id")
	"discord_user_id",
	"id",
	"primary_mode",
	"daily_dm_enabled",
	"created_at",
	"updated_at"
FROM "accounts"
ORDER BY "discord_user_id", "created_at", "id";
--> statement-breakpoint
DROP INDEX "accounts_discord_user_idx";--> statement-breakpoint
ALTER TABLE "discord_account_links" ADD CONSTRAINT "discord_account_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_account_links_account_idx" ON "discord_account_links" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "discord_user_id";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "daily_dm_enabled";--> statement-breakpoint
DELETE FROM "accounts"
WHERE "id" NOT IN (SELECT "account_id" FROM "discord_account_links");

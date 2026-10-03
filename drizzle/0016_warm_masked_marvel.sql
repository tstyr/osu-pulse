CREATE TABLE "profile_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"mode" "osu_mode" NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"global_rank" integer,
	"country_rank" integer,
	"pp" double precision DEFAULT 0 NOT NULL,
	"accuracy" double precision,
	"play_count" integer DEFAULT 0 NOT NULL,
	"play_time_seconds" integer,
	"total_score" text DEFAULT '0' NOT NULL,
	"ranked_score" text,
	"level" double precision,
	"source" text DEFAULT 'live' NOT NULL,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "top_play_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"mode" "osu_mode" NOT NULL,
	"top_limit" integer DEFAULT 50 NOT NULL,
	"score_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"top_pp_sum" double precision DEFAULT 0 NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'live' NOT NULL,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_snapshots" ADD CONSTRAINT "profile_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_play_snapshots" ADD CONSTRAINT "top_play_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_snapshots_account_mode_time_idx" ON "profile_snapshots" USING btree ("account_id","mode","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_snapshots_source_key_idx" ON "profile_snapshots" USING btree ("source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "top_play_snapshots_account_mode_time_idx" ON "top_play_snapshots" USING btree ("account_id","mode","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "top_play_snapshots_source_key_idx" ON "top_play_snapshots" USING btree ("source_key");
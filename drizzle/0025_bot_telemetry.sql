CREATE TABLE "bot_telemetry_samples" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bot_telemetry_samples_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"scope" text NOT NULL,
	"scope_label" text NOT NULL,
	"session_id" text NOT NULL,
	"sampled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"interval_seconds" double precision NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bot_telemetry_sample_identity_idx" ON "bot_telemetry_samples" USING btree ("scope","session_id","sampled_at");--> statement-breakpoint
CREATE INDEX "bot_telemetry_scope_time_idx" ON "bot_telemetry_samples" USING btree ("scope","sampled_at");--> statement-breakpoint
CREATE INDEX "bot_telemetry_time_idx" ON "bot_telemetry_samples" USING btree ("sampled_at");
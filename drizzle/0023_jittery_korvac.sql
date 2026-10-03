CREATE TABLE "score_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"score_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"rule_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message_id" text,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "score_notification_deliveries" ADD CONSTRAINT "score_notification_deliveries_score_id_score_events_id_fk" FOREIGN KEY ("score_id") REFERENCES "public"."score_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_notification_deliveries" ADD CONSTRAINT "score_notification_deliveries_rule_id_notification_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."notification_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "score_notification_deliveries_score_channel_idx" ON "score_notification_deliveries" USING btree ("score_id","channel_id");--> statement-breakpoint
CREATE INDEX "score_notification_deliveries_due_idx" ON "score_notification_deliveries" USING btree ("status","next_attempt_at");
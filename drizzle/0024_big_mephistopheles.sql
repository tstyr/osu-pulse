DROP INDEX "accounts_osu_user_idx";--> statement-breakpoint
CREATE INDEX "cloud_render_jobs_status_priority_created_idx" ON "cloud_render_jobs" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE INDEX "cloud_render_jobs_source_status_idx" ON "cloud_render_jobs" USING btree ("source_hash","status");--> statement-breakpoint
CREATE INDEX "score_events_account_mode_pp_idx" ON "score_events" USING btree ("account_id","mode","pp");--> statement-breakpoint
CREATE INDEX "service_incidents_service_resolved_idx" ON "service_incidents" USING btree ("service","resolved_at");--> statement-breakpoint
CREATE INDEX "system_metric_samples_time_idx" ON "system_metric_samples" USING btree ("sampled_at");
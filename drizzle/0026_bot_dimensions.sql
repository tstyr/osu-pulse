ALTER TABLE "bot_telemetry_samples" ADD COLUMN "dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL;

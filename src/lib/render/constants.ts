export const CLOUD_RENDER_STATUSES = [
  "queued",
  "claimed",
  "resolving_score",
  "downloading_replay",
  "resolving_beatmap",
  "rendering",
  "encoding",
  "uploading",
  "completed",
  "failed",
  "cancelled",
] as const;

export type CloudRenderStatus = (typeof CLOUD_RENDER_STATUSES)[number];

export const TERMINAL_CLOUD_RENDER_STATUSES = new Set<CloudRenderStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export const WEB_REPLAY_MAX_BYTES = 3 * 1024 * 1024;
export const CLOUD_RENDER_LEASE_SECONDS = 45;
export const CLOUD_RENDER_OUTPUT_HOURS = 24;

export const RENDER_RESOLUTIONS = [
  "1920x1080",
  "2560x1440",
  "2560x1600",
  "3840x2160",
] as const;
export const RENDER_FPS = [60, 120, 240] as const;
export const RENDER_SPEEDS = [
  "original",
  "0.5",
  "0.75",
  "1.0",
  "1.25",
  "1.5",
  "2.0",
] as const;

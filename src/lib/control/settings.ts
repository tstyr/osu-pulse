import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import {
  controlPanelSettings,
  type ControlPanelSecretName,
  type ControlPanelSettingsValue,
} from "@/db/schema";
import { autoRenderSettingsSchema, defaultAutoRenderSettings } from "@/lib/control/auto-render-settings";

const SETTINGS_ID = "primary";
const SECRET_NAMES = [
  "OSU_CLIENT_ID",
  "OSU_CLIENT_SECRET",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const satisfies readonly ControlPanelSecretName[];

const boolFromForm = z.preprocess(
  (value) => value === true || value === "true" || value === "on" || value === "1",
  z.boolean(),
);

export const controlSettingsSchema = z.object({
  renderDefaults: z.object({
    resolution: z.enum(["1920x1080", "2560x1440", "2560x1600", "3840x2160"]),
    fps: z.coerce.number().pipe(z.union([z.literal(60), z.literal(120), z.literal(240)])),
    speed: z.enum(["original", "0.5", "0.75", "1.0", "1.25", "1.5", "2.0"]),
    motionBlur: boolFromForm,
  }),
  renderer: z.object({
    maxConcurrentRenders: z.coerce.number().pipe(z.union([z.literal(1), z.literal(2)])),
    renderTimeoutSeconds: z.coerce.number().int().min(300).max(14_400),
    outputRetentionHours: z.coerce.number().int().min(1).max(168),
    videoEncoder: z.enum(["auto", "h264_nvenc", "h264_amf", "libx264"]),
    autoDownloadBeatmaps: boolFromForm,
    beatmapDownloadNoVideo: boolFromForm,
    videoCompress: boolFromForm,
    videoCompressQuality: z.coerce.number().int().min(18).max(32),
    videoCompressAudioKbps: z.coerce.number().int().min(64).max(320),
    watermarkEnabled: boolFromForm.default(false),
    watermarkText: z.string().trim().max(120).default("osu! Pulse · {player}"),
    watermarkPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).default("bottom-right"),
    storageRetentionHours: z.coerce.number().int().min(1).max(8_760).default(168),
    scheduleEnabled: boolFromForm.default(true),
    allowedStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("01:00"),
    allowedEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("07:00"),
    idleOnly: boolFromForm.default(true),
    idleMinutes: z.coerce.number().int().min(1).max(240).default(10),
  }),
  appearance: z.object({
    maniaScrollSpeed: z.coerce.number().int().min(1).max(40),
    maniaJudgmentScale: z.coerce.number().min(0.25).max(1.5),
    maniaScoreScale: z.coerce.number().min(0.5).max(2.5),
    maniaComboScale: z.coerce.number().min(0.5).max(2.5),
    standardBackgroundParallax: boolFromForm,
    standardKeyOverlay: boolFromForm,
    standardKeyOverlayScale: z.coerce.number().min(0.5).max(2),
  }).default({
    maniaScrollSpeed: 30,
    maniaJudgmentScale: 0.58,
    maniaScoreScale: 1.35,
    maniaComboScale: 1.35,
    standardBackgroundParallax: false,
    standardKeyOverlay: true,
    standardKeyOverlayScale: 1,
  }),
  youtube: z.object({
    autoUpload: boolFromForm,
    privacyStatus: z.enum(["private", "unlisted", "public"]),
    deleteAfterUpload: boolFromForm,
    categoryId: z.string().regex(/^\d{1,8}$/),
    titleTemplate: z.string().trim().min(1).max(300).default("{rank} | {pp} | {accuracy} | {artist} - {title} [{difficulty}]"),
    descriptionTemplate: z.string().max(5_000).default("Player: {player}\nMode: {mode}\nMap: {artist} - {title}\nDifficulty: {difficulty}\nMods: {mods}\nResult: {score_url}\n\nRendered automatically by osu! Pulse."),
    tags: z.array(z.string().trim().min(1).max(100)).max(30).default(["osu!", "osu! replay", "osu! Pulse"]),
    playlistIds: z.object({
      x: z.string().max(128),
      s: z.string().max(128),
      a: z.string().max(128),
      pp100: z.string().max(128),
      pp200: z.string().max(128),
      pp300: z.string().max(128),
      pp400: z.string().max(128),
    }).default({ x: "", s: "", a: "", pp100: "", pp200: "", pp300: "", pp400: "" }),
  }),
  storage: z.object({
    r2Endpoint: z.union([z.literal(""), z.string().url().max(500)]),
    r2Bucket: z.string().max(63),
  }),
  autoRender: autoRenderSettingsSchema.default(defaultAutoRenderSettings()),
  monitoring: z.object({
    alertsEnabled: boolFromForm,
    alertChannelId: z.string().regex(/^$|^\d{17,20}$/),
    osuDailyRequestLimit: z.coerce.number().int().min(100).max(1_000_000),
    youtubeDailyQuota: z.coerce.number().int().min(1_600).max(10_000_000),
    r2StorageLimitGb: z.coerce.number().min(0.1).max(100_000),
  }).default({
    alertsEnabled: true,
    alertChannelId: "",
    osuDailyRequestLimit: 10_000,
    youtubeDailyQuota: 10_000,
    r2StorageLimitGb: 25,
  }),
});

export type ControlSettingsInput = z.input<typeof controlSettingsSchema>;

export function defaultControlSettings(): ControlPanelSettingsValue {
  return {
    renderDefaults: {
      resolution: "1920x1080",
      fps: 60,
      speed: "original",
      motionBlur: false,
    },
    renderer: {
      maxConcurrentRenders: 1,
      renderTimeoutSeconds: 1_800,
      outputRetentionHours: 24,
      videoEncoder: "auto",
      autoDownloadBeatmaps: true,
      beatmapDownloadNoVideo: true,
      videoCompress: true,
      videoCompressQuality: 26,
      videoCompressAudioKbps: 128,
      watermarkEnabled: false,
      watermarkText: "osu! Pulse · {player}",
      watermarkPosition: "bottom-right",
      storageRetentionHours: 24,
      scheduleEnabled: true,
      allowedStartTime: "01:00",
      allowedEndTime: "07:00",
      idleOnly: true,
      idleMinutes: 10,
    },
    appearance: {
      maniaScrollSpeed: 30,
      maniaJudgmentScale: 0.58,
      maniaScoreScale: 1.35,
      maniaComboScale: 1.35,
      standardBackgroundParallax: false,
      standardKeyOverlay: true,
      standardKeyOverlayScale: 1,
    },
    youtube: {
      autoUpload: true,
      privacyStatus: "public",
      deleteAfterUpload: true,
      categoryId: "20",
      titleTemplate: "{rank} | {pp} | {accuracy} | {artist} - {title} [{difficulty}]",
      descriptionTemplate: "Player: {player}\nMode: {mode}\nMap: {artist} - {title}\nDifficulty: {difficulty}\nMods: {mods}\nResult: {score_url}\n\nRendered automatically by osu! Pulse.",
      tags: ["osu!", "osu! replay", "osu! Pulse"],
      playlistIds: { x: "", s: "", a: "", pp100: "", pp200: "", pp300: "", pp400: "" },
    },
    storage: {
      r2Endpoint: process.env.R2_ENDPOINT ?? "",
      r2Bucket: process.env.R2_BUCKET ?? "",
    },
    autoRender: defaultAutoRenderSettings(),
    monitoring: {
      alertsEnabled: true,
      alertChannelId: "",
      osuDailyRequestLimit: 10_000,
      youtubeDailyQuota: 10_000,
      r2StorageLimitGb: 25,
    },
  };
}

function encryptionKey() {
  const secret = process.env.CONTROL_PANEL_SESSION_SECRET ?? process.env.INTERNAL_API_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("CONTROL_PANEL_SESSION_SECRET must contain at least 32 characters");
  }
  return createHash("sha256").update(secret).digest();
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSecret(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Stored control-panel secret has an unsupported format");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function ensureSettings() {
  const db = getDb();
  await db.insert(controlPanelSettings).values({
    id: SETTINGS_ID,
    values: defaultControlSettings(),
  }).onConflictDoNothing();
  const row = await db.query.controlPanelSettings.findFirst({
    where: eq(controlPanelSettings.id, SETTINGS_ID),
  });
  if (!row) throw new Error("Control-panel settings could not be initialized");
  return row;
}

export async function getControlSettings() {
  const row = await ensureSettings();
  const parsed = controlSettingsSchema.safeParse(row.values);
  return {
    values: parsed.success ? parsed.data : defaultControlSettings(),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    secretConfigured: Object.fromEntries(
      SECRET_NAMES.map((name) => [name, Boolean(row.encryptedSecrets[name])]),
    ) as Record<ControlPanelSecretName, boolean>,
  };
}

export async function saveControlSettings(
  input: unknown,
  secretUpdates: Partial<Record<ControlPanelSecretName, string>>,
) {
  const values = controlSettingsSchema.parse(input);
  const current = await ensureSettings();
  const encryptedSecrets = { ...current.encryptedSecrets };
  for (const name of SECRET_NAMES) {
    const next = secretUpdates[name]?.trim();
    if (next) encryptedSecrets[name] = encryptSecret(next);
  }
  const now = new Date();
  const [saved] = await getDb().update(controlPanelSettings).set({
    values,
    encryptedSecrets,
    version: current.version + 1,
    updatedAt: now,
  }).where(eq(controlPanelSettings.id, SETTINGS_ID)).returning();
  return saved;
}

export async function getBridgeConfiguration() {
  const row = await ensureSettings();
  const parsed = controlSettingsSchema.safeParse(row.values);
  const values = parsed.success ? parsed.data : defaultControlSettings();
  const env: Record<string, string> = {
    MAX_CONCURRENT_RENDERS: String(values.renderer.maxConcurrentRenders),
    RENDER_TIMEOUT_SECONDS: String(values.renderer.renderTimeoutSeconds),
    OUTPUT_RETENTION_HOURS: String(values.renderer.outputRetentionHours),
    VIDEO_ENCODER: values.renderer.videoEncoder,
    AUTO_DOWNLOAD_BEATMAPS: String(values.renderer.autoDownloadBeatmaps),
    BEATMAP_DOWNLOAD_NO_VIDEO: String(values.renderer.beatmapDownloadNoVideo),
    VIDEO_COMPRESS: String(values.renderer.videoCompress),
    VIDEO_COMPRESS_QUALITY: String(values.renderer.videoCompressQuality),
    VIDEO_COMPRESS_AUDIO_KBPS: String(values.renderer.videoCompressAudioKbps),
    VIDEO_WATERMARK_ENABLED: String(values.renderer.watermarkEnabled),
    VIDEO_WATERMARK_TEXT: values.renderer.watermarkText,
    VIDEO_WATERMARK_POSITION: values.renderer.watermarkPosition,
    STORAGE_RETENTION_HOURS: String(values.renderer.storageRetentionHours),
    RENDER_SCHEDULE_ENABLED: String(values.renderer.scheduleEnabled),
    RENDER_ALLOWED_START_TIME: values.renderer.allowedStartTime,
    RENDER_ALLOWED_END_TIME: values.renderer.allowedEndTime,
    RENDER_IDLE_ONLY: String(values.renderer.idleOnly),
    RENDER_IDLE_MINUTES: String(values.renderer.idleMinutes),
    MANIA_SCROLL_SPEED: String(values.appearance.maniaScrollSpeed),
    MANIA_JUDGMENT_SCALE: String(values.appearance.maniaJudgmentScale),
    MANIA_SCORE_SCALE: String(values.appearance.maniaScoreScale),
    MANIA_COMBO_SCALE: String(values.appearance.maniaComboScale),
    STD_BACKGROUND_PARALLAX: String(values.appearance.standardBackgroundParallax),
    STD_KEY_OVERLAY: String(values.appearance.standardKeyOverlay),
    STD_KEY_OVERLAY_SCALE: String(values.appearance.standardKeyOverlayScale),
    YOUTUBE_AUTO_UPLOAD: String(values.youtube.autoUpload),
    YOUTUBE_PRIVACY_STATUS: values.youtube.privacyStatus,
    YOUTUBE_DELETE_AFTER_UPLOAD: String(values.youtube.deleteAfterUpload),
    YOUTUBE_CATEGORY_ID: values.youtube.categoryId,
    YOUTUBE_TITLE_TEMPLATE: values.youtube.titleTemplate,
    // Keep the dotenv file one physical line; the renderer expands these again.
    YOUTUBE_DESCRIPTION_TEMPLATE: values.youtube.descriptionTemplate.replace(/\r?\n/g, "\\n"),
    YOUTUBE_TAGS: values.youtube.tags.join(","),
    YOUTUBE_PLAYLIST_X_ID: values.youtube.playlistIds.x,
    YOUTUBE_PLAYLIST_S_ID: values.youtube.playlistIds.s,
    YOUTUBE_PLAYLIST_A_ID: values.youtube.playlistIds.a,
    YOUTUBE_PLAYLIST_PP100_ID: values.youtube.playlistIds.pp100,
    YOUTUBE_PLAYLIST_PP200_ID: values.youtube.playlistIds.pp200,
    YOUTUBE_PLAYLIST_PP300_ID: values.youtube.playlistIds.pp300,
    YOUTUBE_PLAYLIST_PP400_ID: values.youtube.playlistIds.pp400,
  };
  if (values.storage.r2Endpoint) env.R2_ENDPOINT = values.storage.r2Endpoint;
  if (values.storage.r2Bucket) env.R2_BUCKET = values.storage.r2Bucket;
  for (const name of SECRET_NAMES) {
    const encrypted = row.encryptedSecrets[name];
    if (encrypted) env[name] = decryptSecret(encrypted);
  }
  return { version: row.version, env };
}

export const controlPanelSecretNames = SECRET_NAMES;

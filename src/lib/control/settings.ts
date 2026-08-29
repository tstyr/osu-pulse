import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import {
  controlPanelSettings,
  type ControlPanelSecretName,
  type ControlPanelSettingsValue,
} from "@/db/schema";

const SETTINGS_ID = "primary";
const SECRET_NAMES = [
  "OSU_CLIENT_ID",
  "OSU_CLIENT_SECRET",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
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
  }),
  youtube: z.object({
    autoUpload: boolFromForm,
    privacyStatus: z.enum(["private", "unlisted", "public"]),
    deleteAfterUpload: boolFromForm,
    categoryId: z.string().regex(/^\d{1,8}$/),
  }),
  storage: z.object({
    r2Endpoint: z.union([z.literal(""), z.string().url().max(500)]),
    r2Bucket: z.string().max(63),
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
      videoCompressQuality: 24,
      videoCompressAudioKbps: 160,
    },
    youtube: {
      autoUpload: true,
      privacyStatus: "public",
      deleteAfterUpload: true,
      categoryId: "20",
    },
    storage: {
      r2Endpoint: process.env.R2_ENDPOINT ?? "",
      r2Bucket: process.env.R2_BUCKET ?? "",
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
    YOUTUBE_AUTO_UPLOAD: String(values.youtube.autoUpload),
    YOUTUBE_PRIVACY_STATUS: values.youtube.privacyStatus,
    YOUTUBE_DELETE_AFTER_UPLOAD: String(values.youtube.deleteAfterUpload),
    YOUTUBE_CATEGORY_ID: values.youtube.categoryId,
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

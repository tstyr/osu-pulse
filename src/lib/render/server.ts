import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, asc, count, eq, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { hasControlPanelSession } from "@/lib/control/auth";
import {
  cloudRendererState,
  cloudRenderJobs,
  type CloudRenderJob,
  type CloudRenderMetadata,
  type CloudRenderOptions,
} from "@/db/schema";

import {
  CLOUD_RENDER_LEASE_SECONDS,
  CLOUD_RENDER_OUTPUT_HOURS,
  CLOUD_RENDER_STATUSES,
  RENDER_FPS,
  RENDER_RESOLUTIONS,
  RENDER_SPEEDS,
  TERMINAL_CLOUD_RENDER_STATUSES,
  type CloudRenderStatus,
} from "./constants";
export { parseScoreUrl, RenderApiError } from "./score-url";
import { RenderApiError } from "./score-url";

const ACTIVE_STATUSES: CloudRenderStatus[] = CLOUD_RENDER_STATUSES.filter(
  (status) => !TERMINAL_CLOUD_RENDER_STATUSES.has(status),
);

export const renderOptionsSchema = z.object({
  resolution: z.enum(RENDER_RESOLUTIONS).default("1920x1080"),
  fps: z.coerce.number().pipe(z.union(RENDER_FPS.map((fps) => z.literal(fps)))).default(60),
  speed: z.enum(RENDER_SPEEDS).default("original"),
  motionBlur: z.preprocess(
    (value) => value === true || value === "true" || value === "1" || value === "on",
    z.boolean(),
  ).default(false),
});

export const bridgeUpdateSchema = z.object({
  localJobId: z.string().max(64).optional(),
  status: z.enum(CLOUD_RENDER_STATUSES),
  progress: z.number().int().min(0).max(100),
  message: z.string().min(1).max(500),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  errorCode: z.string().max(100).nullable().optional(),
  error: z.string().max(500).nullable().optional(),
  videoUrl: z.string().url().max(2_000).nullable().optional(),
  videoSize: z.number().int().nonnegative().safe().nullable().optional(),
});

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function requireWebRenderAccess(request: Request) {
  if (await hasControlPanelSession()) return;
  const expected = process.env.WEB_RENDER_ACCESS_KEY;
  const supplied = request.headers.get("authorization") ?? "";
  if (!expected || !supplied.startsWith("Bearer ") || !safeEqual(supplied.slice(7), expected)) {
    throw new RenderApiError("UNAUTHORIZED", "レンダーアクセスキーが違います。", 401);
  }
}

export function requireBridgeAccess(request: Request) {
  const expected = process.env.RENDER_BRIDGE_TOKEN;
  const supplied = request.headers.get("authorization") ?? "";
  if (!expected || !supplied.startsWith("Bearer ") || !safeEqual(supplied.slice(7), expected)) {
    throw new RenderApiError("UNAUTHORIZED", "Renderer bridge token is invalid.", 401);
  }
}

export function hashToken(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function createJobToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function requireJobToken(request: Request, job: CloudRenderJob) {
  const token = request.headers.get("x-render-job-token") ?? "";
  if (!token || !safeEqual(hashToken(token), job.accessTokenHash)) {
    throw new RenderApiError("JOB_NOT_FOUND", "レンダージョブが見つかりません。", 404);
  }
}

export function publicJob(job: CloudRenderJob) {
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    metadata: job.metadata,
    options: job.options,
    videoUrl: job.status === "completed" ? job.videoUrl : null,
    videoSize: job.status === "completed" ? job.videoSize : null,
    errorCode: job.errorCode,
    error: job.error,
    cancelRequested: job.cancelRequested,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt?.toISOString() ?? null,
  };
}

export async function createCloudRenderJob(input: {
  tokenHash: string;
  inputType: "score_url" | "replay";
  sourceHash: string;
  scoreUrl?: string;
  replayData?: string;
  options: CloudRenderOptions;
}) {
  const db = getDb();
  const [active] = await db
    .select({ value: count() })
    .from(cloudRenderJobs)
    .where(inArray(cloudRenderJobs.status, ACTIVE_STATUSES));
  if ((active?.value ?? 0) >= 4) {
    throw new RenderApiError("QUEUE_FULL", "レンダー待機列がいっぱいです。しばらくしてから再試行してください。", 429);
  }
  const duplicate = await db.query.cloudRenderJobs.findFirst({
    where: and(
      eq(cloudRenderJobs.sourceHash, input.sourceHash),
      inArray(cloudRenderJobs.status, ACTIVE_STATUSES),
    ),
    columns: { id: true },
  });
  if (duplicate) {
    throw new RenderApiError("DUPLICATE_JOB", "同じリプレイのレンダーがすでに進行中です。", 409);
  }
  const [created] = await db.insert(cloudRenderJobs).values({
    accessTokenHash: input.tokenHash,
    inputType: input.inputType,
    sourceHash: input.sourceHash,
    scoreUrl: input.scoreUrl,
    replayData: input.replayData,
    options: input.options,
  }).returning();
  return created;
}

export async function getCloudRenderJob(id: string) {
  return getDb().query.cloudRenderJobs.findFirst({ where: eq(cloudRenderJobs.id, id) });
}

export async function cancelCloudRenderJob(job: CloudRenderJob) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CLOUD_RENDER_OUTPUT_HOURS * 3_600_000);
  const [updated] = await getDb().update(cloudRenderJobs).set(
    job.status === "queued"
      ? { status: "cancelled", progress: job.progress, message: "キャンセルしました", cancelRequested: true, completedAt: now, expiresAt, updatedAt: now }
      : { cancelRequested: true, message: "キャンセルを要求しました", updatedAt: now },
  ).where(eq(cloudRenderJobs.id, job.id)).returning();
  return updated;
}

export async function heartbeatRenderer(input: {
  rendererId: string;
  status: string;
  busy: boolean;
  queueSize: number;
  activeCloudJobId?: string | null;
  dependencies: Record<string, unknown>;
  version?: string;
  configurationVersion?: number;
  restartRequired?: boolean;
}) {
  const now = new Date();
  const values = {
    id: input.rendererId,
    status: input.status.slice(0, 64),
    busy: input.busy,
    queueSize: input.queueSize,
    activeCloudJobId: input.activeCloudJobId ?? null,
    dependencies: input.dependencies,
    version: input.version?.slice(0, 64),
    configurationVersion: input.configurationVersion ?? 0,
    restartRequired: input.restartRequired ?? false,
    lastSeenAt: now,
    updatedAt: now,
  };
  await getDb().insert(cloudRendererState).values(values).onConflictDoUpdate({
    target: cloudRendererState.id,
    set: values,
  });
}

export async function claimCloudRenderJob(rendererId: string) {
  const db = getDb();
  const now = new Date();
  await db.update(cloudRenderJobs).set({
    status: "queued",
    claimedBy: null,
    localJobId: null,
    leaseExpiresAt: null,
    message: "Renderer が再接続するまで待機中",
    updatedAt: now,
  }).where(and(
    inArray(cloudRenderJobs.status, ACTIVE_STATUSES.filter((status) => status !== "queued")),
    lt(cloudRenderJobs.leaseExpiresAt, now),
    eq(cloudRenderJobs.cancelRequested, false),
  ));

  await db.update(cloudRenderJobs).set({
    status: "cancelled",
    message: "キャンセルしました",
    completedAt: now,
    expiresAt: new Date(now.getTime() + CLOUD_RENDER_OUTPUT_HOURS * 3_600_000),
    leaseExpiresAt: null,
    updatedAt: now,
  }).where(and(
    inArray(cloudRenderJobs.status, ACTIVE_STATUSES),
    eq(cloudRenderJobs.cancelRequested, true),
    or(eq(cloudRenderJobs.status, "queued"), lt(cloudRenderJobs.leaseExpiresAt, now)),
  ));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidate = await db.query.cloudRenderJobs.findFirst({
      where: and(eq(cloudRenderJobs.status, "queued"), eq(cloudRenderJobs.cancelRequested, false)),
      orderBy: asc(cloudRenderJobs.createdAt),
    });
    if (!candidate) return null;
    const [claimed] = await db.update(cloudRenderJobs).set({
      status: "claimed",
      progress: Math.max(candidate.progress, 0),
      message: "ローカル Renderer がジョブを取得しました",
      claimedBy: rendererId,
      claimedAt: candidate.claimedAt ?? now,
      leaseExpiresAt: new Date(now.getTime() + CLOUD_RENDER_LEASE_SECONDS * 1_000),
      updatedAt: now,
    }).where(and(eq(cloudRenderJobs.id, candidate.id), eq(cloudRenderJobs.status, "queued"))).returning();
    if (claimed) return claimed;
  }
  return null;
}

function validateBlobUrl(value: string) {
  const url = new URL(value);
  const youtube = url.protocol === "https:" && url.hostname === "youtu.be" && /^\/[A-Za-z0-9_-]{6,32}$/.test(url.pathname);
  if (
    !youtube && (url.protocol !== "https:" ||
    !url.hostname.endsWith(".public.blob.vercel-storage.com") ||
    !/^\/renders\/[0-9a-f-]{36}\.mp4$/.test(url.pathname))
  ) {
    throw new RenderApiError("INVALID_VIDEO_URL", "Unexpected completed video URL.", 400);
  }
}

export async function updateCloudRenderJob(
  id: string,
  rendererId: string,
  input: z.infer<typeof bridgeUpdateSchema>,
) {
  const job = await getCloudRenderJob(id);
  if (!job || job.claimedBy !== rendererId || TERMINAL_CLOUD_RENDER_STATUSES.has(job.status)) {
    throw new RenderApiError("JOB_NOT_FOUND", "Cloud render job was not found.", 404);
  }
  if (input.videoUrl) validateBlobUrl(input.videoUrl);
  if (input.status === "completed" && (!input.videoUrl || !input.videoSize)) {
    throw new RenderApiError("INVALID_COMPLETION", "Completed jobs require a Blob URL and size.", 400);
  }
  const now = new Date();
  const terminal = TERMINAL_CLOUD_RENDER_STATUSES.has(input.status);
  const [updated] = await getDb().update(cloudRenderJobs).set({
    localJobId: input.localJobId ?? job.localJobId,
    status: input.status,
    progress: input.status === "completed" ? 100 : input.progress,
    message: input.message,
    metadata: input.metadata as CloudRenderMetadata | null | undefined,
    errorCode: input.errorCode,
    error: input.error,
    videoUrl: input.videoUrl,
    videoSize: input.videoSize,
    replayData: terminal ? null : job.replayData,
    leaseExpiresAt: terminal ? null : new Date(now.getTime() + CLOUD_RENDER_LEASE_SECONDS * 1_000),
    completedAt: terminal ? now : null,
    expiresAt: terminal ? new Date(now.getTime() + CLOUD_RENDER_OUTPUT_HOURS * 3_600_000) : null,
    updatedAt: now,
  }).where(and(eq(cloudRenderJobs.id, id), eq(cloudRenderJobs.claimedBy, rendererId))).returning();
  return updated;
}

export async function rendererStatus() {
  const renderer = await getDb().query.cloudRendererState.findFirst({
    orderBy: (table, { desc }) => desc(table.lastSeenAt),
  });
  const [pending] = await getDb().select({ value: count() }).from(cloudRenderJobs).where(
    inArray(cloudRenderJobs.status, ACTIVE_STATUSES),
  );
  const online = Boolean(renderer && Date.now() - renderer.lastSeenAt.getTime() < 30_000);
  return {
    online,
    status: online ? renderer!.status : "offline",
    busy: online ? renderer!.busy : false,
    queueSize: pending?.value ?? 0,
    localQueueSize: online ? renderer!.queueSize : 0,
    dependencies: online ? renderer!.dependencies : {},
    configurationVersion: online ? renderer!.configurationVersion : 0,
    restartRequired: online ? renderer!.restartRequired : false,
    lastSeenAt: renderer?.lastSeenAt.toISOString() ?? null,
  };
}

export async function expiredCloudRenderJobs() {
  return getDb().select({ id: cloudRenderJobs.id, videoUrl: cloudRenderJobs.videoUrl }).from(cloudRenderJobs).where(
    lt(cloudRenderJobs.expiresAt, new Date()),
  );
}

export async function deleteCloudRenderJobs(ids: string[]) {
  if (!ids.length) return;
  await getDb().delete(cloudRenderJobs).where(inArray(cloudRenderJobs.id, ids));
}

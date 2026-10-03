import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, count, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { cloudRenderJobs, type CloudRenderOptions } from "@/db/schema";
import { CLOUD_RENDER_STATUSES, TERMINAL_CLOUD_RENDER_STATUSES, type CloudRenderStatus } from "@/lib/render/constants";
import { parseScoreUrl, RenderApiError } from "@/lib/render/score-url";

const ACTIVE_STATUSES: CloudRenderStatus[] = CLOUD_RENDER_STATUSES.filter(
  (status) => !TERMINAL_CLOUD_RENDER_STATUSES.has(status),
);

export async function createCloudRenderBatch(input: {
  scoreUrls: string[];
  options: CloudRenderOptions;
  scheduledAt?: Date | null;
  requestedByDiscordUserId?: string | null;
}) {
  const urls = [...new Set(input.scoreUrls.map(parseScoreUrl))].slice(0, 20);
  const batchId = randomUUID();
  const db = getDb();
  const existing = await db.select({ sourceHash: cloudRenderJobs.sourceHash }).from(cloudRenderJobs).where(
    inArray(cloudRenderJobs.status, ACTIVE_STATUSES),
  );
  const hashes = new Set(existing.map((row) => row.sourceHash));
  const values = urls.flatMap((scoreUrl) => {
    const sourceHash = createHash("sha256").update(scoreUrl).digest("hex");
    if (hashes.has(sourceHash)) return [];
    hashes.add(sourceHash);
    return [{
      accessTokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      inputType: "score_url" as const,
      sourceHash,
      scoreUrl,
      options: input.options,
      batchId,
      scheduledAt: input.scheduledAt ?? null,
      metadata: { request_source: input.scheduledAt ? "scheduled" as const : "manual" as const },
      requestedByDiscordUserId: input.requestedByDiscordUserId ?? null,
      message: input.scheduledAt ? "予約時刻まで待機中" : "一括レンダー待機中",
    }];
  });
  if (!values.length) return { batchId, created: [] };
  const created = await db.insert(cloudRenderJobs).values(values).returning();
  return { batchId, created };
}

export async function createCloudCompositionJob(input: {
  kind: "montage" | "comparison";
  comparisonMode?: "same-beatmap" | "versus";
  title: string;
  scoreUrls: string[];
  options: CloudRenderOptions;
  requestedByDiscordUserId?: string | null;
  scheduledAt?: Date | null;
}) {
  const scoreUrls = [...new Set(input.scoreUrls.map(parseScoreUrl))].slice(0, input.kind === "comparison" ? 2 : 8);
  if (scoreUrls.length < 2) {
    throw new RenderApiError("INVALID_COMPOSITION", "合成には2件以上のScore URLが必要です。", 400);
  }

  const payload = JSON.stringify({
    kind: input.kind,
    comparisonMode: input.kind === "comparison" ? (input.comparisonMode ?? "versus") : undefined,
    title: input.title.slice(0, 120),
    scoreUrls,
  });
  const sourceHash = createHash("sha256").update(payload).digest("hex");
  const db = getDb();
  const [active] = await db.select({ value: count() }).from(cloudRenderJobs).where(
    inArray(cloudRenderJobs.status, ACTIVE_STATUSES),
  );
  if ((active?.value ?? 0) >= 4) {
    throw new RenderApiError("QUEUE_FULL", "レンダー待機列がいっぱいです。しばらくしてから再試行してください。", 429);
  }
  const duplicate = await db.query.cloudRenderJobs.findFirst({
    where: and(
      eq(cloudRenderJobs.sourceHash, sourceHash),
      inArray(cloudRenderJobs.status, ACTIVE_STATUSES),
    ),
    columns: { id: true },
  });
  if (duplicate) {
    throw new RenderApiError("DUPLICATE_JOB", "同じ合成動画がすでに進行中です。", 409);
  }

  const [created] = await db.insert(cloudRenderJobs).values({
    accessTokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
    inputType: "composition",
    sourceHash,
    replayData: payload,
    options: input.options,
    requestedByDiscordUserId: input.requestedByDiscordUserId ?? null,
    scheduledAt: input.scheduledAt ?? null,
    metadata: { request_source: input.scheduledAt ? "scheduled" : "manual" },
    message: input.scheduledAt ? "予約時刻まで待機中" : "合成レンダー待機中",
  }).returning();
  return created;
}

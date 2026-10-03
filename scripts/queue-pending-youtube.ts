import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { and, desc, eq, isNotNull } from "drizzle-orm";

import { getDb } from "../src/db";
import { cloudRenderJobs } from "../src/db/schema";

type PendingFile = { version: number; pending: Record<string, Record<string, unknown>> };

function readPending(path: string): PendingFile {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PendingFile;
    return parsed && typeof parsed.pending === "object" ? parsed : { version: 1, pending: {} };
  } catch {
    return { version: 1, pending: {} };
  }
}

async function main() {
  const outputRoot = resolve("renderer/output");
  const pendingPath = resolve("renderer/youtube-pending.json");
  const payload = readPending(pendingPath);
  const rows = await getDb().select({
    localJobId: cloudRenderJobs.localJobId,
    metadata: cloudRenderJobs.metadata,
    videoSize: cloudRenderJobs.videoSize,
  }).from(cloudRenderJobs).where(and(
    eq(cloudRenderJobs.status, "completed"),
    isNotNull(cloudRenderJobs.localJobId),
  )).orderBy(desc(cloudRenderJobs.createdAt)).limit(500);
  let queued = 0;
  for (const row of rows) {
    const jobId = row.localJobId;
    const metadata = row.metadata as Record<string, unknown> | null;
    if (!jobId || !/^[0-9a-f]{32}$/.test(jobId) || !metadata) continue;
    if (typeof metadata.youtube_url === "string" && metadata.youtube_url) continue;
    const error = typeof metadata.youtube_error === "string" ? metadata.youtube_error : "YouTube upload was not completed";
    if (!existsSync(resolve(outputRoot, `${jobId}.mp4`)) || payload.pending[jobId]) continue;
    const now = new Date();
    payload.pending[jobId] = {
      metadata: Object.fromEntries(Object.entries(metadata).filter(([key]) => !key.startsWith("youtube_"))),
      source_size: Number(row.videoSize ?? 0),
      attempts: 1,
      last_error: error.slice(0, 500),
      queued_at: now.toISOString(),
      last_attempt_at: now.toISOString(),
      next_attempt_at: new Date(now.getTime() + 6 * 3_600_000).toISOString(),
    };
    queued += 1;
  }
  writeFileSync(pendingPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ queued, totalPending: Object.keys(payload.pending).length }));
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});

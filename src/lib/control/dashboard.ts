import "server-only";

import { count, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  accounts,
  cloudRenderJobs,
  discordAccountLinks,
  guildSettings,
} from "@/db/schema";
import { rendererStatus } from "@/lib/render/server";

const ACTIVE_RENDER_STATUSES = [
  "queued",
  "claimed",
  "resolving_score",
  "downloading_replay",
  "resolving_beatmap",
  "rendering",
  "encoding",
  "uploading",
] as const;

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function getDashboardOverview() {
  const db = getDb();
  const since = new Date(Date.now() - 13 * 24 * 60 * 60 * 1_000);
  const [
    renderer,
    totalRows,
    completedRows,
    failedRows,
    activeRows,
    uploadedRows,
    accountRows,
    linkRows,
    guildRows,
    trendRows,
    recentJobs,
  ] = await Promise.all([
    rendererStatus(),
    db.select({ value: count() }).from(cloudRenderJobs),
    db.select({ value: count() }).from(cloudRenderJobs).where(eq(cloudRenderJobs.status, "completed")),
    db.select({ value: count() }).from(cloudRenderJobs).where(eq(cloudRenderJobs.status, "failed")),
    db.select({ value: count() }).from(cloudRenderJobs).where(inArray(cloudRenderJobs.status, [...ACTIVE_RENDER_STATUSES])),
    db.select({ value: count() }).from(cloudRenderJobs).where(sql`${cloudRenderJobs.videoUrl} like 'https://youtu.be/%'`),
    db.select({ value: count() }).from(accounts),
    db.select({ value: count() }).from(discordAccountLinks),
    db.select({ value: count() }).from(guildSettings),
    db.select({ createdAt: cloudRenderJobs.createdAt, status: cloudRenderJobs.status })
      .from(cloudRenderJobs)
      .where(gte(cloudRenderJobs.createdAt, since))
      .orderBy(cloudRenderJobs.createdAt),
    db.select({
      id: cloudRenderJobs.id,
      status: cloudRenderJobs.status,
      progress: cloudRenderJobs.progress,
      message: cloudRenderJobs.message,
      metadata: cloudRenderJobs.metadata,
      options: cloudRenderJobs.options,
      videoUrl: cloudRenderJobs.videoUrl,
      videoSize: cloudRenderJobs.videoSize,
      createdAt: cloudRenderJobs.createdAt,
      completedAt: cloudRenderJobs.completedAt,
    }).from(cloudRenderJobs).orderBy(desc(cloudRenderJobs.createdAt)).limit(8),
  ]);

  const completed = completedRows[0]?.value ?? 0;
  const failed = failedRows[0]?.value ?? 0;
  const terminal = completed + failed;
  const trend = new Map<string, { date: string; completed: number; failed: number; total: number }>();
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(since.getTime() + offset * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    trend.set(date, { date, completed: 0, failed: 0, total: 0 });
  }
  for (const row of trendRows) {
    const date = row.createdAt.toISOString().slice(0, 10);
    const bucket = trend.get(date);
    if (!bucket) continue;
    bucket.total += 1;
    if (row.status === "completed") bucket.completed += 1;
    if (row.status === "failed") bucket.failed += 1;
  }

  const dependencies = objectValue(renderer.dependencies);
  const system = objectValue(dependencies.system);
  const renderStats = objectValue(dependencies.render_stats);

  return {
    generatedAt: new Date().toISOString(),
    renderer: {
      online: renderer.online,
      status: renderer.status,
      busy: renderer.busy,
      cloudQueue: renderer.queueSize,
      localQueue: renderer.localQueueSize,
      lastSeenAt: renderer.lastSeenAt,
      configurationVersion: numberValue(renderer.configurationVersion),
      restartRequired: Boolean(renderer.restartRequired),
      capacity: numberValue(dependencies.capacity) || 1,
      activeCount: numberValue(dependencies.local_rendering),
      encoder: dependencies.encoder ?? (dependencies.amf ? "h264_amf" : dependencies.nvenc ? "h264_nvenc" : "libx264"),
    },
    system: {
      cpuPercent: numberValue(system.cpu_percent),
      gpuPercent: system.gpu_percent === null || system.gpu_percent === undefined ? null : numberValue(system.gpu_percent),
      memoryUsedBytes: numberValue(system.memory_used_bytes),
      memoryTotalBytes: numberValue(system.memory_total_bytes),
      memoryPercent: numberValue(system.memory_percent),
      diskUsedBytes: numberValue(system.disk_used_bytes),
      diskTotalBytes: numberValue(system.disk_total_bytes),
      diskPercent: numberValue(system.disk_percent),
      networkReceivedBytes: numberValue(system.network_received_bytes),
      networkSentBytes: numberValue(system.network_sent_bytes),
      uptimeSeconds: numberValue(system.uptime_seconds),
    },
    renders: {
      total: totalRows[0]?.value ?? 0,
      completed,
      failed,
      active: activeRows[0]?.value ?? 0,
      successRate: terminal ? Math.round((completed / terminal) * 1_000) / 10 : 100,
      youtubeUploaded: uploadedRows[0]?.value ?? 0,
      localProcessed: numberValue(renderStats.processed_total),
      localVideoCount: numberValue(renderStats.video_count),
      localVideoBytes: numberValue(renderStats.video_bytes),
    },
    community: {
      osuAccounts: accountRows[0]?.value ?? 0,
      discordLinks: linkRows[0]?.value ?? 0,
      guilds: guildRows[0]?.value ?? 0,
    },
    trend: [...trend.values()],
    recentJobs: recentJobs.map((job) => ({
      ...job,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    })),
  };
}

export type DashboardOverview = Awaited<ReturnType<typeof getDashboardOverview>>;

type DatabaseInfoRow = {
  database_name: string;
  database_user: string;
  database_size_bytes: string | number;
  postgres_version: string;
};

type TableInfoRow = {
  table_name: string;
  approximate_rows: string | number;
  data_bytes: string | number;
  index_bytes: string | number;
  total_bytes: string | number;
};

export async function getDatabaseDetails() {
  const db = getDb();
  const [databaseResult, tablesResult] = await Promise.all([
    db.execute<DatabaseInfoRow>(sql`
      select
        current_database() as database_name,
        current_user as database_user,
        pg_database_size(current_database()) as database_size_bytes,
        version() as postgres_version
    `),
    db.execute<TableInfoRow>(sql`
      select
        relname as table_name,
        n_live_tup as approximate_rows,
        pg_relation_size(relid) as data_bytes,
        pg_indexes_size(relid) as index_bytes,
        pg_total_relation_size(relid) as total_bytes
      from pg_stat_user_tables
      order by pg_total_relation_size(relid) desc, relname asc
    `),
  ]);
  const info = databaseResult.rows[0];
  return {
    generatedAt: new Date().toISOString(),
    database: {
      name: info?.database_name ?? "unknown",
      user: info?.database_user ?? "unknown",
      sizeBytes: numberValue(info?.database_size_bytes),
      version: info?.postgres_version?.split(" on ")[0] ?? "PostgreSQL",
      provider: "Neon Postgres",
    },
    tables: tablesResult.rows.map((row) => ({
      name: row.table_name,
      approximateRows: numberValue(row.approximate_rows),
      dataBytes: numberValue(row.data_bytes),
      indexBytes: numberValue(row.index_bytes),
      totalBytes: numberValue(row.total_bytes),
    })),
  };
}

export type DatabaseDetails = Awaited<ReturnType<typeof getDatabaseDetails>>;

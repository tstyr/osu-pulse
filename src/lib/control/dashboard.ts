import "server-only";

import { count, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { databaseProviderName, databaseResultRows, getDb } from "@/db";
import {
  accounts,
  cloudRenderJobs,
  discordAccountLinks,
  guildSettings,
  manuallyTrackedAccounts,
  renderVideos,
} from "@/db/schema";
import { rendererStatus } from "@/lib/render/server";
import { cachedAsync } from "@/lib/async-cache";
import { rendererDiagnostics } from "@/lib/render/diagnostics";

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

async function buildDashboardOverview() {
  const db = getDb();
  const todayJst = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const since = new Date(Date.parse(`${todayJst}T00:00:00+09:00`) - 13 * 24 * 60 * 60 * 1_000);
  const renderDay = sql<string>`to_char(${cloudRenderJobs.createdAt} at time zone 'Asia/Tokyo', 'YYYY-MM-DD')`;
  const [
    renderer,
    renderSummary,
    uploadedRows,
    accountRows,
    linkRows,
    guildRows,
    trendRows,
    recentJobs,
  ] = await Promise.all([
    rendererStatus(),
    db.select({
      total: count(),
      completed: sql<number>`count(*) filter (where ${eq(cloudRenderJobs.status, "completed")})`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${eq(cloudRenderJobs.status, "failed")})`.mapWith(Number),
      active: sql<number>`count(*) filter (where ${inArray(cloudRenderJobs.status, [...ACTIVE_RENDER_STATUSES])})`.mapWith(Number),
    }).from(cloudRenderJobs),
    db.select({ value: count() }).from(renderVideos).where(eq(renderVideos.status, "active")),
    db.select({ value: count() }).from(accounts),
    db.select({ value: count() }).from(discordAccountLinks),
    db.select({ value: count() }).from(guildSettings),
    db.select({
      date: renderDay,
      total: count(),
      completed: sql<number>`count(*) filter (where ${eq(cloudRenderJobs.status, "completed")})`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${eq(cloudRenderJobs.status, "failed")})`.mapWith(Number),
    })
      .from(cloudRenderJobs)
      .where(gte(cloudRenderJobs.createdAt, since))
      .groupBy(renderDay),
    db.select({
      id: cloudRenderJobs.id,
      status: cloudRenderJobs.status,
      progress: cloudRenderJobs.progress,
      message: cloudRenderJobs.message,
      metadata: cloudRenderJobs.metadata,
      errorCode: cloudRenderJobs.errorCode,
      error: cloudRenderJobs.error,
      updatedAt: cloudRenderJobs.updatedAt,
      options: cloudRenderJobs.options,
      videoUrl: cloudRenderJobs.videoUrl,
      videoSize: cloudRenderJobs.videoSize,
      createdAt: cloudRenderJobs.createdAt,
      completedAt: cloudRenderJobs.completedAt,
    }).from(cloudRenderJobs).orderBy(desc(cloudRenderJobs.createdAt)).limit(8),
  ]);

  const completed = renderSummary[0]?.completed ?? 0;
  const failed = renderSummary[0]?.failed ?? 0;
  const terminal = completed + failed;
  const trend = new Map<string, { date: string; completed: number; failed: number; total: number }>();
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(since.getTime() + 9 * 3_600_000 + offset * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    trend.set(date, { date, completed: 0, failed: 0, total: 0 });
  }
  for (const row of trendRows) {
    const bucket = trend.get(row.date);
    if (!bucket) continue;
    bucket.total = row.total;
    bucket.completed = row.completed;
    bucket.failed = row.failed;
  }

  const dependencies = objectValue(renderer.dependencies);
  const system = objectValue(dependencies.system);
  const renderStats = objectValue(dependencies.render_stats);
  const diagnostics = rendererDiagnostics(dependencies);

  return {
    generatedAt: new Date().toISOString(),
    databaseProvider: databaseProviderName(),
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
      storage: diagnostics.storage,
      youtube: diagnostics.youtube,
      startPolicy: diagnostics.startPolicy,
    },
    system: {
      cpuPercent: numberValue(system.cpu_percent),
      gpuPercent: system.gpu_percent === null || system.gpu_percent === undefined ? null : numberValue(system.gpu_percent),
      cpuTemperatureC: system.cpu_temperature_c === null || system.cpu_temperature_c === undefined ? null : numberValue(system.cpu_temperature_c),
      gpuTemperatureC: system.gpu_temperature_c === null || system.gpu_temperature_c === undefined ? null : numberValue(system.gpu_temperature_c),
      memoryUsedBytes: numberValue(system.memory_used_bytes),
      memoryTotalBytes: numberValue(system.memory_total_bytes),
      memoryPercent: numberValue(system.memory_percent),
      diskUsedBytes: numberValue(system.disk_used_bytes),
      diskAvailable: typeof system.disk_available === "boolean" ? system.disk_available : null,
      diskTotalBytes: numberValue(system.disk_total_bytes),
      diskPercent: numberValue(system.disk_percent),
      networkReceivedBytes: numberValue(system.network_received_bytes),
      networkSentBytes: numberValue(system.network_sent_bytes),
      uptimeSeconds: numberValue(system.uptime_seconds),
    },
    renders: {
      total: renderSummary[0]?.total ?? 0,
      completed,
      failed,
      active: renderSummary[0]?.active ?? 0,
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
      updatedAt: job.updatedAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    })),
  };
}

export const getDashboardOverview = cachedAsync(buildDashboardOverview, 3_000);
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
  const [databaseResult, tablesResult, trackedRows] = await Promise.all([
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
    db.select({
      id: accounts.id,
      osuUserId: accounts.osuUserId,
      username: accounts.username,
      countryCode: accounts.countryCode,
      primaryMode: accounts.primaryMode,
      createdAt: accounts.createdAt,
      manualAccountId: manuallyTrackedAccounts.accountId,
      discordUserId: discordAccountLinks.discordUserId,
    })
      .from(accounts)
      .leftJoin(manuallyTrackedAccounts, eq(manuallyTrackedAccounts.accountId, accounts.id))
      .leftJoin(discordAccountLinks, eq(discordAccountLinks.accountId, accounts.id))
      .orderBy(desc(accounts.createdAt)),
  ]);
  const info = databaseResultRows<DatabaseInfoRow>(databaseResult)[0];
  const tableRows = databaseResultRows<TableInfoRow>(tablesResult);
  const trackedAccounts = new Map<string, {
    id: string;
    osuUserId: number;
    username: string;
    countryCode: string | null;
    primaryMode: string;
    manuallyTracked: boolean;
    discordLinks: number;
    createdAt: string;
  }>();
  for (const row of trackedRows) {
    const current = trackedAccounts.get(row.id);
    if (current) {
      if (row.discordUserId) current.discordLinks += 1;
      continue;
    }
    trackedAccounts.set(row.id, {
      id: row.id,
      osuUserId: row.osuUserId,
      username: row.username,
      countryCode: row.countryCode,
      primaryMode: row.primaryMode,
      manuallyTracked: Boolean(row.manualAccountId),
      discordLinks: row.discordUserId ? 1 : 0,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    database: {
      name: info?.database_name ?? "unknown",
      user: info?.database_user ?? "unknown",
      sizeBytes: numberValue(info?.database_size_bytes),
      version: info?.postgres_version?.split(" on ")[0] ?? "PostgreSQL",
      provider: databaseProviderName(),
    },
    tables: tableRows.map((row) => ({
      name: row.table_name,
      approximateRows: numberValue(row.approximate_rows),
      dataBytes: numberValue(row.data_bytes),
      indexBytes: numberValue(row.index_bytes),
      totalBytes: numberValue(row.total_bytes),
    })),
    trackedAccounts: [...trackedAccounts.values()],
  };
}

export type DatabaseDetails = Awaited<ReturnType<typeof getDatabaseDetails>>;

import { createHash, randomBytes } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";

import type { OsuMode } from "@/lib/osu/modes";
import { getDb } from "./index";
import {
  accountGuilds,
  accounts,
  cloudRendererState,
  dailySnapshots,
  guildSettings,
  overlayFeeds,
  rivalries,
  scoreEvents,
  serviceHeartbeats,
  serviceIncidents,
  systemMetricSamples,
} from "./schema";

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createRivalry(input: {
  guildId: string;
  ownerDiscordUserId: string;
  ownerAccountId: string;
  rivalDiscordUserId?: string | null;
  rivalAccountId: string;
  mode: OsuMode;
  notificationChannelId?: string | null;
}) {
  const [row] = await getDb().insert(rivalries).values({
    ...input,
    rivalDiscordUserId: input.rivalDiscordUserId ?? null,
    notificationChannelId: input.notificationChannelId ?? null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [rivalries.guildId, rivalries.ownerDiscordUserId, rivalries.rivalAccountId, rivalries.mode],
    set: {
      rivalDiscordUserId: input.rivalDiscordUserId ?? null,
      ownerAccountId: input.ownerAccountId,
      notificationChannelId: input.notificationChannelId ?? null,
      enabled: true,
      updatedAt: new Date(),
    },
  }).returning();
  return row;
}

export async function listRivalries(input?: { guildId?: string; ownerDiscordUserId?: string; enabledOnly?: boolean }) {
  const filters = [
    input?.guildId ? eq(rivalries.guildId, input.guildId) : undefined,
    input?.ownerDiscordUserId ? eq(rivalries.ownerDiscordUserId, input.ownerDiscordUserId) : undefined,
    input?.enabledOnly ? eq(rivalries.enabled, true) : undefined,
  ].filter(Boolean) as ReturnType<typeof eq>[];
  const rows = await getDb().select().from(rivalries)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(rivalries.createdAt));
  const ids = [...new Set(rows.flatMap((row) => [row.ownerAccountId, row.rivalAccountId]))];
  const accountRows = ids.length ? await getDb().select().from(accounts).where(inArray(accounts.id, ids)) : [];
  const names = new Map(accountRows.map((account) => [account.id, account]));
  return rows.map((row) => ({
    ...row,
    ownerAccount: names.get(row.ownerAccountId) ?? null,
    rivalAccount: names.get(row.rivalAccountId) ?? null,
  }));
}

export async function removeRivalry(input: { id: string; guildId: string; ownerDiscordUserId?: string }) {
  const filters = [eq(rivalries.id, input.id), eq(rivalries.guildId, input.guildId)];
  if (input.ownerDiscordUserId) filters.push(eq(rivalries.ownerDiscordUserId, input.ownerDiscordUserId));
  const [deleted] = await getDb().delete(rivalries).where(and(...filters)).returning();
  return deleted;
}

export async function getRivalrySnapshot(rivalryId: string) {
  const row = (await listRivalries()).find((item) => item.id === rivalryId);
  if (!row?.ownerAccount || !row.rivalAccount) return null;
  const snapshots = await getDb().select().from(dailySnapshots).where(and(
    inArray(dailySnapshots.accountId, [row.ownerAccountId, row.rivalAccountId]),
    eq(dailySnapshots.mode, row.mode),
  )).orderBy(desc(dailySnapshots.snapshotDate));
  return {
    rivalry: row,
    owner: { account: row.ownerAccount, snapshot: snapshots.find((item) => item.accountId === row.ownerAccountId) ?? null },
    rival: { account: row.rivalAccount, snapshot: snapshots.find((item) => item.accountId === row.rivalAccountId) ?? null },
  };
}

export async function listDueRivalries(reportDate: string) {
  return listRivalries({ enabledOnly: true }).then((rows) => rows.filter((row) => row.lastNotifiedDate !== reportDate));
}

export async function markRivalryNotified(id: string, reportDate: string) {
  await getDb().update(rivalries).set({ lastNotifiedDate: reportDate, updatedAt: new Date() }).where(eq(rivalries.id, id));
}

export async function rotateOverlayFeed(input: { guildId: string; createdByDiscordUserId: string }) {
  const token = randomBytes(32).toString("base64url");
  const values = {
    tokenHash: hashToken(token),
    guildId: input.guildId,
    createdByDiscordUserId: input.createdByDiscordUserId,
    enabled: true,
    updatedAt: new Date(),
  };
  await getDb().insert(overlayFeeds).values(values).onConflictDoUpdate({
    target: overlayFeeds.guildId,
    set: values,
  });
  return token;
}

export async function disableOverlayFeed(guildId: string) {
  const [row] = await getDb().update(overlayFeeds).set({ enabled: false, updatedAt: new Date() }).where(eq(overlayFeeds.guildId, guildId)).returning();
  return row;
}

export async function getOverlaySnapshot(token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const feed = await getDb().query.overlayFeeds.findFirst({
    where: and(eq(overlayFeeds.tokenHash, hashToken(token)), eq(overlayFeeds.enabled, true)),
  });
  if (!feed) return null;
  const [latest] = await getDb().select({
    id: scoreEvents.id,
    osuScoreId: scoreEvents.osuScoreId,
    accountId: scoreEvents.accountId,
    mode: scoreEvents.mode,
    artist: scoreEvents.artist,
    title: scoreEvents.title,
    difficulty: scoreEvents.difficulty,
    coverUrl: scoreEvents.coverUrl,
    pp: scoreEvents.pp,
    accuracy: scoreEvents.accuracy,
    rank: scoreEvents.rank,
    maxCombo: scoreEvents.maxCombo,
    mods: scoreEvents.mods,
    endedAt: scoreEvents.endedAt,
    username: accounts.username,
    avatarUrl: accounts.avatarUrl,
  }).from(scoreEvents)
    .innerJoin(accountGuilds, eq(accountGuilds.accountId, scoreEvents.accountId))
    .innerJoin(accounts, eq(accounts.id, scoreEvents.accountId))
    .where(eq(accountGuilds.guildId, feed.guildId))
    .orderBy(desc(scoreEvents.endedAt))
    .limit(1);
  return {
    guildId: feed.guildId,
    score: latest ? { ...latest, endedAt: latest.endedAt.toISOString() } : null,
    generatedAt: new Date().toISOString(),
  };
}

export async function recordServiceHeartbeat(service: string, status: string, details: Record<string, unknown> = {}) {
  const now = new Date();
  const values = { service, status, details, lastSeenAt: now, updatedAt: now };
  await getDb().insert(serviceHeartbeats).values(values).onConflictDoUpdate({
    target: serviceHeartbeats.service,
    set: values,
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metricNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function recordRendererMetricSample(input: {
  rendererId: string;
  dependencies: Record<string, unknown>;
  queueSize: number;
}) {
  const latest = await getDb().query.systemMetricSamples.findFirst({
    where: eq(systemMetricSamples.rendererId, input.rendererId),
    orderBy: desc(systemMetricSamples.sampledAt),
    columns: { sampledAt: true },
  });
  if (latest && Date.now() - latest.sampledAt.getTime() < 45_000) return false;
  const system = objectValue(input.dependencies.system);
  const render = objectValue(input.dependencies.render_stats);
  await getDb().insert(systemMetricSamples).values({
    rendererId: input.rendererId,
    cpuPercent: metricNumber(system.cpu_percent),
    gpuPercent: system.gpu_percent === null || system.gpu_percent === undefined ? null : metricNumber(system.gpu_percent),
    cpuTemperatureC: system.cpu_temperature_c === null || system.cpu_temperature_c === undefined ? null : metricNumber(system.cpu_temperature_c),
    gpuTemperatureC: system.gpu_temperature_c === null || system.gpu_temperature_c === undefined ? null : metricNumber(system.gpu_temperature_c),
    memoryUsedBytes: metricNumber(system.memory_used_bytes),
    memoryTotalBytes: metricNumber(system.memory_total_bytes),
    diskUsedBytes: metricNumber(system.disk_used_bytes),
    diskTotalBytes: metricNumber(system.disk_total_bytes),
    networkReceivedBytes: metricNumber(system.network_received_bytes),
    networkSentBytes: metricNumber(system.network_sent_bytes),
    activeRenders: metricNumber(render.active_count ?? input.dependencies.local_rendering),
    queueSize: input.queueSize,
  });
  return true;
}

export async function getSystemMetricHistory(hours = 24) {
  const boundedHours = Math.min(Math.max(Math.floor(hours), 1), 24 * 31);
  const cutoff = new Date(Date.now() - boundedHours * 3_600_000);
  const rows = await getDb().select().from(systemMetricSamples)
    .where(gte(systemMetricSamples.sampledAt, cutoff))
    .orderBy(asc(systemMetricSamples.sampledAt));
  return rows.map((row) => ({ ...row, sampledAt: row.sampledAt.toISOString() }));
}

export async function openServiceIncident(input: { service: string; title: string; message: string; severity?: string }) {
  const existing = await getDb().query.serviceIncidents.findFirst({
    where: and(eq(serviceIncidents.service, input.service), isNull(serviceIncidents.resolvedAt)),
  });
  if (existing) return existing;
  const [created] = await getDb().insert(serviceIncidents).values({ ...input, severity: input.severity ?? "degraded" }).returning();
  return created;
}

export async function resolveServiceIncident(service: string) {
  const now = new Date();
  await getDb().update(serviceIncidents).set({ resolvedAt: now, updatedAt: now }).where(and(eq(serviceIncidents.service, service), isNull(serviceIncidents.resolvedAt)));
}

export async function getPublicServiceStatus() {
  const now = Date.now();
  const [heartbeats, renderer, incidents, metrics] = await Promise.all([
    getDb().select().from(serviceHeartbeats).orderBy(asc(serviceHeartbeats.service)),
    getDb().query.cloudRendererState.findFirst({ orderBy: desc(cloudRendererState.lastSeenAt) }),
    getDb().select().from(serviceIncidents).where(or(isNull(serviceIncidents.resolvedAt), gte(serviceIncidents.resolvedAt, new Date(now - 7 * 86_400_000)))).orderBy(desc(serviceIncidents.startedAt)).limit(20),
    getDb().select({ sampledAt: systemMetricSamples.sampledAt }).from(systemMetricSamples).where(gte(systemMetricSamples.sampledAt, new Date(now - 24 * 3_600_000))).orderBy(asc(systemMetricSamples.sampledAt)),
  ]);
  // This view is requested by HTTP pages/handlers: the successful DB read above
  // proves this Web instance is responding, regardless of who last visited /api/status.
  const services = heartbeats.filter((item) => item.service !== "web").map((item) => ({
    name: item.service,
    status: now - item.lastSeenAt.getTime() > 90_000 ? "offline" : item.status,
    details: item.details,
    lastSeenAt: item.lastSeenAt.toISOString(),
  }));
  services.push({ name: "web", status: "operational", details: {}, lastSeenAt: new Date(now).toISOString() });
  services.push({
    name: "renderer",
    status: renderer && now - renderer.lastSeenAt.getTime() < 30_000 ? renderer.status : "offline",
    details: renderer?.dependencies ?? {},
    lastSeenAt: renderer?.lastSeenAt.toISOString() ?? new Date(0).toISOString(),
  });
  const oldestSampleAt = metrics[0]?.sampledAt.getTime() ?? now;
  const expectedSamples = Math.max(1, Math.min(24 * 60, Math.ceil((now - oldestSampleAt) / 60_000) + 1));
  const uptimeEstimate = Math.min(100, Math.round(metrics.length / expectedSamples * 10_000) / 100);
  const healthyStatuses = new Set(["operational", "ready", "ok", "online"]);
  return {
    generatedAt: new Date(now).toISOString(),
    overall: services.every((item) => healthyStatuses.has(item.status)) ? "operational" : services.some((item) => item.status === "offline") ? "partial_outage" : "degraded",
    uptimeEstimate,
    services,
    incidents: incidents.map((item) => ({ ...item, startedAt: item.startedAt.toISOString(), resolvedAt: item.resolvedAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })),
  };
}

export async function configureMonthlyMontage(input: { guildId: string; channelId: string; mode: OsuMode; enabled: boolean }) {
  const values = {
    monthlyMontageEnabled: input.enabled,
    monthlyMontageChannelId: input.channelId,
    monthlyMontageMode: input.mode,
    updatedAt: new Date(),
  };
  const [row] = await getDb().insert(guildSettings).values({ guildId: input.guildId, ...values }).onConflictDoUpdate({
    target: guildSettings.guildId,
    set: values,
  }).returning();
  return row;
}

export async function listMonthlyMontageGuilds() {
  return getDb().select().from(guildSettings).where(and(eq(guildSettings.monthlyMontageEnabled, true), isNotNull(guildSettings.monthlyMontageChannelId)));
}

export async function getMonthlyBestScoreUrls(guildId: string, mode: OsuMode, monthStart: Date, monthEnd: Date, limit = 5) {
  const rows = await getDb().select({ osuScoreId: scoreEvents.osuScoreId, pp: scoreEvents.pp, username: accounts.username })
    .from(scoreEvents)
    .innerJoin(accountGuilds, eq(accountGuilds.accountId, scoreEvents.accountId))
    .innerJoin(accounts, eq(accounts.id, scoreEvents.accountId))
    .where(and(eq(accountGuilds.guildId, guildId), eq(scoreEvents.mode, mode), gte(scoreEvents.endedAt, monthStart), lt(scoreEvents.endedAt, monthEnd)))
    .orderBy(desc(scoreEvents.pp), desc(scoreEvents.endedAt))
    .limit(Math.min(Math.max(limit, 2), 8));
  return rows.map((row) => ({ url: `https://osu.ppy.sh/scores/${row.osuScoreId}`, pp: row.pp, username: row.username }));
}

export async function markMonthlyMontageCreated(guildId: string, month: string) {
  await getDb().update(guildSettings).set({ lastMonthlyMontageMonth: month, updatedAt: new Date() }).where(eq(guildSettings.guildId, guildId));
}

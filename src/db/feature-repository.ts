import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import type { OsuMode } from "@/lib/osu/modes";
import { calculatePulseHistory } from "../lib/osu/pulse-index";
import { getDb } from "./index";
import {
  accountGuilds,
  accounts,
  adminAuditLogs,
  botErrors,
  botFeedback,
  controlPanelSettings,
  dailySnapshots,
  discordAnnouncements,
  guildSettings,
  musicFavorites,
  musicQueueSnapshots,
  notificationRules,
  renderVideos,
  reportDeliveries,
  scoreEvents,
  serviceUsageDaily,
  userGoals,
  type PersistedMusicTrack,
  type NotificationRuleConditions,
} from "./schema";

export async function setUserGoal(input: {
  discordUserId: string;
  accountId: string;
  mode: OsuMode;
  targetPp?: number | null;
  targetGlobalRank?: number | null;
}) {
  const [goal] = await getDb().insert(userGoals).values({
    discordUserId: input.discordUserId,
    accountId: input.accountId,
    mode: input.mode,
    targetPp: input.targetPp ?? null,
    targetGlobalRank: input.targetGlobalRank ?? null,
    achievedAt: null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [userGoals.discordUserId, userGoals.mode],
    set: {
      accountId: input.accountId,
      targetPp: input.targetPp ?? null,
      targetGlobalRank: input.targetGlobalRank ?? null,
      achievedAt: null,
      updatedAt: new Date(),
    },
  }).returning();
  return goal;
}

export async function getUserGoal(discordUserId: string, mode: OsuMode) {
  return getDb().query.userGoals.findFirst({
    where: and(eq(userGoals.discordUserId, discordUserId), eq(userGoals.mode, mode)),
  });
}

export async function clearUserGoal(discordUserId: string, mode: OsuMode) {
  const [deleted] = await getDb().delete(userGoals).where(
    and(eq(userGoals.discordUserId, discordUserId), eq(userGoals.mode, mode)),
  ).returning();
  return deleted;
}

export async function listGoalsForAccount(accountId: string, mode: OsuMode) {
  return getDb().select().from(userGoals).where(
    and(eq(userGoals.accountId, accountId), eq(userGoals.mode, mode)),
  );
}

export async function markGoalAchieved(id: string) {
  await getDb().update(userGoals).set({ achievedAt: new Date(), updatedAt: new Date() }).where(eq(userGoals.id, id));
}

export async function recordBotError(input: {
  traceId?: string;
  command: string;
  discordUserId?: string | null;
  guildId?: string | null;
  error: unknown;
  context?: Record<string, unknown>;
}) {
  const traceId = input.traceId ?? randomBytes(5).toString("hex").toUpperCase();
  const error = input.error instanceof Error ? input.error : new Error(String(input.error));
  await getDb().insert(botErrors).values({
    traceId,
    command: input.command,
    discordUserId: input.discordUserId ?? null,
    guildId: input.guildId ?? null,
    message: error.message.slice(0, 2_000),
    stack: error.stack?.slice(0, 12_000) ?? null,
    context: input.context ?? {},
  });
  return traceId;
}

export async function listBotErrors(limit = 100) {
  return getDb().select().from(botErrors).orderBy(desc(botErrors.createdAt)).limit(Math.min(Math.max(limit, 1), 500));
}

export async function resolveBotError(traceId: string) {
  const [row] = await getDb().update(botErrors).set({ resolvedAt: new Date() }).where(eq(botErrors.traceId, traceId)).returning();
  return row;
}

export async function createBotFeedback(input: {
  discordUserId: string;
  guildId?: string | null;
  kind: string;
  title: string;
  details: string;
}) {
  const [row] = await getDb().insert(botFeedback).values({
    discordUserId: input.discordUserId,
    guildId: input.guildId ?? null,
    kind: input.kind,
    title: input.title,
    details: input.details,
  }).returning();
  return row;
}

export async function listBotFeedback(limit = 100) {
  return getDb().select().from(botFeedback).orderBy(desc(botFeedback.createdAt)).limit(Math.min(Math.max(limit, 1), 500));
}

export async function configureUtilityPanel(input: { guildId: string; channelId: string; messageId: string }) {
  const [row] = await getDb().insert(guildSettings).values({
    guildId: input.guildId,
    utilityPanelChannelId: input.channelId,
    utilityPanelMessageId: input.messageId,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: guildSettings.guildId,
    set: {
      utilityPanelChannelId: input.channelId,
      utilityPanelMessageId: input.messageId,
      updatedAt: new Date(),
    },
  }).returning();
  return row;
}

export async function configureUpdatesChannel(guildId: string, channelId: string) {
  const [row] = await getDb().insert(guildSettings).values({
    guildId,
    updatesChannelId: channelId,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: guildSettings.guildId,
    set: { updatesChannelId: channelId, updatedAt: new Date() },
  }).returning();
  return row;
}

export async function configureGuildAutomationChannels(input: {
  guildId: string;
  dailyReportChannelId?: string | null;
  weeklyAwardsChannelId?: string | null;
  auditLogChannelId?: string | null;
  consoleLogChannelId?: string | null;
}) {
  const values = {
    dailyReportChannelId: input.dailyReportChannelId,
    weeklyAwardsChannelId: input.weeklyAwardsChannelId,
    auditLogChannelId: input.auditLogChannelId,
    consoleLogChannelId: input.consoleLogChannelId,
    updatedAt: new Date(),
  };
  const [row] = await getDb().insert(guildSettings).values({ guildId: input.guildId, ...values }).onConflictDoUpdate({
    target: guildSettings.guildId,
    set: values,
  }).returning();
  return row;
}

export async function listGuildAutomationChannels() {
  return getDb().select({
    guildId: guildSettings.guildId,
    dailyReportChannelId: guildSettings.dailyReportChannelId,
    weeklyAwardsChannelId: guildSettings.weeklyAwardsChannelId,
    auditLogChannelId: guildSettings.auditLogChannelId,
    consoleLogChannelId: guildSettings.consoleLogChannelId,
  }).from(guildSettings);
}

export async function hasReportDelivery(guildId: string, reportType: string, reportDate: string) {
  return Boolean(await getDb().query.reportDeliveries.findFirst({
    where: and(
      eq(reportDeliveries.guildId, guildId),
      eq(reportDeliveries.reportType, reportType),
      eq(reportDeliveries.reportDate, reportDate),
    ),
    columns: { guildId: true },
  }));
}

export async function recordReportDelivery(input: {
  guildId: string;
  reportType: string;
  reportDate: string;
  channelId: string;
  messageId?: string | null;
}) {
  await getDb().insert(reportDeliveries).values(input).onConflictDoNothing();
}

export async function recordAdminAudit(input: {
  guildId?: string | null;
  actorDiscordUserId?: string | null;
  source: string;
  action: string;
  summary: string;
  details?: Record<string, unknown>;
}) {
  const [row] = await getDb().insert(adminAuditLogs).values({
    guildId: input.guildId ?? null,
    actorDiscordUserId: input.actorDiscordUserId ?? null,
    source: input.source.slice(0, 80),
    action: input.action.slice(0, 120),
    summary: input.summary.slice(0, 1_000),
    details: input.details ?? {},
  }).returning();
  return row;
}

export async function listAdminAudits(limit = 200) {
  return getDb().select().from(adminAuditLogs).orderBy(desc(adminAuditLogs.createdAt)).limit(Math.min(Math.max(limit, 1), 1_000));
}

export async function createNotificationRule(input: {
  guildId: string;
  channelId: string;
  name: string;
  accountId?: string | null;
  conditions: NotificationRuleConditions;
  createdBy?: string | null;
}) {
  const [row] = await getDb().insert(notificationRules).values({ ...input, accountId: input.accountId ?? null }).returning();
  return row;
}

export async function listNotificationRules(guildId?: string) {
  return getDb().select({
    rule: notificationRules,
    accountUsername: accounts.username,
  }).from(notificationRules).leftJoin(accounts, eq(notificationRules.accountId, accounts.id))
    .where(guildId ? eq(notificationRules.guildId, guildId) : undefined)
    .orderBy(desc(notificationRules.createdAt));
}

export async function deleteNotificationRule(id: string) {
  const [row] = await getDb().delete(notificationRules).where(eq(notificationRules.id, id)).returning();
  return row;
}

export async function toggleNotificationRule(id: string, enabled: boolean) {
  const [row] = await getDb().update(notificationRules).set({ enabled, updatedAt: new Date() }).where(eq(notificationRules.id, id)).returning();
  return row;
}

export async function listMatchingNotificationRules(accountId: string) {
  return getDb().select().from(notificationRules).where(and(
    eq(notificationRules.enabled, true),
    sql`(
      ${notificationRules.accountId} = ${accountId}
      or (
        ${notificationRules.accountId} is null
        and exists (
          select 1
          from ${accountGuilds}
          where ${accountGuilds.accountId} = ${accountId}
            and ${accountGuilds.guildId} = ${notificationRules.guildId}
        )
      )
    )`,
  ));
}

export async function markNotificationRuleMatched(id: string) {
  await getDb().update(notificationRules).set({ lastMatchedAt: new Date(), updatedAt: new Date() }).where(eq(notificationRules.id, id));
}

export async function getRecentSessions(accountId: string, mode: OsuMode, limit = 10) {
  const rows = await getDb().select().from(scoreEvents).where(and(
    eq(scoreEvents.accountId, accountId),
    eq(scoreEvents.mode, mode),
  )).orderBy(desc(scoreEvents.endedAt)).limit(2_000);
  const chronological = [...rows].reverse();
  const sessions: Array<typeof chronological> = [];
  for (const score of chronological) {
    const current = sessions.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous || score.endedAt.getTime() - previous.endedAt.getTime() > 45 * 60_000) sessions.push([score]);
    else current.push(score);
  }
  return sessions.slice(-Math.max(1, limit)).reverse().map((scores) => {
    const ppValues = scores.flatMap((score) => score.pp === null ? [] : [score.pp]);
    const best = [...scores].sort((left, right) => (right.pp ?? -1) - (left.pp ?? -1))[0];
    return {
      startedAt: scores[0].endedAt,
      endedAt: scores.at(-1)!.endedAt,
      plays: scores.length,
      averageAccuracy: scores.reduce((sum, score) => sum + score.accuracy, 0) / scores.length,
      averagePp: ppValues.length ? ppValues.reduce((sum, pp) => sum + pp, 0) / ppValues.length : null,
      best,
      personalBests: scores.filter((score) => score.isPersonalBest).length,
      misses: scores.filter((score) => !score.passed).length,
    };
  });
}

export async function listPendingVersionAnnouncements(version: string) {
  return getDb().select({
    guildId: guildSettings.guildId,
    channelId: guildSettings.updatesChannelId,
  }).from(guildSettings).where(sql`${guildSettings.updatesChannelId} is not null and (${guildSettings.lastAnnouncedVersion} is null or ${guildSettings.lastAnnouncedVersion} <> ${version})`);
}

export async function markVersionAnnounced(guildId: string, version: string) {
  await getDb().update(guildSettings).set({ lastAnnouncedVersion: version, updatedAt: new Date() }).where(eq(guildSettings.guildId, guildId));
}

export async function getWeeklyLeaderboard(guildId: string, mode: OsuMode) {
  const linked = await getDb().select({ accountId: accounts.id, username: accounts.username }).from(accountGuilds)
    .innerJoin(accounts, eq(accountGuilds.accountId, accounts.id))
    .where(eq(accountGuilds.guildId, guildId));
  if (!linked.length) return [];
  const cutoff = new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10);
  const rows = await getDb().select().from(dailySnapshots).where(and(
    inArray(dailySnapshots.accountId, linked.map((row) => row.accountId)),
    eq(dailySnapshots.mode, mode),
    gte(dailySnapshots.snapshotDate, cutoff),
  )).orderBy(asc(dailySnapshots.snapshotDate));
  const names = new Map(linked.map((row) => [row.accountId, row.username]));
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) grouped.set(row.accountId, [...(grouped.get(row.accountId) ?? []), row]);
  return [...grouped.entries()].map(([accountId, snapshots]) => {
    const first = snapshots[0];
    const latest = snapshots.at(-1)!;
    return {
      accountId,
      username: names.get(accountId) ?? "Unknown",
      ppGain: latest.pp - first.pp,
      rankGain: first.globalRank && latest.globalRank ? first.globalRank - latest.globalRank : null,
      currentPp: latest.pp,
    };
  }).sort((left, right) => right.ppGain - left.ppGain);
}

export async function getSeasonLeaderboard(guildId: string, mode: OsuMode) {
  const linked = await getDb().select({ accountId: accounts.id, username: accounts.username }).from(accountGuilds)
    .innerJoin(accounts, eq(accountGuilds.accountId, accounts.id))
    .where(eq(accountGuilds.guildId, guildId));
  if (!linked.length) return [];
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthKey = monthStart.toISOString().slice(0, 7);
  const ids = linked.map((row) => row.accountId);
  const [snapshots, plays] = await Promise.all([
    getDb().select().from(dailySnapshots).where(and(
      inArray(dailySnapshots.accountId, ids),
      eq(dailySnapshots.mode, mode),
      gte(dailySnapshots.snapshotDate, `${monthKey}-01`),
    )).orderBy(asc(dailySnapshots.snapshotDate)),
    getDb().select({ accountId: scoreEvents.accountId, value: sql<number>`count(*)::int` }).from(scoreEvents).where(and(
      inArray(scoreEvents.accountId, ids),
      eq(scoreEvents.mode, mode),
      gte(scoreEvents.endedAt, monthStart),
    )).groupBy(scoreEvents.accountId),
  ]);
  const names = new Map(linked.map((row) => [row.accountId, row.username]));
  const playCounts = new Map(plays.map((row) => [row.accountId, row.value]));
  const grouped = new Map<string, typeof snapshots>();
  for (const row of snapshots) grouped.set(row.accountId, [...(grouped.get(row.accountId) ?? []), row]);
  return [...grouped.entries()].map(([accountId, rows]) => {
    const first = rows[0];
    const latest = rows.at(-1)!;
    const ppGain = latest.pp - first.pp;
    const rankGain = first.globalRank && latest.globalRank ? first.globalRank - latest.globalRank : 0;
    const playCount = playCounts.get(accountId) ?? 0;
    return {
      accountId,
      username: names.get(accountId) ?? "Unknown",
      ppGain,
      rankGain,
      playCount,
      currentPp: latest.pp,
      points: Math.round(Math.max(0, ppGain) * 100 + Math.max(0, rankGain) / 10 + playCount * 7),
      month: monthKey,
    };
  }).sort((left, right) => right.points - left.points || right.ppGain - left.ppGain);
}

export async function getPulseLeaderboard(guildId: string, mode: OsuMode, days = 30) {
  const linked = await getDb().select({ accountId: accounts.id, username: accounts.username }).from(accountGuilds)
    .innerJoin(accounts, eq(accountGuilds.accountId, accounts.id))
    .where(eq(accountGuilds.guildId, guildId));
  if (!linked.length) return [];
  const accountIds = linked.map((row) => row.accountId);
  const cutoff = new Date(Date.now() - Math.max(1, days) * 86_400_000);
  const snapshotCutoff = new Date(cutoff.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const [scores, snapshots] = await Promise.all([
    getDb().select().from(scoreEvents).where(and(
      inArray(scoreEvents.accountId, accountIds),
      eq(scoreEvents.mode, mode),
      gte(scoreEvents.endedAt, cutoff),
    )).orderBy(asc(scoreEvents.endedAt)),
    getDb().select().from(dailySnapshots).where(and(
      inArray(dailySnapshots.accountId, accountIds),
      eq(dailySnapshots.mode, mode),
      gte(dailySnapshots.snapshotDate, snapshotCutoff),
    )).orderBy(asc(dailySnapshots.snapshotDate)),
  ]);
  const names = new Map(linked.map((row) => [row.accountId, row.username]));
  return accountIds.flatMap((accountId) => {
    const accountScores = scores.filter((score) => score.accountId === accountId);
    const accountSnapshots = snapshots.filter((snapshot) => snapshot.accountId === accountId).map((snapshot) => ({
      date: snapshot.snapshotDate,
      pp: snapshot.pp,
      globalRank: snapshot.globalRank,
    }));
    const history = calculatePulseHistory(accountScores, accountSnapshots, mode);
    const latest = history.at(-1);
    if (!latest) return [];
    const activeDays = history.length;
    const activityBand = activeDays >= 12 ? "active" : activeDays >= 4 ? "regular" : "light";
    return [{
      accountId,
      username: names.get(accountId) ?? "Unknown",
      pulseIndex: latest.rollingIndex,
      growthRate: latest.growthRate,
      execution: latest.execution,
      difficulty: latest.difficulty,
      playCount: accountScores.length,
      activeDays,
      activityBand,
      currentPp: latest.totalPp,
      globalRank: latest.globalRank,
    }];
  }).sort((left, right) => right.pulseIndex - left.pulseIndex || right.execution - left.execution);
}

export async function analyzeAndMarkScore(scoreId: string) {
  const current = await getDb().query.scoreEvents.findFirst({ where: eq(scoreEvents.id, scoreId) });
  if (!current) return null;
  const previousCondition = and(
    eq(scoreEvents.accountId, current.accountId),
    eq(scoreEvents.mode, current.mode),
    sql`${scoreEvents.id} <> ${current.id}`,
    // Use Drizzle's typed timestamp operator here. A raw SQL interpolation
    // leaves the postgres-js driver without the column encoder and it tries to
    // measure the Date as a string, aborting score processing on local Postgres.
    lte(scoreEvents.endedAt, current.endedAt),
    sql`${scoreEvents.pp} is not null`,
  );
  const [previous, [best]] = await Promise.all([
    getDb().select({ pp: scoreEvents.pp }).from(scoreEvents).where(previousCondition).orderBy(desc(scoreEvents.endedAt)).limit(30),
    getDb().select({ maxPp: sql<number | null>`max(${scoreEvents.pp})` }).from(scoreEvents).where(previousCondition),
  ]);
  const values = previous.map((row) => row.pp).filter((value): value is number => value !== null);
  const personalBest = current.pp !== null && (best.maxPp === null || current.pp > best.maxPp);
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : current.pp ?? 0;
  const variance = values.length > 1 ? values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length : 0;
  const deviation = Math.sqrt(variance);
  const anomalyScore = current.pp !== null && deviation > 0 ? (current.pp - mean) / deviation : null;
  await getDb().update(scoreEvents).set({ isPersonalBest: personalBest, anomalyScore }).where(eq(scoreEvents.id, current.id));
  return { ...current, isPersonalBest: personalBest, anomalyScore, sampleSize: values.length };
}

export async function getScoreAnalysis(accountId: string, mode: OsuMode) {
  return getDb().select({
    osuScoreId: scoreEvents.osuScoreId,
    artist: scoreEvents.artist,
    title: scoreEvents.title,
    difficulty: scoreEvents.difficulty,
    pp: scoreEvents.pp,
    accuracy: scoreEvents.accuracy,
    rank: scoreEvents.rank,
    starRating: scoreEvents.starRating,
    bpm: scoreEvents.bpm,
    ar: scoreEvents.ar,
    od: scoreEvents.od,
    cs: scoreEvents.cs,
    mods: scoreEvents.mods,
    endedAt: scoreEvents.endedAt,
    anomalyScore: scoreEvents.anomalyScore,
  }).from(scoreEvents).where(and(eq(scoreEvents.accountId, accountId), eq(scoreEvents.mode, mode))).orderBy(desc(scoreEvents.endedAt));
}

export async function saveMusicQueue(input: {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  volume: number;
  tracks: PersistedMusicTrack[];
}) {
  await getDb().insert(musicQueueSnapshots).values({ ...input, updatedAt: new Date() }).onConflictDoUpdate({
    target: musicQueueSnapshots.guildId,
    set: { ...input, updatedAt: new Date() },
  });
}

export async function deleteMusicQueue(guildId: string) {
  await getDb().delete(musicQueueSnapshots).where(eq(musicQueueSnapshots.guildId, guildId));
}

export async function listMusicQueues() {
  return getDb().select().from(musicQueueSnapshots).orderBy(asc(musicQueueSnapshots.updatedAt));
}

export async function addMusicFavorite(input: Omit<typeof musicFavorites.$inferInsert, "id" | "createdAt">) {
  const [row] = await getDb().insert(musicFavorites).values(input).onConflictDoUpdate({
    target: [musicFavorites.discordUserId, musicFavorites.uri],
    set: { title: input.title, author: input.author, source: input.source, duration: input.duration },
  }).returning();
  return row;
}

export async function listMusicFavorites(discordUserId: string) {
  return getDb().select().from(musicFavorites).where(eq(musicFavorites.discordUserId, discordUserId)).orderBy(desc(musicFavorites.createdAt));
}

export async function removeMusicFavorite(id: string, discordUserId: string) {
  const [row] = await getDb().delete(musicFavorites).where(and(eq(musicFavorites.id, id), eq(musicFavorites.discordUserId, discordUserId))).returning();
  return row;
}

export async function recordDiscordAnnouncement(input: { channelId: string; title: string; message: string; sentBy?: string }) {
  const [row] = await getDb().insert(discordAnnouncements).values(input).returning();
  return row;
}

export async function recordServiceUsage(service: string, operations = 1, bytes = 0) {
  const usageDate = new Date().toISOString().slice(0, 10);
  await getDb().insert(serviceUsageDaily).values({ service, usageDate, operations, bytes, updatedAt: new Date() }).onConflictDoUpdate({
    target: [serviceUsageDaily.service, serviceUsageDaily.usageDate],
    set: {
      operations: sql`${serviceUsageDaily.operations} + ${operations}`,
      bytes: sql`${serviceUsageDaily.bytes} + ${bytes}`,
      updatedAt: new Date(),
    },
  });
}

export async function getServiceUsageToday() {
  const usageDate = new Date().toISOString().slice(0, 10);
  const [usage, videos] = await Promise.all([
    getDb().select().from(serviceUsageDaily).where(eq(serviceUsageDaily.usageDate, usageDate)),
    getDb().select({ sourceSize: renderVideos.sourceSize, cleanup: renderVideos.cleanup, uploadedAt: renderVideos.uploadedAt }).from(renderVideos),
  ]);
  const youtubeUploads = videos.filter((video) => video.uploadedAt.toISOString().slice(0, 10) === usageDate).length;
  const r2Bytes = videos.reduce((sum, video) => sum + (video.cleanup?.r2_deleted ? 0 : video.sourceSize), 0);
  return { usage, youtubeUploads, youtubeQuotaUnits: youtubeUploads * 1_600, r2Bytes };
}

export async function getMonthlyUsageForecast() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const monthKey = monthStart.toISOString().slice(0, 7);
  const elapsedDays = Math.max(1, Math.ceil((now.getTime() - monthStart.getTime()) / 86_400_000));
  const daysInMonth = Math.round((nextMonth.getTime() - monthStart.getTime()) / 86_400_000);
  const [usage, videos] = await Promise.all([
    getDb().select().from(serviceUsageDaily).where(gte(serviceUsageDaily.usageDate, `${monthKey}-01`)).orderBy(asc(serviceUsageDaily.usageDate)),
    getDb().select({ sourceSize: renderVideos.sourceSize, cleanup: renderVideos.cleanup, uploadedAt: renderVideos.uploadedAt }).from(renderVideos),
  ]);
  const multiplier = daysInMonth / elapsedDays;
  const services = [...new Set(usage.map((row) => row.service))].map((service) => {
    const rows = usage.filter((row) => row.service === service);
    const operations = rows.reduce((sum, row) => sum + row.operations, 0);
    const bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
    return { service, operations, bytes, forecastOperations: Math.round(operations * multiplier), forecastBytes: Math.round(bytes * multiplier) };
  });
  const youtubeUploads = videos.filter((video) => video.uploadedAt >= monthStart && video.uploadedAt < nextMonth).length;
  const retainedBytes = videos.reduce((sum, video) => sum + (video.cleanup?.r2_deleted ? 0 : video.sourceSize), 0);
  const uploadedBytes = videos.filter((video) => video.uploadedAt >= monthStart && video.uploadedAt < nextMonth).reduce((sum, video) => sum + video.sourceSize, 0);
  return {
    month: monthKey,
    elapsedDays,
    daysInMonth,
    services,
    youtubeUploads,
    forecastYoutubeUploads: Math.round(youtubeUploads * multiplier),
    youtubeQuotaUnits: youtubeUploads * 1_600,
    forecastYoutubeQuotaUnits: Math.round(youtubeUploads * multiplier) * 1_600,
    retainedBytes,
    uploadedBytes,
    forecastUploadedBytes: Math.round(uploadedBytes * multiplier),
  };
}

export async function getMonitoringConfiguration() {
  const row = await getDb().query.controlPanelSettings.findFirst({
    where: eq(controlPanelSettings.id, "primary"),
    columns: { values: true },
  });
  return row?.values.monitoring ?? {
    alertsEnabled: true,
    alertChannelId: "",
    osuDailyRequestLimit: 10_000,
    youtubeDailyQuota: 10_000,
    r2StorageLimitGb: 25,
  };
}

export async function markServiceAlerted(service: string) {
  const usageDate = new Date().toISOString().slice(0, 10);
  await getDb().insert(serviceUsageDaily).values({ service, usageDate, alerted: true }).onConflictDoUpdate({
    target: [serviceUsageDaily.service, serviceUsageDaily.usageDate],
    set: { alerted: true, updatedAt: new Date() },
  });
}

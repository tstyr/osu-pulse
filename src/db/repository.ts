import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  sql,
} from "drizzle-orm";

import type { OsuMode } from "@/lib/osu/modes";
import type { OsuUser } from "@/lib/osu/types";
import type { ServerStatusChannelIds } from "./schema";

import { databaseResultRows, getDb, withDatabaseRetry } from "./index";
import {
  accountGuilds,
  accounts,
  dailySnapshots,
  discordAccountLinks,
  focusSessions,
  guildSettings,
  manuallyTrackedAccounts,
  profileSnapshots,
  reminders,
  scoreEvents,
} from "./schema";

export async function ensureGuild(guildId: string) {
  const db = getDb();
  await db
    .insert(guildSettings)
    .values({ guildId })
    .onConflictDoNothing({ target: guildSettings.guildId });
}

export async function linkAccount(input: {
  discordUserId: string;
  guildId?: string | null;
  user: OsuUser;
  primaryMode: OsuMode;
}) {
  const db = getDb();
  const previousLink = await db.query.discordAccountLinks.findFirst({
    where: eq(discordAccountLinks.discordUserId, input.discordUserId),
  });

  const account = await upsertAccount({
    user: input.user,
    primaryMode: input.primaryMode,
  });

  await db
    .insert(discordAccountLinks)
    .values({
      discordUserId: input.discordUserId,
      accountId: account.id,
      primaryMode: input.primaryMode,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: discordAccountLinks.discordUserId,
      set: {
        accountId: account.id,
        primaryMode: input.primaryMode,
        updatedAt: new Date(),
      },
    });

  if (input.guildId) {
    await ensureGuild(input.guildId);
    await db
      .insert(accountGuilds)
      .values({ accountId: account.id, guildId: input.guildId })
      .onConflictDoNothing();
  }

  if (previousLink && previousLink.accountId !== account.id) {
    const [remaining] = await db
      .select({ value: count() })
      .from(discordAccountLinks)
      .where(eq(discordAccountLinks.accountId, previousLink.accountId));
    const manuallyTracked = await isAccountManuallyTracked(previousLink.accountId);
    if ((remaining?.value ?? 0) === 0 && !manuallyTracked) {
      await db.delete(accounts).where(eq(accounts.id, previousLink.accountId));
    }
  }

  return account;
}

export async function upsertAccount(input: {
  user: OsuUser;
  primaryMode: OsuMode;
}) {
  const [account] = await getDb()
    .insert(accounts)
    .values({
      osuUserId: input.user.id,
      username: input.user.username,
      avatarUrl: input.user.avatar_url,
      countryCode: input.user.country_code,
      primaryMode: input.primaryMode,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: accounts.osuUserId,
      set: {
        username: input.user.username,
        avatarUrl: input.user.avatar_url,
        countryCode: input.user.country_code,
        primaryMode: input.primaryMode,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!account) throw new Error("アカウント登録に失敗しました。");
  return account;
}

export async function markAccountManuallyTracked(accountId: string) {
  const [row] = await getDb()
    .insert(manuallyTrackedAccounts)
    .values({ accountId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: manuallyTrackedAccounts.accountId,
      set: { updatedAt: new Date() },
    })
    .returning();
  return row;
}

export async function isAccountManuallyTracked(accountId: string) {
  return Boolean(await getDb().query.manuallyTrackedAccounts.findFirst({
    where: eq(manuallyTrackedAccounts.accountId, accountId),
    columns: { accountId: true },
  }));
}

export async function setLinkedPrimaryMode(
  discordUserId: string,
  primaryMode: OsuMode,
) {
  const [updated] = await getDb()
    .update(discordAccountLinks)
    .set({ primaryMode, updatedAt: new Date() })
    .where(eq(discordAccountLinks.discordUserId, discordUserId))
    .returning();
  return updated;
}

export async function updateAccountIdentity(
  accountId: string,
  user: OsuUser,
) {
  const db = getDb();
  await db
    .update(accounts)
    .set({
      username: user.username,
      avatarUrl: user.avatar_url,
      countryCode: user.country_code,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, accountId));
}

export async function getAccountsByDiscord(discordUserId: string) {
  const rows = await withDatabaseRetry(() => getDb()
      .select({
        account: accounts,
        primaryMode: discordAccountLinks.primaryMode,
      })
      .from(discordAccountLinks)
      .innerJoin(accounts, eq(discordAccountLinks.accountId, accounts.id))
      .where(eq(discordAccountLinks.discordUserId, discordUserId))
      .orderBy(asc(discordAccountLinks.createdAt)));
  return rows.map((row) => ({
    ...row.account,
    primaryMode: row.primaryMode,
  }));
}

export async function listDailyDigestTargets() {
  return getDb()
    .select({
      discordUserId: discordAccountLinks.discordUserId,
      dailyDmEnabled: discordAccountLinks.dailyDmEnabled,
      primaryMode: discordAccountLinks.primaryMode,
      account: accounts,
    })
    .from(discordAccountLinks)
    .innerJoin(accounts, eq(discordAccountLinks.accountId, accounts.id))
    .orderBy(
      asc(discordAccountLinks.createdAt),
      asc(discordAccountLinks.discordUserId),
    );
}

export async function listDiscordAccountAssignments() {
  return getDb()
    .select({
      discordUserId: discordAccountLinks.discordUserId,
      accountId: discordAccountLinks.accountId,
    })
    .from(discordAccountLinks)
    .orderBy(asc(discordAccountLinks.createdAt));
}

export async function getAccountByDiscord(discordUserId: string) {
  const linked = await getAccountsByDiscord(discordUserId);
  return linked[0];
}

export async function getAccountByOsuId(osuUserId: number) {
  return getDb().query.accounts.findFirst({
    where: eq(accounts.osuUserId, osuUserId),
  });
}

export async function getAccountById(accountId: string) {
  return getDb().query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
}

export async function listAccounts() {
  return getDb().select().from(accounts).orderBy(asc(accounts.createdAt));
}

export async function unlinkAccount(
  discordUserId: string,
) {
  const db = getDb();
  const account = await getAccountByDiscord(discordUserId);
  if (!account) return undefined;

  const [deleted] = await db
    .delete(discordAccountLinks)
    .where(eq(discordAccountLinks.discordUserId, discordUserId))
    .returning();
  if (!deleted) return undefined;

  const [remaining] = await db
    .select({ value: count() })
    .from(discordAccountLinks)
    .where(eq(discordAccountLinks.accountId, account.id));
  const manuallyTracked = await isAccountManuallyTracked(account.id);
  if ((remaining?.value ?? 0) === 0 && !manuallyTracked) {
    await db.delete(accounts).where(eq(accounts.id, account.id));
  }
  return account;
}

export async function setDailyDm(
  discordUserId: string,
  enabled: boolean,
) {
  const [updated] = await getDb()
    .update(discordAccountLinks)
    .set({ dailyDmEnabled: enabled, updatedAt: new Date() })
    .where(eq(discordAccountLinks.discordUserId, discordUserId))
    .returning();
  return updated;
}

export async function attachAccountToGuild(accountId: string, guildId: string) {
  await ensureGuild(guildId);
  await getDb()
    .insert(accountGuilds)
    .values({ accountId, guildId })
    .onConflictDoNothing();
}

export async function configureGuild(input: {
  guildId: string;
  resultChannelId?: string | null;
  announcementsEnabled?: boolean;
  minimumPp?: number;
}) {
  const [settings] = await getDb()
    .insert(guildSettings)
    .values({
      guildId: input.guildId,
      resultChannelId: input.resultChannelId ?? null,
      announcementsEnabled: input.announcementsEnabled ?? true,
      minimumPp: input.minimumPp ?? 0,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: guildSettings.guildId,
      set: {
        ...(input.resultChannelId !== undefined
          ? { resultChannelId: input.resultChannelId }
          : {}),
        ...(input.announcementsEnabled !== undefined
          ? { announcementsEnabled: input.announcementsEnabled }
          : {}),
        ...(input.minimumPp !== undefined ? { minimumPp: input.minimumPp } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();

  return settings;
}

export async function getGuildSettings(guildId: string) {
  return getDb().query.guildSettings.findFirst({
    where: eq(guildSettings.guildId, guildId),
  });
}

export async function configureServerStatus(input: {
  guildId: string;
  categoryId: string;
  channelIds: ServerStatusChannelIds;
  liveMessageId?: string | null;
}) {
  const [settings] = await getDb()
    .insert(guildSettings)
    .values({
      guildId: input.guildId,
      statusEnabled: true,
      statusCategoryId: input.categoryId,
      statusChannelIds: input.channelIds,
      statusLiveMessageId: input.liveMessageId ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: guildSettings.guildId,
      set: {
        statusEnabled: true,
        statusCategoryId: input.categoryId,
        statusChannelIds: input.channelIds,
        statusLiveMessageId: input.liveMessageId ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return settings;
}

export async function disableServerStatus(guildId: string) {
  const [settings] = await getDb()
    .update(guildSettings)
    .set({
      statusEnabled: false,
      statusCategoryId: null,
      statusChannelIds: null,
      statusLiveMessageId: null,
      updatedAt: new Date(),
    })
    .where(eq(guildSettings.guildId, guildId))
    .returning();
  return settings;
}

export async function setServerStatusLiveMessage(guildId: string, messageId: string) {
  await getDb()
    .update(guildSettings)
    .set({ statusLiveMessageId: messageId, updatedAt: new Date() })
    .where(eq(guildSettings.guildId, guildId));
}

export async function listServerStatusSettings() {
  return getDb()
    .select({
      guildId: guildSettings.guildId,
      statusCategoryId: guildSettings.statusCategoryId,
      statusChannelIds: guildSettings.statusChannelIds,
      statusLiveMessageId: guildSettings.statusLiveMessageId,
    })
    .from(guildSettings)
    .where(eq(guildSettings.statusEnabled, true));
}

export async function getAnnouncementTargets(accountId: string) {
  return getDb()
    .select({
      guildId: guildSettings.guildId,
      resultChannelId: guildSettings.resultChannelId,
      minimumPp: guildSettings.minimumPp,
    })
    .from(accountGuilds)
    .innerJoin(
      guildSettings,
      eq(accountGuilds.guildId, guildSettings.guildId),
    )
    .where(
      and(
        eq(accountGuilds.accountId, accountId),
        eq(guildSettings.announcementsEnabled, true),
      ),
    );
}

export async function insertScoreEvent(
  score: typeof scoreEvents.$inferInsert,
) {
  await getDb()
    .update(scoreEvents)
    .set({
      beatmapId: score.beatmapId,
      ...(score.beatmapsetId === null || score.beatmapsetId === undefined ? {} : { beatmapsetId: score.beatmapsetId }),
      ...(score.artist === "Unknown artist" ? {} : { artist: score.artist }),
      ...(score.title.startsWith("Beatmap #") ? {} : { title: score.title }),
      difficulty: score.difficulty,
      ...(score.mapper === null || score.mapper === undefined ? {} : { mapper: score.mapper }),
      ...(score.coverUrl === null || score.coverUrl === undefined ? {} : { coverUrl: score.coverUrl }),
      ...(score.pp === null || score.pp === undefined ? {} : { pp: score.pp }),
      ...(score.starRating === null || score.starRating === undefined ? {} : { starRating: score.starRating }),
      ...(score.bpm === null || score.bpm === undefined ? {} : { bpm: score.bpm }),
      ...(score.beatmapLengthSeconds === null || score.beatmapLengthSeconds === undefined ? {} : { beatmapLengthSeconds: score.beatmapLengthSeconds }),
      ...(score.ar === null || score.ar === undefined ? {} : { ar: score.ar }),
      ...(score.od === null || score.od === undefined ? {} : { od: score.od }),
      ...(score.cs === null || score.cs === undefined ? {} : { cs: score.cs }),
      accuracy: score.accuracy,
      rank: score.rank,
      ...(score.maxCombo === null || score.maxCombo === undefined ? {} : { maxCombo: score.maxCombo }),
      ...(score.score === null || score.score === undefined ? {} : { score: score.score }),
      mods: score.mods,
      passed: score.passed,
      endedAt: score.endedAt,
    })
    .where(eq(scoreEvents.osuScoreId, score.osuScoreId));
  const [inserted] = await getDb()
    .insert(scoreEvents)
    .values(score)
    .onConflictDoNothing({ target: scoreEvents.osuScoreId })
    .returning();
  return inserted;
}

export async function updateScoreDifficultyAttributes(
  scoreId: string,
  attributes: { aimDifficulty?: number | null; speedDifficulty?: number | null },
) {
  const [updated] = await getDb().update(scoreEvents).set({
    aimDifficulty: attributes.aimDifficulty ?? null,
    speedDifficulty: attributes.speedDifficulty ?? null,
  }).where(eq(scoreEvents.id, scoreId)).returning();
  return updated ?? null;
}

export async function getRecentPlays(
  accountId: string,
  mode: OsuMode,
  limit = 10,
) {
  return getDb()
    .select()
    .from(scoreEvents)
    .where(and(eq(scoreEvents.accountId, accountId), eq(scoreEvents.mode, mode)))
    .orderBy(desc(scoreEvents.endedAt))
    .limit(limit);
}

export async function getPlayerScoreHistory(
  accountId: string,
  mode: OsuMode,
) {
  return getDb()
    .select()
    .from(scoreEvents)
    .where(and(eq(scoreEvents.accountId, accountId), eq(scoreEvents.mode, mode)))
    .orderBy(desc(scoreEvents.endedAt));
}

export async function upsertDailySnapshot(
  snapshot: typeof dailySnapshots.$inferInsert,
) {
  const db = getDb();
  const [saved] = await db
    .insert(dailySnapshots)
    .values(snapshot)
    .onConflictDoUpdate({
      target: [
        dailySnapshots.accountId,
        dailySnapshots.mode,
        dailySnapshots.snapshotDate,
      ],
      set: {
        globalRank: snapshot.globalRank,
        countryRank: snapshot.countryRank,
        pp: snapshot.pp,
        accuracy: snapshot.accuracy,
        playCount: snapshot.playCount,
        playTimeSeconds: snapshot.playTimeSeconds,
        totalScore: snapshot.totalScore,
        rankedScore: snapshot.rankedScore,
        level: snapshot.level,
        updatedAt: new Date(),
      },
    })
    .returning();

  const latest = await db.query.profileSnapshots.findFirst({
    where: and(
      eq(profileSnapshots.accountId, saved.accountId),
      eq(profileSnapshots.mode, saved.mode),
    ),
    orderBy: desc(profileSnapshots.capturedAt),
  });
  const changed = !latest
    || latest.globalRank !== saved.globalRank
    || latest.countryRank !== saved.countryRank
    || latest.pp !== saved.pp
    || latest.accuracy !== saved.accuracy
    || latest.playCount !== saved.playCount
    || latest.playTimeSeconds !== saved.playTimeSeconds
    || latest.totalScore !== saved.totalScore
    || latest.rankedScore !== saved.rankedScore
    || latest.level !== saved.level;

  if (changed) {
    await db.insert(profileSnapshots).values({
      accountId: saved.accountId,
      mode: saved.mode,
      capturedAt: new Date(),
      globalRank: saved.globalRank,
      countryRank: saved.countryRank,
      pp: saved.pp,
      accuracy: saved.accuracy,
      playCount: saved.playCount,
      playTimeSeconds: saved.playTimeSeconds,
      totalScore: saved.totalScore,
      rankedScore: saved.rankedScore,
      level: saved.level,
      source: "live",
    }).onConflictDoNothing();
  }

  return saved;
}

export async function getGrowthHistory(
  accountId: string,
  mode: OsuMode,
  days = 90,
) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - Math.max(days, 1));
  const dateKey = since.toISOString().slice(0, 10);

  return getDb()
    .select()
    .from(dailySnapshots)
    .where(
      and(
        eq(dailySnapshots.accountId, accountId),
        eq(dailySnapshots.mode, mode),
        gte(dailySnapshots.snapshotDate, dateKey),
      ),
    )
    .orderBy(asc(dailySnapshots.snapshotDate));
}

export async function getFullGrowthHistory(
  accountId: string,
  mode: OsuMode,
) {
  return getDb()
    .select()
    .from(dailySnapshots)
    .where(and(eq(dailySnapshots.accountId, accountId), eq(dailySnapshots.mode, mode)))
    .orderBy(asc(dailySnapshots.snapshotDate));
}

export async function getLatestSnapshots(accountId: string) {
  const rows = await getDb()
    .select()
    .from(dailySnapshots)
    .where(eq(dailySnapshots.accountId, accountId))
    .orderBy(desc(dailySnapshots.snapshotDate));

  const seen = new Set<OsuMode>();
  return rows.filter((row) => {
    if (seen.has(row.mode)) return false;
    seen.add(row.mode);
    return true;
  });
}

export async function getSnapshotDelta(
  accountId: string,
  mode: OsuMode,
) {
  const rows = await getDb()
    .select()
    .from(dailySnapshots)
    .where(and(eq(dailySnapshots.accountId, accountId), eq(dailySnapshots.mode, mode)))
    .orderBy(desc(dailySnapshots.snapshotDate))
    .limit(2);

  return {
    latest: rows[0] ?? null,
    previous: rows[1] ?? null,
  };
}

export async function getOverviewCounts() {
  const db = getDb();
  const [[accountCount], [scoreCount], [guildCount], [focusCount]] =
    await Promise.all([
      db.select({ value: count() }).from(accounts),
      db.select({ value: count() }).from(scoreEvents),
      db.select({ value: count() }).from(guildSettings),
      db
        .select({ value: count() })
        .from(focusSessions)
        .where(eq(focusSessions.status, "completed")),
    ]);

  return {
    accounts: accountCount?.value ?? 0,
    scores: scoreCount?.value ?? 0,
    guilds: guildCount?.value ?? 0,
    focusSessions: focusCount?.value ?? 0,
  };
}

export async function createReminder(input: {
  discordUserId: string;
  guildId?: string | null;
  channelId?: string | null;
  message: string;
  dueAt: Date;
}) {
  const [created] = await getDb().insert(reminders).values(input).returning();
  if (!created) throw new Error("Failed to create reminder");
  return created;
}

export async function setReminderWorkflowRun(id: string, runId: string) {
  await getDb()
    .update(reminders)
    .set({ workflowRunId: runId })
    .where(eq(reminders.id, id));
}

export async function getReminder(id: string) {
  return getDb().query.reminders.findFirst({ where: eq(reminders.id, id) });
}

export async function listReminders(discordUserId: string) {
  return getDb()
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.discordUserId, discordUserId),
        eq(reminders.status, "scheduled"),
      ),
    )
    .orderBy(asc(reminders.dueAt))
    .limit(20);
}

export async function cancelReminder(id: string, discordUserId: string) {
  const [cancelled] = await getDb()
    .update(reminders)
    .set({ status: "cancelled" })
    .where(
      and(eq(reminders.id, id), eq(reminders.discordUserId, discordUserId)),
    )
    .returning();
  return cancelled;
}

export async function markReminderDelivered(id: string) {
  await getDb()
    .update(reminders)
    .set({ status: "delivered", deliveredAt: new Date() })
    .where(eq(reminders.id, id));
}

export async function markReminderFailed(id: string) {
  await getDb()
    .update(reminders)
    .set({ status: "failed" })
    .where(eq(reminders.id, id));
}

export async function getDueReminders(now = new Date()) {
  return getDb()
    .select()
    .from(reminders)
    .where(
      and(eq(reminders.status, "scheduled"), lt(reminders.dueAt, now)),
    )
    .orderBy(asc(reminders.dueAt))
    .limit(50);
}

export async function createFocusSession(input: {
  discordUserId: string;
  guildId?: string | null;
  channelId: string;
  focusMinutes: number;
  breakMinutes: number;
  rounds: number;
}) {
  const [created] = await getDb().insert(focusSessions).values(input).returning();
  if (!created) throw new Error("Failed to create focus session");
  return created;
}

export async function setFocusWorkflowRun(id: string, runId: string) {
  await getDb()
    .update(focusSessions)
    .set({ workflowRunId: runId })
    .where(eq(focusSessions.id, id));
}

export async function getFocusSession(id: string) {
  return getDb().query.focusSessions.findFirst({
    where: eq(focusSessions.id, id),
  });
}

export async function getActiveFocusSession(discordUserId: string) {
  return getDb().query.focusSessions.findFirst({
    where: and(
      eq(focusSessions.discordUserId, discordUserId),
      eq(focusSessions.status, "running"),
    ),
    orderBy: desc(focusSessions.startedAt),
  });
}

export async function completeFocusRound(id: string, completedRounds: number) {
  await getDb()
    .update(focusSessions)
    .set({ completedRounds })
    .where(eq(focusSessions.id, id));
}

export async function finishFocusSession(id: string) {
  await getDb()
    .update(focusSessions)
    .set({ status: "completed", endedAt: new Date() })
    .where(eq(focusSessions.id, id));
}

export async function cancelFocusSession(id: string, discordUserId: string) {
  const [cancelled] = await getDb()
    .update(focusSessions)
    .set({ status: "cancelled", endedAt: new Date() })
    .where(
      and(
        eq(focusSessions.id, id),
        eq(focusSessions.discordUserId, discordUserId),
      ),
    )
    .returning();
  return cancelled;
}

export async function getModeScoreCounts(accountId: string) {
  return getDb()
    .select({ mode: scoreEvents.mode, value: count() })
    .from(scoreEvents)
    .where(eq(scoreEvents.accountId, accountId))
    .groupBy(scoreEvents.mode);
}

export async function getAccountsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return getDb().select().from(accounts).where(inArray(accounts.id, ids));
}

export async function pingDatabase() {
  const result = await getDb().execute(sql`select 1 as ok`);
  return databaseResultRows<{ ok: number }>(result)[0];
}

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

import { getDb } from "./index";
import {
  accountGuilds,
  accounts,
  dailySnapshots,
  focusSessions,
  guildSettings,
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
  const existingOsu = await db.query.accounts.findFirst({
    where: eq(accounts.osuUserId, input.user.id),
  });

  if (existingOsu && existingOsu.discordUserId !== input.discordUserId) {
    throw new Error("このosu!アカウントは別のDiscordユーザーに登録済みです。");
  }

  const [account] = await db
    .insert(accounts)
    .values({
      discordUserId: input.discordUserId,
      osuUserId: input.user.id,
      username: input.user.username,
      avatarUrl: input.user.avatar_url,
      countryCode: input.user.country_code,
      primaryMode: input.primaryMode,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: accounts.discordUserId,
      set: {
        osuUserId: input.user.id,
        username: input.user.username,
        avatarUrl: input.user.avatar_url,
        countryCode: input.user.country_code,
        primaryMode: input.primaryMode,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!account) throw new Error("アカウント登録に失敗しました。");

  if (input.guildId) {
    await ensureGuild(input.guildId);
    await db
      .insert(accountGuilds)
      .values({ accountId: account.id, guildId: input.guildId })
      .onConflictDoNothing();
  }

  return account;
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

export async function getAccountByDiscord(discordUserId: string) {
  return getDb().query.accounts.findFirst({
    where: eq(accounts.discordUserId, discordUserId),
  });
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

export async function unlinkAccount(discordUserId: string) {
  const [deleted] = await getDb()
    .delete(accounts)
    .where(eq(accounts.discordUserId, discordUserId))
    .returning({ id: accounts.id });
  return Boolean(deleted);
}

export async function setDailyDm(discordUserId: string, enabled: boolean) {
  const [updated] = await getDb()
    .update(accounts)
    .set({ dailyDmEnabled: enabled, updatedAt: new Date() })
    .where(eq(accounts.discordUserId, discordUserId))
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
  const [inserted] = await getDb()
    .insert(scoreEvents)
    .values(score)
    .onConflictDoNothing({ target: scoreEvents.osuScoreId })
    .returning();
  return inserted;
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

export async function getScoreEventForAccount(
  accountId: string,
  osuScoreId: string,
) {
  const [score] = await getDb()
    .select()
    .from(scoreEvents)
    .where(
      and(
        eq(scoreEvents.accountId, accountId),
        eq(scoreEvents.osuScoreId, osuScoreId),
      ),
    )
    .limit(1);
  return score;
}

export async function upsertDailySnapshot(
  snapshot: typeof dailySnapshots.$inferInsert,
) {
  const [saved] = await getDb()
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
        totalScore: snapshot.totalScore,
        rankedScore: snapshot.rankedScore,
        level: snapshot.level,
        updatedAt: new Date(),
      },
    })
    .returning();
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
  return result.rows[0];
}

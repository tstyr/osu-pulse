import {
  attachAccountToGuild,
  insertScoreEvent,
  linkAccount,
  listAccounts,
  markAccountManuallyTracked,
  updateAccountIdentity,
  updateScoreDifficultyAttributes,
  upsertAccount,
  upsertDailySnapshot,
} from "../db/repository";
import { analyzeAndMarkScore, listGoalsForAccount, markGoalAchieved } from "../db/feature-repository";
import type { Account, ScoreEvent } from "../db/schema";
import { sendDiscordDm } from "../lib/discord/rest";
import { getBeatmapDifficultyAttributes, getOsuUser, getRecentScores, OsuApiError, type OsuApiCredentials } from "../lib/osu/client";
import { MODE_LABELS, OSU_MODES, type OsuMode } from "../lib/osu/modes";
import { normalizeScore, snapshotFromUser } from "../lib/osu/normalize";
import { zonedDateKey } from "../lib/time";
import { enqueueScoreNotificationDeliveries, scoreNotificationCutoff } from "./score-notification-delivery";

async function captureSnapshot(account: Account, mode: OsuMode, apiCredentials?: OsuApiCredentials) {
  const user = await getOsuUser(account.osuUserId, mode, apiCredentials);
  await updateAccountIdentity(account.id, user);

  if (!user.statistics) return null;

  return upsertDailySnapshot(
    snapshotFromUser(
      account.id,
      mode,
      user,
      zonedDateKey(new Date(), account.timezone),
    ),
  );
}

export async function registerOsuAccount(input: {
  discordUserId: string;
  guildId?: string | null;
  username: string;
  primaryMode: OsuMode;
}) {
  const user = await getOsuUser(input.username, input.primaryMode);
  const account = await linkAccount({
    discordUserId: input.discordUserId,
    guildId: input.guildId,
    user,
    primaryMode: input.primaryMode,
  });

  if (input.guildId) {
    await attachAccountToGuild(account.id, input.guildId);
  }

  const initial = await collectInitialAccountData(account);

  return {
    account,
    ...initial,
  };
}

async function collectInitialAccountData(account: Account, apiCredentials?: OsuApiCredentials) {
  const snapshotResults = await Promise.allSettled(
    OSU_MODES.map((mode) => captureSnapshot(account, mode, apiCredentials)),
  );
  const scoreResults = await Promise.allSettled(
    OSU_MODES.map((mode) => importRecentScores(account, mode, false, apiCredentials)),
  );
  return {
    capturedModes: snapshotResults.filter(
      (result) => result.status === "fulfilled" && result.value,
    ).length,
    importedScores: scoreResults.reduce(
      (sum, result) => result.status === "fulfilled" ? sum + result.value.length : sum,
      0,
    ),
  };
}

export async function registerManuallyTrackedOsuAccount(input: {
  username: string;
  primaryMode: OsuMode;
  apiCredentials?: OsuApiCredentials;
}) {
  const user = await getOsuUser(input.username, input.primaryMode, input.apiCredentials);
  const account = await upsertAccount({ user, primaryMode: input.primaryMode });
  await markAccountManuallyTracked(account.id);
  const initial = await collectInitialAccountData(account, input.apiCredentials);
  return { account, ...initial };
}

export async function importRecentScores(
  account: Account,
  mode: OsuMode,
  onlyFresh: boolean,
  apiCredentials?: OsuApiCredentials,
) {
  const rawScores = await getRecentScores(account.osuUserId, mode, 50, apiCredentials);
  const normalized = rawScores
    .map((score) => normalizeScore(account.id, mode, score))
    .sort((left, right) => left.endedAt.getTime() - right.endedAt.getTime());

  const inserted: ScoreEvent[] = [];
  const notificationCutoff = scoreNotificationCutoff();

  for (const score of normalized) {
    let saved = await insertScoreEvent(score);
    if (!saved) continue;
    if (mode === "osu") {
      const difficulty = await getBeatmapDifficultyAttributes(score.beatmapId, mode, score.mods, apiCredentials).catch(() => null);
      if (difficulty) {
        saved = await updateScoreDifficultyAttributes(saved.id, {
          aimDifficulty: difficulty.attributes.aim_difficulty ?? null,
          speedDifficulty: difficulty.attributes.speed_difficulty ?? null,
        }) ?? saved;
      }
    }
    // Notification delivery is core ingestion work. Queue it before optional
    // analytics so a calculation failure cannot silently suppress Discord
    // score announcements after the score has already been persisted.
    const fresh = onlyFresh && saved.endedAt >= notificationCutoff;
    if (fresh) await enqueueScoreNotificationDeliveries(account, saved);

    const analyzed = await analyzeAndMarkScore(saved.id).catch((error) => {
      console.error(`[osu] score analysis failed: score=${saved.osuScoreId}`, error);
      return null;
    });
    // PB/anomaly rules need the computed values. Generic rules were queued
    // before analysis so they still work if analytics fails; the outbox's
    // score/channel uniqueness makes this second pass safe.
    if (fresh && analyzed) await enqueueScoreNotificationDeliveries(account, analyzed);
    inserted.push(analyzed ?? saved);
  }

  return inserted;
}

async function notifyAchievedGoals(
  account: Account,
  mode: OsuMode,
  snapshot: Awaited<ReturnType<typeof captureSnapshot>>,
) {
  if (!snapshot) return;
  const goals = await listGoalsForAccount(account.id, mode);
  for (const goal of goals) {
    if (goal.achievedAt) continue;
    const ppReached = goal.targetPp !== null && snapshot.pp >= goal.targetPp;
    const rankReached = goal.targetGlobalRank !== null && snapshot.globalRank !== null && snapshot.globalRank <= goal.targetGlobalRank;
    if (!ppReached && !rankReached) continue;
    await markGoalAchieved(goal.id);
    if (!goal.notificationsEnabled) continue;
    const achievements = [
      ppReached ? `${goal.targetPp!.toLocaleString()}pp` : null,
      rankReached ? `世界順位 #${goal.targetGlobalRank!.toLocaleString()}` : null,
    ].filter(Boolean).join(" / ");
    await sendDiscordDm(goal.discordUserId, {
      content: `🎯 **目標達成！** ${account.username} · ${MODE_LABELS[mode]}\n${achievements}`,
      allowed_mentions: { parse: [] },
    }).catch(() => undefined);
  }
}

export async function pollAccount(
  account: Account,
) {
  const results = await Promise.allSettled(
    OSU_MODES.map(async (mode) => {
      const snapshot = await captureSnapshot(account, mode);
      const scores = await importRecentScores(account, mode, true);
      await notifyAchievedGoals(account, mode, snapshot);
      return { mode, scores: scores.length };
    }),
  );

  return results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const reason = result.reason;
    const status = reason instanceof OsuApiError ? reason.status : undefined;
    return {
      mode: OSU_MODES[index],
      scores: 0,
      error: reason instanceof Error ? reason.message : String(reason),
      status,
    };
  });
}

export async function refreshAllAccounts() {
  const accounts = await listAccounts();
  const results = [];

  for (const account of accounts) {
    results.push({
      accountId: account.id,
      modes: await pollAccount(account),
    });
  }

  return results;
}

export async function refreshLiveAccounts(fullSync = false) {
  const accounts = await listAccounts();
  const results = [];

  for (const account of accounts) {
    if (fullSync) {
      results.push({
        accountId: account.id,
        modes: await pollAccount(account),
      });
      continue;
    }

    const scoreResults = await Promise.allSettled(
      OSU_MODES.map(async (mode) => ({
        mode,
        scores: (await importRecentScores(account, mode, true)).length,
      })),
    );
    results.push({
      accountId: account.id,
      modes: scoreResults.map((result, index) => {
        if (result.status === "fulfilled") return result.value;
        const error = result.reason;
        return {
          mode: OSU_MODES[index],
          scores: 0,
          error: error instanceof Error ? error.message : String(error),
          status: error instanceof OsuApiError ? error.status : undefined,
        };
      }),
    });
  }

  return results;
}

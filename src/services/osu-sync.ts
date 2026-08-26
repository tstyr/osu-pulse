import {
  attachAccountToGuild,
  getAnnouncementTargets,
  insertScoreEvent,
  linkAccount,
  listAccounts,
  updateAccountIdentity,
  upsertDailySnapshot,
} from "@/db/repository";
import type { Account, ScoreEvent } from "@/db/schema";
import { getOsuUser, getRecentScores, OsuApiError } from "@/lib/osu/client";
import { OSU_MODES, type OsuMode } from "@/lib/osu/modes";
import { normalizeScore, snapshotFromUser } from "@/lib/osu/normalize";
import { zonedDateKey } from "@/lib/time";

export type NewScoreCallback = (input: {
  account: Account;
  score: ScoreEvent;
  targets: Awaited<ReturnType<typeof getAnnouncementTargets>>;
}) => Promise<void>;

async function captureSnapshot(account: Account, mode: OsuMode) {
  const user = await getOsuUser(account.osuUserId, mode);
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

  const snapshotResults = await Promise.allSettled(
    OSU_MODES.map((mode) => captureSnapshot(account, mode)),
  );

  const scoreResults = await Promise.allSettled(
    OSU_MODES.map((mode) => importRecentScores(account, mode, false)),
  );

  return {
    account,
    capturedModes: snapshotResults.filter(
      (result) => result.status === "fulfilled" && result.value,
    ).length,
    importedScores: scoreResults.reduce(
      (sum, result) =>
        result.status === "fulfilled" ? sum + result.value.length : sum,
      0,
    ),
  };
}

export async function importRecentScores(
  account: Account,
  mode: OsuMode,
  onlyFresh: boolean,
  onNewScore?: NewScoreCallback,
) {
  const rawScores = await getRecentScores(account.osuUserId, mode, 50);
  const normalized = rawScores
    .map((score) => normalizeScore(account.id, mode, score))
    .sort((left, right) => left.endedAt.getTime() - right.endedAt.getTime());

  const inserted: ScoreEvent[] = [];
  const freshnessThreshold = Date.now() - 15 * 60_000;

  for (const score of normalized) {
    const saved = await insertScoreEvent(score);
    if (!saved) continue;
    inserted.push(saved);

    const shouldAnnounce =
      onlyFresh && saved.endedAt.getTime() >= freshnessThreshold && onNewScore;

    if (shouldAnnounce) {
      await onNewScore({
        account,
        score: saved,
        targets: await getAnnouncementTargets(account.id),
      });
    }
  }

  return inserted;
}

export async function pollAccount(
  account: Account,
  onNewScore?: NewScoreCallback,
) {
  const results = await Promise.allSettled(
    OSU_MODES.map(async (mode) => {
      const [scores] = await Promise.all([
        importRecentScores(account, mode, true, onNewScore),
        captureSnapshot(account, mode),
      ]);
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

export async function refreshAllAccounts(onNewScore?: NewScoreCallback) {
  const accounts = await listAccounts();
  const results = [];

  for (const account of accounts) {
    results.push({
      accountId: account.id,
      modes: await pollAccount(account, onNewScore),
    });
  }

  return results;
}

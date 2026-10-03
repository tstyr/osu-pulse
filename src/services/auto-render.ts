import { createHash, randomBytes } from "node:crypto";

import { and, asc, count, eq, inArray } from "drizzle-orm";

import { getDb } from "../db";
import {
  accounts,
  cloudRenderJobs,
  controlPanelSettings,
  discordAccountLinks,
  renderVideos,
  scoreEvents,
  type ScoreEvent,
} from "../db/schema";
import {
  autoRenderSettingsSchema,
  defaultAutoRenderSettings,
  type AutoRenderSettings,
} from "../lib/control/auto-render-settings";
import { getOsuUser } from "../lib/osu/client";
import { CLOUD_RENDER_STATUSES, TERMINAL_CLOUD_RENDER_STATUSES } from "../lib/render/constants";

const SETTINGS_ID = "primary";
const MAX_ACTIVE_CLOUD_JOBS = 4;
const ACTIVE_STATUSES = CLOUD_RENDER_STATUSES.filter(
  (status) => !TERMINAL_CLOUD_RENDER_STATUSES.has(status),
);

export function matchesAutoRenderScore(
  settings: AutoRenderSettings,
  score: Pick<ScoreEvent, "osuScoreId" | "mode" | "rank" | "pp" | "accuracy" | "passed">,
) {
  if (!score.passed || !/^\d{1,18}$/.test(score.osuScoreId)) return false;
  if (!Number.isSafeInteger(Number(score.osuScoreId))) return false;
  if (!settings.modes.includes(score.mode as "osu" | "mania")) return false;
  if (!settings.ranks.includes(score.rank as AutoRenderSettings["ranks"][number])) return false;
  if (settings.minimumPp > 0 && (score.pp == null || score.pp < settings.minimumPp)) return false;
  return score.accuracy * 100 >= settings.minimumAccuracy;
}

export function prioritizeAutoRenderScores<
  T extends Pick<ScoreEvent, "accountId" | "osuScoreId" | "endedAt">,
>(scores: T[], handledScoreIds: ReadonlySet<string>) {
  const handledByAccount = new Map<string, number>();
  for (const score of scores) {
    if (!handledScoreIds.has(score.osuScoreId)) continue;
    handledByAccount.set(score.accountId, (handledByAccount.get(score.accountId) ?? 0) + 1);
  }
  return scores.filter((score) => !handledScoreIds.has(score.osuScoreId)).sort((left, right) => (
    (handledByAccount.get(left.accountId) ?? 0) - (handledByAccount.get(right.accountId) ?? 0)
    || left.endedAt.getTime() - right.endedAt.getTime()
  ));
}

function scoreUrl(scoreId: string) {
  return `https://osu.ppy.sh/scores/${scoreId}`;
}

function sourceHash(scoreId: string) {
  return createHash("sha256").update(scoreUrl(scoreId)).digest("hex");
}

async function currentSettings() {
  const row = await getDb().query.controlPanelSettings.findFirst({
    where: eq(controlPanelSettings.id, SETTINGS_ID),
    columns: { values: true },
  });
  const parsed = autoRenderSettingsSchema.safeParse(row?.values?.autoRender);
  return parsed.success ? parsed.data : defaultAutoRenderSettings();
}

async function resolveTargetAccountIds(settings: AutoRenderSettings) {
  const db = getDb();
  const [linkedAccounts, directAccounts] = await Promise.all([
    settings.discordUserIds.length > 0
      ? db.select({ accountId: discordAccountLinks.accountId })
        .from(discordAccountLinks)
        .where(inArray(discordAccountLinks.discordUserId, settings.discordUserIds))
      : [],
    settings.osuUserIds.length > 0
      ? db.select({ id: accounts.id, osuUserId: accounts.osuUserId })
        .from(accounts)
        .where(inArray(accounts.osuUserId, settings.osuUserIds.map(Number)))
      : [],
  ]);
  const accountIds = new Set(linkedAccounts.map((row) => row.accountId));
  const existingOsuIds = new Set(directAccounts.map((row) => String(row.osuUserId)));
  directAccounts.forEach((row) => accountIds.add(row.id));

  for (const osuUserId of settings.osuUserIds) {
    if (existingOsuIds.has(osuUserId)) continue;
    try {
      const user = await getOsuUser(osuUserId, "osu");
      const [account] = await db.insert(accounts).values({
        osuUserId: user.id,
        username: user.username,
        countryCode: user.country_code,
        avatarUrl: user.avatar_url,
        primaryMode: user.playmode,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: accounts.osuUserId,
        set: {
          username: user.username,
          countryCode: user.country_code,
          avatarUrl: user.avatar_url,
          primaryMode: user.playmode,
          updatedAt: new Date(),
        },
      }).returning({ id: accounts.id });
      if (account) accountIds.add(account.id);
    } catch (error) {
      console.error(`[auto-render] osu! User ID ${osuUserId} could not be registered:`, error);
    }
  }

  return [...accountIds];
}

export async function enqueueEligibleAutoRenders() {
  const settings = await currentSettings();
  if (!settings.enabled) return { enabled: false, matched: 0, queued: 0, remaining: 0 };

  const db = getDb();
  const accountIds = await resolveTargetAccountIds(settings);
  if (accountIds.length === 0) return { enabled: true, matched: 0, queued: 0, remaining: 0 };

  const storedScores = await db
    .select()
    .from(scoreEvents)
    .where(and(
      inArray(scoreEvents.accountId, accountIds),
      eq(scoreEvents.passed, true),
      inArray(scoreEvents.mode, settings.modes),
      inArray(scoreEvents.rank, settings.ranks),
    ))
    .orderBy(asc(scoreEvents.endedAt));
  const matched = storedScores.filter((score) => (
    matchesAutoRenderScore(settings, score)
    && (!settings.personalBestOnly || score.isPersonalBest)
  ));
  if (matched.length === 0) return { enabled: true, matched: 0, queued: 0, remaining: 0 };

  const [existingJobs, existingVideos, active, targetAccounts] = await Promise.all([
    db.select({ sourceHash: cloudRenderJobs.sourceHash }).from(cloudRenderJobs),
    db.select({ scoreId: renderVideos.scoreId }).from(renderVideos),
    db.select({ value: count() }).from(cloudRenderJobs).where(inArray(cloudRenderJobs.status, ACTIVE_STATUSES)),
    db.select({ id: accounts.id, osuUserId: accounts.osuUserId, username: accounts.username })
      .from(accounts)
      .where(inArray(accounts.id, accountIds)),
  ]);
  const knownHashes = new Set(existingJobs.map((job) => job.sourceHash));
  const renderedScoreIds = new Set(existingVideos.flatMap((video) => video.scoreId == null ? [] : [String(video.scoreId)]));
  const handledScoreIds = new Set(matched.flatMap((score) => (
    knownHashes.has(sourceHash(score.osuScoreId)) || renderedScoreIds.has(score.osuScoreId)
      ? [score.osuScoreId]
      : []
  )));
  const pending = prioritizeAutoRenderScores(matched, handledScoreIds);
  const accountById = new Map(targetAccounts.map((account) => [account.id, account]));
  const capacity = Math.max(0, MAX_ACTIVE_CLOUD_JOBS - (active[0]?.value ?? 0));
  const batch = pending.slice(0, capacity);

  for (const score of batch) {
    const hash = sourceHash(score.osuScoreId);
    const account = accountById.get(score.accountId);
    await db.insert(cloudRenderJobs).values({
      accessTokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      inputType: "score_url",
      sourceHash: hash,
      scoreUrl: scoreUrl(score.osuScoreId),
      options: {
        resolution: settings.resolution,
        fps: settings.fps,
        speed: settings.speed,
        motionBlur: settings.motionBlur,
      },
      message: `自動レンダー待機中（判定 ${score.rank}）`,
      metadata: {
        request_source: "automatic",
        score_id: Number(score.osuScoreId),
        beatmap_id: score.beatmapId,
        beatmapset_id: score.beatmapsetId,
        artist: score.artist,
        title: score.title,
        difficulty: score.difficulty,
        mapper: score.mapper,
        ruleset: score.mode,
        user_id: account?.osuUserId,
        player_name: account?.username,
        mods: score.mods,
        pp: score.pp,
        rank: score.rank,
        accuracy: score.accuracy,
        max_combo: score.maxCombo,
        ended_at: score.endedAt.toISOString(),
      },
    });
    knownHashes.add(hash);
  }

  return {
    enabled: true,
    matched: matched.length,
    queued: batch.length,
    remaining: pending.length - batch.length,
  };
}

import type { OsuMode } from "./modes";
import type { OsuScore, OsuUser } from "./types";

export function normalizeMods(mods: OsuScore["mods"]): string[] {
  if (!mods) return [];
  return mods.map((mod) => (typeof mod === "string" ? mod : mod.acronym));
}

export function normalizeScore(
  accountId: string,
  mode: OsuMode,
  score: OsuScore,
) {
  const beatmapset = score.beatmapset;
  const endedAt = score.ended_at ?? score.created_at;

  if (!endedAt) {
    throw new Error(`Score ${score.id} has no timestamp`);
  }

  return {
    osuScoreId: String(score.id),
    accountId,
    mode,
    beatmapId: score.beatmap.id,
    beatmapsetId: score.beatmap.beatmapset_id ?? beatmapset?.id ?? null,
    artist: beatmapset?.artist ?? "Unknown artist",
    title: beatmapset?.title ?? `Beatmap #${score.beatmap.id}`,
    difficulty: score.beatmap.version,
    mapper: beatmapset?.creator ?? null,
    coverUrl:
      beatmapset?.covers?.["cover@2x"] ?? beatmapset?.covers?.cover ?? null,
    pp: score.pp,
    accuracy: score.accuracy,
    rank: score.rank,
    maxCombo: score.max_combo,
    score: String(score.total_score ?? score.score ?? 0),
    mods: normalizeMods(score.mods),
    passed: score.passed ?? score.rank !== "F",
    endedAt: new Date(endedAt),
  };
}

export function snapshotFromUser(
  accountId: string,
  mode: OsuMode,
  user: OsuUser,
  snapshotDate: string,
) {
  const statistics = user.statistics;
  if (!statistics) {
    throw new Error(`No ${mode} statistics are available for ${user.username}`);
  }

  return {
    accountId,
    mode,
    snapshotDate,
    globalRank: statistics.global_rank,
    countryRank: statistics.country_rank,
    pp: statistics.pp ?? 0,
    accuracy: statistics.hit_accuracy ?? 0,
    playCount: statistics.play_count ?? 0,
    totalScore: String(statistics.total_score ?? 0),
    rankedScore: String(statistics.ranked_score ?? 0),
    level:
      (statistics.level?.current ?? 0) +
      (statistics.level?.progress ?? 0) / 100,
    updatedAt: new Date(),
  };
}

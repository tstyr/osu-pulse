import "server-only";

import { cache } from "react";

import { getRecentSessions } from "@/db/feature-repository";
import { getAccountByOsuId, getFullGrowthHistory, getLatestSnapshots, getPlayerScoreHistory } from "@/db/repository";
import type { OsuMode } from "@/lib/osu/modes";

export const getPublicProfile = cache(async (osuUserId: number, mode: OsuMode) => {
  const account = await getAccountByOsuId(osuUserId);
  if (!account) return null;
  const [latestAll, growth, scores, sessions] = await Promise.all([
    getLatestSnapshots(account.id),
    getFullGrowthHistory(account.id, mode),
    getPlayerScoreHistory(account.id, mode),
    getRecentSessions(account.id, mode, 12),
  ]);
  const latest = latestAll.find((snapshot) => snapshot.mode === mode) ?? null;
  const snapshotRows = growth.map((snapshot) => ({
    date: snapshot.snapshotDate,
    globalRank: snapshot.globalRank,
    countryRank: snapshot.countryRank,
    pp: snapshot.pp,
    accuracy: snapshot.accuracy,
    playCount: snapshot.playCount,
    playTimeSeconds: snapshot.playTimeSeconds,
    totalScore: Number(snapshot.totalScore),
    rankedScore: Number(snapshot.rankedScore),
    level: snapshot.level,
  }));
  const scoreRows = scores.map((score) => ({
    id: score.id,
    osuScoreId: score.osuScoreId,
    beatmapId: score.beatmapId,
    artist: score.artist,
    title: score.title,
    difficulty: score.difficulty,
    mapper: score.mapper,
    coverUrl: score.coverUrl,
    pp: score.pp,
    starRating: score.starRating,
    aimDifficulty: score.aimDifficulty,
    speedDifficulty: score.speedDifficulty,
    bpm: score.bpm,
    beatmapLengthSeconds: score.beatmapLengthSeconds,
    ar: score.ar,
    od: score.od,
    cs: score.cs,
    accuracy: score.accuracy,
    rank: score.rank,
    maxCombo: score.maxCombo,
    score: score.score === null ? null : Number(score.score),
    mods: score.mods,
    passed: score.passed,
    isPersonalBest: score.isPersonalBest,
    endedAt: score.endedAt.toISOString(),
  }));
  return {
    account: {
      id: account.id,
      osuUserId: account.osuUserId,
      username: account.username,
      countryCode: account.countryCode,
      avatarUrl: account.avatarUrl,
      primaryMode: account.primaryMode,
      createdAt: account.createdAt.toISOString(),
    },
    mode,
    latest: latest ? {
      date: latest.snapshotDate,
      globalRank: latest.globalRank,
      countryRank: latest.countryRank,
      pp: latest.pp,
      accuracy: latest.accuracy,
      playCount: latest.playCount,
      playTimeSeconds: latest.playTimeSeconds,
      totalScore: Number(latest.totalScore),
      rankedScore: Number(latest.rankedScore),
      level: latest.level,
    } : null,
    snapshots: snapshotRows,
    scores: scoreRows,
    sessions: sessions.map((session) => ({
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt.toISOString(),
      plays: session.plays,
      averageAccuracy: session.averageAccuracy,
      averagePp: session.averagePp,
      personalBests: session.personalBests,
      misses: session.misses,
      best: session.best ? {
        osuScoreId: session.best.osuScoreId,
        title: session.best.title,
        pp: session.best.pp,
      } : null,
    })),
    generatedAt: new Date().toISOString(),
  };
});

export type PublicProfile = NonNullable<Awaited<ReturnType<typeof getPublicProfile>>>;

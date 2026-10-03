import "server-only";
import { cachedAsync } from "@/lib/async-cache";

import { asc, avg, count, desc, max, min } from "drizzle-orm";

import { getDb } from "@/db";
import { accountGuilds, accounts, dailySnapshots, profileSnapshots, scoreEvents, topPlaySnapshots } from "@/db/schema";
import { OSU_MODES, type OsuMode } from "@/lib/osu/modes";

export type StatisticsSnapshot = {
  date: string;
  globalRank: number | null;
  countryRank: number | null;
  pp: number;
  accuracy: number;
  playCount: number;
  playTimeSeconds: number | null;
  totalScore: number;
  rankedScore: number;
  level: number;
};

export type StatisticsScore = {
  id: string;
  osuScoreId: string;
  beatmapId: number;
  artist: string;
  title: string;
  difficulty: string;
  mapper: string | null;
  coverUrl: string | null;
  pp: number | null;
  starRating: number | null;
  aimDifficulty: number | null;
  speedDifficulty: number | null;
  bpm: number | null;
  beatmapLengthSeconds: number | null;
  ar: number | null;
  od: number | null;
  cs: number | null;
  accuracy: number;
  rank: string;
  maxCombo: number | null;
  score: string | null;
  mods: string[];
  passed: boolean;
  endedAt: string;
};

export type StatisticsModeSummary = {
  snapshotCount: number;
  dailySnapshotCount: number;
  scoreCount: number;
  averagePp: number | null;
  averageAccuracy: number | null;
  firstScoreAt: string | null;
  lastScoreAt: string | null;
  rankCounts: Record<string, number>;
};

export type StatisticsTopPlaySnapshot = {
  capturedAt: string;
  topLimit: number;
  topPpSum: number;
  scoreCount: number;
};

export type StatisticsModeData = {
  snapshots: StatisticsSnapshot[];
  scores: StatisticsScore[];
  topPlayHistory: StatisticsTopPlaySnapshot[];
  summary: StatisticsModeSummary;
};

export type StatisticsPlayer = {
  id: string;
  osuUserId: number;
  username: string;
  countryCode: string | null;
  avatarUrl: string | null;
  primaryMode: OsuMode;
  registeredAt: string;
  guildIds: string[];
  modes: Record<OsuMode, StatisticsModeData>;
};

export type PlayerStatisticsDataset = {
  generatedAt: string;
  players: StatisticsPlayer[];
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyModeData(): StatisticsModeData {
  return {
    snapshots: [],
    scores: [],
    topPlayHistory: [],
    summary: {
      snapshotCount: 0,
      dailySnapshotCount: 0,
      scoreCount: 0,
      averagePp: null,
      averageAccuracy: null,
      firstScoreAt: null,
      lastScoreAt: null,
      rankCounts: {},
    },
  };
}

async function buildPlayerStatisticsDataset(): Promise<PlayerStatisticsDataset> {
  const db = getDb();
  const [accountRows, guildRows, snapshotRows, profileSnapshotCountRows, scoreSummaryRows, rankRows, recentScoreRows, topPlayRows] = await Promise.all([
    db.select({
      id: accounts.id,
      osuUserId: accounts.osuUserId,
      username: accounts.username,
      countryCode: accounts.countryCode,
      avatarUrl: accounts.avatarUrl,
      primaryMode: accounts.primaryMode,
      createdAt: accounts.createdAt,
    }).from(accounts).orderBy(asc(accounts.username)),
    db.select({ accountId: accountGuilds.accountId, guildId: accountGuilds.guildId }).from(accountGuilds),
    db.select({
      accountId: dailySnapshots.accountId,
      mode: dailySnapshots.mode,
      date: dailySnapshots.snapshotDate,
      globalRank: dailySnapshots.globalRank,
      countryRank: dailySnapshots.countryRank,
      pp: dailySnapshots.pp,
      accuracy: dailySnapshots.accuracy,
      playCount: dailySnapshots.playCount,
      playTimeSeconds: dailySnapshots.playTimeSeconds,
      totalScore: dailySnapshots.totalScore,
      rankedScore: dailySnapshots.rankedScore,
      level: dailySnapshots.level,
    }).from(dailySnapshots).orderBy(asc(dailySnapshots.snapshotDate)),
    db.select({
      accountId: profileSnapshots.accountId,
      mode: profileSnapshots.mode,
      value: count(),
    }).from(profileSnapshots).groupBy(profileSnapshots.accountId, profileSnapshots.mode),
    db.select({
      accountId: scoreEvents.accountId,
      mode: scoreEvents.mode,
      scoreCount: count(),
      averagePp: avg(scoreEvents.pp),
      averageAccuracy: avg(scoreEvents.accuracy),
      firstScoreAt: min(scoreEvents.endedAt),
      lastScoreAt: max(scoreEvents.endedAt),
    }).from(scoreEvents).groupBy(scoreEvents.accountId, scoreEvents.mode),
    db.select({
      accountId: scoreEvents.accountId,
      mode: scoreEvents.mode,
      rank: scoreEvents.rank,
      value: count(),
    }).from(scoreEvents).groupBy(scoreEvents.accountId, scoreEvents.mode, scoreEvents.rank),
    db.select({
      id: scoreEvents.id,
      osuScoreId: scoreEvents.osuScoreId,
      accountId: scoreEvents.accountId,
      mode: scoreEvents.mode,
      beatmapId: scoreEvents.beatmapId,
      artist: scoreEvents.artist,
      title: scoreEvents.title,
      difficulty: scoreEvents.difficulty,
      mapper: scoreEvents.mapper,
      coverUrl: scoreEvents.coverUrl,
      pp: scoreEvents.pp,
      starRating: scoreEvents.starRating,
      aimDifficulty: scoreEvents.aimDifficulty,
      speedDifficulty: scoreEvents.speedDifficulty,
      bpm: scoreEvents.bpm,
      beatmapLengthSeconds: scoreEvents.beatmapLengthSeconds,
      ar: scoreEvents.ar,
      od: scoreEvents.od,
      cs: scoreEvents.cs,
      accuracy: scoreEvents.accuracy,
      rank: scoreEvents.rank,
      maxCombo: scoreEvents.maxCombo,
      score: scoreEvents.score,
      mods: scoreEvents.mods,
      passed: scoreEvents.passed,
      endedAt: scoreEvents.endedAt,
    }).from(scoreEvents).orderBy(desc(scoreEvents.endedAt)),
    db.select({
      accountId: topPlaySnapshots.accountId,
      mode: topPlaySnapshots.mode,
      capturedAt: topPlaySnapshots.capturedAt,
      topLimit: topPlaySnapshots.topLimit,
      topPpSum: topPlaySnapshots.topPpSum,
      scoreIds: topPlaySnapshots.scoreIds,
    }).from(topPlaySnapshots).orderBy(asc(topPlaySnapshots.capturedAt)),
  ]);

  const players = new Map<string, StatisticsPlayer>();
  for (const account of accountRows) {
    players.set(account.id, {
      id: account.id,
      osuUserId: account.osuUserId,
      username: account.username,
      countryCode: account.countryCode,
      avatarUrl: account.avatarUrl,
      primaryMode: account.primaryMode,
      registeredAt: account.createdAt.toISOString(),
      guildIds: [],
      modes: Object.fromEntries(OSU_MODES.map((mode) => [mode, emptyModeData()])) as Record<OsuMode, StatisticsModeData>,
    });
  }

  for (const row of guildRows) {
    const player = players.get(row.accountId);
    if (player && !player.guildIds.includes(row.guildId)) player.guildIds.push(row.guildId);
  }

  for (const row of snapshotRows) {
    const player = players.get(row.accountId);
    if (!player) continue;
    player.modes[row.mode].snapshots.push({
      date: row.date,
      globalRank: row.globalRank,
      countryRank: row.countryRank,
      pp: row.pp,
      accuracy: row.accuracy,
      playCount: row.playCount,
      playTimeSeconds: row.playTimeSeconds,
      totalScore: numberValue(row.totalScore),
      rankedScore: numberValue(row.rankedScore),
      level: row.level,
    });
  }

  for (const row of scoreSummaryRows) {
    const player = players.get(row.accountId);
    if (!player) continue;
    player.modes[row.mode].summary = {
      ...player.modes[row.mode].summary,
      scoreCount: row.scoreCount,
      averagePp: row.averagePp === null ? null : numberValue(row.averagePp),
      averageAccuracy: row.averageAccuracy === null ? null : numberValue(row.averageAccuracy),
      firstScoreAt: row.firstScoreAt?.toISOString() ?? null,
      lastScoreAt: row.lastScoreAt?.toISOString() ?? null,
    };
  }

  for (const row of rankRows) {
    const player = players.get(row.accountId);
    if (!player) continue;
    player.modes[row.mode].summary.rankCounts[row.rank] = row.value;
  }

  for (const row of recentScoreRows) {
    const player = players.get(row.accountId);
    if (!player) continue;
    player.modes[row.mode].scores.push({
      id: row.id,
      osuScoreId: row.osuScoreId,
      beatmapId: row.beatmapId,
      artist: row.artist,
      title: row.title,
      difficulty: row.difficulty,
      mapper: row.mapper,
      coverUrl: row.coverUrl,
      pp: row.pp,
      starRating: row.starRating,
      aimDifficulty: row.aimDifficulty,
      speedDifficulty: row.speedDifficulty,
      bpm: row.bpm,
      beatmapLengthSeconds: row.beatmapLengthSeconds,
      ar: row.ar,
      od: row.od,
      cs: row.cs,
      accuracy: row.accuracy,
      rank: row.rank,
      maxCombo: row.maxCombo,
      score: row.score,
      mods: row.mods,
      passed: row.passed,
      endedAt: row.endedAt.toISOString(),
    });
  }

  for (const row of topPlayRows) {
    const player = players.get(row.accountId);
    if (!player) continue;
    player.modes[row.mode].topPlayHistory.push({
      capturedAt: row.capturedAt.toISOString(),
      topLimit: row.topLimit,
      topPpSum: row.topPpSum,
      scoreCount: row.scoreIds.length,
    });
  }

  for (const player of players.values()) {
    for (const mode of OSU_MODES) {
      const dailyCount = player.modes[mode].snapshots.length;
      player.modes[mode].summary.dailySnapshotCount = dailyCount;
      player.modes[mode].summary.snapshotCount = dailyCount;
    }
  }

  for (const row of profileSnapshotCountRows) {
    const player = players.get(row.accountId);
    if (!player) continue;
    player.modes[row.mode].summary.snapshotCount = row.value;
  }

  return { generatedAt: new Date().toISOString(), players: [...players.values()] };
}

export const getPlayerStatisticsDataset = cachedAsync(buildPlayerStatisticsDataset, 15_000);

import type { OsuMode } from "@/lib/osu/modes";

export type PulseIndexScore = {
  pp: number | null;
  accuracy: number;
  rank: string;
  starRating: number | null;
  bpm: number | null;
  beatmapLengthSeconds: number | null;
  ar: number | null;
  od: number | null;
  cs: number | null;
  mods: string[];
};

export type PulseDatedScore = PulseIndexScore & { endedAt: string | Date };
export type PulseProfileSnapshot = { date: string; pp: number; globalRank: number | null };

export type PulseIndexBreakdown = {
  total: number;
  performance: number;
  execution: number;
  difficulty: number;
  modChallenge: number;
  coverage: number;
};

const GRADE_SCORE: Record<string, number> = {
  XH: 100,
  X: 100,
  SH: 94,
  S: 94,
  A: 80,
  B: 62,
  C: 42,
  D: 22,
  F: 5,
};

const PP_SCALE: Record<OsuMode, number> = {
  osu: 300,
  taiko: 260,
  fruits: 270,
  mania: 300,
};

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function saturation(value: number, scale: number) {
  return 100 * (1 - Math.exp(-Math.max(0, value) / scale));
}

function optional(value: number | null, fallback = 50) {
  return value === null || !Number.isFinite(value) ? fallback : value;
}

function modChallenge(mods: string[]) {
  const values: Record<string, number> = {
    DT: 100,
    NC: 100,
    HR: 82,
    FL: 88,
    HD: 55,
    RX: 20,
    AP: 20,
    EZ: 8,
    HT: 8,
  };
  const recognized = mods.flatMap((mod) => values[mod] === undefined ? [] : [values[mod]]);
  if (!recognized.length) return 35;
  return clamp(Math.max(...recognized) + Math.max(0, recognized.length - 1) * 4);
}

function difficultyIndex(score: PulseIndexScore, mode: OsuMode) {
  const stars = score.starRating === null ? null : clamp((score.starRating - 1) / 7 * 100);
  const od = score.od === null ? null : clamp(score.od * 10);
  const ar = score.ar === null ? null : clamp(score.ar * 10);
  const cs = score.cs === null ? null : mode === "mania"
    ? clamp((score.cs - 3) / 5 * 100)
    : clamp(score.cs * 10);
  const bpm = score.bpm === null ? null : clamp((score.bpm - 80) / 240 * 100);
  const length = score.beatmapLengthSeconds === null ? null : clamp(
    Math.log1p(score.beatmapLengthSeconds / 60) / Math.log(11) * 100,
  );

  const weighted = mode === "mania"
    ? [[stars, 0.45], [od, 0.18], [cs, 0.14], [bpm, 0.10], [length, 0.13]] as const
    : [[stars, 0.45], [od, 0.15], [ar, 0.12], [cs, 0.08], [bpm, 0.08], [length, 0.12]] as const;
  const available = weighted.filter(([value]) => value !== null);
  const weight = available.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  if (!weight) return 50;
  return available.reduce((sum, [value, itemWeight]) => sum + optional(value) * itemWeight, 0) / weight;
}

export function calculatePulseIndex(score: PulseIndexScore, mode: OsuMode): PulseIndexBreakdown {
  const performance = score.pp === null ? 0 : saturation(score.pp, PP_SCALE[mode]);
  const accuracyPercent = score.accuracy <= 1 ? score.accuracy * 100 : score.accuracy;
  const accuracy = clamp((accuracyPercent - 80) / 20 * 100);
  const grade = GRADE_SCORE[score.rank] ?? 0;
  const execution = accuracy * 0.72 + grade * 0.28;
  const difficulty = difficultyIndex(score, mode);
  const mods = modChallenge(score.mods);
  const tracked = [score.pp, score.starRating, score.bpm, score.beatmapLengthSeconds, score.od, score.cs];
  if (mode !== "mania") tracked.push(score.ar);
  const coverage = tracked.filter((value) => value !== null && Number.isFinite(value)).length / tracked.length * 100;
  const total = performance * 0.42 + execution * 0.28 + difficulty * 0.25 + mods * 0.05;

  return {
    total: clamp(total),
    performance,
    execution,
    difficulty,
    modChallenge: mods,
    coverage,
  };
}

export function calculateProfileStrength(pp: number | null, globalRank: number | null) {
  const ppStrength = pp === null ? 50 : saturation(pp, 7_000);
  const rankStrength = globalRank === null || globalRank <= 0
    ? 50
    : 100 / (1 + Math.pow(globalRank / 10_000, 0.35));
  return ppStrength * 0.65 + rankStrength * 0.35;
}

export function combineDailyPulseIndex(scoreIndex: number, profileStrength: number | null) {
  return clamp(profileStrength === null ? scoreIndex : scoreIndex * 0.82 + profileStrength * 0.18);
}

const DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function calculatePulseHistory(scores: PulseDatedScore[], snapshots: PulseProfileSnapshot[], mode: OsuMode) {
  const groups = new Map<string, PulseDatedScore[]>();
  for (const score of scores) {
    const date = DAY_FORMATTER.format(typeof score.endedAt === "string" ? new Date(score.endedAt) : score.endedAt);
    groups.set(date, [...(groups.get(date) ?? []), score]);
  }
  const sortedSnapshots = [...snapshots].sort((left, right) => left.date.localeCompare(right.date));
  const rows = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, items]) => {
    const ranked = items
      .map((score) => ({ score, index: calculatePulseIndex(score, mode) }))
      .sort((left, right) => right.index.total - left.index.total)
      .slice(0, 5);
    const average = (key: keyof PulseIndexBreakdown) => ranked.reduce((sum, item) => sum + item.index[key], 0) / ranked.length;
    const snapshot = sortedSnapshots.filter((item) => item.date <= date).at(-1) ?? null;
    const playIndex = average("total");
    const profileStrength = snapshot ? calculateProfileStrength(snapshot.pp, snapshot.globalRank) : null;
    return {
      date,
      pulseIndex: combineDailyPulseIndex(playIndex, profileStrength),
      playIndex,
      performance: average("performance"),
      execution: average("execution"),
      difficulty: average("difficulty"),
      modChallenge: average("modChallenge"),
      coverage: average("coverage"),
      profileStrength,
      totalPp: snapshot?.pp ?? null,
      globalRank: snapshot?.globalRank ?? null,
      plays: items.length,
    };
  });
  const baselineWindow = rows.slice(0, Math.min(7, rows.length));
  const baseline = baselineWindow.length ? baselineWindow.reduce((sum, row) => sum + row.pulseIndex, 0) / baselineWindow.length : null;
  return rows.map((row, index) => {
    const window = rows.slice(Math.max(0, index - 6), index + 1);
    const rollingIndex = window.reduce((sum, item) => sum + item.pulseIndex, 0) / window.length;
    return {
      ...row,
      rollingIndex,
      growthRate: baseline && baseline > 0 ? (rollingIndex / baseline - 1) * 100 : null,
    };
  });
}

import type { OsuMode } from "./modes";
import { calculatePulseIndex, type PulseIndexScore } from "./pulse-index";

export type SkillScore = PulseIndexScore & {
  aimDifficulty?: number | null;
  speedDifficulty?: number | null;
  maxCombo: number | null;
};

export type SkillProfile = {
  aim: number;
  speed: number;
  precision: number;
  reading: number;
  endurance: number;
  overall: number;
  exactAttributeCoverage: number;
};

const GRADE: Record<string, number> = { XH: 100, X: 100, SH: 94, S: 94, A: 80, B: 62, C: 42, D: 22, F: 5 };

function clamp(value: number) {
  return Math.min(100, Math.max(0, value));
}

function scaled(value: number | null | undefined, minimum: number, maximum: number, fallback = 50) {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return clamp((value - minimum) / (maximum - minimum) * 100);
}

function scoreSkills(score: SkillScore, mode: OsuMode) {
  const pulse = calculatePulseIndex(score, mode);
  const accuracyPercent = score.accuracy <= 1 ? score.accuracy * 100 : score.accuracy;
  const accuracy = scaled(accuracyPercent, 80, 100, 0);
  const grade = GRADE[score.rank] ?? 0;
  const combo = score.maxCombo === null ? 50 : 100 * (1 - Math.exp(-Math.max(0, score.maxCombo) / 700));
  const stars = scaled(score.starRating, 1, 8);
  const bpm = scaled(score.bpm, 90, 300);
  const length = score.beatmapLengthSeconds === null ? 50 : clamp(Math.log1p(score.beatmapLengthSeconds / 60) / Math.log(9) * 100);
  const ar = scaled(score.ar, 5, 10);
  const od = scaled(score.od, 5, 10);
  const keys = scaled(score.cs, 3, 8);
  const exactAim = score.aimDifficulty !== null && score.aimDifficulty !== undefined;
  const exactSpeed = score.speedDifficulty !== null && score.speedDifficulty !== undefined;
  const aimDemand = mode === "osu"
    ? exactAim ? scaled(score.aimDifficulty, 0.5, 6.5) : stars * 0.55 + scaled(score.cs, 2, 7) * 0.25 + ar * 0.20
    : keys * 0.48 + od * 0.27 + stars * 0.25;
  const speedDemand = mode === "osu" && exactSpeed
    ? scaled(score.speedDifficulty, 0.5, 6.5)
    : bpm * 0.48 + stars * 0.32 + od * 0.20;
  const hidden = score.mods.some((mod) => mod === "HD" || mod === "FL") ? 100 : 35;

  return {
    aim: clamp(aimDemand * 0.34 + pulse.execution * 0.32 + pulse.performance * 0.24 + combo * 0.10),
    speed: clamp(speedDemand * 0.38 + pulse.execution * 0.30 + pulse.performance * 0.22 + combo * 0.10),
    precision: clamp(accuracy * 0.55 + od * 0.25 + grade * 0.20),
    reading: clamp(stars * 0.30 + ar * 0.25 + hidden * 0.20 + accuracy * 0.25),
    endurance: clamp(length * 0.38 + bpm * 0.22 + stars * 0.20 + pulse.execution * 0.20),
    overall: pulse.total,
    exact: mode === "osu" && exactAim && exactSpeed,
  };
}

export function calculateSkillProfile(scores: SkillScore[], mode: OsuMode): SkillProfile | null {
  if (!scores.length) return null;
  const ranked = scores.map((score) => ({ score, pulse: calculatePulseIndex(score, mode) }))
    .sort((left, right) => right.pulse.total - left.pulse.total)
    .slice(0, 30)
    .map(({ score }) => scoreSkills(score, mode));
  const average = (key: "aim" | "speed" | "precision" | "reading" | "endurance" | "overall") => ranked.reduce((sum, row) => sum + row[key], 0) / ranked.length;
  return {
    aim: average("aim"),
    speed: average("speed"),
    precision: average("precision"),
    reading: average("reading"),
    endurance: average("endurance"),
    overall: average("overall"),
    exactAttributeCoverage: ranked.filter((row) => row.exact).length / ranked.length * 100,
  };
}

export function skillLabels(mode: OsuMode) {
  return {
    aim: mode === "osu" ? "Aim成果" : mode === "mania" ? "Key操作" : mode === "fruits" ? "Catch操作" : "打鍵操作",
    speed: mode === "mania" ? "速度対応" : "Speed成果",
    precision: "精密性",
    reading: "認識力",
    endurance: "持久力",
  } as const;
}

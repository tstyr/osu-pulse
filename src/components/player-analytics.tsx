"use client";

import {
  Activity,
  BarChart3,
  CalendarDays,
  Clock3,
  ExternalLink,
  Gauge,
  Search,
  Sparkles,
  Target,
  Trophy,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { formatCompactNumber, formatNumber, formatRank } from "@/lib/format";
import { MODE_ACCENTS, MODE_LABELS, OSU_MODES } from "@/lib/osu/modes";
import { calculatePulseHistory, calculatePulseIndex } from "@/lib/osu/pulse-index";
import type { PublicProfile } from "@/lib/public-profile";
import { PageScaleControls, useUiPreferences } from "@/components/control-panel/ui-preferences";
import { ComparisonLauncher, type ComparisonPlayerOption } from "@/components/comparison-launcher";
import { summarizeDailyScores } from "@/lib/control/score-analytics";

type RangeKey = "30d" | "90d" | "1y" | "all";
type GrowthMetric = "pp" | "rank" | "score" | "plays";
type ScatterMetric = "accuracy" | "date" | "hour" | "bpm" | "ar" | "od" | "cs" | "stars" | "length";
type ScatterYMetric = "pp" | "pulse" | "accuracy" | "score" | "combo" | "grade";
type ScatterRankFilter = "all" | "sPlus" | "aPlus" | "aOnly" | "passed" | "failed";
type EfficiencyMetric = "perStar" | "perMinute";
type PublicScore = PublicProfile["scores"][number];
type PlayerAnalyticsProfile = PublicProfile;
type PublicSnapshot = PublicProfile["snapshots"][number];
type ChartRange = "summary" | "dailyPp" | "dailyAccuracy" | "pulse" | "profile" | "score" | "growth" | "scatter" | "efficiency" | "activity" | "grade" | "mods" | "stars";

const RANGE_DAYS: Record<RangeKey, number | null> = { "30d": 30, "90d": 90, "1y": 365, all: null };
const RANGE_LABELS: Record<RangeKey, string> = { "30d": "30日", "90d": "90日", "1y": "1年", all: "全期間" };
const GRADE_COLORS: Record<string, string> = {
  XH: "#4fb7c5", X: "#e8b43a", SH: "#76c7ce", S: "#f0c54c", A: "#38a169", B: "#4b83db", C: "#9b6acb", D: "#e85d68", F: "#7b8493",
};
const GRADE_SHAPES: Record<string, "circle" | "cross" | "diamond" | "square" | "star" | "triangle" | "wye"> = {
  XH: "star", X: "diamond", SH: "star", S: "circle", A: "triangle", B: "square", C: "circle", D: "diamond", F: "cross",
};
const SCATTER_METRICS: Array<{ key: ScatterMetric; label: string }> = [
  { key: "accuracy", label: "精度" },
  { key: "date", label: "プレイ日" },
  { key: "hour", label: "1日の経過時刻" },
  { key: "bpm", label: "BPM" },
  { key: "ar", label: "AR" },
  { key: "od", label: "OD" },
  { key: "cs", label: "CS / Key数" },
  { key: "stars", label: "星数" },
  { key: "length", label: "曲の長さ" },
];
const SCATTER_Y_METRICS: Array<{ key: ScatterYMetric; label: string }> = [
  { key: "pp", label: "PP" },
  { key: "pulse", label: "Pulse Index" },
  { key: "accuracy", label: "精度" },
  { key: "score", label: "スコア" },
  { key: "combo", label: "コンボ" },
  { key: "grade", label: "判定" },
];
const GRADE_VALUES: Record<string, number> = { F: 0, D: 1, C: 2, B: 3, A: 4, S: 5, SH: 5.25, X: 6, XH: 6.25 };
const GRADE_TICKS: Record<number, string> = { 0: "F", 1: "D", 2: "C", 3: "B", 4: "A", 5: "S", 6: "X" };
const DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
const DATE_FORMATTER = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "short", day: "numeric" });
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const TIME_OF_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", minute: "2-digit", hourCycle: "h23" });
const ACTIVITY_FORMATTER = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", weekday: "short", hour: "numeric", hourCycle: "h23" });

function dayKey(value: string | Date) {
  return DAY_FORMATTER.format(typeof value === "string" ? new Date(value) : value);
}

function dateTime(value: string) {
  return DATE_TIME_FORMATTER.format(new Date(value));
}

function shortDate(value: string) {
  return DATE_FORMATTER.format(new Date(`${value}T00:00:00+09:00`));
}

function safeDelta(current: number | null | undefined, previous: number | null | undefined) {
  return current === null || current === undefined || previous === null || previous === undefined ? null : current - previous;
}

function signed(value: number | null, digits = 1, suffix = "") {
  if (value === null) return "—";
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${prefix}${formatNumber(Math.abs(value), digits)}${suffix}`;
}

function hours(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${formatNumber(value / 3_600, 1)}h`;
}

function scoreUrl(score: PublicScore) {
  return `https://osu.ppy.sh/scores/${score.osuScoreId}`;
}

function timeOfDay(value: string) {
  const parts = TIME_OF_DAY_FORMATTER.formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour + minute / 60;
}

function scatterValue(score: PublicScore, metric: ScatterMetric) {
  if (metric === "accuracy") return score.accuracy * 100;
  if (metric === "date") return new Date(score.endedAt).getTime();
  if (metric === "hour") return timeOfDay(score.endedAt);
  if (metric === "bpm") return score.bpm;
  if (metric === "ar") return score.ar;
  if (metric === "od") return score.od;
  if (metric === "cs") return score.cs;
  if (metric === "stars") return score.starRating;
  return score.beatmapLengthSeconds === null ? null : score.beatmapLengthSeconds / 60;
}

function formatScatterValue(value: number, metric: ScatterMetric) {
  if (metric === "accuracy") return `${formatNumber(value, 2)}%`;
  if (metric === "date") return DATE_FORMATTER.format(new Date(value));
  if (metric === "hour") {
    const hour = Math.floor(value);
    const minute = Math.round((value - hour) * 60);
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  if (metric === "bpm") return `${formatNumber(value, 0)} BPM`;
  if (metric === "stars") return `${formatNumber(value, 2)}★`;
  if (metric === "length") return `${Math.floor(value)}:${String(Math.round(value % 1 * 60)).padStart(2, "0")}`;
  return formatNumber(value, 1);
}

function scatterYValue(score: PublicScore, metric: ScatterYMetric, mode: PublicProfile["mode"]) {
  if (metric === "pp") return score.pp;
  if (metric === "pulse") return calculatePulseIndex(score, mode).total;
  if (metric === "accuracy") return score.accuracy * 100;
  if (metric === "score") return score.score;
  if (metric === "combo") return score.maxCombo;
  return GRADE_VALUES[score.rank] ?? null;
}

function formatScatterYValue(value: number, metric: ScatterYMetric) {
  if (metric === "pp") return `${formatNumber(value, 2)}pp`;
  if (metric === "pulse") return formatNumber(value, 2);
  if (metric === "accuracy") return `${formatNumber(value, 2)}%`;
  if (metric === "score") return formatCompactNumber(value);
  if (metric === "combo") return `${formatNumber(value, 0)}x`;
  return GRADE_TICKS[Math.round(value)] ?? "";
}

function matchesScatterRank(score: PublicScore, filter: ScatterRankFilter) {
  const failed = !score.passed || score.rank === "F";
  if (filter === "failed") return failed;
  if (filter === "passed") return !failed;
  if (filter === "aOnly") return score.rank === "A";
  if (filter === "aPlus") return ["A", "S", "SH", "X", "XH"].includes(score.rank);
  if (filter === "sPlus") return ["S", "SH", "X", "XH"].includes(score.rank);
  return true;
}

function quantile(values: number[], percentile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[lower + 1] === undefined ? 0 : fraction * (sorted[lower + 1] - sorted[lower]));
}

function withoutIqrOutliers<T extends { xValue: number; yValue: number }>(points: T[]) {
  if (points.length < 8) return points;
  const bounds = (values: number[]) => {
    const q1 = quantile(values, 0.25);
    const q3 = quantile(values, 0.75);
    const iqr = q3 - q1;
    return [q1 - iqr * 1.5, q3 + iqr * 1.5] as const;
  };
  const [xMin, xMax] = bounds(points.map((point) => point.xValue));
  const [yMin, yMax] = bounds(points.map((point) => point.yValue));
  return points.filter((point) => point.xValue >= xMin && point.xValue <= xMax && point.yValue >= yMin && point.yValue <= yMax);
}

function gradeClass(rank: string) {
  if (rank.startsWith("X")) return "bg-[#fff4ce] text-[#865b00]";
  if (rank.startsWith("S")) return "bg-[#fff7d8] text-[#7c6200]";
  if (rank === "A") return "bg-[#e6f6ee] text-[#17734c]";
  if (rank === "B") return "bg-[#eaf2ff] text-[#245ca8]";
  if (rank === "C") return "bg-[#f2eaff] text-[#6941a5]";
  return "bg-[#fdebed] text-[#a2323d]";
}

function PanelHeading({ title, description, icon: Icon, actions }: { title: string; description: string; icon?: typeof Activity; actions?: React.ReactNode }) {
  return <div className="flex flex-col items-start justify-between gap-3 border-b border-[#e2e6eb] px-4 py-4 sm:flex-row sm:px-5">
    <div><h2 className="text-sm font-semibold text-[#202733]">{title}</h2><p className="mt-1 text-[10px] leading-relaxed text-[#7d8795] sm:text-[11px]">{description}</p></div>
    <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}{Icon ? <Icon className="size-4 shrink-0 text-[#748096]" /> : null}</div>
  </div>;
}

function RangePicker({ value, onChange, compact = false }: { value: RangeKey; onChange: (value: RangeKey) => void; compact?: boolean }) {
  return <div className="flex gap-0.5 rounded-md border border-[#dce2e9] bg-[#f7f9fb] p-0.5" aria-label="表示期間">{(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => <button key={key} type="button" onClick={() => onChange(key)} aria-pressed={value === key} className={`rounded px-2 py-1.5 font-semibold transition ${compact ? "text-[8px]" : "text-[9px]"} ${value === key ? "bg-white text-[#0051c3] shadow-sm" : "text-[#748092] hover:text-[#344054]"}`}>{RANGE_LABELS[key]}</button>)}</div>;
}

function cutoffFor(range: RangeKey, latestTime: number) {
  const days = RANGE_DAYS[range];
  return days === null ? Number.NEGATIVE_INFINITY : latestTime - days * 86_400_000;
}

function scoresInRange(scores: PublicScore[], range: RangeKey, latestTime: number) {
  const cutoff = cutoffFor(range, latestTime);
  return scores.filter((item) => new Date(item.endedAt).getTime() >= cutoff);
}

function snapshotsInRange(snapshots: PublicSnapshot[], range: RangeKey, latestTime: number) {
  const cutoff = cutoffFor(range, latestTime);
  return snapshots.filter((item) => new Date(`${item.date}T23:59:59+09:00`).getTime() >= cutoff);
}

function aggregateDailyScores(scores: PublicScore[]) {
  return summarizeDailyScores(scores).map((row) => ({ ...row, label: shortDate(row.date) }));
}

function growthFromSnapshots(snapshots: PublicSnapshot[]) {
  return snapshots.map((item, index) => {
    const previous = snapshots[index - 1];
    return {
      ...item,
      label: shortDate(item.date),
      ppGain: previous ? item.pp - previous.pp : null,
      rankGain: previous && item.globalRank && previous.globalRank ? previous.globalRank - item.globalRank : null,
      scoreGain: previous ? item.totalScore - previous.totalScore : null,
      playGain: previous ? item.playCount - previous.playCount : null,
      playTimeGain: previous && item.playTimeSeconds !== null && previous.playTimeSeconds !== null ? item.playTimeSeconds - previous.playTimeSeconds : null,
      playTimeHours: item.playTimeSeconds === null ? null : item.playTimeSeconds / 3_600,
    };
  });
}

function EmptyChart({ text = "この期間のデータがありません" }: { text?: string }) {
  return <div className="grid h-full place-items-center px-5 text-center text-xs text-[#8a94a3]">{text}</div>;
}

export function PlayerAnalytics({ profile, comparisonPlayers }: { profile: PlayerAnalyticsProfile; comparisonPlayers: ComparisonPlayerOption[] }) {
  const { scale, wideMode } = useUiPreferences();
  const effectiveScale = wideMode ? 1 : scale;
  const [ranges, setRanges] = useState<Record<ChartRange, RangeKey>>({ summary: "90d", dailyPp: "90d", dailyAccuracy: "90d", pulse: "90d", profile: "90d", score: "90d", growth: "90d", scatter: "90d", efficiency: "90d", activity: "90d", grade: "90d", mods: "90d", stars: "90d" });
  const [growthMetric, setGrowthMetric] = useState<GrowthMetric>("pp");
  const [scatterMetric, setScatterMetric] = useState<ScatterMetric>("accuracy");
  const [scatterYMetric, setScatterYMetric] = useState<ScatterYMetric>("pp");
  const [scatterRankFilter, setScatterRankFilter] = useState<ScatterRankFilter>("all");
  const [excludeOutliers, setExcludeOutliers] = useState(false);
  const [efficiencyMetric, setEfficiencyMetric] = useState<EfficiencyMetric>("perStar");
  const [scoreSearch, setScoreSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [selectedScore, setSelectedScore] = useState<PublicScore | null>(null);
  const accent = MODE_ACCENTS[profile.mode];
  const scatterMetricLabel = SCATTER_METRICS.find((item) => item.key === scatterMetric)?.label ?? "精度";
  const scatterYMetricLabel = SCATTER_Y_METRICS.find((item) => item.key === scatterYMetric)?.label ?? "PP";
  const setRange = (chart: ChartRange, value: RangeKey) => setRanges((current) => ({ ...current, [chart]: value }));

  const latestTime = useMemo(() => {
    let latest = -Infinity;
    for (const snapshot of profile.snapshots) {
      const time = Date.parse(`${snapshot.date}T23:59:59+09:00`);
      if (Number.isFinite(time)) latest = Math.max(latest, time);
    }
    for (const score of profile.scores) {
      const time = Date.parse(score.endedAt);
      if (Number.isFinite(time)) latest = Math.max(latest, time);
    }
    return Number.isFinite(latest) ? latest : Date.parse(profile.generatedAt);
  }, [profile.generatedAt, profile.scores, profile.snapshots]);
  // All graphs share the four period slices, so opening a score detail does not rescan history.
  const rangeScores = useMemo(() => Object.fromEntries(
    (Object.keys(RANGE_DAYS) as RangeKey[]).map((range) => [range, scoresInRange(profile.scores, range, latestTime)]),
  ) as Record<RangeKey, PublicScore[]>, [profile.scores, latestTime]);
  const rangeSnapshots = useMemo(() => Object.fromEntries(
    (Object.keys(RANGE_DAYS) as RangeKey[]).map((range) => [range, snapshotsInRange(profile.snapshots, range, latestTime)]),
  ) as Record<RangeKey, PublicSnapshot[]>, [profile.snapshots, latestTime]);
  const scores = rangeScores[ranges.summary];
  const snapshots = rangeSnapshots[ranges.summary];
  const dailyPpScores = rangeScores[ranges.dailyPp];
  const dailyAccuracyScores = rangeScores[ranges.dailyAccuracy];
  const dailyPpData = useMemo(() => aggregateDailyScores(dailyPpScores), [dailyPpScores]);
  const dailyAccuracyData = useMemo(() => aggregateDailyScores(dailyAccuracyScores), [dailyAccuracyScores]);
  const pulseScores = rangeScores[ranges.pulse];
  const pulseHistory = useMemo(() => calculatePulseHistory(pulseScores, profile.snapshots, profile.mode).map((row) => ({ ...row, label: shortDate(row.date) })), [pulseScores, profile.snapshots, profile.mode]);
  const profileSnapshots = rangeSnapshots[ranges.profile];
  const profileGrowth = useMemo(() => growthFromSnapshots(profileSnapshots), [profileSnapshots]);
  const scoreSnapshots = rangeSnapshots[ranges.score];
  const scoreGrowth = useMemo(() => growthFromSnapshots(scoreSnapshots), [scoreSnapshots]);
  const growthSnapshots = rangeSnapshots[ranges.growth];
  const snapshotGrowth = useMemo(() => growthFromSnapshots(growthSnapshots), [growthSnapshots]);
  const scatterScores = rangeScores[ranges.scatter];
  const efficiencyScores = rangeScores[ranges.efficiency];
  const efficiencySnapshots = rangeSnapshots[ranges.efficiency];
  const activityScores = rangeScores[ranges.activity];
  const gradeScores = rangeScores[ranges.grade];
  const modScores = rangeScores[ranges.mods];
  const starScores = rangeScores[ranges.stars];

  const first = snapshots[0] ?? null;
  const last = snapshots.at(-1) ?? profile.latest;
  const deltas = {
    pp: safeDelta(last?.pp, first?.pp),
    rank: first?.globalRank && last?.globalRank ? first.globalRank - last.globalRank : null,
    score: safeDelta(last?.totalScore, first?.totalScore),
    plays: safeDelta(last?.playCount, first?.playCount),
    playTime: safeDelta(last?.playTimeSeconds, first?.playTimeSeconds),
  };

  const summary = useMemo(() => {
    const pp = scores.flatMap((item) => item.pp === null ? [] : [item.pp]);
    const accuracies = scores.map((item) => item.accuracy * 100);
    return {
      averagePp: pp.length ? pp.reduce((sum, value) => sum + value, 0) / pp.length : null,
      bestPp: pp.length ? pp.reduce((best, value) => Math.max(best, value), -Infinity) : null,
      averageAccuracy: accuracies.length ? accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length : null,
      activeDays: new Set(scores.map((item) => dayKey(item.endedAt))).size,
    };
  }, [scores]);
  const latestPulse = pulseHistory.at(-1) ?? null;
  const firstPulse = pulseHistory[0] ?? null;

  const gradeData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const score of gradeScores) counts.set(score.rank, (counts.get(score.rank) ?? 0) + 1);
    return ["XH", "X", "SH", "S", "A", "B", "C", "D", "F"].flatMap((rank) => counts.has(rank) ? [{ rank, count: counts.get(rank)! }] : []);
  }, [gradeScores]);

  const modData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const score of modScores) {
      const key = score.mods.length ? score.mods.join("") : "NM";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([mod, count]) => ({ mod, count }));
  }, [modScores]);

  const starData = useMemo(() => {
    const buckets = [0, 2, 3, 4, 5, 6, 7, 8, 20];
    return buckets.slice(0, -1).map((start, index) => {
      const end = buckets[index + 1];
      const items = starScores.filter((score) => score.starRating !== null && score.starRating >= start && score.starRating < end);
      const pp = items.flatMap((item) => item.pp === null ? [] : [item.pp]);
      return { band: end === 20 ? `${start}★+` : `${start}–${end}★`, plays: items.length, averagePp: pp.length ? pp.reduce((sum, value) => sum + value, 0) / pp.length : null };
    }).filter((item) => item.plays > 0);
  }, [starScores]);

  const rawScatterPoints = useMemo(() => scatterScores.flatMap((score) => {
    const xValue = scatterValue(score, scatterMetric);
    const yValue = scatterYValue(score, scatterYMetric, profile.mode);
    if (!matchesScatterRank(score, scatterRankFilter) || xValue === null || yValue === null || !Number.isFinite(xValue) || !Number.isFinite(yValue)) return [];
    return [{ ...score, xValue, yValue, markerSize: Math.max(1, score.starRating ?? 1) }];
  }), [scatterScores, scatterMetric, scatterYMetric, scatterRankFilter, profile.mode]);
  const visibleScatterPoints = useMemo(() => excludeOutliers ? withoutIqrOutliers(rawScatterPoints) : rawScatterPoints, [excludeOutliers, rawScatterPoints]);
  const hiddenOutlierCount = rawScatterPoints.length - visibleScatterPoints.length;
  const scatterGroups = useMemo(() => ["XH", "X", "SH", "S", "A", "B", "C", "D", "F"].map((rank) => ({
    rank,
    points: visibleScatterPoints.filter((score) => score.rank === rank),
  })).filter((group) => group.points.length), [visibleScatterPoints]);

  const efficiencyRows = useMemo(() => efficiencyScores.flatMap((score) => {
    if (score.pp === null) return [];
    const perStar = score.starRating && score.starRating > 0 ? score.pp / score.starRating : null;
    const perMinute = score.beatmapLengthSeconds && score.beatmapLengthSeconds > 0 ? score.pp / (score.beatmapLengthSeconds / 60) : null;
    if (perStar === null && perMinute === null) return [];
    return [{ score, perStar, perMinute }];
  }), [efficiencyScores]);
  const efficiencyLeaderboard = useMemo(() => [...efficiencyRows]
    .filter((row) => row[efficiencyMetric] !== null)
    .sort((left, right) => (right[efficiencyMetric] ?? 0) - (left[efficiencyMetric] ?? 0))
    .slice(0, 10), [efficiencyRows, efficiencyMetric]);
  const averageEfficiency = (metric: EfficiencyMetric) => {
    const values = efficiencyRows.flatMap((row) => row[metric] === null ? [] : [row[metric]!]);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const efficiencyPpGain = efficiencySnapshots.length > 1 ? efficiencySnapshots.at(-1)!.pp - efficiencySnapshots[0].pp : null;
  const ppGainPerStoredPlay = efficiencyPpGain === null || !efficiencyScores.length ? null : efficiencyPpGain / efficiencyScores.length;
  const lengthCoverage = efficiencyScores.length ? efficiencyScores.filter((score) => score.beatmapLengthSeconds !== null).length / efficiencyScores.length * 100 : null;

  const activity = useMemo(() => {
    const cells = Array.from({ length: 7 }, (_, weekday) => Array.from({ length: 6 }, (_, block) => ({ weekday, block, count: 0 })));
    for (const score of activityScores) {
      const parts = ACTIVITY_FORMATTER.formatToParts(new Date(score.endedAt));
      const weekdayName = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
      const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
      const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekdayName);
      if (weekday >= 0) cells[weekday][Math.min(5, Math.floor(hour / 4))].count += 1;
    }
    return cells;
  }, [activityScores]);
  const maxActivity = Math.max(1, ...activity.flat().map((item) => item.count));

  const filteredScoreRows = useMemo(() => profile.scores.filter((score) => {
    if (gradeFilter !== "all" && score.rank !== gradeFilter) return false;
    const haystack = `${score.artist} ${score.title} ${score.difficulty} ${score.mapper ?? ""} ${score.mods.join(" ")}`.toLowerCase();
    return haystack.includes(scoreSearch.trim().toLowerCase());
  }).slice(0, 100), [gradeFilter, profile.scores, scoreSearch]);

  const currentCards = [
    { label: "総PP", value: `${formatNumber(profile.latest?.pp, 2)}pp`, detail: `${RANGE_LABELS[ranges.summary]} ${signed(deltas.pp, 2, "pp")}`, icon: Trophy },
    { label: "世界順位", value: formatRank(profile.latest?.globalRank), detail: `${RANGE_LABELS[ranges.summary]} ${signed(deltas.rank, 0)}`, icon: Target },
    { label: "平均精度", value: profile.latest ? `${formatNumber(profile.latest.accuracy, 3)}%` : "—", detail: `保存リザルト ${summary.averageAccuracy === null ? "—" : `${formatNumber(summary.averageAccuracy, 2)}%`}`, icon: Gauge },
    { label: "総スコア", value: profile.latest ? formatCompactNumber(profile.latest.totalScore) : "—", detail: `${RANGE_LABELS[ranges.summary]} ${signed(deltas.score, 0)}`, icon: BarChart3 },
    { label: "プレイ回数", value: formatNumber(profile.latest?.playCount), detail: `${RANGE_LABELS[ranges.summary]} ${signed(deltas.plays, 0)}`, icon: Activity },
    { label: "プレイ時間", value: hours(profile.latest?.playTimeSeconds), detail: `${RANGE_LABELS[ranges.summary]} ${hours(deltas.playTime)}`, icon: Clock3 },
  ];

  const growthMetricConfig = {
    pp: { key: "ppGain", label: "PP増加", color: accent, formatter: (value: number) => `${signed(value, 2, "pp")}` },
    rank: { key: "rankGain", label: "順位上昇", color: "#15a36d", formatter: (value: number) => signed(value, 0) },
    score: { key: "scoreGain", label: "総スコア増加", color: "#2867c7", formatter: (value: number) => signed(value, 0) },
    plays: { key: "playGain", label: "プレイ回数増加", color: "#8b67d5", formatter: (value: number) => signed(value, 0) },
  }[growthMetric];

  const pageScaleStyle = {
    zoom: effectiveScale,
    width: `${100 / effectiveScale}%`,
    maxWidth: `${1500 / effectiveScale}px`,
    minHeight: `${100 / effectiveScale}vh`,
  } as CSSProperties;

  return <main style={pageScaleStyle} className="mx-auto min-h-screen px-3 py-5 sm:px-6 sm:py-8 xl:px-8">
    <header className="cp-panel overflow-hidden">
      <div className="bg-[radial-gradient(circle_at_82%_-40%,rgba(255,255,255,.22),transparent_34%),linear-gradient(125deg,#101827,#263a5b_62%,#f48120)] p-5 text-white sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {profile.account.avatarUrl ? <Image src={profile.account.avatarUrl} alt={`${profile.account.username} avatar`} width={112} height={112} priority className="size-24 rounded-2xl border-2 border-white/55 object-cover shadow-xl sm:size-28" /> : <div className="size-24 rounded-2xl bg-white/15 sm:size-28" />}
          <div className="min-w-0 flex-1"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/65">osu! Pulse · player intelligence</p><h1 className="mt-2 truncate text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{profile.account.username}</h1><p className="mt-2 text-sm text-white/70">{profile.account.countryCode ?? "—"} · {MODE_LABELS[profile.mode]} · 保存履歴を全件分析</p></div>
          <div className="flex flex-wrap items-center gap-2"><PageScaleControls inverse /><a href={`https://osu.ppy.sh/users/${profile.account.osuUserId}/${profile.mode}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/25 bg-white/10 px-4 text-xs font-semibold backdrop-blur transition hover:bg-white/20"><ExternalLink className="size-3.5" /> osu!プロフィール</a></div>
        </div>
      </div>
      <div className="border-t border-white/10 bg-white p-2">
        <nav className="flex gap-1 overflow-x-auto">{OSU_MODES.map((mode) => <Link key={mode} href={`/players/${profile.account.osuUserId}?mode=${mode}`} className={`shrink-0 rounded-md px-4 py-2 text-xs font-semibold transition ${mode === profile.mode ? "bg-[#eef4fc] text-[#0051c3]" : "text-[#657083] hover:bg-[#f5f7f9]"}`}>{MODE_LABELS[mode]}</Link>)}</nav>
      </div>
      <div className="border-t border-[#e2e6eb] bg-[#fbfcfd] px-3 py-3 sm:px-5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div className="shrink-0"><p className="text-[10px] font-semibold text-[#303947]">このプレイヤーとVS比較</p><p className="mt-0.5 text-[9px] text-[#8791a0]">相手を選ぶと現在の {MODE_LABELS[profile.mode]} で比較します</p></div>
          <div className="w-full lg:max-w-xl"><ComparisonLauncher players={comparisonPlayers} initialLeftOsuId={profile.account.osuUserId} initialMode={profile.mode} lockLeft compact /></div>
        </div>
      </div>
    </header>

    <div className="mt-4 flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7d8795]">現在値と期間差分</p><p className="mt-0.5 text-[9px] text-[#929aa6]">この期間は上の概要カードだけに反映</p></div><RangePicker value={ranges.summary} onChange={(value) => setRange("summary", value)} /></div>
    <section className="mt-4 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {currentCards.map(({ label, value, detail, icon: Icon }) => <article key={label} className="cp-panel min-w-0 p-4"><div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7d8795]">{label}</p><Icon className="size-4" style={{ color: accent }} /></div><p className="mt-3 truncate text-xl font-semibold tracking-tight text-[#202733]">{value}</p><p className="mt-1 truncate text-[10px] text-[#8b94a1]">{detail}</p></article>)}
    </section>

    <section className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {[
        ["保存リザルト", formatNumber(scores.length), `全期間 ${formatNumber(profile.scores.length)}件`],
        ["日次平均PP", summary.averagePp === null ? "—" : `${formatNumber(summary.averagePp, 2)}pp`, `最高 ${summary.bestPp === null ? "—" : `${formatNumber(summary.bestPp, 2)}pp`}`],
        ["活動日数", `${formatNumber(summary.activeDays)}日`, `${RANGE_LABELS[ranges.summary]}の記録`],
        ["DBカバー範囲", snapshots.length ? `${snapshots.length}日` : "—", snapshots.length ? `${snapshots[0].date} → ${snapshots.at(-1)!.date}` : "日次履歴なし"],
      ].map(([label, value, detail]) => <article key={label} className="rounded-lg border border-[#dce2e9] bg-[#fbfcfd] px-4 py-3"><p className="text-[10px] font-semibold text-[#788395]">{label}</p><p className="mt-1 text-base font-semibold text-[#26303d]">{value}</p><p className="mt-0.5 text-[9px] text-[#929aa6]">{detail}</p></article>)}
    </section>

    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <section className="cp-panel overflow-hidden"><PanelHeading title="毎日の平均PP" description="その日に保存した全リザルトの平均 · 点線は直近7活動日の移動平均" icon={Sparkles} actions={<RangePicker compact value={ranges.dailyPp} onChange={(value) => setRange("dailyPp", value)} />} /><div className="h-[310px] p-3 sm:p-5">{dailyPpData.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={dailyPpData} margin={{ left: 2, right: 12, top: 8, bottom: 2 }}><CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" minTickGap={24} tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: "#778294" }} tickFormatter={(value) => `${formatNumber(Number(value), 0)}pp`} width={56} tickLine={false} axisLine={false} /><Tooltip formatter={(value, name) => [`${formatNumber(Number(value), 2)}pp`, name]} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""} contentStyle={{ borderRadius: 8, fontSize: 11 }} /><Legend wrapperStyle={{ fontSize: 10 }} /><Bar dataKey="averagePp" name="日次平均PP" fill={accent} fillOpacity={0.34} radius={[3, 3, 0, 0]} isAnimationActive={false} /><Line type="monotone" dataKey="rollingPp" name="7活動日平均" stroke={accent} strokeWidth={2.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} /></ComposedChart></ResponsiveContainer> : <EmptyChart />}</div></section>

      <section className="cp-panel overflow-hidden"><PanelHeading title="毎日の平均精度" description="保存した各リザルトの平均精度 · 最良PPだけに偏らない安定性の指標" icon={Gauge} actions={<RangePicker compact value={ranges.dailyAccuracy} onChange={(value) => setRange("dailyAccuracy", value)} />} /><div className="h-[310px] p-3 sm:p-5">{dailyAccuracyData.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={dailyAccuracyData} margin={{ left: 2, right: 12, top: 8, bottom: 2 }}><CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" minTickGap={24} tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} /><YAxis domain={["dataMin - 1", 100]} tick={{ fontSize: 10, fill: "#778294" }} tickFormatter={(value) => `${formatNumber(Number(value), 1)}%`} width={56} tickLine={false} axisLine={false} /><Tooltip formatter={(value, name) => [`${formatNumber(Number(value), 3)}%`, name]} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""} contentStyle={{ borderRadius: 8, fontSize: 11 }} /><Legend wrapperStyle={{ fontSize: 10 }} /><Line type="monotone" dataKey="averageAccuracy" name="日次平均精度" stroke="#147bb8" strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="rollingAccuracy" name="7活動日平均" stroke="#55a8d8" strokeWidth={2.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} /></ComposedChart></ResponsiveContainer> : <EmptyChart />}</div></section>
    </div>

    <section className="cp-panel mt-5 overflow-hidden">
      <PanelHeading title="Pulse Index · 総合成長記録" description="PP・精度・判定・星数・BPM・AR・OD・CS/Key数・曲尺・MOD・総PP・世界順位を0–100へ統合" icon={Activity} actions={<RangePicker compact value={ranges.pulse} onChange={(value) => setRange("pulse", value)} />} />
      <div className="grid gap-0 xl:grid-cols-[1fr_260px]">
        <div className="h-[390px] border-b border-[#e2e6eb] p-3 sm:p-5 xl:border-b-0 xl:border-r">
          {pulseHistory.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={pulseHistory} margin={{ left: 0, right: 12, top: 16, bottom: 2 }}>
            <defs><linearGradient id={`pulse-fill-${profile.mode}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={accent} stopOpacity={0.28} /><stop offset="100%" stopColor={accent} stopOpacity={0.025} /></linearGradient></defs>
            <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" minTickGap={26} tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} />
            <YAxis domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tick={{ fontSize: 10, fill: "#778294" }} tickFormatter={(value) => `${value}`} width={38} tickLine={false} axisLine={false} />
            <Tooltip formatter={(value, name) => {
              if (name === "総合指数" || name === "7活動日平均") return [formatNumber(Number(value), 2), name];
              return [value, name];
            }} labelFormatter={(_, payload) => {
              const row = payload?.[0]?.payload as (typeof pulseHistory)[number] | undefined;
              if (!row) return "";
              const rank = row.globalRank ? ` · #${formatNumber(row.globalRank)}` : "";
              const pp = row.totalPp === null ? "" : ` · ${formatNumber(row.totalPp, 2)}pp`;
              return `${row.date} · ${row.plays} plays${pp}${rank}`;
            }} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="monotone" dataKey="pulseIndex" name="総合指数" stroke={accent} fill={`url(#pulse-fill-${profile.mode})`} strokeWidth={1.5} dot={{ r: 2, fill: "white", strokeWidth: 1.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="rollingIndex" name="7活動日平均" stroke="#202733" strokeWidth={2.8} dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart></ResponsiveContainer> : <EmptyChart text="総合指数を計算できる保存リザルトがありません" />}
        </div>
        <div className="grid grid-cols-2 gap-px bg-[#e5e9ee] xl:grid-cols-1">
          {[
            ["現在の総合指数", latestPulse ? formatNumber(latestPulse.rollingIndex, 2) : "—", "直近7活動日の平均"],
            ["期間内成長率", latestPulse?.growthRate === null || latestPulse?.growthRate === undefined ? "—" : signed(latestPulse.growthRate, 2, "%"), firstPulse ? `最初の${Math.min(7, pulseHistory.length)}活動日を基準` : "基準なし"],
            ["プレイ実力", latestPulse ? formatNumber(latestPulse.playIndex, 2) : "—", "当日の上位5プレイ"],
            ["譜面難度", latestPulse ? formatNumber(latestPulse.difficulty, 2) : "—", "★・BPM・各難易度値・曲尺"],
            ["実行品質", latestPulse ? formatNumber(latestPulse.execution, 2) : "—", "精度と判定ランク"],
            ["データ充足率", latestPulse ? `${formatNumber(latestPulse.coverage, 1)}%` : "—", "欠損項目は残りの項目で再配分"],
          ].map(([label, value, detail]) => <article key={label} className="bg-white p-4"><p className="text-[9px] font-semibold text-[#7d8795]">{label}</p><p className="mt-1 font-mono text-lg font-semibold text-[#202733]">{value}</p><p className="mt-0.5 text-[8px] leading-relaxed text-[#929aa6]">{detail}</p></article>)}
        </div>
      </div>
      <details className="group border-t border-[#e2e6eb] bg-[#fbfcfd] px-4 py-3 sm:px-5">
        <summary className="cursor-pointer list-none text-[10px] font-semibold text-[#536071]">計算式と重みを表示</summary>
        <div className="mt-3 grid gap-3 text-[9px] leading-5 text-[#687486] md:grid-cols-3">
          <div><p className="font-semibold text-[#303947]">プレイ指数</p><p>PP 42% + 実行品質 28% + 譜面難度 25% + MOD負荷 5%。PPはモード別の飽和曲線で正規化します。</p></div>
          <div><p className="font-semibold text-[#303947]">譜面難度</p><p>星数45%を中心に、OD・AR・CS（maniaはKey数）・BPM・曲の長さをモード別に配分。欠損項目の重みは自動再配分します。</p></div>
          <div><p className="font-semibold text-[#303947]">日次総合指数</p><p>当日の上位5プレイ平均82% + 総PPと世界順位のプロフィール強度18%。7活動日平均と、期間冒頭からの成長率を記録します。</p></div>
        </div>
        <p className="mt-3 text-[8px] text-[#929aa6]">Pulse Indexはosu!公式レーティングではなく、異なる側面の推移を一つにまとめるosu! Pulse独自指標です。</p>
      </details>
    </section>

    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <section className="cp-panel overflow-hidden"><PanelHeading title="総PPと順位" description="osu!プロフィールの日次スナップショット · 順位軸は上が良い" icon={Trophy} actions={<RangePicker compact value={ranges.profile} onChange={(value) => setRange("profile", value)} />} /><div className="h-[330px] p-3 sm:p-5">{profileSnapshots.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={profileGrowth} margin={{ left: 0, right: 0, top: 8, bottom: 2 }}><CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" minTickGap={28} tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} /><YAxis yAxisId="pp" tick={{ fontSize: 10, fill: "#778294" }} tickFormatter={(value) => `${formatCompactNumber(Number(value))}pp`} width={58} tickLine={false} axisLine={false} /><YAxis yAxisId="rank" orientation="right" reversed tick={{ fontSize: 10, fill: "#778294" }} tickFormatter={(value) => `#${formatCompactNumber(Number(value))}`} width={58} tickLine={false} axisLine={false} /><Tooltip formatter={(value, name) => [name === "世界順位" ? `#${formatNumber(Number(value))}` : `${formatNumber(Number(value), 2)}pp`, name]} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""} contentStyle={{ borderRadius: 8, fontSize: 11 }} /><Legend wrapperStyle={{ fontSize: 10 }} /><Line yAxisId="pp" type="monotone" dataKey="pp" name="総PP" stroke={accent} strokeWidth={2.8} dot={false} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} /><Line yAxisId="rank" type="monotone" dataKey="globalRank" name="世界順位" stroke="#34445a" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} /></ComposedChart></ResponsiveContainer> : <EmptyChart />}</div></section>

      <section className="cp-panel overflow-hidden"><PanelHeading title="総スコア・ランクスコア" description="累計値の推移 · ツールチップでは省略せず実数を表示" icon={BarChart3} actions={<RangePicker compact value={ranges.score} onChange={(value) => setRange("score", value)} />} /><div className="h-[330px] p-3 sm:p-5">{scoreSnapshots.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={scoreGrowth} margin={{ left: 0, right: 12, top: 8, bottom: 2 }}><defs><linearGradient id={`score-fill-${profile.mode}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2867c7" stopOpacity={0.24} /><stop offset="100%" stopColor="#2867c7" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" minTickGap={28} tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: "#778294" }} tickFormatter={(value) => formatCompactNumber(Number(value))} width={62} tickLine={false} axisLine={false} /><Tooltip formatter={(value, name) => [formatNumber(Number(value)), name]} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""} contentStyle={{ borderRadius: 8, fontSize: 11 }} /><Legend wrapperStyle={{ fontSize: 10 }} /><Area type="monotone" dataKey="totalScore" name="総スコア" stroke="#2867c7" fill={`url(#score-fill-${profile.mode})`} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="rankedScore" name="ランクスコア" stroke="#f48120" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} /></AreaChart></ResponsiveContainer> : <EmptyChart />}</div></section>
    </div>

    <section className="cp-panel mt-5 overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#e2e6eb] px-4 py-4 lg:flex-row lg:items-center lg:justify-between sm:px-5"><div><h2 className="text-sm font-semibold text-[#202733]">1日あたりの成長</h2><p className="mt-1 text-[10px] text-[#7d8795] sm:text-[11px]">前回のDBスナップショットとの差分を指標ごとに確認</p></div><div className="flex flex-wrap items-center gap-2"><div className="flex gap-1 overflow-x-auto">{(["pp", "rank", "score", "plays"] as GrowthMetric[]).map((metric) => <button key={metric} type="button" onClick={() => setGrowthMetric(metric)} className={`shrink-0 rounded-md px-3 py-2 text-[10px] font-semibold ${growthMetric === metric ? "bg-[#202733] text-white" : "bg-[#f2f4f7] text-[#667184]"}`}>{{ pp: "PP", rank: "順位", score: "総スコア", plays: "回数" }[metric]}</button>)}</div><RangePicker compact value={ranges.growth} onChange={(value) => setRange("growth", value)} /></div></div>
      <div className="h-[330px] p-3 sm:p-5">{snapshotGrowth.length > 1 ? <ResponsiveContainer width="100%" height="100%"><BarChart data={snapshotGrowth.slice(1)} margin={{ left: 2, right: 12, top: 12, bottom: 2 }}><CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" minTickGap={24} tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: "#778294" }} tickFormatter={(value) => growthMetric === "score" ? formatCompactNumber(Number(value)) : formatNumber(Number(value), growthMetric === "pp" ? 1 : 0)} width={64} tickLine={false} axisLine={false} /><ReferenceLine y={0} stroke="#9aa3af" /><Tooltip formatter={(value) => [growthMetricConfig.formatter(Number(value)), growthMetricConfig.label]} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""} contentStyle={{ borderRadius: 8, fontSize: 11 }} /><Bar dataKey={growthMetricConfig.key} name={growthMetricConfig.label} fill={growthMetricConfig.color} radius={[3, 3, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer> : <EmptyChart />}</div>
    </section>

    <div className="mt-5 flex flex-wrap items-end justify-between gap-2 px-1">
      <div>
        <h2 className="text-base font-semibold text-[#202733]">パフォーマンス推移</h2>
        <p className="mt-1 text-[10px] text-[#7d8795] sm:text-[11px]">保存リザルトを軸・判定・期間別に掘り下げて分析</p>
      </div>
      <span className="text-[9px] font-semibold text-[#8791a0]">表示中: {scatterYMetricLabel} × {scatterMetricLabel}</span>
    </div>

    <div className="mt-3 grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <section className="cp-panel overflow-hidden"><PanelHeading title={`${scatterYMetricLabel} × ${scatterMetricLabel}`} description={`判定別の色・図形で表示 · ${formatNumber(visibleScatterPoints.length)}件${hiddenOutlierCount ? `（外れ値 ${hiddenOutlierCount}件を非表示）` : ""} · 点を選ぶと詳細表示`} icon={Target} actions={<div className="flex max-w-full flex-wrap items-center gap-1.5"><label className="flex h-8 items-center gap-1 rounded-md border border-[#d5dce5] bg-white pl-2 text-[8px] font-semibold text-[#8a94a3]">横<select value={scatterMetric} onChange={(event) => setScatterMetric(event.target.value as ScatterMetric)} aria-label="分布の横軸" className="h-full max-w-28 bg-transparent pr-2 text-[9px] font-semibold text-[#4d5969] outline-none">{SCATTER_METRICS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label className="flex h-8 items-center gap-1 rounded-md border border-[#d5dce5] bg-white pl-2 text-[8px] font-semibold text-[#8a94a3]">縦<select value={scatterYMetric} onChange={(event) => setScatterYMetric(event.target.value as ScatterYMetric)} aria-label="分布の縦軸" className="h-full max-w-24 bg-transparent pr-2 text-[9px] font-semibold text-[#4d5969] outline-none">{SCATTER_Y_METRICS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><select value={scatterRankFilter} onChange={(event) => setScatterRankFilter(event.target.value as ScatterRankFilter)} aria-label="判定フィルター" className="h-8 rounded-md border border-[#d5dce5] bg-white px-2 text-[9px] font-semibold text-[#4d5969]"><option value="all">全判定</option><option value="sPlus">S以上</option><option value="aPlus">A以上</option><option value="aOnly">Aのみ</option><option value="passed">クリアのみ</option><option value="failed">Failedのみ</option></select><button type="button" onClick={() => setExcludeOutliers((current) => !current)} aria-pressed={excludeOutliers} className={`h-8 rounded-md border px-2 text-[9px] font-semibold transition ${excludeOutliers ? "border-[#8a62d3] bg-[#f2ecff] text-[#6941a5]" : "border-[#d5dce5] bg-white text-[#657083]"}`}>外れ値除外</button><RangePicker compact value={ranges.scatter} onChange={(value) => setRange("scatter", value)} /></div>} /><div className="h-[420px] p-3 sm:p-5">{scatterGroups.length ? <ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ left: 0, right: 14, top: 12, bottom: 4 }}><CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" /><XAxis type="number" dataKey="xValue" name={scatterMetricLabel} domain={scatterMetric === "hour" ? [0, 24] : scatterMetric === "accuracy" ? ["dataMin - 0.3", 100] : ["auto", "auto"]} tick={{ fontSize: 10 }} tickFormatter={(value) => formatScatterValue(Number(value), scatterMetric)} /><YAxis type="number" dataKey="yValue" name={scatterYMetricLabel} domain={scatterYMetric === "accuracy" ? ["dataMin - 0.3", 100] : scatterYMetric === "grade" ? [0, 6.5] : ["auto", "auto"]} ticks={scatterYMetric === "grade" ? [0, 1, 2, 3, 4, 5, 6] : undefined} tick={{ fontSize: 10 }} tickFormatter={(value) => formatScatterYValue(Number(value), scatterYMetric)} width={64} /><ZAxis type="number" dataKey="markerSize" range={[45, 180]} /><Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(value, name) => [name === scatterYMetricLabel ? formatScatterYValue(Number(value), scatterYMetric) : formatScatterValue(Number(value), scatterMetric), name]} contentStyle={{ borderRadius: 8, fontSize: 11 }} /><Legend wrapperStyle={{ fontSize: 9 }} />{scatterGroups.map((group) => <Scatter key={group.rank} name={`${group.rank} (${group.points.length})`} data={group.points} fill={GRADE_COLORS[group.rank] ?? accent} fillOpacity={0.72} shape={GRADE_SHAPES[group.rank] ?? "circle"} legendType={GRADE_SHAPES[group.rank] ?? "circle"} onClick={(point) => { const score = (point as unknown as { payload?: PublicScore }).payload; if (score) setSelectedScore(score); }} isAnimationActive={false} />)}</ScatterChart></ResponsiveContainer> : <EmptyChart text={scatterMetric === "length" ? "曲の長さが保存されたリザルトがありません" : "この条件で表示できるデータがありません"} />}</div></section>

      <section className="cp-panel overflow-hidden"><PanelHeading title="活動ヒートマップ" description="曜日 × 4時間帯 · JST · 濃いほど保存プレイが多い" icon={CalendarDays} actions={<RangePicker compact value={ranges.activity} onChange={(value) => setRange("activity", value)} />} /><div className="p-4 sm:p-5"><div className="grid grid-cols-[36px_repeat(6,minmax(36px,1fr))] gap-1.5 text-center text-[9px] text-[#7c8796]"><span />{["0–4", "4–8", "8–12", "12–16", "16–20", "20–24"].map((label) => <span key={label}>{label}</span>)}{activity.map((row, weekday) => <div key={weekday} className="contents"><span className="grid place-items-center font-semibold">{["月", "火", "水", "木", "金", "土", "日"][weekday]}</span>{row.map((cell) => <div key={cell.block} title={`${["月", "火", "水", "木", "金", "土", "日"][weekday]} ${cell.block * 4}:00–${cell.block * 4 + 4}:00 · ${cell.count} plays`} className="grid aspect-[1.35] min-h-9 place-items-center rounded-md border border-[#dfe5eb] text-[10px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${accent} ${Math.max(5, cell.count / maxActivity * 82)}%, white)`, color: cell.count / maxActivity > 0.55 ? "white" : "#4d5969" }}>{cell.count || "·"}</div>)}</div>)}</div><div className="mt-5 grid grid-cols-2 gap-2">{[["最多時間帯", (() => { const best = activity.flat().sort((a, b) => b.count - a.count)[0]; return best ? `${best.block * 4}:00–${best.block * 4 + 4}:00` : "—"; })()], ["期間内プレイ", `${formatNumber(activityScores.length)}件`], ["活動日", `${formatNumber(new Set(activityScores.map((score) => dayKey(score.endedAt))).size)}日`], ["1活動日平均", (() => { const days = new Set(activityScores.map((score) => dayKey(score.endedAt))).size; return days ? `${formatNumber(activityScores.length / days, 1)}回` : "—"; })()]].map(([label, value]) => <div key={label} className="rounded-md bg-[#f5f7fa] p-3"><p className="text-[9px] text-[#8490a0]">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>)}</div></div></section>
    </div>

    <section className="cp-panel mt-5 overflow-hidden">
      <PanelHeading title="PP効率分析" description="難易度・曲尺に対するPP効率と、DB保存プレイあたりのプロフィールPP増加" icon={Sparkles} actions={<div className="flex flex-wrap items-center gap-2"><div className="flex rounded-md border border-[#dce2e9] bg-[#f7f9fb] p-0.5">{(["perStar", "perMinute"] as EfficiencyMetric[]).map((metric) => <button key={metric} type="button" onClick={() => setEfficiencyMetric(metric)} className={`rounded px-2.5 py-1.5 text-[9px] font-semibold ${efficiencyMetric === metric ? "bg-white text-[#0051c3] shadow-sm" : "text-[#748092]"}`}>{metric === "perStar" ? "PP/★順" : "PP/分順"}</button>)}</div><RangePicker compact value={ranges.efficiency} onChange={(value) => setRange("efficiency", value)} /></div>} />
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[.7fr_1.3fr]">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">{[
          ["平均 PP / ★", averageEfficiency("perStar") === null ? "—" : formatNumber(averageEfficiency("perStar"), 2), "星数がある保存リザルト"],
          ["平均 PP / 分", averageEfficiency("perMinute") === null ? "—" : formatNumber(averageEfficiency("perMinute"), 2), "曲尺がある保存リザルト"],
          ["PP増加 / 保存プレイ", ppGainPerStoredPlay === null ? "—" : signed(ppGainPerStoredPlay, 3, "pp"), efficiencyPpGain === null ? "日次履歴が不足" : `期間内PP差 ${signed(efficiencyPpGain, 2, "pp")}`],
          ["曲尺データ充足率", lengthCoverage === null ? "—" : `${formatNumber(lengthCoverage, 1)}%`, `${efficiencyScores.filter((score) => score.beatmapLengthSeconds !== null).length}/${efficiencyScores.length}件`],
        ].map(([label, value, detail]) => <article key={label} className="rounded-lg border border-[#dce2e9] bg-[#fbfcfd] p-3"><p className="text-[9px] font-semibold text-[#788395]">{label}</p><p className="mt-1 text-lg font-semibold text-[#26303d]">{value}</p><p className="mt-0.5 text-[8px] text-[#929aa6]">{detail}</p></article>)}</div>
        <div className="overflow-hidden rounded-lg border border-[#dce2e9]"><div className="border-b border-[#e6eaf0] bg-[#fafbfc] px-4 py-3"><p className="text-[10px] font-semibold text-[#536071]">効率上位譜面</p><p className="mt-0.5 text-[8px] text-[#9099a6]">行を選ぶと右下にScore詳細を表示</p></div><div className="max-h-[360px] overflow-auto"><table className="w-full min-w-[650px] text-left text-[10px]"><thead className="sticky top-0 z-10 bg-white text-[8px] uppercase tracking-[0.05em] text-[#7d8795]"><tr><th className="px-4 py-2.5">Beatmap</th><th className="px-3 py-2.5 text-right">PP</th><th className="px-3 py-2.5 text-right">★</th><th className="px-3 py-2.5 text-right">長さ</th><th className="px-3 py-2.5 text-right">PP/★</th><th className="px-4 py-2.5 text-right">PP/分</th></tr></thead><tbody className="divide-y divide-[#edf0f3]">{efficiencyLeaderboard.map(({ score, perStar, perMinute }, index) => <tr key={`${score.id}-${index}`} onClick={() => setSelectedScore(score)} className="cursor-pointer transition hover:bg-[#f5f8fc]"><td className="max-w-[320px] px-4 py-3"><p className="truncate font-semibold text-[#26303d]">{index + 1}. {score.title} [{score.difficulty}]</p><p className="mt-0.5 truncate text-[8px] text-[#8993a1]">{score.artist} · {score.rank} · {score.mods.length ? `+${score.mods.join("")}` : "NM"}</p></td><td className="px-3 py-3 text-right font-mono">{score.pp === null ? "—" : formatNumber(score.pp, 2)}</td><td className="px-3 py-3 text-right font-mono">{score.starRating === null ? "—" : formatNumber(score.starRating, 2)}</td><td className="px-3 py-3 text-right font-mono">{score.beatmapLengthSeconds === null ? "—" : `${Math.floor(score.beatmapLengthSeconds / 60)}:${String(score.beatmapLengthSeconds % 60).padStart(2, "0")}`}</td><td className={`px-3 py-3 text-right font-mono font-semibold ${efficiencyMetric === "perStar" ? "text-[#0051c3]" : ""}`}>{perStar === null ? "—" : formatNumber(perStar, 2)}</td><td className={`px-4 py-3 text-right font-mono font-semibold ${efficiencyMetric === "perMinute" ? "text-[#0051c3]" : ""}`}>{perMinute === null ? "—" : formatNumber(perMinute, 2)}</td></tr>)}{!efficiencyLeaderboard.length ? <tr><td colSpan={6} className="px-5 py-12 text-center text-[#8a94a3]">この期間は効率を算出できるデータがありません。</td></tr> : null}</tbody></table></div></div>
      </div>
    </section>

    <section className="mt-5 grid gap-5 lg:grid-cols-3">
      <div className="cp-panel overflow-hidden"><PanelHeading title="判定ランク分布" description="保存リザルトの内訳" actions={<RangePicker compact value={ranges.grade} onChange={(value) => setRange("grade", value)} />} /><div className="h-64 p-4">{gradeData.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={gradeData}><CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="rank" tick={{ fontSize: 10 }} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} /><Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} /><Bar dataKey="count" name="プレイ数" radius={[4, 4, 0, 0]} isAnimationActive={false}>{gradeData.map((entry) => <Cell key={entry.rank} fill={GRADE_COLORS[entry.rank] ?? "#8792a2"} />)}</Bar></BarChart></ResponsiveContainer> : <EmptyChart />}</div></div>
      <div className="cp-panel overflow-hidden"><PanelHeading title="使用MOD" description="組み合わせ別 上位10件" actions={<RangePicker compact value={ranges.mods} onChange={(value) => setRange("mods", value)} />} /><div className="h-64 p-4">{modData.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={modData} layout="vertical" margin={{ left: 8, right: 10 }}><CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 9 }} /><YAxis type="category" dataKey="mod" width={58} tick={{ fontSize: 9 }} tickLine={false} /><Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} /><Bar dataKey="count" name="プレイ数" fill="#596f91" radius={[0, 4, 4, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer> : <EmptyChart />}</div></div>
      <div className="cp-panel overflow-hidden"><PanelHeading title="難易度帯" description="星数帯ごとの回数と平均PP" actions={<RangePicker compact value={ranges.stars} onChange={(value) => setRange("stars", value)} />} /><div className="h-64 p-4">{starData.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={starData}><CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="band" tick={{ fontSize: 9 }} tickLine={false} /><YAxis yAxisId="plays" allowDecimals={false} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} /><YAxis yAxisId="pp" orientation="right" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} /><Tooltip formatter={(value, name) => [name === "平均PP" ? `${formatNumber(Number(value), 2)}pp` : formatNumber(Number(value)), name]} contentStyle={{ borderRadius: 8, fontSize: 11 }} /><Bar yAxisId="plays" dataKey="plays" name="プレイ数" fill={accent} fillOpacity={0.42} radius={[3, 3, 0, 0]} isAnimationActive={false} /><Line yAxisId="pp" type="monotone" dataKey="averagePp" name="平均PP" stroke="#202733" strokeWidth={2.2} dot={{ r: 3 }} connectNulls isAnimationActive={false} /></ComposedChart></ResponsiveContainer> : <EmptyChart />}</div></div>
    </section>

    <div className="mt-5 grid gap-5 xl:grid-cols-[.72fr_1.28fr]">
      <section className="cp-panel overflow-hidden"><PanelHeading title="最近のセッション" description="45分以上の空白で区切った直近12セッション" icon={Clock3} /><div className="max-h-[480px] divide-y divide-[#e8ebef] overflow-y-auto">{profile.sessions.map((session) => <a key={session.startedAt} href={session.best ? `https://osu.ppy.sh/scores/${session.best.osuScoreId}` : undefined} target="_blank" rel="noreferrer" className="block p-4 transition hover:bg-[#fafbfc]"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold">{dateTime(session.startedAt)}</p><span className="rounded bg-[#f1f4f8] px-2 py-1 font-mono text-[9px]">{session.plays} plays</span></div><div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-[#6e7989]"><span>{session.averagePp === null ? "—" : `${formatNumber(session.averagePp, 1)}pp`} avg</span><span>{formatNumber(session.averageAccuracy * 100, 2)}%</span><span>PB {session.personalBests}件</span></div>{session.best ? <p className="mt-2 truncate text-[10px] text-[#8b94a1]">Best: {session.best.title} · {session.best.pp === null ? "—" : `${formatNumber(session.best.pp, 1)}pp`}</p> : null}</a>)}{!profile.sessions.length ? <p className="p-8 text-center text-xs text-[#8b94a1]">セッションデータがありません。</p> : null}</div></section>

      <section className="cp-panel overflow-hidden"><div className="border-b border-[#e2e6eb] px-4 py-4 sm:px-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="text-sm font-semibold text-[#202733]">保存リザルト検索</h2><p className="mt-1 text-[10px] text-[#7d8795]">全{formatNumber(profile.scores.length)}件から検索 · 表示は上位100件</p></div><div className="flex flex-col gap-2 sm:flex-row"><label className="relative"><Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#8691a0]" /><input value={scoreSearch} onChange={(event) => setScoreSearch(event.target.value)} placeholder="曲名・譜面・MOD" className="h-9 w-full rounded-md border border-[#cfd6df] bg-white pl-9 pr-3 text-xs sm:w-52" /></label><select value={gradeFilter} onChange={(event) => setGradeFilter(event.target.value)} className="h-9 rounded-md border border-[#cfd6df] bg-white px-3 text-xs"><option value="all">全判定</option>{["XH", "X", "SH", "S", "A", "B", "C", "D", "F"].map((rank) => <option key={rank} value={rank}>{rank}</option>)}</select></div></div></div><div className="max-h-[480px] overflow-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 z-10 bg-[#fafbfc] text-[9px] uppercase tracking-[0.06em] text-[#7d8795]"><tr><th className="px-4 py-3">Beatmap</th><th className="px-3 py-3 text-center">Rank</th><th className="px-3 py-3">Mods</th><th className="px-3 py-3 text-right">PP</th><th className="px-3 py-3 text-right">Accuracy</th><th className="px-4 py-3 text-right">Played</th></tr></thead><tbody className="divide-y divide-[#e8ebef]">{filteredScoreRows.map((score) => <tr key={score.id} className="hover:bg-[#fbfcfd]"><td className="max-w-[340px] px-4 py-3"><a href={scoreUrl(score)} target="_blank" rel="noreferrer" className="block truncate font-medium text-[#26303d] hover:text-[#0051c3] hover:underline">{score.artist} — {score.title} [{score.difficulty}]</a><p className="mt-1 truncate text-[9px] text-[#8a94a3]">{score.starRating === null ? "—" : `${formatNumber(score.starRating, 2)}★`} · {score.bpm === null ? "—" : `${formatNumber(score.bpm)} BPM`} · {score.maxCombo ? `${formatNumber(score.maxCombo)}x` : "—"}</p></td><td className="px-3 py-3 text-center"><span className={`inline-flex min-w-8 justify-center rounded px-2 py-1 font-mono text-[10px] font-semibold ${gradeClass(score.rank)}`}>{score.rank}</span></td><td className="px-3 py-3 font-mono text-[10px] text-[#596477]">{score.mods.length ? `+${score.mods.join("")}` : "NM"}</td><td className="px-3 py-3 text-right font-mono font-semibold">{score.pp === null ? "—" : formatNumber(score.pp, 2)}</td><td className="px-3 py-3 text-right font-mono">{formatNumber(score.accuracy * 100, 2)}%</td><td className="px-4 py-3 text-right text-[10px] text-[#6c7788]">{dateTime(score.endedAt)}</td></tr>)}{!filteredScoreRows.length ? <tr><td colSpan={6} className="px-5 py-14 text-center text-[#8a94a3]">条件に一致するリザルトがありません。</td></tr> : null}</tbody></table></div></section>
    </div>

    <footer className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-[#dfe4ea] py-5 text-[9px] text-[#929aa6] sm:flex-row"><span>DB保存データから算出。未収集期間はグラフに含まれません。</span><span className="font-mono">Updated {new Date(profile.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} · osu! Pulse</span></footer>

    {selectedScore ? <aside role="dialog" aria-label="選択したプレイの詳細" aria-live="polite" className="fixed inset-x-3 bottom-3 z-50 ml-auto max-w-[390px] overflow-hidden rounded-xl border border-[#cfd7e2] bg-white shadow-[0_18px_55px_rgba(15,23,42,.24)] sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[390px]">
      <div className="h-1" style={{ backgroundColor: GRADE_COLORS[selectedScore.rank] ?? accent }} />
      <div className="p-4"><div className="flex items-start gap-3"><span className={`grid size-10 shrink-0 place-items-center rounded-lg font-mono text-sm font-bold ${gradeClass(selectedScore.rank)}`}>{selectedScore.rank}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[#202733]">{selectedScore.artist} — {selectedScore.title}</p><p className="mt-1 truncate text-[10px] text-[#7c8796]">[{selectedScore.difficulty}] {selectedScore.mapper ? `· ${selectedScore.mapper}` : ""}</p></div><button type="button" onClick={() => setSelectedScore(null)} aria-label="詳細を閉じる" className="grid size-8 shrink-0 place-items-center rounded-md text-[#6f7a8a] hover:bg-[#f1f3f6]"><X className="size-4" /></button></div>
      <div className="mt-4 grid grid-cols-5 gap-2">{[["Pulse", formatNumber(calculatePulseIndex(selectedScore, profile.mode).total, 2)], ["PP", selectedScore.pp === null ? "—" : formatNumber(selectedScore.pp, 2)], ["精度", `${formatNumber(selectedScore.accuracy * 100, 2)}%`], ["コンボ", selectedScore.maxCombo ? `${formatNumber(selectedScore.maxCombo)}x` : "—"], ["MOD", selectedScore.mods.length ? `+${selectedScore.mods.join("")}` : "NM"]].map(([label, value]) => <div key={label} className="rounded-md bg-[#f5f7fa] px-2 py-2"><p className="text-[8px] uppercase text-[#8a94a3]">{label}</p><p className="mt-1 truncate font-mono text-[10px] font-semibold text-[#27303b]">{value}</p></div>)}</div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-[#697586]"><span>{selectedScore.starRating === null ? "—" : `${formatNumber(selectedScore.starRating, 2)}★`}</span><span>{selectedScore.bpm === null ? "—" : `${formatNumber(selectedScore.bpm)} BPM`}</span><span>{selectedScore.beatmapLengthSeconds === null ? "長さ —" : `長さ ${Math.floor(selectedScore.beatmapLengthSeconds / 60)}:${String(selectedScore.beatmapLengthSeconds % 60).padStart(2, "0")}`}</span><span>AR {formatNumber(selectedScore.ar, 1)}</span><span>CS {formatNumber(selectedScore.cs, 1)}</span><span>OD {formatNumber(selectedScore.od, 1)}</span>{profile.mode === "osu" ? <><span>Aim難度 {formatNumber(selectedScore.aimDifficulty, 2)}</span><span>Speed難度 {formatNumber(selectedScore.speedDifficulty, 2)}</span></> : null}<span>{dateTime(selectedScore.endedAt)}</span></div>
      <a href={scoreUrl(selectedScore)} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#202733] text-[10px] font-semibold text-white hover:bg-[#10151d]">osu!でScore詳細を開く <ExternalLink className="size-3" /></a></div>
    </aside> : null}
  </main>;
}

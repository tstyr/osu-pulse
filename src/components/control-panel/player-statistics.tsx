"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Clock3,
  Crosshair,
  Download,
  ExternalLink,
  FileSpreadsheet,
  GitCompareArrows,
  Medal,
  MousePointerClick,
  RotateCcw,
  Search,
  Trophy,
  UsersRound,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState, type WheelEvent } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Symbols,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  type ScatterPointItem,
  type TooltipContentProps,
} from "recharts";

import type {
  PlayerStatisticsDataset,
  StatisticsModeData,
  StatisticsPlayer,
  StatisticsScore,
  StatisticsSnapshot,
} from "@/lib/control/statistics";
import { formatAccuracy, formatCompactNumber, formatNumber, formatRank } from "@/lib/format";
import { MODE_ACCENTS, MODE_LABELS, OSU_MODES, type OsuMode } from "@/lib/osu/modes";
import { calculatePulseHistory } from "@/lib/osu/pulse-index";
import { calculateSkillProfile, skillLabels } from "@/lib/osu/skill-profile";

type View = "player" | "versus" | "everyone";
type Metric = "pp" | "globalRank" | "accuracy" | "playCount" | "playTimeSeconds" | "rankedScore" | "totalScore";
type ScoreRank = "XH" | "X" | "SH" | "S" | "A" | "B" | "C" | "D" | "F";
type MarkerShape = "circle" | "cross" | "diamond" | "square" | "star" | "triangle" | "wye";
type PerformancePoint = StatisticsScore & { pp: number; time: number; grade: ScoreRank; markerSize: number };
type HistoryRow = Record<string, string | number | null> & { date: string };
type ChartZoomRange = { startIndex: number; endIndex: number };
type DragSelection = { from: string; to: string };
type ChartInteractionMode = "inspect" | "zoom";
type DailyGrowthMetric = "pp" | "rank" | "score";
type FlourishMetric = "pp" | "globalRank" | "rankProgress" | "totalScore" | "rankedScore" | "playCount" | "accuracy" | "playTimeSeconds";
type FatiguePoint = { minute: number; accuracy: number; pp: number | null; plays: number };
type EfficiencyMetric = "perStar" | "perMinute";
type EfficiencyModGroup = "NM" | "HD" | "DT" | "HDDT";

const CHART_COLORS = [
  "#0051c3",
  "#f48120",
  "#16a36f",
  "#8c7cff",
  "#dc3d68",
  "#0891b2",
  "#ca8a04",
  "#7c3aed",
  "#0f766e",
  "#db2777",
  "#2563eb",
  "#ea580c",
  "#65a30d",
  "#9333ea",
  "#be123c",
  "#0284c7",
];
const RANK_ORDER: ScoreRank[] = ["XH", "X", "SH", "S", "A", "B", "C", "D", "F"];
const RANK_VISUALS: Record<ScoreRank, { color: string; shape: MarkerShape; label: string }> = {
  XH: { color: "#06b6d4", shape: "star", label: "XH" },
  X: { color: "#d6a117", shape: "diamond", label: "X" },
  SH: { color: "#22a6b3", shape: "cross", label: "SH" },
  S: { color: "#f2bd3f", shape: "circle", label: "S" },
  A: { color: "#65b84b", shape: "triangle", label: "A" },
  B: { color: "#5377c8", shape: "square", label: "B" },
  C: { color: "#9b59c6", shape: "circle", label: "C" },
  D: { color: "#ef6a6a", shape: "diamond", label: "D" },
  F: { color: "#64748b", shape: "cross", label: "F" },
};
const METRICS: Array<{ key: Metric; label: string }> = [
  { key: "pp", label: "PP" },
  { key: "globalRank", label: "世界順位" },
  { key: "accuracy", label: "精度" },
  { key: "playCount", label: "プレイ回数" },
  { key: "playTimeSeconds", label: "プレイ時間" },
  { key: "rankedScore", label: "Ranked score" },
  { key: "totalScore", label: "Total score" },
];
const DAILY_GROWTH_METRICS: Array<{ key: DailyGrowthMetric; label: string }> = [
  { key: "pp", label: "PP増加" },
  { key: "rank", label: "順位上昇" },
  { key: "score", label: "総スコア増加" },
];
const FLOURISH_METRICS: Array<{ key: FlourishMetric; label: string }> = [
  { key: "pp", label: "PP" },
  { key: "globalRank", label: "世界順位（実数）" },
  { key: "rankProgress", label: "世界順位（レース向け）" },
  { key: "totalScore", label: "総スコア" },
  { key: "rankedScore", label: "Ranked score" },
  { key: "playCount", label: "プレイ回数" },
  { key: "accuracy", label: "精度" },
  { key: "playTimeSeconds", label: "プレイ時間" },
];
const EFFICIENCY_MOD_GROUPS: Array<{ key: EfficiencyModGroup; label: string }> = [
  { key: "NM", label: "NM" },
  { key: "HD", label: "HD" },
  { key: "DT", label: "DT / NC" },
  { key: "HDDT", label: "HD + DT" },
];

function efficiencyModGroup(score: StatisticsScore): EfficiencyModGroup | null {
  const mods = new Set(score.mods.map((mod) => mod.toUpperCase()).filter((mod) => mod !== "CL"));
  const hidden = mods.has("HD");
  const speedUp = mods.has("DT") || mods.has("NC");
  if (hidden && speedUp) return "HDDT";
  if (speedUp) return "DT";
  if (hidden) return "HD";
  return mods.size === 0 ? "NM" : null;
}

function latestSnapshot(data: StatisticsModeData) {
  return data.snapshots.at(-1) ?? null;
}

function hasModeData(player: StatisticsPlayer, mode: OsuMode) {
  const data = player.modes[mode];
  return data.snapshots.length > 0 || data.summary.scoreCount > 0;
}

function metricValue(snapshot: StatisticsSnapshot, metric: Metric) {
  return snapshot[metric];
}

function formatMetric(value: number | null | undefined, metric: Metric) {
  if (value === null || value === undefined) return "—";
  if (metric === "globalRank") return formatRank(value);
  if (metric === "accuracy") return formatAccuracy(value);
  if (metric === "pp") return `${formatNumber(value, 1)} pp`;
  if (metric === "playTimeSeconds") return formatPlayTime(value);
  return formatNumber(value);
}

function formatPlayTime(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 3_600) return `${Math.round(seconds / 60)}分`;
  const hours = seconds / 3_600;
  if (hours < 24) return `${hours.toFixed(1)}時間`;
  return `${(hours / 24).toFixed(hours >= 2_400 ? 0 : 1)}日`;
}

function formatMetricMagnitude(value: number, metric: Metric) {
  return metric === "playTimeSeconds" ? formatPlayTime(Math.abs(value)) : formatNumber(Math.abs(value), metric === "accuracy" || metric === "pp" ? 2 : 0);
}

function formatDate(value: string | null, withTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ja-JP", withTime
    ? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }
    : { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Tokyo" }).format(new Date(value));
}

function formatAxisDate(value: number) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function normalizeRank(rank: string): ScoreRank {
  return RANK_ORDER.includes(rank as ScoreRank) ? rank as ScoreRank : "F";
}

function performanceRegression(points: PerformancePoint[]): [{ x: number; y: number }, { x: number; y: number }] | null {
  if (points.length < 2) return null;
  const origin = points[0].time;
  const values = points.map((point) => ({ x: (point.time - origin) / 86_400_000, y: point.pp }));
  const meanX = values.reduce((sum, point) => sum + point.x, 0) / values.length;
  const meanY = values.reduce((sum, point) => sum + point.y, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (const point of values) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }
  if (denominator === 0) return null;
  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  const firstX = values[0].x;
  const lastX = values.at(-1)?.x ?? firstX;
  return [
    { x: origin + firstX * 86_400_000, y: Math.max(0, intercept + slope * firstX) },
    { x: origin + lastX * 86_400_000, y: Math.max(0, intercept + slope * lastX) },
  ];
}

function durationLabel(milliseconds: number | null) {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds <= 0) return "—";
  const hours = milliseconds / 3_600_000;
  if (hours < 24) return `${hours.toFixed(1)}時間`;
  return `${(hours / 24).toFixed(1)}日`;
}

function rankTone(rank: string) {
  if (["XH", "X", "SH", "S"].includes(rank)) return "bg-amber-50 text-amber-700";
  if (rank === "A") return "bg-emerald-50 text-emerald-700";
  if (rank === "B") return "bg-blue-50 text-blue-700";
  return "bg-slate-100 text-slate-600";
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function playerColor(index: number, seed = "") {
  if (seed) {
    const hash = hashString(seed);
    const mixed = Math.imul(hash ^ (hash >>> 16), 2_246_822_507) >>> 0;
    const hue = mixed % 360;
    const saturation = 68 + ((mixed >>> 8) % 15);
    const lightness = 38 + ((mixed >>> 16) % 10);
    return `hsl(${hue} ${saturation}% ${lightness}%)`;
  }
  if (index < CHART_COLORS.length) return CHART_COLORS[index];
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue} 78% 43%)`;
}

function metricDelta(first: StatisticsSnapshot | null, latest: StatisticsSnapshot | null, metric: Metric) {
  if (!first || !latest) return null;
  if (metric === "globalRank") {
    if (first.globalRank === null || latest.globalRank === null) return null;
    return first.globalRank - latest.globalRank;
  }
  const firstValue = metricValue(first, metric);
  const latestValue = metricValue(latest, metric);
  if (firstValue === null || latestValue === null) return null;
  return latestValue - firstValue;
}

function calculateGrowth(data: StatisticsModeData) {
  const first = data.snapshots[0] ?? null;
  const latest = latestSnapshot(data);
  const firstDate = first ? Date.parse(`${first.date}T00:00:00Z`) : 0;
  const lastDate = latest ? Date.parse(`${latest.date}T00:00:00Z`) : 0;
  const days = first && latest ? Math.max(1, (lastDate - firstDate) / 86_400_000) : 0;
  const ppGain = first && latest ? latest.pp - first.pp : 0;
  const rankGain = first?.globalRank && latest?.globalRank ? first.globalRank - latest.globalRank : 0;
  const rankedScoreGain = first && latest ? latest.rankedScore - first.rankedScore : 0;
  const playGain = first && latest ? Math.max(0, latest.playCount - first.playCount) : 0;
  const playTimeSnapshots = data.snapshots.filter((snapshot) => snapshot.playTimeSeconds !== null);
  const firstPlayTime = playTimeSnapshots[0]?.playTimeSeconds ?? null;
  const latestPlayTime = playTimeSnapshots.at(-1)?.playTimeSeconds ?? null;
  const playTimeGain = playTimeSnapshots.length >= 2 && firstPlayTime !== null && latestPlayTime !== null
    ? Math.max(0, latestPlayTime - firstPlayTime)
    : null;
  let bestDailyPp = 0;
  for (let index = 1; index < data.snapshots.length; index += 1) {
    bestDailyPp = Math.max(bestDailyPp, data.snapshots[index].pp - data.snapshots[index - 1].pp);
  }
  const scoreSpan = data.summary.firstScoreAt && data.summary.lastScoreAt
    ? Date.parse(data.summary.lastScoreAt) - Date.parse(data.summary.firstScoreAt)
    : null;
  return {
    first,
    latest,
    days,
    ppGain,
    rankGain,
    rankedScoreGain,
    playGain,
    playTimeGain,
    bestDailyPp,
    averagePpPerPlay: data.summary.averagePp,
    averageRankPerPlay: playGain > 0 ? rankGain / playGain : null,
    averageTimeBetweenScores: scoreSpan !== null && data.summary.scoreCount > 1
      ? scoreSpan / (data.summary.scoreCount - 1)
      : null,
  };
}

function mergedHistory(players: StatisticsPlayer[], mode: OsuMode, metric: Metric) {
  const rows = new Map<string, HistoryRow>();
  for (const player of players) {
    for (const snapshot of player.modes[mode].snapshots) {
      const row = rows.get(snapshot.date) ?? { date: snapshot.date };
      row[player.id] = metricValue(snapshot, metric);
      rows.set(snapshot.date, row);
    }
  }
  return [...rows.values()].sort((left, right) => String(left.date).localeCompare(String(right.date)));
}

function mergedDailyGrowth(players: StatisticsPlayer[], mode: OsuMode, metric: DailyGrowthMetric) {
  const rows = new Map<string, HistoryRow>();
  for (const player of players) {
    const snapshots = player.modes[mode].snapshots;
    for (let index = 1; index < snapshots.length; index += 1) {
      const previous = snapshots[index - 1];
      const current = snapshots[index];
      let value: number | null = null;
      if (metric === "pp") value = current.pp - previous.pp;
      if (metric === "rank" && previous.globalRank !== null && current.globalRank !== null) value = previous.globalRank - current.globalRank;
      if (metric === "score") value = current.totalScore - previous.totalScore;
      if (value === null || !Number.isFinite(value)) continue;
      const row = rows.get(current.date) ?? { date: current.date };
      row[player.id] = value;
      rows.set(current.date, row);
    }
  }
  return [...rows.values()].sort((left, right) => String(left.date).localeCompare(String(right.date)));
}

function formatDailyGrowth(value: number, metric: DailyGrowthMetric) {
  const sign = value > 0 ? "+" : "";
  if (metric === "pp") return `${sign}${formatNumber(value, 2)}pp`;
  if (metric === "rank") return `${sign}${formatNumber(value)}位`;
  return `${sign}${formatNumber(value)}`;
}

function flourishMetricValue(snapshot: StatisticsSnapshot, metric: FlourishMetric, maximumRank: number) {
  if (metric === "rankProgress") return snapshot.globalRank === null ? null : maximumRank + 1 - snapshot.globalRank;
  return snapshot[metric];
}

function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadFlourishCsv(players: StatisticsPlayer[], mode: OsuMode, metric: FlourishMetric) {
  const chartPlayers = players.filter((player) => player.modes[mode].snapshots.length > 0);
  const dates = [...new Set(chartPlayers.flatMap((player) => player.modes[mode].snapshots.map((snapshot) => snapshot.date)))].sort();
  const maximumRank = chartPlayers.reduce((maximum, player) => player.modes[mode].snapshots.reduce(
    (highest, snapshot) => Math.max(highest, snapshot.globalRank ?? 0), maximum,
  ), 0);
  const rows: Array<Array<string | number | null>> = [["Player", "Category", ...dates]];

  for (const player of chartPlayers) {
    const snapshots = new Map(player.modes[mode].snapshots.map((snapshot) => [snapshot.date, snapshot]));
    let currentValue: number | null = null;
    const values = dates.map((date) => {
      const snapshot = snapshots.get(date);
      if (snapshot) currentValue = flourishMetricValue(snapshot, metric, maximumRank);
      return currentValue;
    });
    rows.push([player.username, player.countryCode ?? MODE_LABELS[mode], ...values]);
  }

  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `osu-pulse-${mode}-${metric}-flourish.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function PlayerAvatar({ player, size = 56 }: { player: StatisticsPlayer; size?: number }) {
  if (!player.avatarUrl) {
    return <span className="grid shrink-0 place-items-center rounded-lg bg-[#edf1f5] font-mono text-lg font-semibold text-[#667184]" style={{ width: size, height: size }}>{player.username.slice(0, 1).toUpperCase()}</span>;
  }
  return <Image src={player.avatarUrl} alt="" width={size} height={size} className="shrink-0 rounded-lg object-cover" unoptimized />;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="grid min-h-52 place-items-center rounded-lg border border-dashed border-[#d8dde5] bg-[#fafbfc] px-6 text-center">
      <div><BarChart3 className="mx-auto size-6 text-[#a0a8b4]" /><p className="mt-3 text-sm font-medium text-[#536074]">{message}</p><p className="mt-1 text-xs text-[#8a94a3]">次回同期後にDBの履歴が追加されます。</p></div>
    </div>
  );
}

function OverviewCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-[#e0e4ea] bg-white p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7b8594]">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[#1f2630]">{value}</p>
      <p className="mt-2 text-[10px] text-[#8992a0]">{detail}</p>
    </div>
  );
}

function DifficultyDistribution({ scores, mode }: { scores: StatisticsScore[]; mode: OsuMode }) {
  const metrics = [
    { key: "starRating" as const, label: "Star rating", step: 1, suffix: "★" },
    { key: "ar" as const, label: "AR", step: 1, suffix: "" },
    { key: "od" as const, label: "OD", step: 1, suffix: "" },
    { key: "cs" as const, label: "CS", step: 1, suffix: "" },
  ];
  return <section className="cp-panel overflow-hidden">
    <div className="border-b border-[#e2e6eb] px-5 py-4"><h3 className="text-sm font-semibold">譜面スキル帯分布</h3><p className="mt-1 text-[11px] text-[#818b99]">保存済みリザルトをStar / AR / OD / CSの帯域別に集計</p></div>
    <div className="grid gap-px bg-[#e5e9ee] sm:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => {
      const buckets = new Map<number, number>();
      for (const score of scores) {
        const value = score[metric.key];
        if (value === null || !Number.isFinite(value)) continue;
        const bucket = Math.floor(value / metric.step) * metric.step;
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
      }
      const data = [...buckets.entries()].sort(([left], [right]) => left - right).map(([value, count]) => ({ label: `${value}${metric.suffix}`, count }));
      return <div key={metric.key} className="bg-white p-4"><p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-[#667184]">{metric.label}</p><div className="h-44">{data.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ left: -20, right: 4, top: 4, bottom: 0 }}><CartesianGrid stroke="#edf0f3" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 8 }} tickLine={false} interval={0} /><YAxis allowDecimals={false} tick={{ fontSize: 8 }} tickLine={false} axisLine={false} /><Tooltip contentStyle={{ borderRadius: 8, fontSize: 10 }} /><Bar dataKey="count" name="Plays" fill={MODE_ACCENTS[mode]} radius={[3, 3, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer> : <div className="grid h-full place-items-center text-[10px] text-[#929aa6]">データなし</div>}</div></div>;
    })}</div>
  </section>;
}

function PerformancePointShape(props: ScatterPointItem) {
  const point = props.payload as PerformancePoint | undefined;
  if (!point || props.cx === undefined || props.cy === undefined) return <g />;
  const visual = RANK_VISUALS[point.grade];
  const label = `${point.artist} — ${point.title} [${point.difficulty}]、${point.grade}、${formatNumber(point.pp, 2)}pp。Beatmap詳細を開く`;
  return (
    <a href={`https://osu.ppy.sh/beatmaps/${point.beatmapId}`} target="_blank" rel="noreferrer" aria-label={label}>
      <title>{label}</title>
      <Symbols
        cx={props.cx}
        cy={props.cy}
        type={visual.shape}
        size={point.markerSize}
        fill={visual.color}
        fillOpacity={0.84}
        stroke="#ffffff"
        strokeWidth={1.25}
        className="cursor-pointer transition-opacity hover:opacity-100"
      />
    </a>
  );
}

function PerformanceScatterTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as PerformancePoint | undefined;
  if (!active || !point) return null;
  const visual = RANK_VISUALS[point.grade];
  return (
    <div className="max-w-[320px] rounded-lg border border-[#d8dee7] bg-white/95 p-3 shadow-xl backdrop-blur">
      <div className="flex items-start gap-2">
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: visual.color }} />
        <div className="min-w-0">
          <p className="text-xs font-semibold leading-5 text-[#202833]">{point.artist} — {point.title}</p>
          <p className="mt-0.5 text-[10px] text-[#7b8695]">[{point.difficulty}]</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 border-t border-[#e7eaf0] pt-3 text-[10px]">
        <span className="text-[#7d8795]">判定</span><strong className="text-right" style={{ color: visual.color }}>{point.grade}</strong>
        <span className="text-[#7d8795]">Performance</span><strong className="text-right font-mono">{formatNumber(point.pp, 2)}pp</strong>
        <span className="text-[#7d8795]">Accuracy</span><strong className="text-right font-mono">{formatAccuracy(point.accuracy * 100)}</strong>
        <span className="text-[#7d8795]">Mods</span><strong className="text-right font-mono">{point.mods.length ? `+${point.mods.join("")}` : "NM"}</strong>
        <span className="text-[#7d8795]">Played</span><strong className="text-right font-normal">{formatDate(point.endedAt, true)}</strong>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[9px] font-medium text-[#0051c3]"><MousePointerClick className="size-3" /> 点をクリックしてBeatmap詳細を開く</p>
    </div>
  );
}

function PerformanceScatter({ scores }: { scores: StatisticsScore[] }) {
  const [periodDays, setPeriodDays] = useState<30 | 90 | 365 | "all">(30);
  const allPoints = useMemo(() => scores
      .filter((score): score is StatisticsScore & { pp: number } => score.pp !== null)
      .map((score) => ({
        ...score,
        pp: score.pp,
        time: Date.parse(score.endedAt),
        grade: normalizeRank(score.rank),
        markerSize: 72,
      }))
      .filter((point) => Number.isFinite(point.time))
      .sort((left, right) => left.time - right.time), [scores]);
  const { points, groups, regression, firstTime, lastTime, padding } = useMemo(() => {
    const latestTime = allPoints.at(-1)?.time ?? 0;
    const cutoff = periodDays === "all" ? Number.NEGATIVE_INFINITY : latestTime - periodDays * 86_400_000;
    const filtered = allPoints.filter((point) => point.time >= cutoff);
    const nextPoints = filtered.length ? filtered : allPoints;
    const groupedPoints = RANK_ORDER.map((rank) => ({ rank, points: nextPoints.filter((point) => point.grade === rank) }))
      .filter((group) => group.points.length > 0);
    const first = nextPoints[0]?.time ?? 0;
    const last = nextPoints.at(-1)?.time ?? first;
    return {
      points: nextPoints,
      groups: groupedPoints,
      regression: performanceRegression(nextPoints),
      firstTime: first,
      lastTime: last,
      padding: first === last ? 12 * 60 * 60 * 1_000 : Math.max(60 * 60 * 1_000, (last - first) * 0.025),
    };
  }, [allPoints, periodDays]);

  return (
    <section className="cp-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e6eb] px-5 py-4">
        <div><h3 className="text-sm font-semibold">パフォーマンス推移</h3><p className="mt-1 text-[11px] text-[#818b99]">プレイ日時 × 獲得PP · 表示 {points.length.toLocaleString()} / 全{allPoints.length.toLocaleString()}件</p></div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {([{ value: 30, label: "30日" }, { value: 90, label: "90日" }, { value: 365, label: "1年" }, { value: "all", label: "全件" }] as const).map((item) => <button key={item.label} type="button" onClick={() => setPeriodDays(item.value)} className={`rounded border px-2.5 py-1.5 text-[9px] font-semibold transition ${periodDays === item.value ? "border-[#8eb5e8] bg-[#eef4fc] text-[#0051c3]" : "border-[#d9dee7] bg-white text-[#687486] hover:bg-[#f5f7f9]"}`}>{item.label}</button>)}
          <span className="ml-1 hidden items-center gap-1.5 text-[10px] text-[#7c8796] sm:flex"><MousePointerClick className="size-3.5" /> 詳細</span>
        </div>
      </div>
      <div className="h-[420px] p-3 sm:p-5">
        {points.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ left: 6, right: 14, top: 14, bottom: 8 }}>
              <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} />
              <XAxis
                type="number"
                dataKey="time"
                name="Played"
                domain={[firstTime - padding, lastTime + padding]}
                scale="time"
                tick={{ fontSize: 10, fill: "#778294" }}
                tickFormatter={(value) => formatAxisDate(Number(value))}
                tickLine={false}
                axisLine={{ stroke: "#d8dde5" }}
              />
              <YAxis
                type="number"
                dataKey="pp"
                name="PP"
                unit="pp"
                domain={[0, "dataMax + 20"]}
                width={58}
                tick={{ fontSize: 10, fill: "#778294" }}
                tickLine={false}
                axisLine={false}
              />
              <ZAxis type="number" dataKey="markerSize" range={[72, 72]} />
              <Tooltip cursor={{ stroke: "#aab4c2", strokeDasharray: "4 4" }} content={PerformanceScatterTooltip} />
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
              {regression ? <ReferenceLine segment={regression} stroke="#8c7cff" strokeWidth={2} strokeDasharray="6 5" ifOverflow="extendDomain" /> : null}
              {groups.map((group) => {
                const visual = RANK_VISUALS[group.rank];
                return (
                  <Scatter
                    key={group.rank}
                    name={`${visual.label} (${group.points.length})`}
                    data={group.points}
                    fill={visual.color}
                    shape={PerformancePointShape}
                    legendType={visual.shape}
                    isAnimationActive={false}
                  />
                );
              })}
            </ScatterChart>
          </ResponsiveContainer>
        ) : <EmptyState message="PP付きリザルトがありません" />}
      </div>
      {regression ? <div className="border-t border-[#edf0f3] px-5 py-3 text-[9px] text-[#8791a0]"><span className="mr-2 inline-block w-7 border-t-2 border-dashed border-[#8c7cff] align-middle" />破線は保存済みリザルトのPPトレンドです。</div> : null}
    </section>
  );
}

function RecentPpChart({ scores, mode }: { scores: StatisticsScore[]; mode: OsuMode }) {
  const recentPp = useMemo(() => [...scores].reverse().map((score, index) => ({
    index: index + 1,
    pp: score.pp,
    accuracy: score.accuracy * 100,
    title: score.title,
  })), [scores]);
  const initialStart = Math.max(0, recentPp.length - 40);
  const [range, setRange] = useState(() => ({ startIndex: initialStart, endIndex: Math.max(0, recentPp.length - 1) }));
  const visibleCount = recentPp.length ? range.endIndex - range.startIndex + 1 : 0;
  const presets = [40, 100, 250].filter((value) => value < recentPp.length);

  function selectCount(count: number) {
    setRange({ startIndex: Math.max(0, recentPp.length - count), endIndex: Math.max(0, recentPp.length - 1) });
  }

  if (!recentPp.some((item) => item.pp !== null)) return <EmptyState message="PP付きリザルトがありません" />;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[9px] text-[#7d8795]">表示 {formatNumber(visibleCount)} / 全{formatNumber(recentPp.length)}件</p>
        <div className="flex flex-wrap gap-1">
          {presets.map((count) => <button key={count} type="button" onClick={() => selectCount(count)} aria-pressed={visibleCount === count} className={`rounded border px-2 py-1 text-[9px] font-medium transition ${visibleCount === count ? "border-[#8eb5e8] bg-[#eef4fc] text-[#0051c3]" : "border-[#d9dee7] bg-white text-[#687486] hover:bg-[#f5f7f9]"}`}>直近{count}</button>)}
          <button type="button" onClick={() => selectCount(recentPp.length)} aria-pressed={visibleCount === recentPp.length} className={`rounded border px-2 py-1 text-[9px] font-medium transition ${visibleCount === recentPp.length ? "border-[#8eb5e8] bg-[#eef4fc] text-[#0051c3]" : "border-[#d9dee7] bg-white text-[#687486] hover:bg-[#f5f7f9]"}`}>全件</button>
        </div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={recentPp} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <defs><linearGradient id={`recentPpFill-${mode}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={MODE_ACCENTS[mode]} stopOpacity={0.3} /><stop offset="100%" stopColor={MODE_ACCENTS[mode]} stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="index" tick={{ fontSize: 9 }} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} />
            <Area type="monotone" dataKey="pp" name="PP" stroke={MODE_ACCENTS[mode]} fill={`url(#recentPpFill-${mode})`} strokeWidth={2} connectNulls isAnimationActive={false} />
            <Brush
              dataKey="index"
              height={28}
              travellerWidth={8}
              startIndex={range.startIndex}
              endIndex={range.endIndex}
              onChange={setRange}
              tickFormatter={(value) => `#${value}`}
              stroke={MODE_ACCENTS[mode]}
              fill="#f8fafc"
              ariaLabel="PP履歴の表示範囲"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[9px] text-[#8791a0]">下部の左右ハンドルをドラッグすると、任意の範囲へ拡大・移動できます。</p>
    </>
  );
}

function FatigueChart({ scores, mode }: { scores: StatisticsScore[]; mode: OsuMode }) {
  const points = useMemo(() => {
    const ordered = [...scores].sort((left, right) => Date.parse(left.endedAt) - Date.parse(right.endedAt));
    const sessions: StatisticsScore[][] = [];
    for (const score of ordered) {
      const current = sessions.at(-1);
      const previousAt = current?.at(-1)?.endedAt;
      if (!current || !previousAt || Date.parse(score.endedAt) - Date.parse(previousAt) > 45 * 60_000) sessions.push([score]);
      else current.push(score);
    }
    const buckets = new Map<number, { accuracy: number[]; pp: number[] }>();
    for (const session of sessions.filter((item) => item.length >= 2)) {
      const startedAt = Date.parse(session[0].endedAt);
      for (const score of session) {
        const bucket = Math.floor(Math.max(0, Date.parse(score.endedAt) - startedAt) / (15 * 60_000)) * 15;
        const current = buckets.get(bucket) ?? { accuracy: [], pp: [] };
        current.accuracy.push(score.accuracy * 100);
        if (score.pp !== null) current.pp.push(score.pp);
        buckets.set(bucket, current);
      }
    }
    return [...buckets.entries()].sort(([left], [right]) => left - right).map(([minute, values]): FatiguePoint => ({
      minute,
      accuracy: values.accuracy.reduce((sum, value) => sum + value, 0) / values.accuracy.length,
      pp: values.pp.length ? values.pp.reduce((sum, value) => sum + value, 0) / values.pp.length : null,
      plays: values.accuracy.length,
    }));
  }, [scores]);

  return <section className="cp-panel overflow-hidden">
    <div className="flex items-center justify-between border-b border-[#e2e6eb] px-5 py-4"><div><h3 className="text-sm font-semibold">プレイ時間と疲労傾向</h3><p className="mt-1 text-[11px] text-[#818b99]">セッション開始からの経過時間 × 平均精度・平均PP（15分単位）</p></div><Clock3 className="size-4 text-[#7d8795]" /></div>
    <div className="h-[330px] p-4 sm:p-5">
      {points.length >= 2 ? <ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
        <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="minute" unit="分" tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} />
        <YAxis yAxisId="accuracy" domain={["dataMin - 1", 100]} unit="%" tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} axisLine={false} width={50} />
        <YAxis yAxisId="pp" orientation="right" domain={[0, "dataMax + 20"]} unit="pp" tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} axisLine={false} width={62} />
        <Tooltip formatter={(value, name, item) => [name === "平均精度" ? `${formatNumber(Number(value), 2)}%` : `${formatNumber(Number(value), 1)}pp`, `${name} · ${item.payload.plays} plays`]} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Line yAxisId="accuracy" type="monotone" dataKey="accuracy" name="平均精度" stroke={MODE_ACCENTS[mode]} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
        <Line yAxisId="pp" type="monotone" dataKey="pp" name="平均PP" stroke="#7c3aed" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} connectNulls isAnimationActive={false} />
      </LineChart></ResponsiveContainer> : <EmptyState message="2プレイ以上のセッションデータがまだありません" />}
    </div>
    <p className="border-t border-[#edf0f3] px-5 py-3 text-[9px] text-[#8791a0]">セッション間隔45分・15分バケットで集計。長時間帯で線が下がるほど疲労による低下傾向があります。</p>
  </section>;
}

function PlayerHeader({ player, mode }: { player: StatisticsPlayer; mode: OsuMode }) {
  const data = player.modes[mode];
  const latest = latestSnapshot(data);
  return (
    <section className="cp-panel overflow-hidden">
      <div className="h-1" style={{ background: MODE_ACCENTS[mode] }} />
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <PlayerAvatar player={player} size={64} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-semibold tracking-[-0.025em]">{player.username}</h2>{player.countryCode ? <span className="rounded bg-[#f0f2f5] px-2 py-1 font-mono text-[9px] font-semibold text-[#667184]">{player.countryCode}</span> : null}</div>
            <p className="mt-1 text-xs text-[#7a8493]">{MODE_LABELS[mode]} · osu! ID {player.osuUserId}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3"><Link href={`/players/${player.osuUserId}?mode=${mode}`} className="inline-flex items-center gap-1 rounded-md bg-[#eef4fc] px-2.5 py-1.5 text-[10px] font-semibold text-[#0051c3] hover:bg-[#e2edfb]">公開個人分析へ <BarChart3 className="size-3" /></Link><a href={`https://osu.ppy.sh/users/${player.osuUserId}/${mode}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-medium text-[#0051c3] hover:underline">公式プロフィール <ExternalLink className="size-3" /></a></div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-5 sm:text-right">
          <div><p className="text-[9px] uppercase tracking-[0.08em] text-[#8a94a3]">Performance</p><p className="mt-1 font-mono text-sm font-semibold">{latest ? `${formatNumber(latest.pp, 1)}pp` : "—"}</p></div>
          <div><p className="text-[9px] uppercase tracking-[0.08em] text-[#8a94a3]">Global</p><p className="mt-1 font-mono text-sm font-semibold">{formatRank(latest?.globalRank)}</p></div>
          <div><p className="text-[9px] uppercase tracking-[0.08em] text-[#8a94a3]">Accuracy</p><p className="mt-1 font-mono text-sm font-semibold">{formatAccuracy(latest?.accuracy)}</p></div>
        </div>
      </div>
    </section>
  );
}

function PlayerOverview({ player, mode }: { player: StatisticsPlayer; mode: OsuMode }) {
  const data = player.modes[mode];
  const growth = calculateGrowth(data);
  const rankData = Object.entries(data.summary.rankCounts)
    .sort(([left], [right]) => RANK_ORDER.indexOf(normalizeRank(left)) - RANK_ORDER.indexOf(normalizeRank(right)))
    .map(([rank, value]) => ({ rank, value }));

  return (
    <div className="space-y-5">
      <PlayerHeader player={player} mode={mode} />
      {!growth.latest ? <EmptyState message={`${MODE_LABELS[mode]} のスナップショットがありません`} /> : <>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <OverviewCard label="Total score" value={formatCompactNumber(growth.latest.totalScore)} detail={formatNumber(growth.latest.totalScore)} />
          <OverviewCard label="Ranked score" value={formatCompactNumber(growth.latest.rankedScore)} detail={formatNumber(growth.rankedScoreGain) + " tracked gain"} />
          <OverviewCard label="Tracked plays" value={formatNumber(data.summary.scoreCount)} detail={`${formatNumber(growth.playGain)} profile play gain`} />
          <OverviewCard label="Play time" value={formatPlayTime(growth.latest.playTimeSeconds)} detail={growth.playTimeGain === null ? "増分は次回同期から集計" : `${formatPlayTime(growth.playTimeGain)} tracked gain`} />
          <OverviewCard label="Best daily PP" value={`+${formatNumber(growth.bestDailyPp, 1)}pp`} detail={`${formatNumber(data.summary.snapshotCount)} samples · ${formatNumber(data.summary.dailySnapshotCount)} days`} />
        </section>

        {data.topPlayHistory.length ? <section className="cp-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e2e6eb] px-5 py-4"><div><h3 className="text-sm font-semibold">Top PP合計の履歴</h3><p className="mt-1 text-[11px] text-[#818b99]">旧DBから引き継いだTopプレイ構成の推移</p></div><Activity className="size-4 text-[#7d8795]" /></div>
          <div className="h-[280px] p-4 sm:p-5">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.topPlayHistory.map((snapshot) => ({ ...snapshot, date: snapshot.capturedAt.slice(0, 10) }))} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} axisLine={{ stroke: "#d8dde5" }} />
                <YAxis tick={{ fontSize: 10, fill: "#778294" }} tickFormatter={(value) => `${formatNumber(Number(value), 0)}pp`} tickLine={false} axisLine={false} width={72} />
                <Tooltip formatter={(value) => [`${formatNumber(Number(value), 2)}pp`, "Top PP sum"]} contentStyle={{ border: "1px solid #d9dee7", borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="topPpSum" name="Top PP sum" stroke={MODE_ACCENTS[mode]} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section> : null}

        <section className="cp-panel overflow-hidden">
          <div className="border-b border-[#e2e6eb] px-5 py-4"><h3 className="text-sm font-semibold">期間平均</h3><p className="mt-1 text-[11px] text-[#818b99]">{growth.first?.date} から {growth.latest.date} までのDB差分</p></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[0.08em] text-[#7e8897]"><tr><th className="px-5 py-3">Interval</th><th className="px-4 py-3 text-right">PP gain</th><th className="px-4 py-3 text-right">Rank gain</th><th className="px-4 py-3 text-right">Play time</th><th className="px-5 py-3 text-right">Ranked score gain</th></tr></thead>
              <tbody className="divide-y divide-[#e8ebef]">
                {[
                  ["Per hour", 1 / 24],
                  ["Per day", 1],
                  ["Per week", 7],
                  ["Per month", 30],
                ].map(([label, multiplier]) => {
                  const scale = Number(multiplier) / Math.max(growth.days, 1);
                  return <tr key={String(label)}><th className="px-5 py-3 font-medium text-[#4a5567]">{label}</th><td className="px-4 py-3 text-right font-mono">{formatNumber(growth.ppGain * scale, 2)}pp</td><td className="px-4 py-3 text-right font-mono">{formatNumber(growth.rankGain * scale, 1)}</td><td className="px-4 py-3 text-right font-mono">{growth.playTimeGain === null ? "—" : formatPlayTime(growth.playTimeGain * scale)}</td><td className="px-5 py-3 text-right font-mono">{formatNumber(growth.rankedScoreGain * scale, 0)}</td></tr>;
                })}
              </tbody>
              <tfoot className="border-t-2 border-[#dce2e9] bg-[#fbfcfd] text-xs">
                <tr><th className="px-5 py-3 font-medium">平均PP / 保存リザルト</th><td className="px-4 py-3 text-right font-mono">{growth.averagePpPerPlay === null ? "—" : `${formatNumber(growth.averagePpPerPlay, 2)}pp`}</td><th className="px-4 py-3 font-medium">平均順位上昇 / Play</th><td colSpan={2} className="px-5 py-3 text-right font-mono">{growth.averageRankPerPlay === null ? "—" : formatNumber(growth.averageRankPerPlay, 2)}</td></tr>
                <tr><th className="px-5 py-3 font-medium">平均リザルト間隔</th><td className="px-4 py-3 text-right font-mono">{durationLabel(growth.averageTimeBetweenScores)}</td><th className="px-4 py-3 font-medium">更新期間</th><td colSpan={2} className="px-5 py-3 text-right font-mono">{formatNumber(growth.days, 0)}日</td></tr>
              </tfoot>
            </table>
          </div>
        </section>

        <FatigueChart scores={data.scores} mode={mode} />

        <section className="cp-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e2e6eb] px-5 py-4"><div><h3 className="text-sm font-semibold">PPと世界順位</h3><p className="mt-1 text-[11px] text-[#818b99]">日次スナップショット</p></div><Activity className="size-4 text-[#7d8795]" /></div>
          <div className="h-[340px] p-4 sm:p-5">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.snapshots} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} axisLine={{ stroke: "#d8dde5" }} />
                <YAxis yAxisId="pp" tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} axisLine={false} width={58} />
                <YAxis yAxisId="rank" orientation="right" reversed tick={{ fontSize: 10, fill: "#778294" }} tickFormatter={(value) => formatCompactNumber(Number(value))} tickLine={false} axisLine={false} width={58} />
                <Tooltip contentStyle={{ border: "1px solid #d9dee7", borderRadius: 8, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="pp" type="monotone" dataKey="pp" name="PP" stroke={MODE_ACCENTS[mode]} strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
                <Line yAxisId="rank" type="monotone" dataKey="globalRank" name="Global rank" stroke="#303846" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="cp-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e2e6eb] px-5 py-4"><div><h3 className="text-sm font-semibold">1日あたりの成長</h3><p className="mt-1 text-[11px] text-[#818b99]">前回の日次スナップショットとの差分</p></div><ArrowUpRight className="size-4 text-emerald-600" /></div>
          <div className="p-4 sm:p-5"><DailyGrowthChart key={`daily-player-${player.id}-${mode}`} players={[player]} mode={mode} /></div>
        </section>

        <section className="cp-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e2e6eb] px-5 py-4"><div><h3 className="text-sm font-semibold">プレイ時間推移</h3><p className="mt-1 text-[11px] text-[#818b99]">osu!公式累計 · モード別の日次スナップショット</p></div><Clock3 className="size-4 text-[#7d8795]" /></div>
          <div className="h-[300px] p-4 sm:p-5">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.snapshots.filter((snapshot) => snapshot.playTimeSeconds !== null).map((snapshot) => ({ ...snapshot, playTimeHours: (snapshot.playTimeSeconds ?? 0) / 3_600 }))} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                <defs><linearGradient id={`playTimeFill-${mode}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={MODE_ACCENTS[mode]} stopOpacity={0.3} /><stop offset="100%" stopColor={MODE_ACCENTS[mode]} stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} axisLine={{ stroke: "#d8dde5" }} />
                <YAxis tick={{ fontSize: 10, fill: "#778294" }} tickFormatter={(value) => `${formatNumber(Number(value), 0)}h`} tickLine={false} axisLine={false} width={64} />
                <Tooltip formatter={(value) => [`${formatNumber(Number(value), 1)}時間`, "累計プレイ時間"]} contentStyle={{ border: "1px solid #d9dee7", borderRadius: 8, fontSize: 11 }} />
                <Area type="monotone" dataKey="playTimeHours" name="Play time" stroke={MODE_ACCENTS[mode]} fill={`url(#playTimeFill-${mode})`} strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <PerformanceScatter scores={data.scores} />

        <DifficultyDistribution scores={data.scores} mode={mode} />

        <section className="grid gap-5 xl:grid-cols-2">
          <div className="cp-panel overflow-hidden">
            <div className="border-b border-[#e2e6eb] px-5 py-4"><h3 className="text-sm font-semibold">PP推移（範囲選択）</h3><p className="mt-1 text-[11px] text-[#818b99]">保存済みリザルト全件 · 初期表示は直近40件</p></div>
            <div className="p-4">
              <RecentPpChart key={`${player.id}:${mode}`} scores={data.scores} mode={mode} />
            </div>
          </div>
          <div className="cp-panel overflow-hidden">
            <div className="border-b border-[#e2e6eb] px-5 py-4"><h3 className="text-sm font-semibold">判定ランク分布</h3><p className="mt-1 text-[11px] text-[#818b99]">DBに保存された全リザルト</p></div>
            <div className="h-72 p-4">
              {rankData.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={rankData}><CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="rank" tick={{ fontSize: 10 }} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} /><Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} /><Bar dataKey="value" name="Plays" radius={[4, 4, 0, 0]} isAnimationActive={false}>{rankData.map((entry, index) => <Cell key={entry.rank} fill={entry.rank === "A" ? "#1f9d68" : entry.rank.includes("S") || entry.rank.includes("X") ? "#e0a325" : playerColor(index)} />)}</Bar></BarChart></ResponsiveContainer> : <EmptyState message="判定データがありません" />}
            </div>
          </div>
        </section>
      </>}

      <RecentScores player={player} mode={mode} />
    </div>
  );
}

function RecentScores({ player, mode }: { player: StatisticsPlayer; mode: OsuMode }) {
  const scores = player.modes[mode].scores.slice(0, 30);
  return (
    <section className="cp-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#e2e6eb] px-5 py-4"><div><h3 className="text-sm font-semibold">最近のリザルト</h3><p className="mt-1 text-[11px] text-[#818b99]">DB保存分 · 最大30件</p></div><Medal className="size-4 text-[#7d8795]" /></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[0.07em] text-[#7d8795]"><tr><th className="px-5 py-3">#</th><th className="px-4 py-3">Beatmap</th><th className="px-4 py-3 text-center">Rank</th><th className="px-4 py-3">Mods</th><th className="px-4 py-3 text-right">PP</th><th className="px-4 py-3 text-right">Accuracy</th><th className="px-4 py-3 text-right">Combo</th><th className="px-5 py-3 text-right">Played</th></tr></thead>
          <tbody className="divide-y divide-[#e8ebef]">
            {scores.map((score, index) => <tr key={score.id} className="hover:bg-[#fbfcfd]"><td className="px-5 py-3 font-mono text-[#9199a5]">{index + 1}</td><td className="max-w-[420px] px-4 py-3"><a href={`https://osu.ppy.sh/beatmaps/${score.beatmapId}`} target="_blank" rel="noreferrer" className="block truncate font-medium text-[#27303b] hover:text-[#0051c3] hover:underline">{score.artist} — {score.title} [{score.difficulty}]</a><p className="mt-1 truncate text-[10px] text-[#8a94a3]">{score.mapper ? `mapped by ${score.mapper}` : `score ${score.osuScoreId}`}</p></td><td className="px-4 py-3 text-center"><span className={`inline-flex min-w-8 justify-center rounded px-2 py-1 font-mono text-[10px] font-semibold ${rankTone(score.rank)}`}>{score.rank}</span></td><td className="px-4 py-3 font-mono text-[10px] text-[#596477]">{score.mods.length ? `+${score.mods.join("")}` : "NM"}</td><td className="px-4 py-3 text-right font-mono font-semibold">{score.pp === null ? "—" : formatNumber(score.pp, 2)}</td><td className="px-4 py-3 text-right font-mono">{formatAccuracy(score.accuracy * 100)}</td><td className="px-4 py-3 text-right font-mono">{formatNumber(score.maxCombo)}</td><td className="px-5 py-3 text-right text-[#6c7788]">{formatDate(score.endedAt)}</td></tr>)}
            {!scores.length ? <tr><td colSpan={8} className="px-5 py-14 text-center text-[#8a94a3]">このモードの保存済みリザルトはありません。</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlayerSelect({ label, value, players, onChange }: { label: string; value: string; players: StatisticsPlayer[]; onChange: (id: string) => void }) {
  return <label className="block min-w-[190px] text-[10px] font-semibold uppercase tracking-[0.08em] text-[#778294]">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="cp-select mt-1.5 normal-case tracking-normal">{players.map((player) => <option key={player.id} value={player.id}>{player.username}</option>)}</select></label>;
}

function clampRange(range: ChartZoomRange, total: number): ChartZoomRange {
  if (total <= 1) return { startIndex: 0, endIndex: 0 };
  const last = Math.max(0, total - 1);
  let startIndex = Math.min(range.startIndex, range.endIndex);
  let endIndex = Math.max(range.startIndex, range.endIndex);
  const width = Math.min(last, Math.max(0, endIndex - startIndex));
  if (startIndex < 0) {
    startIndex = 0;
    endIndex = width;
  }
  if (endIndex > last) {
    endIndex = last;
    startIndex = last - width;
  }
  startIndex = Math.max(0, Math.min(startIndex, last));
  endIndex = Math.max(startIndex, Math.min(endIndex, last));
  return { startIndex, endIndex };
}

function comparisonItemsFromPayload(payload: TooltipContentProps["payload"], metric: Metric) {
  return (payload ?? [])
    .filter((item) => item.value !== null && item.value !== undefined && Number.isFinite(Number(item.value)))
    .map((item) => ({
      key: String(item.dataKey ?? item.name),
      name: String(item.name ?? item.dataKey),
      value: Number(item.value),
      color: String(item.color ?? item.stroke ?? "#64748b"),
    }))
    .sort((left, right) => metric === "globalRank" ? left.value - right.value : right.value - left.value);
}

function ComparisonTooltip({
  active,
  label,
  payload,
  metric,
  focusedPlayerId,
  totalPlayers,
}: TooltipContentProps & { metric: Metric; focusedPlayerId: string | null; totalPlayers: number }) {
  if (!active) return null;
  const items = comparisonItemsFromPayload(payload, metric);
  if (!items.length) return null;
  const focusedItem = focusedPlayerId ? items.find((item) => item.key === focusedPlayerId) : null;
  const visibleItems = focusedItem ? [focusedItem] : items.slice(0, 8);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  return (
    <div className="w-[260px] max-w-[calc(100vw-32px)] rounded-lg border border-[#d8dee7] bg-white/95 shadow-xl backdrop-blur">
      <div className="border-b border-[#e7eaf0] px-3 py-2">
        <p className="text-[10px] font-semibold text-[#1f2630]">{String(label)}</p>
        <p className="mt-0.5 text-[9px] text-[#7f8998]">{focusedItem ? "選択中のプレイヤー" : `上位${Math.min(8, items.length)} / ${totalPlayers}人`} · {METRICS.find((item) => item.key === metric)?.label}</p>
      </div>
      <div className="px-3 py-2">
        {visibleItems.map((item) => (
          <div key={item.key} className={`grid grid-cols-[1fr_auto] gap-3 rounded px-1.5 py-1.5 text-[10px] ${focusedPlayerId === item.key ? "bg-[#eef4fc]" : ""}`}>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="truncate text-[#4e5a6b]">{item.name}</span>
            </span>
            <strong className="font-mono text-[#1f2630]">{formatMetric(item.value, metric)}</strong>
          </div>
        ))}
      </div>
      {hiddenCount > 0 ? <p className="border-t border-[#e7eaf0] px-3 py-2 text-[9px] text-[#7f8998]">ほか{hiddenCount}人 · 下の一覧から選ぶと1人だけ詳しく表示</p> : null}
    </div>
  );
}

function ComparisonLegend({
  players,
  lockedPlayerId,
  hoveredPlayerId,
  onLock,
  onHover,
}: {
  players: StatisticsPlayer[];
  lockedPlayerId: string | null;
  hoveredPlayerId: string | null;
  onLock: (playerId: string | null) => void;
  onHover: (playerId: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const filteredPlayers = normalizedQuery
    ? players.filter((player) => player.username.toLocaleLowerCase("ja").includes(normalizedQuery))
    : players;
  const focusedPlayerId = hoveredPlayerId ?? lockedPlayerId;
  return (
    <div className="mt-3 rounded-lg border border-[#e2e7ee] bg-[#fbfcfe] p-2">
      <div className="mb-2 flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#7c8796]">Player focus</p>
          <p className="mt-0.5 text-[9px] text-[#8a94a3]">クリックで固定 · もう一度クリックで解除</p>
        </div>
        <label className="relative block sm:w-52">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[#8a94a3]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="プレイヤーを検索"
            aria-label="比較するプレイヤーを検索"
            className="h-8 w-full rounded-md border border-[#dce2e9] bg-white pl-7 pr-2 text-[10px] text-[#394456] outline-none transition focus:border-[#8eb5e8] focus:ring-2 focus:ring-[#dceaff]"
          />
        </label>
      </div>
      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto overscroll-contain pr-1">
        <button
          type="button"
          onClick={() => onLock(null)}
          aria-pressed={lockedPlayerId === null}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-medium transition ${lockedPlayerId === null ? "border-[#9abbe6] bg-[#eef4fc] text-[#0051c3]" : "border-[#e1e6ed] bg-white text-[#596477] hover:border-[#c8d8ee]"}`}
        >
          全員
        </button>
        {filteredPlayers.map((player) => {
          const index = players.findIndex((item) => item.id === player.id);
          const locked = lockedPlayerId === player.id;
          const active = focusedPlayerId === player.id;
          const muted = focusedPlayerId !== null && !active;
          return (
            <button
              key={player.id}
              type="button"
              onMouseEnter={() => onHover(player.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(player.id)}
              onBlur={() => onHover(null)}
              onClick={() => onLock(locked ? null : player.id)}
              aria-pressed={locked}
              className={`inline-flex max-w-[180px] items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-medium transition ${locked ? "border-[#7da9df] bg-[#e8f1fc] text-[#0051c3] ring-1 ring-[#bdd3ef]" : active ? "border-[#b9cde7] bg-white text-[#294f7c]" : "border-[#e1e6ed] bg-white text-[#596477] hover:border-[#c8d8ee]"} ${muted ? "opacity-35" : "opacity-100"}`}
              title={player.username}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: playerColor(index, player.id) }} />
              <span className="truncate">{player.username}</span>
            </button>
          );
        })}
        {!filteredPlayers.length ? <p className="px-2 py-3 text-[10px] text-[#8a94a3]">該当するプレイヤーはいません。</p> : null}
      </div>
    </div>
  );
}

function DailyGrowthTooltip({
  active,
  label,
  payload,
  metric,
  focusedPlayerId,
}: TooltipContentProps & { metric: DailyGrowthMetric; focusedPlayerId: string | null }) {
  if (!active) return null;
  const items = (payload ?? [])
    .filter((item) => item.value !== null && item.value !== undefined && Number.isFinite(Number(item.value)))
    .map((item) => ({
      key: String(item.dataKey ?? item.name),
      name: String(item.name ?? item.dataKey),
      value: Number(item.value),
      color: String(item.color ?? item.stroke ?? "#64748b"),
    }))
    .sort((left, right) => right.value - left.value);
  const focusedItem = focusedPlayerId ? items.find((item) => item.key === focusedPlayerId) : null;
  const visibleItems = focusedItem ? [focusedItem] : items.slice(0, 8);
  if (!visibleItems.length) return null;
  return (
    <div className="w-[250px] max-w-[calc(100vw-32px)] rounded-lg border border-[#d8dee7] bg-white/95 p-3 shadow-xl backdrop-blur">
      <p className="text-[10px] font-semibold text-[#202833]">{String(label)}</p>
      <p className="mt-0.5 text-[9px] text-[#7f8998]">{DAILY_GROWTH_METRICS.find((item) => item.key === metric)?.label}</p>
      <div className="mt-2 border-t border-[#e7eaf0] pt-2">
        {visibleItems.map((item) => <div key={item.key} className="grid grid-cols-[1fr_auto] gap-3 py-1 text-[10px]"><span className="flex min-w-0 items-center gap-1.5"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><span className="truncate text-[#4e5a6b]">{item.name}</span></span><strong className={`font-mono ${item.value > 0 ? "text-emerald-700" : item.value < 0 ? "text-red-600" : "text-[#596477]"}`}>{formatDailyGrowth(item.value, metric)}</strong></div>)}
      </div>
      {!focusedItem && items.length > visibleItems.length ? <p className="mt-2 border-t border-[#e7eaf0] pt-2 text-[9px] text-[#7f8998]">ほか{items.length - visibleItems.length}人 · 下の一覧からフォーカスできます</p> : null}
    </div>
  );
}

function DailyGrowthChart({ players, mode, dense = false }: { players: StatisticsPlayer[]; mode: OsuMode; dense?: boolean }) {
  const [metric, setMetric] = useState<DailyGrowthMetric>("pp");
  const history = useMemo(() => mergedDailyGrowth(players, mode, metric), [players, mode, metric]);
  const [range, setRange] = useState<ChartZoomRange>(() => ({ startIndex: 0, endIndex: Math.max(0, history.length - 1) }));
  const [lockedPlayerId, setLockedPlayerId] = useState<string | null>(null);
  const [hoveredPlayerId, setHoveredPlayerId] = useState<string | null>(null);
  const focusedPlayerId = hoveredPlayerId ?? lockedPlayerId;
  const safeRange = clampRange(range, history.length);

  function selectCount(count: number) {
    setRange({ startIndex: Math.max(0, history.length - count), endIndex: Math.max(0, history.length - 1) });
  }

  function selectMetric(nextMetric: DailyGrowthMetric) {
    setMetric(nextMetric);
    setRange({ startIndex: 0, endIndex: Number.MAX_SAFE_INTEGER });
    setLockedPlayerId(null);
    setHoveredPlayerId(null);
  }

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1 rounded-lg bg-[#f1f3f6] p-1">
          {DAILY_GROWTH_METRICS.map((item) => <button key={item.key} type="button" onClick={() => selectMetric(item.key)} aria-pressed={metric === item.key} className={`rounded-md px-2.5 py-1.5 text-[9px] font-semibold transition ${metric === item.key ? "bg-white text-[#0051c3] shadow-sm" : "text-[#667184] hover:text-[#27303b]"}`}>{item.label}</button>)}
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => selectCount(30)} className="rounded-md border border-[#d9dee7] bg-white px-2.5 py-1.5 text-[9px] text-[#596477] hover:bg-[#f5f7f9]">直近30日</button>
          <button type="button" onClick={() => selectCount(90)} className="rounded-md border border-[#d9dee7] bg-white px-2.5 py-1.5 text-[9px] text-[#596477] hover:bg-[#f5f7f9]">直近90日</button>
          <button type="button" onClick={() => setRange({ startIndex: 0, endIndex: Math.max(0, history.length - 1) })} className="rounded-md border border-[#9abbe6] bg-[#eef4fc] px-2.5 py-1.5 text-[9px] font-semibold text-[#0051c3]">全期間</button>
        </div>
      </div>
      {!history.length ? <EmptyState message="日次差分を計算できる履歴がありません" /> : <>
        <div className={dense ? "h-[440px]" : "h-[310px]"}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ left: 6, right: 12, top: 12, bottom: 4 }} onMouseLeave={() => setHoveredPlayerId(null)}>
              <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} minTickGap={24} />
              <YAxis tick={{ fontSize: 10, fill: "#778294" }} tickFormatter={(value) => metric === "pp" ? `${formatNumber(Number(value), 1)}pp` : formatCompactNumber(Number(value))} tickLine={false} axisLine={false} width={68} />
              <ReferenceLine y={0} stroke="#aeb7c4" strokeWidth={1.2} />
              <Tooltip content={(props) => <DailyGrowthTooltip {...props} metric={metric} focusedPlayerId={focusedPlayerId} />} cursor={{ stroke: "#9aa8bb", strokeDasharray: "4 4" }} />
              {players.map((player, index) => {
                const focused = focusedPlayerId === player.id;
                const muted = focusedPlayerId !== null && !focused;
                return <Line key={player.id} type="linear" dataKey={player.id} name={player.username} stroke={playerColor(index, player.id)} strokeWidth={focused ? 3.2 : dense ? 1.45 : 2.3} strokeOpacity={muted ? 0.09 : focused ? 1 : dense ? 0.58 : 0.9} dot={false} activeDot={{ r: focused ? 5 : 3.5 }} connectNulls isAnimationActive={false} onMouseEnter={() => setHoveredPlayerId(player.id)} onMouseLeave={() => setHoveredPlayerId(null)} onClick={() => setLockedPlayerId((current) => current === player.id ? null : player.id)} />;
              })}
              <Brush dataKey="date" height={32} travellerWidth={10} startIndex={safeRange.startIndex} endIndex={safeRange.endIndex} onChange={(nextRange) => { if (typeof nextRange.startIndex === "number" && typeof nextRange.endIndex === "number") setRange(clampRange(nextRange, history.length)); }} tickFormatter={(value) => String(value).slice(5)} stroke={MODE_ACCENTS[mode]} fill="#f8fafc" ariaLabel="日次増加グラフの表示期間" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-center text-[9px] text-[#8791a0]">0より上は増加・順位上昇、下は減少です。下部バーで期間を変更できます。</p>
        {players.length > 1 ? <ComparisonLegend players={players} lockedPlayerId={lockedPlayerId} hoveredPlayerId={hoveredPlayerId} onLock={setLockedPlayerId} onHover={setHoveredPlayerId} /> : null}
      </>}
    </div>
  );
}

function FlourishExport({ players, mode }: { players: StatisticsPlayer[]; mode: OsuMode }) {
  const [metric, setMetric] = useState<FlourishMetric>("pp");
  const availablePlayers = players.filter((player) => player.modes[mode].snapshots.length > 0);
  return (
    <section className="cp-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#e2e6eb] px-5 py-4"><div><h3 className="text-sm font-semibold">Flourish バーチャートレース</h3><p className="mt-1 text-[11px] text-[#818b99]">プレイヤーを行、日付を列にしたWide形式CSV</p></div><FileSpreadsheet className="size-4 text-[#16a36f]" /></div>
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl text-[10px] leading-5 text-[#667184]">
          <p>FlourishのBar chart raceへそのまま読み込める累積値です。世界順位（レース向け）は、上位ほどバーが長くなるよう順位を反転した値です。</p>
          <p className="mt-1 font-mono text-[9px] text-[#8a94a3]">{availablePlayers.length} players · {MODE_LABELS[mode]}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block min-w-[220px] text-[10px] font-semibold uppercase tracking-[0.08em] text-[#778294]">Export metric<select value={metric} onChange={(event) => setMetric(event.target.value as FlourishMetric)} className="cp-select mt-1.5 normal-case tracking-normal">{FLOURISH_METRICS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <button type="button" onClick={() => downloadFlourishCsv(players, mode, metric)} disabled={!availablePlayers.length} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#146c43] px-4 text-xs font-semibold text-white transition hover:bg-[#105b38] disabled:cursor-not-allowed disabled:opacity-40"><Download className="size-3.5" />CSVをダウンロード</button>
        </div>
      </div>
    </section>
  );
}

function ComparisonChart({ players, mode, metric, dense = false }: { players: StatisticsPlayer[]; mode: OsuMode; metric: Metric; dense?: boolean }) {
  const history = useMemo(() => mergedHistory(players, mode, metric), [players, mode, metric]);
  const [range, setRange] = useState<ChartZoomRange>(() => ({ startIndex: 0, endIndex: Math.max(0, history.length - 1) }));
  const [dragSelection, setDragSelection] = useState<DragSelection | null>(null);
  const [interactionMode, setInteractionMode] = useState<ChartInteractionMode>("inspect");
  const [lockedPlayerId, setLockedPlayerId] = useState<string | null>(null);
  const [hoveredPlayerId, setHoveredPlayerId] = useState<string | null>(null);
  const dateToIndex = useMemo(() => new Map(history.map((row, index) => [row.date, index])), [history]);
  const focusedPlayerId = hoveredPlayerId ?? lockedPlayerId;
  if (!history.length) return <EmptyState message="比較できる履歴がありません" />;
  const safeRange = clampRange(range, history.length);
  const visibleCount = safeRange.endIndex - safeRange.startIndex + 1;
  const canZoomOut = visibleCount < history.length;

  function updateRange(nextRange: ChartZoomRange) {
    setRange(clampRange(nextRange, history.length));
  }

  function zoomBy(factor: number, anchorRatio = 0.5) {
    if (history.length <= 2) return;
    const current = clampRange(range, history.length);
    const currentWidth = current.endIndex - current.startIndex + 1;
    const nextWidth = Math.max(3, Math.min(history.length, Math.round(currentWidth * factor)));
    const anchor = current.startIndex + (currentWidth - 1) * anchorRatio;
    const startIndex = Math.round(anchor - (nextWidth - 1) * anchorRatio);
    updateRange({ startIndex, endIndex: startIndex + nextWidth - 1 });
  }

  function panBy(direction: -1 | 1) {
    const current = clampRange(range, history.length);
    const width = current.endIndex - current.startIndex + 1;
    const shift = Math.max(1, Math.round(width * 0.35)) * direction;
    updateRange({ startIndex: current.startIndex + shift, endIndex: current.endIndex + shift });
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (history.length <= 2 || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.width > 0 ? Math.max(0.05, Math.min(0.95, (event.clientX - bounds.left) / bounds.width)) : 0.5;
    zoomBy(event.deltaY < 0 ? 0.82 : 1.22, ratio);
  }

  function selectRecentDays(days: number) {
    const lastDate = Date.parse(`${history.at(-1)?.date}T00:00:00Z`);
    if (!Number.isFinite(lastDate)) return;
    const cutoff = lastDate - Math.max(0, days - 1) * 86_400_000;
    const startIndex = history.findIndex((row) => Date.parse(`${row.date}T00:00:00Z`) >= cutoff);
    updateRange({ startIndex: startIndex < 0 ? 0 : startIndex, endIndex: history.length - 1 });
  }

  function chartIndex(state: { activeLabel?: unknown } | null | undefined) {
    const label = typeof state?.activeLabel === "string" ? state.activeLabel : null;
    return label ? dateToIndex.get(label) ?? null : null;
  }

  function beginDrag(state: { activeLabel?: unknown } | null | undefined) {
    if (interactionMode !== "zoom") return;
    const index = chartIndex(state);
    if (index === null) return;
    const date = history[index]?.date;
    if (date) setDragSelection({ from: date, to: date });
  }

  function moveDrag(state: { activeLabel?: unknown } | null | undefined) {
    if (!dragSelection) return;
    const index = chartIndex(state);
    const date = index === null ? null : history[index]?.date;
    if (date) setDragSelection((current) => current ? { ...current, to: date } : current);
  }

  function endDrag() {
    if (!dragSelection) return;
    const from = dateToIndex.get(dragSelection.from);
    const to = dateToIndex.get(dragSelection.to);
    setDragSelection(null);
    if (from === undefined || to === undefined || Math.abs(from - to) < 2) return;
    updateRange({ startIndex: Math.min(from, to), endIndex: Math.max(from, to) });
    setInteractionMode("inspect");
  }

  const selectedPlayer = lockedPlayerId ? players.find((player) => player.id === lockedPlayerId) ?? null : null;
  const rangePresets = [30, 90, 180, 365];

  return (
    <div>
      <div className="mb-3 rounded-lg border border-[#e2e7ee] bg-[#fbfcfe] p-2.5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold text-[#394456]">期間を選択</p>
            <p className="mt-0.5 font-mono text-[9px] text-[#8a94a3]">{history[safeRange.startIndex]?.date} — {history[safeRange.endIndex]?.date} · {formatNumber(visibleCount)} / 全{formatNumber(history.length)}日</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {rangePresets.map((days) => <button key={days} type="button" onClick={() => selectRecentDays(days)} className="rounded-md border border-[#d9dee7] bg-white px-2.5 py-1.5 text-[9px] font-medium text-[#596477] transition hover:border-[#b8cce6] hover:bg-[#f5f8fc]">{days === 365 ? "1年" : `${days}日`}</button>)}
            <button type="button" onClick={() => updateRange({ startIndex: 0, endIndex: history.length - 1 })} disabled={!canZoomOut} className="rounded-md border border-[#9abbe6] bg-[#eef4fc] px-2.5 py-1.5 text-[9px] font-semibold text-[#0051c3] disabled:opacity-40">全期間</button>
          </div>
        </div>
        <div className="mt-2 flex flex-col gap-2 border-t border-[#e7ebf0] pt-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => setInteractionMode("inspect")} aria-pressed={interactionMode === "inspect"} className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[9px] font-semibold transition ${interactionMode === "inspect" ? "border-[#8eb5e8] bg-[#eaf2fc] text-[#0051c3]" : "border-[#d9dee7] bg-white text-[#596477]"}`}><MousePointerClick className="size-3" />見る</button>
            <button type="button" onClick={() => setInteractionMode("zoom")} aria-pressed={interactionMode === "zoom"} className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[9px] font-semibold transition ${interactionMode === "zoom" ? "border-[#8eb5e8] bg-[#eaf2fc] text-[#0051c3]" : "border-[#d9dee7] bg-white text-[#596477]"}`}><Crosshair className="size-3" />範囲ズーム</button>
            <span className="mx-0.5 hidden h-7 w-px bg-[#dfe4ea] sm:block" />
            <button type="button" onClick={() => zoomBy(0.72)} aria-label="横方向に拡大" title="横方向に拡大" className="inline-flex items-center gap-1 rounded-md border border-[#d9dee7] bg-white px-2 py-1.5 text-[9px] text-[#596477] hover:bg-[#f5f7f9]"><ZoomIn className="size-3" />拡大</button>
            <button type="button" onClick={() => zoomBy(1.35)} disabled={!canZoomOut} aria-label="横方向に縮小" title="横方向に縮小" className="inline-flex items-center gap-1 rounded-md border border-[#d9dee7] bg-white px-2 py-1.5 text-[9px] text-[#596477] hover:bg-[#f5f7f9] disabled:opacity-40"><ZoomOut className="size-3" />縮小</button>
            <button type="button" onClick={() => panBy(-1)} className="rounded-md border border-[#d9dee7] bg-white px-2 py-1.5 text-[9px] text-[#596477] hover:bg-[#f5f7f9]">← 前へ</button>
            <button type="button" onClick={() => panBy(1)} className="rounded-md border border-[#d9dee7] bg-white px-2 py-1.5 text-[9px] text-[#596477] hover:bg-[#f5f7f9]">次へ →</button>
          </div>
          <p className="text-[9px] text-[#7f8998]">{interactionMode === "zoom" ? "グラフ上を横にドラッグして範囲を選択" : "線やプレイヤー名をクリックして固定 · Ctrl + ホイールで拡大縮小"}</p>
        </div>
      </div>
      {selectedPlayer ? <div className="mb-2 flex items-center justify-between rounded-md border border-[#cbdcf0] bg-[#f2f7fd] px-3 py-2 text-[10px]"><span className="flex min-w-0 items-center gap-2 font-medium text-[#28527f]"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: playerColor(players.findIndex((player) => player.id === selectedPlayer.id), selectedPlayer.id) }} /><span className="truncate">{selectedPlayer.username} をフォーカス中</span></span><button type="button" onClick={() => setLockedPlayerId(null)} className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[9px] font-semibold text-[#0051c3] hover:bg-white"><RotateCcw className="size-3" />全員へ戻す</button></div> : null}
      <div
        className={`${dense ? "h-[520px]" : "h-[380px]"} select-none ${interactionMode === "zoom" ? "cursor-crosshair" : "cursor-default"}`}
        onWheel={handleWheel}
        onDoubleClick={() => updateRange({ startIndex: 0, endIndex: history.length - 1 })}
        style={{ touchAction: interactionMode === "zoom" ? "none" : "pan-y" }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={history}
            margin={{ left: 8, right: dense ? 18 : 8, top: 12, bottom: 6 }}
            onMouseDown={interactionMode === "zoom" ? beginDrag : undefined}
            onMouseMove={interactionMode === "zoom" ? moveDrag : undefined}
            onMouseUp={interactionMode === "zoom" ? endDrag : undefined}
            onMouseLeave={() => {
              setDragSelection(null);
              setHoveredPlayerId(null);
            }}
          >
            <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#778294" }} tickLine={false} minTickGap={22} />
            <YAxis reversed={metric === "globalRank"} tick={{ fontSize: 10, fill: "#778294" }} tickFormatter={(value) => metric === "accuracy" ? `${Number(value).toFixed(1)}%` : metric === "playTimeSeconds" ? `${formatNumber(Number(value) / 3_600, 0)}h` : formatCompactNumber(Number(value))} tickLine={false} axisLine={false} width={64} />
            <Tooltip content={(props) => <ComparisonTooltip {...props} metric={metric} focusedPlayerId={focusedPlayerId} totalPlayers={players.length} />} cursor={{ stroke: "#9aa8bb", strokeDasharray: "4 4" }} />
            {dragSelection ? <ReferenceArea x1={dragSelection.from} x2={dragSelection.to} strokeOpacity={0.2} fill="#0051c3" fillOpacity={0.08} /> : null}
            {players.map((player, index) => {
              const focused = focusedPlayerId === player.id;
              const muted = focusedPlayerId !== null && !focused;
              return (
                <Line
                  key={player.id}
                  type="monotone"
                  dataKey={player.id}
                  name={player.username}
                  stroke={playerColor(index, player.id)}
                  strokeWidth={focused ? 3.4 : dense ? 1.45 : 2.2}
                  strokeOpacity={muted ? 0.09 : focused ? 1 : dense ? 0.58 : 0.88}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={{ r: focused ? 5 : 3.6, strokeWidth: 1.5 }}
                  connectNulls
                  isAnimationActive={false}
                  onMouseEnter={() => setHoveredPlayerId(player.id)}
                  onMouseLeave={() => setHoveredPlayerId(null)}
                  onClick={() => setLockedPlayerId((current) => current === player.id ? null : player.id)}
                />
              );
            })}
            <Brush
              dataKey="date"
              height={34}
              travellerWidth={10}
              startIndex={safeRange.startIndex}
              endIndex={safeRange.endIndex}
              onChange={(nextRange) => {
                if (typeof nextRange.startIndex === "number" && typeof nextRange.endIndex === "number") updateRange(nextRange);
              }}
              tickFormatter={(value) => String(value).slice(5)}
              stroke={MODE_ACCENTS[mode]}
              fill="#f8fafc"
              ariaLabel="成長比較グラフの表示期間"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-center text-[9px] text-[#8a94a3]">下のミニバーは左右端をドラッグして期間変更 · グラフをダブルクリックで全期間へ戻す</p>
      <ComparisonLegend players={players} lockedPlayerId={lockedPlayerId} hoveredPlayerId={hoveredPlayerId} onLock={setLockedPlayerId} onHover={setHoveredPlayerId} />
    </div>
  );
}

function VersusView({ first, second, mode, metric }: { first: StatisticsPlayer; second: StatisticsPlayer; mode: OsuMode; metric: Metric }) {
  const pair = [first, second];
  const firstLatest = latestSnapshot(first.modes[mode]);
  const secondLatest = latestSnapshot(second.modes[mode]);
  const analyses = pair.map((player) => {
    const data = player.modes[mode];
    const pulse = calculatePulseHistory(data.scores, data.snapshots.map((snapshot) => ({ date: snapshot.date, pp: snapshot.pp, globalRank: snapshot.globalRank })), mode).at(-1) ?? null;
    return { pulse, skills: calculateSkillProfile(data.scores, mode) };
  });
  const versusSkillLabels = skillLabels(mode);
  const skillRows = [["aim", versusSkillLabels.aim], ["speed", versusSkillLabels.speed], ["precision", versusSkillLabels.precision], ["reading", versusSkillLabels.reading], ["endurance", versusSkillLabels.endurance]] as const;
  const rows: Array<{ label: string; metric: Metric }> = METRICS.map((item) => ({ label: item.label, metric: item.key }));
  return (
    <div className="space-y-5">
      <section className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
        {pair.map((player, index) => {
          const latest = latestSnapshot(player.modes[mode]);
          return <div key={player.id} className={`cp-panel p-5 ${index === 1 ? "lg:col-start-3" : ""}`}><div className="flex items-center gap-3"><PlayerAvatar player={player} /><div><p className="font-semibold">{player.username}</p><p className="mt-1 text-[10px] text-[#7c8796]">{MODE_LABELS[mode]} · {formatRank(latest?.globalRank)}</p></div><div className="ml-auto text-right"><p className="text-[8px] uppercase text-[#8992a0]">Pulse</p><p className="font-mono text-xl font-bold" style={{color:playerColor(index)}}>{analyses[index].pulse?.rollingIndex.toFixed(2) ?? "—"}</p></div></div><div className="mt-5 grid grid-cols-3 gap-3"><div><p className="text-[9px] uppercase text-[#8992a0]">PP</p><p className="mt-1 font-mono text-sm font-semibold">{latest ? formatNumber(latest.pp, 1) : "—"}</p></div><div><p className="text-[9px] uppercase text-[#8992a0]">Accuracy</p><p className="mt-1 font-mono text-sm font-semibold">{formatAccuracy(latest?.accuracy)}</p></div><div><p className="text-[9px] uppercase text-[#8992a0]">Plays</p><p className="mt-1 font-mono text-sm font-semibold">{formatNumber(latest?.playCount)}</p></div></div></div>;
        })}
        <div className="hidden items-center justify-center lg:flex"><span className="grid size-10 place-items-center rounded-full border border-[#d9dee7] bg-white font-mono text-[10px] font-bold text-[#788291]">VS</span></div>
      </section>
      {analyses[0].skills && analyses[1].skills ? <section className="cp-panel overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e6eb] px-5 py-4"><div><h3 className="text-sm font-semibold">スキル別勝負</h3><p className="mt-1 text-[11px] text-[#818b99]">上位30プレイからAim・速度・精密性・認識力・持久力を比較</p></div><Link href={`/compare/${first.osuUserId}/${second.osuUserId}?mode=${mode}`} target="_blank" className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#0051c3]">公開1v1を開く <ExternalLink className="size-3" /></Link></div><div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-5">{skillRows.map(([key,label])=>{const left=analyses[0].skills![key];const right=analyses[1].skills![key];return <article key={key} className="rounded-lg border border-[#dfe4ea] bg-[#fbfcfd] p-3"><p className="text-center text-[9px] font-semibold text-[#657083]">{label}</p><div className="mt-2 flex items-center justify-between gap-2 font-mono text-xs"><strong className={left>right?"text-[#0051c3]":"text-[#8490a0]"}>{left.toFixed(1)}</strong><span className="text-[8px] text-[#a0a8b3]">VS</span><strong className={right>left?"text-[#f48120]":"text-[#8490a0]"}>{right.toFixed(1)}</strong></div><div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-[#e8ecf1]"><span className="bg-[#0f67d8]" style={{width:`${left/(left+right||1)*100}%`}}/><span className="flex-1 bg-[#f48120]"/></div></article>})}</div></section> : null}
      <section className="cp-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e6eb] px-5 py-4"><div><h3 className="text-sm font-semibold">1v1 成長比較</h3><p className="mt-1 text-[11px] text-[#818b99]">{METRICS.find((item) => item.key === metric)?.label}</p></div><GitCompareArrows className="size-4 text-[#7d8795]" /></div>
        <div className="p-4 sm:p-5"><ComparisonChart key={`versus-${mode}-${metric}-${pair.map((player) => player.id).join("-")}`} players={pair} mode={mode} metric={metric} /></div>
      </section>
      <section className="cp-panel overflow-hidden">
        <div className="border-b border-[#e2e6eb] px-5 py-4"><h3 className="text-sm font-semibold">現在値の差</h3><p className="mt-1 text-[11px] text-[#818b99]">DB最新スナップショット同士</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-xs"><thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[0.08em] text-[#7d8795]"><tr><th className="px-5 py-3 text-left">Metric</th><th className="px-4 py-3 text-right">{first.username}</th><th className="px-4 py-3 text-right">{second.username}</th><th className="px-5 py-3 text-right">Lead</th></tr></thead><tbody className="divide-y divide-[#e8ebef]">{rows.map((row) => {const left = firstLatest ? metricValue(firstLatest, row.metric) : null;const right = secondLatest ? metricValue(secondLatest, row.metric) : null;const rawDelta = left === null || right === null ? null : Number(left) - Number(right);const delta = row.metric === "globalRank" && rawDelta !== null ? -rawDelta : rawDelta;return <tr key={row.metric}><th className="px-5 py-3 text-left font-medium text-[#4b5668]">{row.label}</th><td className="px-4 py-3 text-right font-mono">{formatMetric(left, row.metric)}</td><td className="px-4 py-3 text-right font-mono">{formatMetric(right, row.metric)}</td><td className={`px-5 py-3 text-right font-mono font-semibold ${delta === null || delta === 0 ? "text-[#8b94a1]" : delta > 0 ? "text-emerald-700" : "text-red-600"}`}>{delta === null ? "—" : `${delta > 0 ? first.username : delta < 0 ? second.username : "Tie"} ${delta === 0 ? "" : formatMetricMagnitude(delta, row.metric)}`}</td></tr>;})}</tbody></table></div>
      </section>
    </div>
  );
}

function SeasonRanking({ players, mode }: { players: StatisticsPlayer[]; mode: OsuMode }) {
  const guildIds = useMemo(() => [...new Set(players.flatMap((player) => player.guildIds))].sort(), [players]);
  const [guildId, setGuildId] = useState(guildIds[0] ?? "all");
  const month = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Tokyo" }).format(new Date()).slice(0, 7);
  const rows = useMemo(() => players
    .filter((player) => guildId === "all" || player.guildIds.includes(guildId))
    .flatMap((player) => {
      const data = player.modes[mode];
      const snapshots = data.snapshots.filter((snapshot) => snapshot.date.startsWith(month));
      const first = snapshots[0];
      const latest = snapshots.at(-1);
      if (!first || !latest) return [];
      const scores = data.scores.filter((score) => score.endedAt.slice(0, 7) === month);
      const ppGain = latest.pp - first.pp;
      const rankGain = first.globalRank !== null && latest.globalRank !== null ? first.globalRank - latest.globalRank : 0;
      const personalBests = scores.filter((score) => score.pp !== null && score.passed).length;
      const points = Math.round(Math.max(0, ppGain) * 100 + Math.max(0, rankGain) / 10 + scores.length * 5 + personalBests * 2);
      return [{ player, ppGain, rankGain, plays: scores.length, points, currentPp: latest.pp }];
    })
    .sort((left, right) => right.points - left.points || right.ppGain - left.ppGain), [players, mode, month, guildId]);

  return <section className="cp-panel overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e6eb] px-5 py-4"><div><h3 className="text-sm font-semibold">サーバー内シーズンランキング</h3><p className="mt-1 text-[11px] text-[#818b99]">{month} · PP増加・順位上昇・プレイ数をポイント化</p></div>{guildIds.length ? <select value={guildId} onChange={(event) => setGuildId(event.target.value)} className="cp-select w-auto min-w-52"><option value="all">登録サーバー全体</option>{guildIds.map((id) => <option key={id} value={id}>Server {id}</option>)}</select> : null}</div>
    <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-xs"><thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[0.08em] text-[#7d8795]"><tr><th className="px-5 py-3 text-left">#</th><th className="px-4 py-3 text-left">Player</th><th className="px-4 py-3 text-right">Season pts</th><th className="px-4 py-3 text-right">PP gain</th><th className="px-4 py-3 text-right">Rank gain</th><th className="px-5 py-3 text-right">Plays</th></tr></thead><tbody className="divide-y divide-[#e8ebef]">{rows.map((row, index) => <tr key={row.player.id} className={index < 3 ? "bg-amber-50/40" : "hover:bg-[#fbfcfd]"}><td className="px-5 py-3 font-mono font-semibold">{index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : index + 1}</td><td className="px-4 py-3 font-medium">{row.player.username}<span className="ml-2 font-mono text-[9px] text-[#8b94a1]">{formatNumber(row.currentPp, 1)}pp</span></td><td className="px-4 py-3 text-right font-mono font-bold text-[#f48120]">{formatNumber(row.points)}</td><td className="px-4 py-3 text-right font-mono text-emerald-700">{row.ppGain >= 0 ? "+" : ""}{formatNumber(row.ppGain, 1)}pp</td><td className="px-4 py-3 text-right font-mono">{row.rankGain >= 0 ? "+" : ""}{formatNumber(row.rankGain)}</td><td className="px-5 py-3 text-right font-mono">{formatNumber(row.plays)}</td></tr>)}{!rows.length ? <tr><td colSpan={6} className="px-5 py-10 text-center text-[#8b94a1]">今月の比較可能な日次スナップショットがまだありません。</td></tr> : null}</tbody></table></div>
    <p className="border-t border-[#edf0f3] px-5 py-3 text-[9px] text-[#8791a0]">Season points = PP増加×100 + 順位上昇÷10 + 保存プレイ×5 + 成功プレイ×2。毎月1日に自動で新シーズンへ切り替わります。</p>
  </section>;
}

function AllPlayerEfficiency({ players, mode }: { players: StatisticsPlayer[]; mode: OsuMode }) {
  const [modGroup, setModGroup] = useState<EfficiencyModGroup>("NM");
  const [efficiencyMetric, setEfficiencyMetric] = useState<EfficiencyMetric>("perStar");
  const allRows = useMemo(() => players.flatMap((player) => player.modes[mode].scores.flatMap((score) => {
    if (score.pp === null || !score.passed) return [];
    const group = efficiencyModGroup(score);
    if (!group) return [];
    const perStar = score.starRating && score.starRating > 0 ? score.pp / score.starRating : null;
    const perMinute = score.beatmapLengthSeconds && score.beatmapLengthSeconds > 0 ? score.pp / (score.beatmapLengthSeconds / 60) : null;
    if (perStar === null && perMinute === null) return [];
    return [{ player, score, group, perStar, perMinute }];
  })), [mode, players]);
  const groupCounts = Object.fromEntries(EFFICIENCY_MOD_GROUPS.map(({ key }) => [key, allRows.filter((row) => row.group === key).length])) as Record<EfficiencyModGroup, number>;
  const eligibleRows = allRows.filter((row) => row.group === modGroup && row[efficiencyMetric] !== null);
  const rows = [...eligibleRows]
    .sort((left, right) => (right[efficiencyMetric] ?? 0) - (left[efficiencyMetric] ?? 0))
    .slice(0, 50);
  const metricValues = rows.flatMap((row) => row[efficiencyMetric] === null ? [] : [row[efficiencyMetric]!]);
  const average = metricValues.length ? metricValues.reduce((sum, value) => sum + value, 0) / metricValues.length : null;
  const playerCount = new Set(eligibleRows.map((row) => row.player.id)).size;

  return <section className="cp-panel overflow-hidden">
    <div className="flex flex-col gap-3 border-b border-[#e2e6eb] px-5 py-4 xl:flex-row xl:items-center xl:justify-between"><div><h3 className="text-sm font-semibold">全プレイヤー効率上位譜面</h3><p className="mt-1 text-[11px] text-[#818b99]">全登録プレイヤーの保存リザルトを統合 · NM・HD・DTを別ランキングで集計</p></div><div className="flex flex-wrap items-center gap-2"><div className="flex flex-wrap rounded-md border border-[#d9dee7] bg-[#f5f7f9] p-0.5">{EFFICIENCY_MOD_GROUPS.map(({ key, label }) => <button key={key} type="button" onClick={() => setModGroup(key)} className={`rounded px-2.5 py-1.5 text-[9px] font-semibold transition ${modGroup === key ? "bg-white text-[#0051c3] shadow-sm" : "text-[#6f7a8b]"}`}>{label} <span className="ml-1 font-mono text-[8px] text-[#939ba6]">{groupCounts[key]}</span></button>)}</div><div className="flex rounded-md border border-[#d9dee7] bg-[#f5f7f9] p-0.5">{(["perStar", "perMinute"] as EfficiencyMetric[]).map((metric) => <button key={metric} type="button" onClick={() => setEfficiencyMetric(metric)} className={`rounded px-2.5 py-1.5 text-[9px] font-semibold transition ${efficiencyMetric === metric ? "bg-white text-[#0051c3] shadow-sm" : "text-[#6f7a8b]"}`}>{metric === "perStar" ? "PP/★" : "PP/分"}</button>)}</div></div></div>
    <div className="grid grid-cols-3 border-b border-[#e8ebef] bg-[#fbfcfd]">{[["対象リザルト", `${formatNumber(eligibleRows.length)}件`], ["参加プレイヤー", `${formatNumber(playerCount)}人`], ["上位50件平均", average === null ? "—" : efficiencyMetric === "perStar" ? `${formatNumber(average, 2)} PP/★` : `${formatNumber(average, 2)} PP/分`]].map(([label, value]) => <div key={label} className="border-r border-[#e8ebef] px-4 py-3 last:border-r-0"><p className="text-[8px] font-semibold uppercase tracking-[0.06em] text-[#8a94a3]">{label}</p><p className="mt-1 font-mono text-sm font-semibold text-[#26303d]">{value}</p></div>)}</div>
    <div className="max-h-[620px] overflow-auto"><table className="w-full min-w-[940px] text-left text-xs"><thead className="sticky top-0 z-10 bg-white text-[9px] uppercase tracking-[0.06em] text-[#7d8795]"><tr><th className="px-5 py-3"># / Player</th><th className="px-4 py-3">Beatmap</th><th className="px-3 py-3 text-center">Rank</th><th className="px-3 py-3">Mods</th><th className="px-3 py-3 text-right">PP</th><th className="px-3 py-3 text-right">★</th><th className="px-3 py-3 text-right">Length</th><th className="px-3 py-3 text-right">PP/★</th><th className="px-5 py-3 text-right">PP/min</th></tr></thead><tbody className="divide-y divide-[#e8ebef]">{rows.map(({ player, score, perStar, perMinute }, index) => <tr key={`${player.id}-${score.id}`} className="hover:bg-[#f8fafc]"><td className="px-5 py-3"><div className="flex items-center gap-2"><span className={`grid size-6 shrink-0 place-items-center rounded font-mono text-[9px] font-bold ${index < 3 ? "bg-[#fff3d6] text-[#8a5a00]" : "bg-[#eef1f5] text-[#6f7a8b]"}`}>{index + 1}</span><Link href={`/players/${player.osuUserId}?mode=${mode}`} className="font-semibold text-[#26303d] hover:text-[#0051c3] hover:underline">{player.username}</Link></div></td><td className="max-w-[360px] px-4 py-3"><a href={`https://osu.ppy.sh/scores/${score.osuScoreId}`} target="_blank" rel="noreferrer" className="block truncate font-medium text-[#26303d] hover:text-[#0051c3] hover:underline">{score.artist} — {score.title} [{score.difficulty}]</a><p className="mt-0.5 text-[8px] text-[#8b94a1]">{formatDate(score.endedAt, true)}</p></td><td className="px-3 py-3 text-center font-mono font-semibold" style={{ color: RANK_VISUALS[normalizeRank(score.rank)].color }}>{score.rank}</td><td className="px-3 py-3 font-mono text-[10px]">{score.mods.length ? `+${score.mods.join("")}` : "NM"}</td><td className="px-3 py-3 text-right font-mono font-semibold">{formatNumber(score.pp, 2)}</td><td className="px-3 py-3 text-right font-mono">{score.starRating === null ? "—" : formatNumber(score.starRating, 2)}</td><td className="px-3 py-3 text-right font-mono">{score.beatmapLengthSeconds === null ? "—" : `${Math.floor(score.beatmapLengthSeconds / 60)}:${String(score.beatmapLengthSeconds % 60).padStart(2, "0")}`}</td><td className={`px-3 py-3 text-right font-mono font-semibold ${efficiencyMetric === "perStar" ? "text-[#0051c3]" : ""}`}>{perStar === null ? "—" : formatNumber(perStar, 2)}</td><td className={`px-5 py-3 text-right font-mono font-semibold ${efficiencyMetric === "perMinute" ? "text-[#0051c3]" : ""}`}>{perMinute === null ? "—" : formatNumber(perMinute, 2)}</td></tr>)}{!rows.length ? <tr><td colSpan={9} className="px-5 py-12 text-center text-[#8b94a1]">{MODE_LABELS[mode]}の{EFFICIENCY_MOD_GROUPS.find((item) => item.key === modGroup)?.label}効率データがありません。</td></tr> : null}</tbody></table></div>
    <p className="border-t border-[#edf0f3] px-5 py-3 text-[9px] text-[#8791a0]">上位50件を表示。CLのみのプレイはNMとして扱い、HD+DT/NCは独立した区分へ分離しています。</p>
  </section>;
}

function EveryoneView({ players, mode, metric }: { players: StatisticsPlayer[]; mode: OsuMode; metric: Metric }) {
  const rows = players.map((player) => ({ player, latest: latestSnapshot(player.modes[mode]) })).sort((left, right) => {
    if (!left.latest) return 1;
    if (!right.latest) return -1;
    const leftValue = metricValue(left.latest, metric) ?? 0;
    const rightValue = metricValue(right.latest, metric) ?? 0;
    return metric === "globalRank" ? Number(leftValue) - Number(rightValue) : Number(rightValue) - Number(leftValue);
  });
  const chartPlayers = rows.filter((row) => row.latest).map((row) => row.player);
  const barData = rows.filter((row) => row.latest).map((row) => ({ name: row.player.username, value: metricValue(row.latest!, metric) }));
  return (
    <div className="space-y-5">
      <SeasonRanking players={players} mode={mode} />
      <AllPlayerEfficiency players={players} mode={mode} />
      <section className="cp-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#e2e6eb] px-5 py-4"><div><h3 className="text-sm font-semibold">全員の成長比較</h3><p className="mt-1 text-[11px] text-[#818b99]">登録済み {players.length}人 · {MODE_LABELS[mode]}</p></div><UsersRound className="size-4 text-[#7d8795]" /></div>
        <div className="p-4 sm:p-5"><ComparisonChart key={`everyone-${mode}-${metric}-${chartPlayers.map((player) => player.id).join("-")}`} players={chartPlayers} mode={mode} metric={metric} dense /></div>
      </section>
      <section className="cp-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#e2e6eb] px-5 py-4"><div><h3 className="text-sm font-semibold">全員の1日あたり成長</h3><p className="mt-1 text-[11px] text-[#818b99]">PP・順位・総スコアの日次増加量</p></div><ArrowUpRight className="size-4 text-emerald-600" /></div>
        <div className="p-4 sm:p-5"><DailyGrowthChart key={`daily-everyone-${mode}-${chartPlayers.map((player) => player.id).join("-")}`} players={chartPlayers} mode={mode} dense /></div>
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,.8fr)]">
        <div className="cp-panel overflow-hidden"><div className="border-b border-[#e2e6eb] px-5 py-4"><h3 className="text-sm font-semibold">Leaderboard</h3><p className="mt-1 text-[11px] text-[#818b99]">最新DB値で並び替え</p></div><div className="overflow-x-auto"><table className="w-full min-w-[640px] text-xs"><thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[0.08em] text-[#7d8795]"><tr><th className="px-5 py-3 text-left">#</th><th className="px-4 py-3 text-left">Player</th><th className="px-4 py-3 text-right">{METRICS.find((item) => item.key === metric)?.label}</th><th className="px-4 py-3 text-right">30d/DB gain</th><th className="px-5 py-3 text-right">Updated</th></tr></thead><tbody className="divide-y divide-[#e8ebef]">{rows.map((row, index) => {const history=row.player.modes[mode].snapshots;const baseline=metric==="playTimeSeconds"?history.find((snapshot)=>snapshot.playTimeSeconds!==null)??null:history[0]??null;const delta=metricDelta(baseline,row.latest,metric);return <tr key={row.player.id} className="hover:bg-[#fbfcfd]"><td className="px-5 py-3 font-mono text-[#8b94a1]">{index+1}</td><td className="px-4 py-3"><div className="flex items-center gap-2.5"><PlayerAvatar player={row.player} size={32}/><div><p className="font-medium">{row.player.username}</p><p className="mt-0.5 font-mono text-[9px] text-[#8b94a1]">{row.player.countryCode??"—"} · {row.player.osuUserId}</p></div></div></td><td className="px-4 py-3 text-right font-mono font-semibold">{row.latest?formatMetric(metricValue(row.latest,metric),metric):"No data"}</td><td className={`px-4 py-3 text-right font-mono ${delta===null||delta===0?"text-[#8b94a1]":delta>0?"text-emerald-700":"text-red-600"}`}>{delta===null?"—":`${delta>0?"+":""}${formatMetricMagnitude(delta,metric)}`}</td><td className="px-5 py-3 text-right text-[#6d7889]">{row.latest?row.latest.date:"—"}</td></tr>;})}</tbody></table></div></div>
        <div className="cp-panel overflow-hidden"><div className="border-b border-[#e2e6eb] px-5 py-4"><h3 className="text-sm font-semibold">現在値</h3><p className="mt-1 text-[11px] text-[#818b99]">横並び比較</p></div><div className="h-[390px] p-4">{barData.length?<ResponsiveContainer width="100%" height="100%"><BarChart data={barData} layout="vertical" margin={{left:16,right:16}}><CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" horizontal={false}/><XAxis type="number" reversed={metric==="globalRank"} tick={{fontSize:9}} tickFormatter={(value)=>metric==="playTimeSeconds"?`${formatNumber(Number(value)/3_600,0)}h`:formatCompactNumber(Number(value))}/><YAxis type="category" dataKey="name" width={88} tick={{fontSize:10}} tickLine={false}/><Tooltip formatter={(value)=>formatMetric(Number(value),metric)} contentStyle={{borderRadius:8,fontSize:11}}/><Bar dataKey="value" name={METRICS.find((item)=>item.key===metric)?.label} radius={[0,4,4,0]} isAnimationActive={false}>{barData.map((item,index)=><Cell key={item.name} fill={playerColor(index)}/>)}</Bar></BarChart></ResponsiveContainer>:<EmptyState message="表示できる現在値がありません"/>}</div></div>
      </section>
      <FlourishExport players={players} mode={mode} />
    </div>
  );
}

export function PlayerStatistics({ dataset }: { dataset: PlayerStatisticsDataset }) {
  const [mode, setMode] = useState<OsuMode>("osu");
  const [view, setView] = useState<View>("player");
  const [metric, setMetric] = useState<Metric>("pp");
  const [primaryId, setPrimaryId] = useState(dataset.players[0]?.id ?? "");
  const [secondaryId, setSecondaryId] = useState(dataset.players[1]?.id ?? dataset.players[0]?.id ?? "");
  const availablePlayers = useMemo(() => dataset.players.filter((player) => hasModeData(player, mode)), [dataset.players, mode]);
  const primary = dataset.players.find((player) => player.id === primaryId) ?? availablePlayers[0] ?? dataset.players[0];
  const secondary = dataset.players.find((player) => player.id === secondaryId && player.id !== primary?.id) ?? availablePlayers.find((player) => player.id !== primary?.id) ?? dataset.players.find((player) => player.id !== primary?.id) ?? primary;

  if (!primary) return <EmptyState message="登録プレイヤーがいません" />;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Player intelligence</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">プレイヤー統計</h1><p className="mt-1 text-sm text-[#6f7a8c]">DBのスナップショットとリザルトから、個人・1v1・全員をモード別に比較します。</p></div>
        <p className="font-mono text-[9px] text-[#9199a5]">DB snapshot · {formatDate(dataset.generatedAt, true)}</p>
      </div>

      <section className="cp-panel mt-6 p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-wrap gap-1 rounded-lg bg-[#f1f3f6] p-1">
            {OSU_MODES.map((item) => <button key={item} type="button" onClick={() => setMode(item)} className={`rounded-md px-3 py-2 text-xs font-semibold transition ${mode === item ? "bg-white text-[#202732] shadow-sm" : "text-[#667184] hover:text-[#242b35]"}`}><span className="mr-1.5 inline-block size-1.5 rounded-full" style={{background:MODE_ACCENTS[item]}} />{MODE_LABELS[item]}</button>)}
          </div>
          <div className="flex flex-wrap gap-2">
            {([{key:"player",label:"個人",icon:Trophy},{key:"versus",label:"1v1",icon:GitCompareArrows},{key:"everyone",label:"全員比較",icon:UsersRound}] as const).map((item)=>{const Icon=item.icon;return <button key={item.key} type="button" onClick={()=>setView(item.key)} className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium transition ${view===item.key?"border-[#9abbe6] bg-[#eef4fc] text-[#0051c3]":"border-[#d9dee7] bg-white text-[#596477] hover:bg-[#f7f8fa]"}`}><Icon className="size-3.5"/>{item.label}</button>;})}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-[#e6e9ed] pt-4">
          {view !== "everyone" ? <PlayerSelect label={view === "versus" ? "Player 1" : "Player"} value={primary.id} players={dataset.players} onChange={setPrimaryId} /> : null}
          {view === "versus" ? <PlayerSelect label="Player 2" value={secondary?.id ?? ""} players={dataset.players.filter((player) => player.id !== primary.id)} onChange={setSecondaryId} /> : null}
          {view !== "player" ? <label className="block min-w-[180px] text-[10px] font-semibold uppercase tracking-[0.08em] text-[#778294]">Metric<select value={metric} onChange={(event)=>setMetric(event.target.value as Metric)} className="cp-select mt-1.5 normal-case tracking-normal">{METRICS.map((item)=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label> : null}
          <div className="ml-auto flex items-center gap-2 rounded-md bg-[#f7f8fa] px-3 py-2 text-[10px] text-[#768191]"><CalendarDays className="size-3.5" /> {availablePlayers.length}/{dataset.players.length}人に{MODE_LABELS[mode]}データあり</div>
        </div>
      </section>

      <div className="mt-5">
        {view === "player" ? <PlayerOverview player={primary} mode={mode} /> : null}
        {view === "versus" && secondary ? <VersusView first={primary} second={secondary} mode={mode} metric={metric} /> : null}
        {view === "everyone" ? <EveryoneView players={dataset.players} mode={mode} metric={metric} /> : null}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#dfe4ea] bg-white px-4 py-3 text-[10px] text-[#7c8796]"><span>数値はosu! APIからDBへ保存された時点のものです。未保存のAim/Tap PPなどは表示していません。</span><span className="flex items-center gap-1 font-mono"><ArrowUpRight className="size-3 text-emerald-600" /> improvement <ArrowDownRight className="ml-2 size-3 text-red-500" /> decline</span></div>
    </div>
  );
}

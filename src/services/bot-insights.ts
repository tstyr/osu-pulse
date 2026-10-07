import { getBotDiskHistory, getBotHeatmap, getBotInsightSamples } from "../db/bot-insights-repository";
import { botStatisticsGuildId, getBotTelemetryAggregate, type BotTelemetryAggregate } from "../db/bot-telemetry-repository";
import { BOT_STATISTIC_METRICS, type BotMetricKey, type BotStatisticsData, type BotStatisticsRange } from "../lib/bot-statistics";
import type { BotComparisonMetric, BotDiskHistory, BotHeatmapCell, BotInsightSample, BotInsights, BotInsightsInput } from "../lib/bot-insights";

const DAY_MS = 86_400_000;
const LATEST_METRICS = new Set<BotMetricKey>(["storedScores", "uniqueBeatmaps", "osuLifetimePlayCount", "osuLifetimePlaySeconds", "dbBytes", "dbRows", "diskUsedBytes", "diskTotalBytes", "videoBytes", "audioBytes", "trackedPlayers"]);

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function coverage(seconds: number | undefined, periodSeconds: number) {
  return seconds === undefined || !Number.isFinite(seconds) || periodSeconds <= 0 ? null : Math.max(0, Math.min(100, seconds / periodSeconds * 100));
}

export function botComparisonPeriod(range: BotStatisticsRange, from: Date, to: Date) {
  if (range === "all") return null;
  const days = range === "today" ? 1 : range === "week" ? 7 : 30;
  return { from: new Date(from.getTime() - days * DAY_MS), to: new Date(to.getTime() - days * DAY_MS), label: range === "today" ? "前日の同じ経過時間" : range === "week" ? "前週の同じ経過時間" : "前30日の同じ経過時間" };
}

export function buildBotComparison(input: BotInsightsInput, previous: BotTelemetryAggregate | null): BotInsights["comparison"] {
  const from = new Date(input.from); const to = new Date(input.to);
  const period = botComparisonPeriod(input.range, from, to);
  const elapsedSeconds = Math.max(0, (to.getTime() - from.getTime()) / 1_000);
  const currentCoveragePercent = coverage(input.coverage?.observedSeconds, elapsedSeconds);
  const previousCoveragePercent = previous ? coverage(previous.observedSeconds, elapsedSeconds) : null;
  if (!period) return { status: "not_applicable", label: "全期間", from: null, to: null, elapsedSeconds, currentCoveragePercent, previousCoveragePercent: null, metrics: [], note: "全期間には対応する前期間がないため比較しません。" };
  const enough = (input.coverage?.sampleCount ?? 0) >= 3 && (previous?.sampleCount ?? 0) >= 3
    && (currentCoveragePercent ?? 0) >= 50 && (previousCoveragePercent ?? 0) >= 50;
  const metrics: BotComparisonMetric[] = (Object.keys(BOT_STATISTIC_METRICS) as BotMetricKey[]).map((metric) => {
    const definition = BOT_STATISTIC_METRICS[metric];
    const aggregation = definition.kind === "delta" ? "total" : LATEST_METRICS.has(metric) ? "latest" : "average";
    const current = finite(input.summary[metric]?.[aggregation]);
    const before = finite(previous?.summary[metric]?.[aggregation]);
    const available = current !== null && before !== null;
    const change = available ? current - before : null;
    return {
      metric, label: `${definition.label}（${aggregation === "total" ? "期間合計" : aggregation === "latest" ? "累計・最新" : "期間平均"}）`, aggregation,
      current, previous: before, change, changePercent: available && before > 0 && enough ? change! / before * 100 : null,
      status: !available || !enough ? "insufficient" : before === 0 ? "zero_baseline" : "ready",
    };
  });
  return {
    status: enough && metrics.some((metric) => metric.status !== "insufficient") ? "ready" : "insufficient", label: period.label, from: period.from.toISOString(), to: period.to.toISOString(), elapsedSeconds,
    currentCoveragePercent, previousCoveragePercent, metrics,
    note: `${enough ? "同じ長さ・同じJST時刻で比較しています。" : "双方3サンプル以上・観測率50%以上になるまで増減率は表示しません。差分値は観測分の参考値です。"} 期間合計と平均、累計スナップショットは別の指標です。基準0の増減率は計算しません。`,
  };
}

export function buildBotDiskForecast(scope: string, summary: BotStatisticsData["summary"], history: BotDiskHistory | null, now: Date): BotInsights["disk"] {
  const rawUsed = finite(summary.diskUsedBytes?.latest); const rawTotal = finite(summary.diskTotalBytes?.latest);
  const valid = scope === "global" && rawUsed !== null && rawTotal !== null && rawTotal > 0 && rawUsed <= rawTotal;
  const usedBytes = valid ? rawUsed : null; const totalBytes = valid ? rawTotal : null;
  const result: BotInsights["disk"] = {
    status: scope === "global" ? "insufficient" : "not_applicable", usedBytes, totalBytes,
    freeBytes: valid ? rawTotal - rawUsed : null, usedPercent: valid ? rawUsed / rawTotal * 100 : null,
    bytesPerDay: null, daysUntilFull: null, projectedFullAt: null,
    observedDays: 0, observations: history?.observations ?? 0, from: null, to: null, cleanupCount: 0,
    note: scope === "global" ? "同じ総容量で3日以上・48時間以上の記録と新しい計測が必要です。" : "PCディスク容量はBot全体の統計です。サーバー別の予測には複製しません。",
  };
  if (!valid || !history?.points.length) return result;
  const sorted = history.points.filter((point) => Number.isFinite(Date.parse(point.at)) && finite(point.usedBytes) !== null && finite(point.totalBytes) !== null && point.usedBytes <= point.totalBytes)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // Defensive guard even for mocks/imported data: never mix a resized or
  // different volume's measurements into a current-capacity growth estimate.
  const points: typeof sorted = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (sorted[index].totalBytes !== totalBytes) break;
    points.unshift(sorted[index]);
  }
  if (!points.length) return result;
  const first = Date.parse(points[0].at); const last = Date.parse(points.at(-1)!.at);
  const days = new Set(points.map((point) => new Date(Date.parse(point.at) + 9 * 3_600_000).toISOString().slice(0, 10))).size;
  result.observedDays = days; result.from = new Date(first).toISOString(); result.to = new Date(last).toISOString();
  result.cleanupCount = points.slice(1).filter((point, index) => points[index].usedBytes - point.usedBytes >= 1_048_576).length;
  if (days < 3 || last - first < 2 * DAY_MS || now.getTime() - last > 15 * 60_000 || last > now.getTime()) return result;
  const xs = points.map((point) => (Date.parse(point.at) - first) / DAY_MS);
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = points.reduce((sum, point) => sum + point.usedBytes, 0) / points.length;
  const denominator = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const slope = denominator > 0 ? xs.reduce((sum, x, index) => sum + (x - xMean) * (points[index].usedBytes - yMean), 0) / denominator : NaN;
  if (!Number.isFinite(slope)) return result;
  result.bytesPerDay = slope;
  result.note = `直近30日以内・同じ総容量のJST日末実測から純増減を直線推定しています。削除・自動掃除の影響も含み、将来の保証ではありません。容量減少を観測した日: ${result.cleanupCount}日。`;
  if (slope <= 0) { result.status = "non_growing"; return result; }
  const daysUntilFull = result.freeBytes! / slope;
  const projectedMs = now.getTime() + daysUntilFull * DAY_MS;
  if (!Number.isFinite(daysUntilFull) || projectedMs > 8.64e15) {
    result.note += " 推定時期が遠すぎるため日時は算出しません。"; return result;
  }
  result.status = "ready"; result.daysUntilFull = daysUntilFull; result.projectedFullAt = new Date(projectedMs).toISOString();
  return result;
}

const ANOMALY_RULES: Array<{ metric: BotMetricKey; floor: number; multiplier: number; criticalFloor: number; criticalMultiplier: number }> = [
  { metric: "gatewayPingMs", floor: 500, multiplier: 3, criticalFloor: 1_500, criticalMultiplier: 5 },
  { metric: "discordApiPingMs", floor: 1_000, multiplier: 3, criticalFloor: 5_000, criticalMultiplier: 5 },
  { metric: "dbPingMs", floor: 250, multiplier: 3, criticalFloor: 1_000, criticalMultiplier: 5 },
  { metric: "receiveBps", floor: 1_048_576, multiplier: 5, criticalFloor: 10_485_760, criticalMultiplier: 10 },
  { metric: "sendBps", floor: 1_048_576, multiplier: 5, criticalFloor: 10_485_760, criticalMultiplier: 10 },
  { metric: "cpuPercent", floor: 100, multiplier: 3, criticalFloor: 200, criticalMultiplier: 5 },
  { metric: "eventLoopLagMs", floor: 100, multiplier: 3, criticalFloor: 1_000, criticalMultiplier: 5 },
];

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildBotAnomalies(samples: BotInsightSample[] | null, now: Date): BotInsights["anomalies"] {
  const result: BotInsights["anomalies"] = {
    status: "insufficient", checkedAt: now.toISOString(), observationCount: 0, baselineObservationCount: 0, findings: [],
    notes: ["同一Bot起動の連続観測を使います。直近3観測すべてが、直前の平常中央値×倍率と固定下限の大きい方を超えた場合に異常候補を表示します。",
      "判定には直前20観測以上・連続区間20分以上・最終観測3分以内が必要です。欠測や再起動では判定を保留します。CPU100%は1コア分です。",
      "通信量増加は正常なダウンロードでも起こるため、異常候補は障害の断定ではありません。Web表示のみで自動通知・停止操作は行いません。"],
  };
  if (!samples?.length) return result;
  const ordered = samples.filter((sample) => Number.isFinite(Date.parse(sample.at)) && Date.parse(sample.at) <= now.getTime())
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const latest = ordered.at(-1);
  if (!latest || now.getTime() - Date.parse(latest.at) > 180_000) return result;
  const continuous: BotInsightSample[] = [];
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const sample = ordered[index];
    if (sample.sessionId !== latest.sessionId || sample.intervalSeconds > 120 || sample.intervalSeconds <= 0
      || (continuous.length > 0 && Date.parse(continuous[0].at) - Date.parse(sample.at) > 120_000)) break;
    continuous.unshift(sample);
  }
  result.observationCount = continuous.length; result.baselineObservationCount = Math.max(0, continuous.length - 3);
  if (continuous.length < 23 || Date.parse(latest.at) - Date.parse(continuous[0].at) < 20 * 60_000) return result;
  const recent = continuous.slice(-3); const baseline = continuous.slice(0, -3);
  let eligible = 0;
  for (const rule of ANOMALY_RULES) {
    const baselineValues = baseline.map((sample) => finite(sample.metrics[rule.metric])).filter((value): value is number => value !== null);
    const recentValues = recent.map((sample) => finite(sample.metrics[rule.metric]));
    if (baselineValues.length < 20 || recentValues.some((value) => value === null)) continue;
    eligible += 1;
    const center = median(baselineValues);
    const threshold = Math.max(rule.floor, center * rule.multiplier);
    const critical = Math.max(rule.criticalFloor, center * rule.criticalMultiplier);
    if (!recentValues.every((value) => value! >= threshold)) continue;
    const level = recentValues.every((value) => value! >= critical) ? "critical" : "warning";
    const effectiveThreshold = level === "critical" ? critical : threshold;
    result.findings.push({ metric: rule.metric, level, current: recentValues.reduce<number>((sum, value) => sum + value!, 0) / 3,
      baseline: center, threshold: effectiveThreshold, since: recent[0].at,
      note: `${BOT_STATISTIC_METRICS[rule.metric].label}: 直近3観測が max(固定下限${level === "critical" ? rule.criticalFloor : rule.floor}, 平常中央値×${level === "critical" ? rule.criticalMultiplier : rule.multiplier}) 以上。` });
  }
  result.status = eligible > 0 ? "ready" : "insufficient";
  return result;
}

function unavailableHeatmap(): BotHeatmapCell[] {
  return Array.from({ length: 168 }, (_, index) => ({ weekday: Math.floor(index / 24), hour: index % 24,
    plays: null, messages: null, voiceMemberSeconds: null, averagePlays: null, averageMessages: null, averageVoiceMemberSeconds: null,
    playDays: 0, messageDays: 0, voiceDays: 0 }));
}

/** Insight failures degrade independently, never taking the core dashboard down. */
export async function getBotInsights(input: BotInsightsInput): Promise<BotInsights> {
  botStatisticsGuildId(input.scope);
  const from = new Date(input.from); const to = new Date(input.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from) throw new Error("Invalid Bot insights period");
  const previous = botComparisonPeriod(input.range, from, to);
  const elapsedSeconds = Math.max(0, (to.getTime() - from.getTime()) / 1_000);
  const [comparison, heatmap, disk, anomalies] = await Promise.allSettled([
    previous ? getBotTelemetryAggregate(input.scope, previous.from, previous.to, Math.max(300, Math.ceil(elapsedSeconds / 479))) : Promise.resolve(null),
    getBotHeatmap(input.scope, from, to),
    input.scope === "global" ? getBotDiskHistory(to) : Promise.resolve(null),
    getBotInsightSamples(input.scope, to),
  ]);
  return {
    comparison: buildBotComparison(input, comparison.status === "fulfilled" ? comparison.value : null),
    heatmap: { status: heatmap.status === "fulfilled" ? "ready" : "unavailable", timezone: "Asia/Tokyo",
      cells: heatmap.status === "fulfilled" ? heatmap.value : unavailableHeatmap(),
      notes: ["曜日はJST月曜始まり。平均は各曜日・各データソースで記録のある日数を分母にします。保存プレイ0はDB内に該当リザルトがない意味です。",
        "メッセージ・VCの未記録時間は0に変換しません。VC延べ時間は計測区間を時間境界で按分した参考値です。", ...(heatmap.status === "rejected" ? ["活動履歴の読み取りに失敗しました。更新すると再試行します。"] : [])] },
    disk: buildBotDiskForecast(input.scope, input.summary, disk.status === "fulfilled" ? disk.value : null, to),
    anomalies: buildBotAnomalies(anomalies.status === "fulfilled" ? anomalies.value : null, to),
  };
}

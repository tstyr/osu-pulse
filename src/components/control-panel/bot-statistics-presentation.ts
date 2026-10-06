import { BOT_STATISTIC_METRICS, type BotMetricKey, type BotStatisticsData, type BotStatisticsRange } from "../../lib/bot-statistics";

export function formatBotValue(key: BotMetricKey, value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未収集";
  const unit = BOT_STATISTIC_METRICS[key].unit;
  if (unit === "bytes" || unit === "bytesPerSecond") {
    const index = Math.min(4, Math.max(0, Math.floor(Math.log(Math.max(1, Math.abs(value))) / Math.log(1024))));
    const amount = value / 1024 ** index;
    return `${amount.toLocaleString("ja-JP", { maximumFractionDigits: index ? 2 : 0 })} ${["B", "KiB", "MiB", "GiB", "TiB"][index]}${unit === "bytesPerSecond" ? "/s" : ""}`;
  }
  if (unit === "seconds") {
    if (value < 60) return `${value.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}秒`;
    const minutes = Math.floor(value / 60);
    return minutes < 60 ? `${minutes}分` : `${Math.floor(minutes / 60).toLocaleString("ja-JP")}時間${minutes % 60}分`;
  }
  return `${value.toLocaleString("ja-JP", { maximumFractionDigits: unit === "ms" || unit === "percent" ? 1 : 2 })}${unit === "ms" ? " ms" : unit === "percent" ? "%" : unit === "people" ? "人" : ""}`;
}

export function formatBotDate(value: string | null, compact = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "未収集";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit",
    ...(compact ? {} : { year: "numeric" as const }),
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

export function formatBotAxisDate(value: string, range: BotStatisticsRange, includeTime = range === "today") {
  if (!Number.isFinite(Date.parse(value))) return "未収集";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    ...(range === "today" ? {} : { month: "2-digit" as const, day: "2-digit" as const, ...(range === "all" ? { year: "2-digit" as const } : {}) }),
    ...(includeTime ? { hour: "2-digit" as const, minute: "2-digit" as const } : {}),
  }).format(new Date(value));
}

export function formatBotAxisValue(keys: readonly BotMetricKey[], value: number) {
  if (!Number.isFinite(value)) return "—";
  const units = new Set(keys.map((key) => BOT_STATISTIC_METRICS[key].unit));
  if (keys.length && units.size === 1 && BOT_STATISTIC_METRICS[keys[0]].unit !== "count") {
    return formatBotValue(keys[0], value);
  }
  // Count and people series can share a numerical axis, but an axis with mixed
  // units must not silently be labelled as the first series' unit.
  return value.toLocaleString("ja-JP", { notation: "compact", maximumFractionDigits: 1 });
}

export function botStatisticsScopeLabel(scopes: BotStatisticsData["scopes"] | undefined, scope: string) {
  return scopes?.find((item) => item.id === scope)?.label
    ?? (scope === "global" ? "Bot全体（全サーバー）" : `サーバー ${scope.replace(/^guild:/, "")}`);
}

const globalOnlyMetrics = new Set<BotMetricKey>([
  "receivedBytes", "sentBytes", "externalReceivedBytes", "externalSentBytes", "localReceivedBytes", "localSentBytes", "receiveBps", "sendBps",
  "discordApiPingMs", "dbPingMs", "cpuPercent", "memoryBytes", "eventLoopLagMs",
  "dbBytes", "dbRows", "diskUsedBytes", "diskTotalBytes", "videoBytes", "audioBytes", "renderQueue", "activeRenders",
]);

export function botMetricIsGlobalOnly(key: BotMetricKey) {
  return globalOnlyMetrics.has(key);
}

export function botTabNavigationIndex(current: number, key: string, count: number) {
  if (!Number.isInteger(count) || count < 1) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current + count - 1) % count;
  return null;
}

export function matchingBotStatistics(data: BotStatisticsData | undefined, range: BotStatisticsRange, scope: string) {
  return data?.range === range && data.scope === scope ? data : undefined;
}

export function botSeriesOpacity(focused: string | null, key: string) {
  return !focused || focused === key ? 1 : 0.15;
}

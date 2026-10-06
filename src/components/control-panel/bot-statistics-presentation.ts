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

export function formatBotAxisDate(value: string, range: BotStatisticsRange) {
  if (!Number.isFinite(Date.parse(value))) return "未収集";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    ...(range === "today"
      ? { hour: "2-digit" as const, minute: "2-digit" as const }
      : { month: "2-digit" as const, day: "2-digit" as const, ...(range === "all" ? { year: "2-digit" as const } : {}) }),
  }).format(new Date(value));
}

export function matchingBotStatistics(data: BotStatisticsData | undefined, range: BotStatisticsRange, scope: string) {
  return data?.range === range && data.scope === scope ? data : undefined;
}

export function botSeriesOpacity(focused: string | null, key: string) {
  return !focused || focused === key ? 1 : 0.15;
}

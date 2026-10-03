import {
  getMonitoringConfiguration,
  getServiceUsageToday,
  markServiceAlerted,
} from "@/db/feature-repository";
import { sendDiscordChannelMessage } from "@/lib/discord/rest";

export async function checkServiceUsageAlerts() {
  const [configuration, usage] = await Promise.all([
    getMonitoringConfiguration(),
    getServiceUsageToday(),
  ]);
  if (!configuration.alertsEnabled || !configuration.alertChannelId) return [];
  const rows = new Map(usage.usage.map((row) => [row.service, row]));
  const osuRequests = rows.get("osu_api")?.operations ?? 0;
  const r2LimitBytes = configuration.r2StorageLimitGb * 1024 ** 3;
  const candidates = [
    { service: "osu_api", label: "osu! APIリクエスト", value: osuRequests, limit: configuration.osuDailyRequestLimit, unit: "回" },
    { service: "youtube", label: "YouTube APIクォータ（推定）", value: usage.youtubeQuotaUnits, limit: configuration.youtubeDailyQuota, unit: "units" },
    { service: "r2", label: "R2保存量", value: usage.r2Bytes, limit: r2LimitBytes, unit: "bytes" },
  ].filter((item) => item.limit > 0 && item.value / item.limit >= 0.8 && !rows.get(item.service)?.alerted);
  for (const item of candidates) {
    const percent = item.value / item.limit * 100;
    const value = item.unit === "bytes" ? `${(item.value / 1024 ** 3).toFixed(2)} / ${(item.limit / 1024 ** 3).toFixed(2)} GiB` : `${item.value.toLocaleString()} / ${item.limit.toLocaleString()} ${item.unit}`;
    await sendDiscordChannelMessage(configuration.alertChannelId, {
      embeds: [{
        title: `⚠️ ${item.label}が上限の${percent.toFixed(0)}%です`,
        description: value,
        color: percent >= 100 ? 0xe74c3c : 0xf1c40f,
        timestamp: new Date().toISOString(),
        footer: { text: "osu! Pulse usage monitor · 同じ警告は1日1回" },
      }],
      allowed_mentions: { parse: [] },
    });
    await markServiceAlerted(item.service);
  }
  return candidates.map((item) => item.service);
}

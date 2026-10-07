import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { databaseResultRows, getDb } from "../db";
import { getBotHistoricalAggregate, getBotTelemetryAggregate } from "../db/bot-telemetry-repository";
import { botWeeklyReportSchedule, botWeeklyReportSettingsSchema, defaultBotWeeklyReportSettings, type BotWeeklyReportGuild, type BotWeeklyReportResponse, type BotWeeklyReportSettings } from "../lib/bot-weekly-report";
import type { BotMetricKey, BotMetricSummary } from "../lib/bot-statistics";
import type { DiscordEmbed } from "../lib/discord/rest";
import { publicAppUrl } from "../lib/public-app-url";

const SETTINGS_ID = "bot-weekly-report-v1";
const CHANNEL_INDEX_SERVICE = "bot-weekly-report-channels";
const LEASE_MS = 5 * 60_000;
const RETRY_MS = 60_000;
type Delivery = {
  periodStart: string; guildId: string; channelId: string; status: "sending" | "failed" | "sent";
  token: string; leaseUntil: string; nextAttemptAt: string; sentAt: string | null; attempts: number;
};
type Stored = { settings: BotWeeklyReportSettings; delivery: Delivery | null };

function stored(input: unknown): Stored {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const settings = botWeeklyReportSettingsSchema.safeParse(value.settings);
  const candidate = value.delivery && typeof value.delivery === "object" ? value.delivery as Delivery : null;
  const delivery = candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate.periodStart)
    && ["sending", "failed", "sent"].includes(candidate.status) && typeof candidate.token === "string"
    ? candidate : null;
  return { settings: settings.success ? settings.data : defaultBotWeeklyReportSettings(), delivery };
}

async function ensureSettings() {
  const defaults = JSON.stringify({ settings: defaultBotWeeklyReportSettings(), delivery: null });
  await getDb().execute(sql`insert into control_panel_settings(id, "values") values (${SETTINGS_ID}, ${defaults}::jsonb) on conflict (id) do nothing`);
}

export async function readBotWeeklyReportSettings(): Promise<Stored> {
  await ensureSettings();
  const [row] = databaseResultRows<{ values: unknown }>(await getDb().execute(sql`select "values" from control_panel_settings where id = ${SETTINGS_ID}`));
  return stored(row?.values);
}

export async function publishBotWeeklyReportChannels(guilds: BotWeeklyReportGuild[], now = new Date()) {
  const details = JSON.stringify({ guilds });
  await getDb().execute(sql`insert into service_heartbeats(service, status, details, last_seen_at, updated_at)
    values (${CHANNEL_INDEX_SERVICE}, 'operational', ${details}::jsonb, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
    on conflict (service) do update set status = excluded.status, details = excluded.details, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at`);
}

async function channelIndex(now = new Date()) {
  const [row] = databaseResultRows<{ details: { guilds?: BotWeeklyReportGuild[] }; last_seen_at: string | Date }>(await getDb().execute(sql`
    select details, last_seen_at from service_heartbeats where service = ${CHANNEL_INDEX_SERVICE}`));
  const lastSeen = row ? new Date(row.last_seen_at).getTime() : NaN;
  const botOnline = Number.isFinite(lastSeen) && now.getTime() - lastSeen < 180_000;
  const guilds = botOnline && Array.isArray(row?.details.guilds) ? row.details.guilds : [];
  return { guilds, botOnline };
}

export async function getBotWeeklyReportConfiguration(now = new Date()): Promise<BotWeeklyReportResponse> {
  const [configuration, index] = await Promise.all([readBotWeeklyReportSettings(), channelIndex(now)]);
  const delivery = configuration.delivery;
  return {
    settings: configuration.settings, ...index,
    nextDueAt: configuration.settings.enabled ? botWeeklyReportSchedule(configuration.settings, now).nextDueAt.toISOString() : null,
    lastDelivery: delivery ? { periodStart: delivery.periodStart, sentAt: delivery.sentAt, status: delivery.status, channelId: delivery.channelId } : null,
  };
}

export class BotWeeklyReportDestinationError extends Error {}

export async function saveBotWeeklyReportSettings(input: unknown) {
  const settings = botWeeklyReportSettingsSchema.parse(input);
  const current = await readBotWeeklyReportSettings();
  const targetChanged = settings.guildId !== current.settings.guildId || settings.channelId !== current.settings.channelId;
  if (settings.enabled || (settings.channelId && targetChanged)) {
    const index = await channelIndex();
    if (!index.guilds.some((guild) => guild.id === settings.guildId && guild.channels.some((channel) => channel.id === settings.channelId))) {
      throw new BotWeeklyReportDestinationError("Botがオンラインの状態で、送信可能なチャンネルを選択してください。");
    }
  }
  await ensureSettings();
  // Preserve the delivery marker even when settings are edited concurrently.
  await getDb().execute(sql`update control_panel_settings set "values" = jsonb_set("values", '{settings}', ${JSON.stringify(settings)}::jsonb),
    version = version + 1, updated_at = now() where id = ${SETTINGS_ID}`);
  return getBotWeeklyReportConfiguration();
}

/** One conditional UPDATE is the cross-process lock; external I/O is never done inside a DB transaction. */
export async function claimBotWeeklyReport(settings: BotWeeklyReportSettings, now = new Date()) {
  const schedule = botWeeklyReportSchedule(settings, now);
  const token = randomUUID();
  const delivery: Delivery = { periodStart: schedule.periodStart, guildId: settings.guildId, channelId: settings.channelId,
    status: "sending", token, leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(), nextAttemptAt: now.toISOString(), sentAt: null, attempts: 1 };
  const rows = databaseResultRows<{ values: unknown }>(await getDb().execute(sql`
    update control_panel_settings set "values" = jsonb_set("values", '{delivery}', ${JSON.stringify(delivery)}::jsonb || jsonb_build_object('attempts',
      case when "values"->'delivery'->>'periodStart' = ${schedule.periodStart} then coalesce(("values"->'delivery'->>'attempts')::int, 0) + 1 else 1 end)),
      updated_at = ${now.toISOString()}::timestamptz
    where id = ${SETTINGS_ID} and "values"->'settings'->>'enabled' = 'true' and "values"->'settings' = ${JSON.stringify(settings)}::jsonb and (
      "values"->'delivery' is null or "values"->'delivery' = 'null'::jsonb or "values"->'delivery'->>'periodStart' < ${schedule.periodStart}
      or ("values"->'delivery'->>'periodStart' = ${schedule.periodStart} and "values"->'delivery'->>'status' <> 'sent'
        and coalesce("values"->'delivery'->>'leaseUntil', '') <= ${now.toISOString()}
        and coalesce("values"->'delivery'->>'nextAttemptAt', '') <= ${now.toISOString()})
    ) returning "values"`));
  const claim = rows[0] ? stored(rows[0].values).delivery : null;
  return claim ? { delivery: claim, schedule } : null;
}

export async function finishBotWeeklyReport(token: string, success: boolean, now = new Date()) {
  const update = success
    ? { status: "sent", sentAt: now.toISOString(), leaseUntil: now.toISOString() }
    : { status: "failed", sentAt: null, leaseUntil: now.toISOString(), nextAttemptAt: new Date(now.getTime() + RETRY_MS).toISOString() };
  await getDb().execute(sql`update control_panel_settings set "values" = jsonb_set("values", '{delivery}', "values"->'delivery' || ${JSON.stringify(update)}::jsonb),
    updated_at = ${now.toISOString()}::timestamptz where id = ${SETTINGS_ID} and "values"->'delivery'->>'token' = ${token}`);
}

export function botWeeklyReportNonce(guildId: string, periodStart: string) {
  return createHash("sha256").update(`bot-weekly-v1:${guildId}:${periodStart}`).digest("hex").slice(0, 24);
}

function number(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined || !Number.isFinite(value) ? "未収集" : `${value.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}${suffix}`;
}
function bytes(value: number | null | undefined) {
  if (value === null || value === undefined) return "未収集";
  const unit = value >= 1024 ** 3 ? 1024 ** 3 : value >= 1024 ** 2 ? 1024 ** 2 : 1024;
  return number(value / unit, unit === 1024 ** 3 ? " GiB" : unit === 1024 ** 2 ? " MiB" : " KiB");
}

export async function buildBotWeeklyReport(settings: BotWeeklyReportSettings, schedule: ReturnType<typeof botWeeklyReportSchedule>, now = new Date()): Promise<DiscordEmbed> {
  const to = new Date(schedule.toExclusive.getTime() - 1);
  const [guild, global, history] = await Promise.all([
    getBotTelemetryAggregate(`guild:${settings.guildId}`, schedule.from, to, 86_400),
    getBotTelemetryAggregate("global", schedule.from, to, 86_400),
    getBotHistoricalAggregate(`guild:${settings.guildId}`, schedule.from, to, 86_400),
  ]);
  const metric = (summary: Partial<Record<BotMetricKey, BotMetricSummary>>, key: BotMetricKey, field: keyof BotMetricSummary) => summary[key]?.[field];
  const messages = metric(guild.summary, "messageCount", "total") ?? history.historicalTotals.messages;
  const endLabel = new Date(schedule.toExclusive.getTime() - 1 + 9 * 3_600_000).toISOString().slice(0, 10);
  const coverage = Math.min(100, guild.observedSeconds / 604_800 * 100);
  return {
    title: "📊 Bot・サーバー統計 週間レポート",
    description: `**${schedule.periodStart} 〜 ${endLabel}（JST・月〜日）**\n保存・観測できたデータのみの集計です。欠測を0として補完しません。`,
    color: 0x2563eb, timestamp: now.toISOString(), url: publicAppUrl("/dashboard/bot-statistics"),
    fields: [
      { name: "💬 サーバー活動", value: `メッセージ: ${number(messages, "件")}\nコマンド: ${number(metric(guild.summary, "commandCount", "total"), "回")}\nメッセージ1日平均: ${number(metric(guild.summary, "messageCount", "average"), "件")}（観測日）`, inline: true },
      { name: "🔊 ボイスチャット", value: `延べ接続時間: ${number((metric(guild.summary, "voiceMemberSeconds", "total") ?? NaN) / 3_600, "時間")}\n平均接続人数: ${number(metric(guild.summary, "voiceMembers", "average"), "人")}\n最大接続人数: ${number(metric(guild.summary, "voiceMembers", "maximum"), "人")}`, inline: true },
      { name: "🎮 osu! 保存履歴", value: `プレイ: ${number(history.historicalTotals.plays)}回 / ${number(history.historicalTotals.activePlayers)}人\nユニーク譜面: ${number(history.historicalTotals.uniqueBeatmaps)}\n譜面長参考合計: ${number(history.historicalTotals.playTimeSeconds / 3_600, "時間")}\nモード: ${history.modeBreakdown.map((mode) => `${mode.mode} ${number(mode.scores)}回`).join(" · ") || "記録なし"}`, inline: false },
      { name: "🌐 通信（Bot全体）", value: `TCP受信: ${bytes(metric(global.summary, "receivedBytes", "total"))}\nTCP送信: ${bytes(metric(global.summary, "sentBytes", "total"))}\n平均受信/日: ${bytes(metric(global.summary, "receivedBytes", "average"))}（観測日）`, inline: true },
      { name: "⚡ 応答・負荷（Bot全体）", value: `平均Gateway: ${number(metric(global.summary, "gatewayPingMs", "average"), " ms")}\n平均API / DB: ${number(metric(global.summary, "discordApiPingMs", "average"), " ms")} / ${number(metric(global.summary, "dbPingMs", "average"), " ms")}\n平均CPU: ${number(metric(global.summary, "cpuPercent", "average"), "%")} / メモリ: ${bytes(metric(global.summary, "memoryBytes", "average"))}`, inline: true },
      { name: "ℹ️ 集計範囲", value: `サーバー観測率: ${number(coverage, "%")} / ${number(guild.sampleCount)}サンプル\nVC・人数・応答は観測分。osu!はDB保存分、譜面長は速度MOD補正なし。通信量はBotプロセス全体です。\n[詳細グラフ・履歴を開く](${publicAppUrl("/dashboard/bot-statistics")})`, inline: false },
    ],
    footer: { text: `週報ID: ${botWeeklyReportNonce(settings.guildId, schedule.periodStart)}` },
  };
}

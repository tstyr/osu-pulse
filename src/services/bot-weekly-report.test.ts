import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), telemetry: vi.fn(), historical: vi.fn() }));
vi.mock("../db", () => ({ getDb: () => ({ execute: mocks.execute }), databaseResultRows: (rows: unknown) => rows }));
vi.mock("../db/bot-telemetry-repository", () => ({ getBotTelemetryAggregate: mocks.telemetry, getBotHistoricalAggregate: mocks.historical }));
vi.mock("../lib/public-app-url", () => ({ publicAppUrl: (value: string) => `https://pulse.example.test${value}` }));
import { botWeeklyReportSchedule, defaultBotWeeklyReportSettings } from "../lib/bot-weekly-report";
import { BotWeeklyReportDestinationError, botWeeklyReportNonce, buildBotWeeklyReport, claimBotWeeklyReport, finishBotWeeklyReport, getBotWeeklyReportConfiguration, saveBotWeeklyReportSettings } from "./bot-weekly-report";

const dialect = new PgDialect();
const settings = { ...defaultBotWeeklyReportSettings(), enabled: true, guildId: "123456789012345678", channelId: "234567890123456789" };
const now = new Date("2026-10-07T03:00:00Z");
const queries = () => mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
beforeEach(() => {
  vi.resetAllMocks(); mocks.execute.mockResolvedValue([]);
  mocks.telemetry.mockResolvedValue({ summary: {}, sampleCount: 0, observedSeconds: 0 });
  mocks.historical.mockResolvedValue({ modeBreakdown: [], historicalTotals: { messages: null, plays: 0, activePlayers: 0, uniqueBeatmaps: 0, playTimeSeconds: 0 } });
});

describe("weekly report persistence", () => {
  it("claims atomically with a lease and protects sent or newer-week markers", async () => {
    expect(await claimBotWeeklyReport(settings, now)).toBeNull();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const query = queries()[0];
    expect(query.sql).toContain("update control_panel_settings");
    expect(query.sql).toContain("\"values\"->'settings'->>'enabled' = 'true'");
    expect(query.sql).toContain("\"values\"->'delivery'->>'periodStart' <");
    expect(query.sql).toContain("\"values\"->'delivery'->>'status' <> 'sent'");
    expect(query.sql).toContain("leaseUntil"); expect(query.sql).toContain("nextAttemptAt");
    const claim = query.params.map(String).find((parameter) => parameter.includes('"status":"sending"'));
    expect(JSON.parse(claim!)).toMatchObject({ periodStart: "2026-09-28", status: "sending", leaseUntil: "2026-10-07T03:05:00.000Z" });
  });
  it("completes or schedules retry only for the current claim token", async () => {
    await finishBotWeeklyReport("first-claim", true, now);
    await finishBotWeeklyReport("second-claim", false, now);
    for (const query of queries()) expect(query.sql).toContain("\"values\"->'delivery'->>'token' =");
    expect(queries()[0].params).toContain("first-claim");
    expect(queries()[1].params).toContain("second-claim");
    const retry = queries()[1].params.map(String).find((parameter) => parameter.includes('"status":"failed"'));
    expect(JSON.parse(retry!)).toMatchObject({ nextAttemptAt: "2026-10-07T03:01:00.000Z", status: "failed" });
  });
  it("does not expose internal claim token or stale channel candidates", async () => {
    mocks.execute.mockImplementation(async (query) => {
      const text = dialect.sqlToQuery(query).sql;
      if (text.includes("select \"values\"")) return [{ values: { settings, delivery: { periodStart: "2026-09-28", guildId: settings.guildId, channelId: settings.channelId, status: "sent", token: "internal-token", sentAt: now.toISOString() } } }];
      if (text.includes("select details")) return [{ details: { guilds: [{ id: settings.guildId, name: "old guild", channels: [] }] }, last_seen_at: "2026-10-01T00:00:00Z" }];
      return [];
    });
    const response = await getBotWeeklyReportConfiguration(now);
    expect(response.botOnline).toBe(false); expect(response.guilds).toEqual([]);
    expect(response.lastDelivery?.status).toBe("sent");
    expect(JSON.stringify(response)).not.toContain("internal-token");
  });
  it("rejects destinations absent from the fresh permission-filtered channel index", async () => {
    await expect(saveBotWeeklyReportSettings(settings)).rejects.toBeInstanceOf(BotWeeklyReportDestinationError);
    expect(queries().some((query) => query.sql.includes("set \"values\" = jsonb_set(\"values\", '{settings}'"))).toBe(false);
  });
  it("can disable an unchanged destination while the Bot is offline", async () => {
    mocks.execute.mockImplementation(async (query) => dialect.sqlToQuery(query).sql.includes("select \"values\"") ? [{ values: { settings } }] : []);
    await saveBotWeeklyReportSettings({ ...settings, enabled: false });
    const save = queries().find((query) => query.sql.includes("set \"values\" = jsonb_set(\"values\", '{settings}'"));
    expect(save).toBeDefined();
    expect(save?.sql).not.toContain("'{delivery}'");
  });
});

describe("weekly report summary", () => {
  it("queries only the completed calendar week and labels missing/global data honestly", async () => {
    const schedule = botWeeklyReportSchedule(settings, now);
    const embed = await buildBotWeeklyReport(settings, schedule, now);
    expect(mocks.telemetry).toHaveBeenCalledWith(`guild:${settings.guildId}`, schedule.from, new Date("2026-10-04T14:59:59.999Z"), 86_400);
    expect(mocks.telemetry).toHaveBeenCalledWith("global", schedule.from, new Date("2026-10-04T14:59:59.999Z"), 86_400);
    expect(embed.description).toContain("2026-09-28 〜 2026-10-04");
    expect(embed.fields?.find((field) => field.name.includes("通信"))?.name).toContain("Bot全体");
    expect(embed.fields?.find((field) => field.name.includes("サーバー活動"))?.value).toContain("メッセージ: 未収集");
    expect(embed.url).toBe("https://pulse.example.test/dashboard/bot-statistics");
    expect(embed.footer?.text).toContain(botWeeklyReportNonce(settings.guildId, schedule.periodStart));
  });
  it("uses a stable bounded nonce without exposing account details", () => {
    const first = botWeeklyReportNonce(settings.guildId, "2026-09-28");
    expect(first).toHaveLength(24);
    expect(first).toBe(botWeeklyReportNonce(settings.guildId, "2026-09-28"));
    expect(first).not.toBe(botWeeklyReportNonce(settings.guildId, "2026-10-05"));
    expect(first).not.toContain(settings.guildId);
  });
});

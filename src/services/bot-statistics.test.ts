import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ extent: vi.fn(), telemetry: vi.fn(), historical: vi.fn(), insights: vi.fn(), dimensions: vi.fn() }));
vi.mock("./bot-insights", () => ({ getBotInsights: mocks.insights }));
vi.mock("../db/bot-dimensions-repository", () => ({ getBotDimensions: mocks.dimensions }));
vi.mock("../db/bot-telemetry-repository", () => ({
  botStatisticsGuildId: (scope: string) => { if (scope !== "global" && !/^guild:\d{17,20}$/.test(scope)) throw new Error("Invalid scope"); return scope === "global" ? null : scope.slice(6); },
  getBotStatisticsExtent: mocks.extent, getBotTelemetryAggregate: mocks.telemetry, getBotHistoricalAggregate: mocks.historical,
}));

const now = new Date("2026-10-07T03:00:00Z");
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  mocks.extent.mockResolvedValue({ firstSampleAt: null, lastSampleAt: null, historyStartedAt: null, scopes: [] });
  mocks.telemetry.mockResolvedValue({ summary: {}, points: [], sampleCount: 0, observedSeconds: 0 });
  mocks.historical.mockResolvedValue({ activityHours: [], modeBreakdown: [], historical: [], historicalTotals: { messages: 0, plays: 0, uniqueBeatmaps: 0, activePlayers: 0, playTimeSeconds: 0, days: 0 } });
  mocks.insights.mockResolvedValue(undefined);
  mocks.dimensions.mockResolvedValue({ commands: [], services: [], sampleCount: 0, collectionStartedAt: null });
});
afterEach(() => { vi.useRealTimers(); });

describe("Bot statistics periods", () => {
  it("uses JST midnight and inclusive 7/30 calendar dates, not rolling hours", async () => {
    const { botStatisticsPeriod } = await import("./bot-statistics");
    expect(botStatisticsPeriod("today", now).from.toISOString()).toBe("2026-10-06T15:00:00.000Z");
    expect(botStatisticsPeriod("week", now).from.toISOString()).toBe("2026-09-30T15:00:00.000Z");
    expect(botStatisticsPeriod("month", now).from.toISOString()).toBe("2026-09-07T15:00:00.000Z");
    expect(botStatisticsPeriod("all", now, "2020-03-10T01:00:00Z").from.toISOString()).toBe("2020-03-09T15:00:00.000Z");
  });

  it("bounds rollup points even for decades of data without truncating raw history", async () => {
    const { botStatisticsBucketSeconds } = await import("./bot-statistics");
    for (const seconds of [86_400, 30 * 86_400, 365 * 86_400, 30 * 365 * 86_400, 500 * 365 * 86_400]) {
      const stride = botStatisticsBucketSeconds("all", seconds);
      expect(Math.floor(seconds / stride) + 1).toBeLessThanOrEqual(480);
    }
  });
});

describe("Bot statistics responses", () => {
  it("passes coverage into insights and preserves the core dashboard when an additional analysis fails", async () => {
    const { getBotStatistics } = await import("./bot-statistics");
    mocks.insights.mockRejectedValue(new Error("temporary additional analysis failure"));
    mocks.dimensions.mockRejectedValue(new Error("temporary dimension failure"));
    const data = await getBotStatistics({ range: "today", scope: "global" });
    expect(data.summary).toEqual({});
    expect(data.insights).toBeUndefined();
    expect(data.dimensions).toBeUndefined();
    expect(mocks.insights).toHaveBeenCalledWith(expect.objectContaining({ range: "today", scope: "global", coverage: { sampleCount: 0, observedSeconds: 0 } }));
  });
  it("keeps uncollected data unknown and distinguishes stale collection from empty history", async () => {
    const { getBotStatistics } = await import("./bot-statistics");
    mocks.telemetry.mockResolvedValue({ summary: { dbPingMs: { latest: null, average: null, minimum: null, maximum: null, total: null } }, points: [{ at: now.toISOString(), values: { dbPingMs: null } }], sampleCount: 0, observedSeconds: 0 });
    const result = await getBotStatistics({ range: "today", scope: "global" });
    expect(result).toMatchObject({ collectionStartedAt: null, lastSampleAt: null, stale: true, coverage: { sampleCount: 0, observedSeconds: 0, percent: 0 } });
    expect(result.summary.dbPingMs?.latest).toBeNull();
    expect(result.points[0].values.dbPingMs).toBeNull();
    expect(result.scopes).toEqual([{ id: "global", label: "Bot全体" }]);
  });

  it("clamps coverage and uses earliest historical data without pretending telemetry existed then", async () => {
    const { getBotStatistics } = await import("./bot-statistics");
    mocks.extent.mockResolvedValue({ firstSampleAt: "2026-10-07T01:00:00Z", lastSampleAt: now.toISOString(), historyStartedAt: "2026-10-01T01:00:00Z", scopes: [{ id: "global", label: "Bot全体" }] });
    mocks.telemetry.mockResolvedValue({ summary: {}, points: [], sampleCount: 10, observedSeconds: 99_999_999 });
    const result = await getBotStatistics({ range: "all", scope: "global" });
    expect(result.from).toBe("2026-09-30T15:00:00.000Z");
    expect(result.collectionStartedAt).toBe("2026-10-07T01:00:00.000Z");
    expect(result.coverage.percent).toBe(100);
    expect(result.stale).toBe(false);
  });

  it("shares in-flight reads and retries rejected reads instead of caching permanent failures", async () => {
    const { getBotStatistics } = await import("./bot-statistics");
    mocks.extent.mockRejectedValueOnce(new Error("temporary DB error"));
    await expect(getBotStatistics({ range: "week", scope: "global" })).rejects.toThrow("temporary DB");
    const first = getBotStatistics({ range: "week", scope: "global" });
    const second = getBotStatistics({ range: "week", scope: "global" });
    expect(first).toBe(second);
    await first;
    expect(mocks.extent).toHaveBeenCalledTimes(2);
  });
});

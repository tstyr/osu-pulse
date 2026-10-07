import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotTelemetryAggregate } from "../db/bot-telemetry-repository";
import type { BotDiskHistory, BotInsightSample, BotInsightsInput } from "../lib/bot-insights";
import type { BotMetricSummary, BotMetricValues } from "../lib/bot-statistics";

const mocks = vi.hoisted(() => ({ heatmap: vi.fn(), disk: vi.fn(), samples: vi.fn(), aggregate: vi.fn() }));
vi.mock("../db/bot-insights-repository", () => ({ getBotHeatmap: mocks.heatmap, getBotDiskHistory: mocks.disk, getBotInsightSamples: mocks.samples }));
vi.mock("../db/bot-telemetry-repository", () => ({ getBotTelemetryAggregate: mocks.aggregate,
  botStatisticsGuildId: (scope: string) => { if (scope !== "global" && !/^guild:\d{17,20}$/.test(scope)) throw new Error("Invalid scope"); return scope === "global" ? null : scope.slice(6); } }));

import { botComparisonPeriod, buildBotAnomalies, buildBotComparison, buildBotDiskForecast, getBotInsights } from "./bot-insights";

const now = new Date("2026-10-07T03:00:00Z");
const summary = (value: number | null): BotMetricSummary => ({ latest: value, average: value, minimum: value, maximum: value, total: value });
const input = (): BotInsightsInput => ({ range: "today", scope: "global", from: "2026-10-06T15:00:00Z", to: now,
  summary: { receivedBytes: summary(200), gatewayPingMs: summary(30), storedScores: summary(5_000) }, points: [], coverage: { sampleCount: 100, observedSeconds: 43_200 } });
const previous = (): BotTelemetryAggregate => ({ summary: { receivedBytes: summary(100), gatewayPingMs: summary(20), storedScores: summary(4_000) }, points: [], sampleCount: 100, observedSeconds: 43_200 });

beforeEach(() => { vi.resetAllMocks(); mocks.heatmap.mockResolvedValue([]); mocks.disk.mockResolvedValue({ points: [], observations: 0, segmentFrom: null, lastSampleAt: null }); mocks.samples.mockResolvedValue([]); mocks.aggregate.mockResolvedValue(previous()); });

describe("same elapsed-time Bot comparisons", () => {
  it("shifts exact window boundaries by 1, 7 or 30 days and makes all-time comparison inapplicable", () => {
    const from = new Date(input().from);
    expect(botComparisonPeriod("today", from, now)?.from.toISOString()).toBe("2026-10-05T15:00:00.000Z");
    expect(botComparisonPeriod("today", from, now)?.to.toISOString()).toBe("2026-10-06T03:00:00.000Z");
    expect(now.getTime() - botComparisonPeriod("week", from, now)!.to.getTime()).toBe(7 * 86_400_000);
    expect(now.getTime() - botComparisonPeriod("month", from, now)!.to.getTime()).toBe(30 * 86_400_000);
    expect(buildBotComparison({ ...input(), range: "all" }, previous())).toMatchObject({ status: "not_applicable", metrics: [] });
  });

  it("distinguishes period totals, gauge averages and cumulative snapshots", () => {
    const result = buildBotComparison(input(), previous());
    expect(result.status).toBe("ready");
    expect(result.metrics.find((row) => row.metric === "receivedBytes")).toMatchObject({ aggregation: "total", change: 100, changePercent: 100 });
    expect(result.metrics.find((row) => row.metric === "gatewayPingMs")).toMatchObject({ aggregation: "average", change: 10, changePercent: 50 });
    expect(result.metrics.find((row) => row.metric === "storedScores")).toMatchObject({ aggregation: "latest", change: 1_000 });
    expect(result.metrics.find((row) => row.metric === "storedScores")?.label).toContain("累計");
  });

  it("retains a zero-baseline absolute difference without Infinity or fake percentages", () => {
    const baseline = previous(); baseline.summary.receivedBytes = summary(0);
    const row = buildBotComparison(input(), baseline).metrics.find((item) => item.metric === "receivedBytes");
    expect(row).toMatchObject({ current: 200, previous: 0, change: 200, changePercent: null, status: "zero_baseline" });
  });

  it("labels missing or inadequate observed coverage as insufficient, not zero", () => {
    const partial = { ...input(), coverage: { sampleCount: 2, observedSeconds: 120 } };
    const result = buildBotComparison(partial, previous());
    expect(result.status).toBe("insufficient");
    expect(result.metrics.find((row) => row.metric === "receivedBytes")).toMatchObject({ changePercent: null, status: "insufficient" });
    expect(buildBotComparison(input(), null).metrics.find((row) => row.metric === "receivedBytes")).toMatchObject({ previous: null, change: null });
    expect(buildBotComparison({ ...input(), coverage: undefined }, previous()).currentCoveragePercent).toBeNull();
  });
});

describe("capacity forecasts from actual observations", () => {
  const total = 100 * 1_073_741_824;
  const diskSummary = { diskUsedBytes: summary(60 * 1_073_741_824), diskTotalBytes: summary(total) };
  const history = (uses = [40, 50, 60]): BotDiskHistory => ({
    points: uses.map((used, index) => ({ at: new Date(now.getTime() - (uses.length - index - 1) * 86_400_000).toISOString(), usedBytes: used * 1_073_741_824, totalBytes: total })),
    observations: 2_000, segmentFrom: "2026-10-05T03:00:00Z", lastSampleAt: now.toISOString(),
  });

  it("predicts a linear net growth rate only after multiple days of same-capacity measurements", () => {
    const result = buildBotDiskForecast("global", diskSummary, history(), now);
    expect(result).toMatchObject({ status: "ready", observedDays: 3, freeBytes: 40 * 1_073_741_824, usedPercent: 60, daysUntilFull: 4 });
    expect(result.bytesPerDay).toBeCloseTo(10 * 1_073_741_824);
    expect(result.projectedFullAt).toBe("2026-10-11T03:00:00.000Z");
  });

  it("does not predict from one day, stale data, unknown capacity or guild scope", () => {
    expect(buildBotDiskForecast("global", diskSummary, history([60]), now).status).toBe("insufficient");
    expect(buildBotDiskForecast("global", diskSummary, history(), new Date(now.getTime() + 20 * 60_000)).daysUntilFull).toBeNull();
    expect(buildBotDiskForecast("global", { diskUsedBytes: summary(null) }, history(), now).freeBytes).toBeNull();
    expect(buildBotDiskForecast("guild:123456789012345678", diskSummary, history(), now)).toMatchObject({ status: "not_applicable", totalBytes: null });
  });

  it("does not mix a resized volume's old observations into the forecast", () => {
    const resized = history(); resized.points[0].totalBytes = total * 2;
    const result = buildBotDiskForecast("global", diskSummary, resized, now);
    expect(result).toMatchObject({ status: "insufficient", observedDays: 2, daysUntilFull: null });
  });

  it("reports non-growing storage and cleanup influence without inventing a full date", () => {
    const result = buildBotDiskForecast("global", diskSummary, history([80, 70, 60]), now);
    expect(result).toMatchObject({ status: "non_growing", cleanupCount: 2, daysUntilFull: null, projectedFullAt: null });
    expect(result.bytesPerDay).toBeLessThan(0);
    expect(result.note).toContain("削除");
  });
});

function samples(baseline: BotMetricValues = { gatewayPingMs: 20 }, recent: BotMetricValues = { gatewayPingMs: 900 }): BotInsightSample[] {
  return Array.from({ length: 30 }, (_, index) => ({ at: new Date(now.getTime() - (29 - index) * 60_000).toISOString(), sessionId: "one", intervalSeconds: 60, metrics: index >= 27 ? recent : baseline }));
}

describe("explainable consecutive anomaly detection", () => {
  it("requires three consecutive high observations over a sufficient baseline", () => {
    const result = buildBotAnomalies(samples(), now);
    expect(result.status).toBe("ready");
    expect(result.findings[0]).toMatchObject({ metric: "gatewayPingMs", level: "warning", current: 900, baseline: 20, threshold: 500, since: new Date(now.getTime() - 2 * 60_000).toISOString() });
  });

  it("does not flag a single spike or manufacture missing metric values", () => {
    const transient = samples(); transient[27].metrics = { gatewayPingMs: 20 };
    expect(buildBotAnomalies(transient, now).findings).toEqual([]);
    const missing = samples(); missing[29].metrics = { gatewayPingMs: null };
    expect(buildBotAnomalies(missing, now).status).toBe("insufficient");
  });

  it("withholds conclusions after restarts, gaps, stale final samples or overly short collection", () => {
    const restarted = samples(); restarted[28].sessionId = "two"; restarted[29].sessionId = "two";
    expect(buildBotAnomalies(restarted, now).status).toBe("insufficient");
    const gap = samples(); gap[27].intervalSeconds = 600;
    expect(buildBotAnomalies(gap, now).status).toBe("insufficient");
    expect(buildBotAnomalies(samples(), new Date(now.getTime() + 4 * 60_000)).status).toBe("insufficient");
    expect(buildBotAnomalies(samples().slice(-3), now).status).toBe("insufficient");
  });

  it("uses absolute floors when the traffic baseline is zero and classifies stronger sustained events", () => {
    const result = buildBotAnomalies(samples({ receiveBps: 0, cpuPercent: 5 }, { receiveBps: 2_097_152, cpuPercent: 400 }), now);
    expect(result.findings.find((item) => item.metric === "receiveBps")).toMatchObject({ threshold: 1_048_576, level: "warning" });
    expect(result.findings.find((item) => item.metric === "cpuPercent")).toMatchObject({ threshold: 200, level: "critical" });
    expect(result.notes.join(" ")).toContain("Web表示のみ");
  });
});

describe("independent insight degradation", () => {
  it("returns honest 168-cell missing data if every optional query fails without failing core statistics", async () => {
    for (const mock of Object.values(mocks)) mock.mockRejectedValue(new Error("DB unavailable"));
    const result = await getBotInsights(input());
    expect(result.comparison.status).toBe("insufficient");
    expect(result.heatmap.status).toBe("unavailable");
    expect(result.heatmap.cells).toHaveLength(168);
    expect(result.heatmap.cells.every((cell) => cell.plays === null && cell.messages === null && cell.voiceMemberSeconds === null)).toBe(true);
    expect(result.disk.status).toBe("insufficient");
    expect(result.anomalies.status).toBe("insufficient");
  });

  it("does not issue inapplicable all-time comparison or per-guild PC capacity reads", async () => {
    const result = await getBotInsights({ ...input(), range: "all", scope: "guild:123456789012345678" });
    expect(mocks.aggregate).not.toHaveBeenCalled();
    expect(mocks.disk).not.toHaveBeenCalled();
    expect(result.comparison.status).toBe("not_applicable");
    expect(result.disk.status).toBe("not_applicable");
  });
});

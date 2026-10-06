import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { BotTelemetryInput } from "../lib/bot-statistics";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), values: vi.fn(), conflict: vi.fn() }));
vi.mock("./index", () => ({
  databaseResultRows: (result: unknown) => Array.isArray(result) ? result : (result as { rows: unknown[] }).rows,
  getDb: () => ({ execute: mocks.execute, insert: () => ({ values: (values: unknown[]) => {
    mocks.values(values);
    return { onConflictDoNothing: (conflict: unknown) => {
      mocks.conflict(conflict);
      return { returning: async () => values.map((_, index) => ({ id: index })) };
    } };
  } }) }),
}));

const now = new Date("2026-10-07T00:00:00.000Z");
function sample(index = 0): BotTelemetryInput {
  return { scope: "global", scopeLabel: "Bot全体", sessionId: "session", sampledAt: new Date(now.getTime() + index * 1_000), intervalSeconds: 60, metrics: { receivedBytes: 100, gatewayPingMs: 20 } };
}
function text(query: SQL) { return new PgDialect().sqlToQuery(query).sql; }

beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); mocks.execute.mockResolvedValue([]); });
afterEach(() => { vi.useRealTimers(); });

describe("Bot telemetry persistence", () => {
  it("sanitizes invalid numbers without turning unknown values into zero", async () => {
    const { sanitizeBotMetricValues } = await import("./bot-telemetry-repository");
    expect(sanitizeBotMetricValues({ receivedBytes: Infinity, cpuPercent: NaN, memoryBytes: null, storedScores: -1, messageCount: 0 })).toEqual({ receivedBytes: null, cpuPercent: null, memoryBytes: null, storedScores: null, messageCount: 0 });
  });

  it("deduplicates the same sample and uses its persistent identity for retries", async () => {
    const { insertBotTelemetrySamples } = await import("./bot-telemetry-repository");
    expect(await insertBotTelemetrySamples([sample(), sample(), sample(1)])).toBe(2);
    expect(mocks.values).toHaveBeenCalledTimes(1);
    expect(mocks.values.mock.calls[0][0]).toHaveLength(2);
    expect(mocks.conflict.mock.calls[0][0].target.map((column: { name: string }) => column.name)).toEqual(["scope", "session_id", "sampled_at"]);
  });

  it("uses bounded bulk batches and ignores invalid observation intervals", async () => {
    const { insertBotTelemetrySamples } = await import("./bot-telemetry-repository");
    expect(await insertBotTelemetrySamples([...Array.from({ length: 501 }, (_, index) => sample(index)), { ...sample(), intervalSeconds: 0 }])).toBe(501);
    expect(mocks.values.mock.calls.map(([values]) => values.length)).toEqual([500, 1]);
  });

  it("rejects arbitrary scope strings before generating SQL", async () => {
    const { botStatisticsGuildId } = await import("./bot-telemetry-repository");
    expect(botStatisticsGuildId("global")).toBeNull();
    expect(botStatisticsGuildId("guild:123456789012345678")).toBe("123456789012345678");
    expect(() => botStatisticsGuildId("guild:bad;drop table accounts")).toThrow("Invalid");
  });
});

describe("Bot telemetry SQL aggregation", () => {
  it("keeps rollups and null gap buckets in SQL instead of fetching raw history", async () => {
    const { getBotTelemetryAggregate } = await import("./bot-telemetry-repository");
    mocks.execute.mockResolvedValue({ rows: [{ summary: { gatewayPingMs: { latest: null, average: 20, minimum: 10, maximum: 30, total: null } }, points: [{ at: now.toISOString(), values: { gatewayPingMs: null } }], sample_count: "2", observed_seconds: "60" }] });
    const aggregate = await getBotTelemetryAggregate("global", new Date(now.getTime() - 3_600_000), now, 300);
    expect(aggregate.summary.gatewayPingMs?.latest).toBeNull();
    expect(aggregate.points[0].values.gatewayPingMs).toBeNull();
    expect(aggregate).toMatchObject({ sampleCount: 2, observedSeconds: 60 });
    const query = text(mocks.execute.mock.calls[0][0]);
    expect(query).toContain("date_bin");
    expect(query).toContain("generate_series");
    expect(query).toContain("sum(value * weight)");
    expect(query).toContain("range_agg");
    expect(query).toContain("count(distinct (sampled_at at time zone 'Asia/Tokyo')::date)");
    expect(query.match(/latest as \([\s\S]*?\), summaries/)?.[0]).not.toContain("where value is not null");
    expect(query).toContain("s.weight / nullif(s.interval_seconds, 0)");
    expect(query).toContain("sum(period_value)");
    const latest = query.match(/latest as \([\s\S]*?\), summaries/)?.[0];
    expect(latest).toContain("select metrics from samples order by sampled_at desc, id desc limit 1");
    expect(latest).not.toContain("distinct on (metric)");
  });

  it("keeps historical missing messages and VC observations nullable", async () => {
    const { getBotHistoricalAggregate } = await import("./bot-telemetry-repository");
    await getBotHistoricalAggregate("guild:123456789012345678", new Date(now.getTime() - 86_400_000), now, 86_400);
    const query = text(mocks.execute.mock.calls[0][0]);
    expect(query).toContain("exists (select 1 from account_guilds");
    expect(query).toContain("count(distinct beatmap_id)");
    expect(query).toContain("left join discord_buckets");
    expect(query).toContain("t(bucket)");
    expect(query).toContain("score_hours as");
    expect(query).not.toContain("coalesce(d.messages, 0)");
    expect(query).toContain("'averageMessages'");
    expect(query).not.toContain("coalesce(sum(message_count), 0)");
  });

  it("enumerates labels with indexed per-scope lookups and preserves removed guild history", async () => {
    const { getBotStatisticsExtent } = await import("./bot-telemetry-repository");
    await getBotStatisticsExtent("global");
    const query = text(mocks.execute.mock.calls[0][0]);
    expect(query).toContain("with recursive recorded_scopes");
    expect(query).toContain("t.scope > r.scope");
    expect(query).toContain("left join lateral");
    expect(query).not.toContain("distinct on (scope)");
  });
});

describe("Bot context and capacity caching", () => {
  it("keeps failures unknown instead of inventing successful zero measurements", async () => {
    const { getBotTelemetryContext } = await import("./bot-telemetry-repository");
    mocks.execute.mockRejectedValue(new Error("DB unavailable"));
    const result = await getBotTelemetryContext();
    expect(result.global).toMatchObject({ osuActivePlayers: null, trackedPlayers: null, storedScores: null, dbBytes: null, diskUsedBytes: null, audioBytes: null, renderQueue: null });
    expect(result.guilds).toEqual({});
  });

  it("uses indexed latest profiles, distinct players, and global-only five-minute capacities", async () => {
    const { getBotTelemetryContext } = await import("./bot-telemetry-repository");
    mocks.execute.mockImplementation(async (query: SQL) => {
      const statement = text(query);
      if (statement.includes("membership as")) return [{ scope: "global", metrics: { trackedPlayers: 2, osuActivePlayers: 1 } }, { scope: "guild:123456789012345678", metrics: { trackedPlayers: 1, storedScores: 5 } }];
      if (statement.includes("pg_database_size")) return [{ bytes: "1000", rows: "100" }];
      if (statement.includes("cloud_renderer_state")) return [{ last_seen_at: now.toISOString(), dependencies: { system: { disk_available: false, disk_used_bytes: 500, disk_total_bytes: 1000 }, render_stats: { video_bytes: 99, queue_size: 3, active_count: 2 } } }];
      if (statement.includes("music_local_audio_tracks")) return [{ bytes: "200" }];
      return [{ queued: "4", active: "1" }];
    });
    const result = await getBotTelemetryContext();
    expect(result.global).toMatchObject({ dbBytes: 1000, dbRows: 100, audioBytes: 200, diskUsedBytes: null, diskTotalBytes: null, videoBytes: null, renderQueue: 7, activeRenders: 2 });
    expect(result.guilds["123456789012345678"]).toEqual({ trackedPlayers: 1, storedScores: 5 });
    expect(result.guilds["123456789012345678"].dbBytes).toBeUndefined();
    await getBotTelemetryContext();
    expect(mocks.execute).toHaveBeenCalledTimes(5);
    vi.setSystemTime(now.getTime() + 31_000);
    await getBotTelemetryContext();
    expect(mocks.execute).toHaveBeenCalledTimes(6);
    const query = text(mocks.execute.mock.calls[0][0]);
    expect(query).toContain("count(distinct s.account_id)");
    expect(query).toContain("s.ended_at <= now()");
    expect(query).toContain("join lateral");
    expect(query).toContain("p.mode = m.mode order by captured_at desc limit 1");
  });
});

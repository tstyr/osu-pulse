import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("./index", () => ({ getDb: () => ({ execute }), databaseResultRows: (value: unknown) => Array.isArray(value) ? value : (value as { rows: unknown[] }).rows }));
import { botDimensionsQuery, getBotDimensions } from "./bot-dimensions-repository";
import { emptyBotCommandCounters } from "../lib/bot-dimensions";
const from = new Date("2026-10-07T00:00:00Z");
const to = new Date("2026-10-07T01:00:00Z");
beforeEach(() => execute.mockReset());

describe("Bot dimensions period aggregation", () => {
  it("aggregates in SQL under scope/time filters without fetching raw samples", () => {
    const query = new PgDialect().sqlToQuery(botDimensionsQuery("global", from, to));
    expect(query.sql).toContain("scope =");
    expect(query.sql).toContain("sampled_at >=");
    expect(query.sql).toContain("cross join lateral jsonb_each");
    expect(query.sql).toContain("jsonb_object_agg");
    // jsonb_build_object takes variadic "any" arguments: parameterized keys
    // need explicit text casts or PostgreSQL rejects them with SQLSTATE 42P18.
    expect(query.sql).toMatch(/jsonb_build_object\(\$\d+::text,/);
    expect(query.sql).toContain("max(");
    expect(query.sql).toContain("dimensions ? 'commands'");
    expect(query.sql).toContain("weight / nullif(interval_seconds, 0)");
    expect(query.params).toContain("discord");
    expect(query.params).toContain("durationMsTotal");
    expect(() => botDimensionsQuery("guild:bad", from, to)).toThrow("Invalid");
    expect(() => botDimensionsQuery("global", to, from)).toThrow("Invalid");
  });

  it("keeps legacy samples uncollected, not zero observed command use", async () => {
    execute.mockResolvedValue([{ sample_count: "0", collection_started_at: null, commands: {}, services: {} }]);
    expect(await getBotDimensions("global", from, to)).toEqual({ sampleCount: 0, collectionStartedAt: null, commands: [], services: [] });
  });

  it("computes failure/latency denominators independently and discards unknown service labels", async () => {
    execute.mockResolvedValue({ rows: [{ sample_count: "2", collection_started_at: from, commands: { ping: { ...emptyBotCommandCounters(), attempts: 4, failures: 1, completed: 4, durationMsTotal: 400, durationMsMax: 250, acknowledged: 2, ackMsTotal: 20, ackMsMax: 15 }, "osu stats": { ...emptyBotCommandCounters(), attempts: 1, completed: 1, durationMsTotal: 10, durationMsMax: 10 } }, services: { discord: { receivedBytes: 1024, sentBytes: 512 }, "secret.host": { receivedBytes: 42 } } }] });
    const result = await getBotDimensions("global", from, to);
    expect(result.commands[0]).toMatchObject({ command: "ping", failureRate: 25, averageDurationMs: 100, averageAckMs: 10 });
    expect(result.commands[1].averageAckMs).toBeNull();
    expect(result.services).toEqual([{ service: "discord", receivedBytes: 1024, sentBytes: 512 }]);
    expect(result.collectionStartedAt).toBe(from.toISOString());
  });
});

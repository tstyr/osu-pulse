import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("./index", () => ({ getDb: () => ({ execute: mocks.execute }), databaseResultRows: (value: unknown) => Array.isArray(value) ? value : (value as { rows: unknown[] })?.rows ?? [] }));

import { getBotDiskHistory, getBotHeatmap, getBotInsightSamples } from "./bot-insights-repository";

const from = new Date("2026-10-06T15:00:00Z");
const to = new Date("2026-10-07T03:00:00Z");
const statement = (query: SQL) => new PgDialect().sqlToQuery(query).sql;

beforeEach(() => { vi.resetAllMocks(); mocks.execute.mockResolvedValue([]); });

describe("Bot insight read-only SQL", () => {
  it("aggregates all 168 JST cells with independent weekday observation denominators and null messages", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ weekday: "2", hour: "3", plays: "4", messages: null, voiceMemberSeconds: "120", averagePlays: "2", averageMessages: null, averageVoiceMemberSeconds: "60", playDays: "2", messageDays: "0", voiceDays: "2" }] });
    const cells = await getBotHeatmap("guild:123456789012345678", from, to);
    expect(cells[0]).toMatchObject({ weekday: 2, hour: 3, plays: 4, messages: null, voiceMemberSeconds: 120, averagePlays: 2, averageMessages: null, playDays: 2 });
    const query = statement(mocks.execute.mock.calls[0][0]);
    expect(query).toContain("generate_series(0, 6)");
    expect(query).toContain("generate_series(0, 23)");
    expect(query).toContain("extract(isodow from local_at)::int - 1");
    expect(query).toContain("count(distinct local_at::date)");
    expect(query).toContain("exists (select 1 from account_guilds");
    expect(query).not.toContain("coalesce(m.messages, 0)");
    expect(query).not.toContain("coalesce(v.seconds, 0)");
    expect(query).toContain("nullif(md.days, 0)");
    expect(query).toContain("nullif(vd.days, 0)");
  });

  it("splits VC duration across explicit JST hour boundaries, clips the period and excludes offline intervals", async () => {
    await getBotHeatmap("global", from, to);
    const query = statement(mocks.execute.mock.calls[0][0]);
    expect(query).toContain("greatest(");
    expect(query).toContain("least(v.sampled_at, h.at + interval '1 hour')");
    expect(query).toContain("/ v.interval_seconds");
    expect(query).toContain("v.observed_from at time zone 'Asia/Tokyo'");
    expect(query).toContain("sampled_at - interval '1 microsecond'");
    expect(query).toContain("(metrics->>'botOnlineSeconds')::double precision > 0");
  });

  it("bounds recent anomaly input with a scope/time index-friendly window and normalizes missing metrics", async () => {
    mocks.execute.mockResolvedValue([{ sampled_at: to, session_id: "new", interval_seconds: "60", metrics: { gatewayPingMs: 10, sendBps: null } },
      { sampled_at: from, session_id: "old", interval_seconds: 60, metrics: { cpuPercent: -2 } }]);
    const rows = await getBotInsightSamples("global", to);
    expect(rows.map((row) => row.sessionId)).toEqual(["old", "new"]);
    expect(rows[0].metrics.cpuPercent).toBeNull();
    expect(rows[1].metrics.sendBps).toBeNull();
    const query = statement(mocks.execute.mock.calls[0][0]);
    expect(query).toContain("order by sampled_at desc, id desc limit 180");
    expect(query).toContain("sampled_at >=");
    expect(query).toContain("sampled_at <=");
  });

  it("uses only the latest constant disk-capacity segment and returns daily rollups instead of raw samples", async () => {
    mocks.execute.mockResolvedValue([{ points: [{ at: to.toISOString(), usedBytes: "400", totalBytes: "1000" }], observations: "10", segment_from: from.toISOString(), last_sample_at: to.toISOString() }]);
    const history = await getBotDiskHistory(to);
    expect(history).toMatchObject({ points: [{ usedBytes: 400, totalBytes: 1000 }], observations: 10, segmentFrom: from.toISOString() });
    const query = statement(mocks.execute.mock.calls[0][0]);
    expect(query).toContain("lag(capacity) over");
    expect(query).toContain("previous_capacity is distinct from capacity");
    expect(query).toContain("segment = (select max(segment)");
    expect(query).toContain("distinct on ((sampled_at at time zone 'Asia/Tokyo')::date)");
    expect(query).toContain("scope = 'global'");
  });

  it("rejects untrusted scope strings without issuing SQL", async () => {
    await expect(getBotHeatmap("guild:bad", from, to)).rejects.toThrow("Invalid");
    await expect(getBotInsightSamples("global;drop table accounts", to)).rejects.toThrow("Invalid");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

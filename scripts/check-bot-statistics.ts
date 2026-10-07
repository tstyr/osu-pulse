import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { botTelemetryAggregateQuery } from "../src/db/bot-telemetry-repository";
import { closeDatabase, isLocalDatabaseUrl } from "../src/db";
import { getBotStatistics } from "../src/services/bot-statistics";
import { botDimensionsQuery, getBotDimensions } from "../src/db/bot-dimensions-repository";
import type { BotMetricValues, BotStatisticsData } from "../src/lib/bot-statistics";

/** SELECT-only fixtures: never insert, change, or delete production statistics. */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !isLocalDatabaseUrl(databaseUrl)) throw new Error("A local DATABASE_URL is required for this read-only check.");
  const client = postgres(databaseUrl, { max: 1, prepare: false, connection: { default_transaction_read_only: true, statement_timeout: 30_000 } });
  const dialect = new PgDialect();
  const from = new Date("2026-10-06T15:00:00Z");
  const to = new Date("2026-10-06T15:05:00Z");
  const samples: Array<{ at: string; seconds: number; metrics: BotMetricValues }> = [
    // Half this observation lies before JST midnight and must not leak into today.
    { at: "2026-10-06T15:00:30Z", seconds: 60, metrics: { receivedBytes: 600, gatewayPingMs: 10, dbPingMs: 8 } },
    { at: "2026-10-06T15:01:30Z", seconds: 60, metrics: { receivedBytes: 120, gatewayPingMs: 20, dbPingMs: 4 } },
    { at: "2026-10-06T15:02:30Z", seconds: 60, metrics: { receivedBytes: 0, gatewayPingMs: null } },
  ];
  try {
    const relation = sql`(values ${sql.join(samples.map((sample, index) => sql`(${index + 1}::bigint, 'global'::text, ${sample.at}::timestamptz, ${sample.seconds}::double precision, ${sample.metrics}::jsonb)`), sql`, `)}) as fixture(id, scope, sampled_at, interval_seconds, metrics)`;
    const query = dialect.sqlToQuery(botTelemetryAggregateQuery("global", from, to, 60, relation));
    const [fixture] = await client.unsafe<{ summary: BotStatisticsData["summary"]; points: BotStatisticsData["points"]; observed_seconds: string }[]>(query.sql, query.params as postgres.ParameterOrJSON<never>[]);
    assert.equal(fixture.summary.receivedBytes?.total, 420);
    assert.equal(fixture.summary.receivedBytes?.average, 420);
    assert.equal(fixture.summary.gatewayPingMs?.latest, null);
    assert.equal(fixture.summary.dbPingMs?.latest, null, "Missing newest metric must not revive an old value.");
    assert.equal(fixture.summary.gatewayPingMs?.average, (10 * 30 + 20 * 60) / 90);
    assert.equal(Number(fixture.observed_seconds), 150);
    assert.equal(fixture.points.length, 6);
    assert.equal(fixture.points.at(-1)?.values.receivedBytes, null);

    const dimensionSamples = [
      { at: samples[0].at, dimensions: { commands: { ping: { attempts: 2, completed: 2, failures: 1, durationMsTotal: 100, durationMsMax: 70, acknowledged: 2, ackMsTotal: 40, ackMsMax: 30 } }, services: { discord: { receivedBytes: 600, sentBytes: 200 } } } },
      { at: samples[1].at, dimensions: { commands: { ping: { attempts: 1, completed: 1, failures: 0, durationMsTotal: 20, durationMsMax: 20, acknowledged: 1, ackMsTotal: 5, ackMsMax: 5 } }, services: { discord: { receivedBytes: 120, sentBytes: 40 } } } },
    ];
    const dimensionRelation = sql`(values ${sql.join(dimensionSamples.map((sample) => sql`('global'::text, ${sample.at}::timestamptz, 60::double precision, ${sample.dimensions}::jsonb)`), sql`, `)}) as fixture(scope, sampled_at, interval_seconds, dimensions)`;
    const dimensionQuery = dialect.sqlToQuery(botDimensionsQuery("global", from, to, dimensionRelation));
    const [dimensionFixture] = await client.unsafe<{ commands: Record<string, { attempts: number; durationMsMax: number; durationMsTotal: number }>; services: Record<string, { receivedBytes: number; sentBytes: number }> }[]>(dimensionQuery.sql, dimensionQuery.params as postgres.ParameterOrJSON<never>[]);
    assert.equal(dimensionFixture.commands.ping.attempts, 3, "Completed commands stay whole counts at the boundary.");
    assert.equal(dimensionFixture.commands.ping.durationMsMax, 70);
    assert.equal(dimensionFixture.commands.ping.durationMsTotal, 120);
    assert.equal(dimensionFixture.services.discord.receivedBytes, 420);
    assert.equal(dimensionFixture.services.discord.sentBytes, 140);

    const timings: Record<string, number> = {};
    await getBotDimensions("global", from, to);
    for (const range of ["today", "week", "month", "all"] as const) {
      const started = performance.now();
      const data = await getBotStatistics({ range, scope: "global" });
      timings[range] = Math.round(performance.now() - started);
      assert.equal(data.range, range);
      assert.ok(data.points.length <= 480);
      assert.ok(data.coverage.percent >= 0 && data.coverage.percent <= 100);
      assert.ok(data.modeBreakdown.reduce((sum, mode) => sum + mode.scores, 0) === data.historicalTotals.plays);
      assert.ok(data.historical.reduce((sum, point) => sum + point.plays, 0) === data.historicalTotals.plays);
      assert.ok(data.insights, "Additional statistics SQL must succeed against the real database.");
      assert.equal(data.insights.heatmap.status, "ready");
      assert.equal(data.insights.heatmap.cells.length, 168);
      assert.equal(new Set(data.insights.heatmap.cells.map((cell) => `${cell.weekday}:${cell.hour}`)).size, 168);
      assert.equal(data.insights.heatmap.cells.reduce((sum, cell) => sum + (cell.plays ?? 0), 0), data.historicalTotals.plays);
      assert.equal(data.insights.comparison.status === "not_applicable", range === "all");
      assert.ok(data.insights.disk.status);
      assert.ok(data.insights.anomalies.status);
      assert.ok(data.dimensions, "Dimensions SQL must succeed after the additive migration.");
      assert.ok(data.dimensions.sampleCount >= 0);
      assert.ok(data.dimensions.commands.every((command) => command.failures <= command.attempts));
    }
    const scopes = await client.unsafe<{ scope: string }[]>("select distinct scope from bot_telemetry_samples where scope like 'guild:%' order by scope limit 20");
    for (const { scope } of scopes) {
      const data = await getBotStatistics({ range: "all", scope });
      assert.equal(data.insights?.heatmap.status, "ready");
      assert.equal(data.insights.heatmap.cells.length, 168);
      assert.equal(data.insights.heatmap.cells.reduce((sum, cell) => sum + (cell.plays ?? 0), 0), data.historicalTotals.plays);
      assert.equal(data.insights.disk.status, "not_applicable");
      assert.ok(data.dimensions);
      assert.deepEqual(data.dimensions.services, [], "Global network traffic must not be copied into individual guilds.");
    }
    console.log(JSON.stringify({ ok: true, selectOnlyFixtures: "passed", periodReadMilliseconds: timings, verifiedGuildScopes: scopes.length }));
  } finally {
    await Promise.all([client.end(), closeDatabase()]);
  }
}

void main().catch((error: unknown) => {
  // Do not print query parameters, connection credentials, or private telemetry.
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  const diagnostic = error instanceof assert.AssertionError ? error.message : cause && typeof cause === "object" && "code" in cause ? `${String(cause.code)}${"routine" in cause ? `:${String(cause.routine)}` : ""}` : "unknown";
  console.error(`Bot statistics read-only verification failed (${diagnostic}).`);
  process.exitCode = 1;
});

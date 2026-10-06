import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { botTelemetryAggregateQuery } from "../src/db/bot-telemetry-repository";
import { closeDatabase, isLocalDatabaseUrl } from "../src/db";
import { getBotStatistics } from "../src/services/bot-statistics";
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

    const timings: Record<string, number> = {};
    for (const range of ["today", "week", "month", "all"] as const) {
      const started = performance.now();
      const data = await getBotStatistics({ range, scope: "global" });
      timings[range] = Math.round(performance.now() - started);
      assert.equal(data.range, range);
      assert.ok(data.points.length <= 480);
      assert.ok(data.coverage.percent >= 0 && data.coverage.percent <= 100);
      assert.ok(data.modeBreakdown.reduce((sum, mode) => sum + mode.scores, 0) === data.historicalTotals.plays);
      assert.ok(data.historical.reduce((sum, point) => sum + point.plays, 0) === data.historicalTotals.plays);
    }
    console.log(JSON.stringify({ ok: true, selectOnlyFixtures: "passed", periodReadMilliseconds: timings }));
  } finally {
    await Promise.all([client.end(), closeDatabase()]);
  }
}

void main().catch((error: unknown) => {
  // Do not print query parameters, connection credentials, or private telemetry.
  const diagnostic = error instanceof assert.AssertionError ? error.message : error && typeof error === "object" && "code" in error ? `${String(error.code)}${"routine" in error ? `:${String(error.routine)}` : ""}` : "unknown";
  console.error(`Bot statistics read-only verification failed (${diagnostic}).`);
  process.exitCode = 1;
});

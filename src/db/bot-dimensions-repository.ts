import { sql, type SQL } from "drizzle-orm";
import { databaseResultRows, getDb } from "./index";
import { botStatisticsGuildId } from "./bot-telemetry-repository";
import { BOT_NETWORK_SERVICES, sanitizeBotDimensions, type BotCommandCounters, type BotDimensions } from "../lib/bot-dimensions";

// Aggregation reads the existing (scope, sampled_at) index. JSONB containment
// indexes would add write cost without helping these period-wide rollups.
function valueCounter(key: string): SQL {
  return sql`case when jsonb_typeof(value -> ${key}) = 'number'
    then greatest(0::numeric, least(1000000000000000000::numeric, (value ->> ${key})::numeric))::double precision else 0 end`;
}

export function botDimensionsQuery(scope: string, from: Date, to: Date, relation: SQL = sql`bot_telemetry_samples`) {
  botStatisticsGuildId(scope);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) throw new Error("Invalid Bot dimensions period");
  const commandFields: Array<keyof BotCommandCounters> = ["attempts", "failures", "completed", "durationMsTotal", "durationMsMax", "acknowledged", "ackMsTotal", "ackMsMax"];
  const aggregates = sql.join(commandFields.map((key) => sql`${key}::text, ${key.endsWith("Max") ? sql`max(${valueCounter(key)})` : sql`sum(${valueCounter(key)})`}`), sql`, `);
  return sql`with samples as materialized (
    select dimensions, interval_seconds, greatest(0, least(interval_seconds,
      extract(epoch from sampled_at - ${from.toISOString()}::timestamptz)))::double precision as weight from ${relation}
    where scope = ${scope} and sampled_at >= ${from.toISOString()}::timestamptz and sampled_at <= ${to.toISOString()}::timestamptz
      and (dimensions ? 'commands' or dimensions ? 'services')
  ), command_values as (
    select entry.key as command, entry.value from samples
    cross join lateral jsonb_each(case when jsonb_typeof(dimensions -> 'commands') = 'object' then dimensions -> 'commands' else '{}'::jsonb end) entry
    where char_length(entry.key) <= 120
  ), commands as (
    select command, jsonb_build_object(${aggregates}) as counters from command_values group by command
  ), service_values as (
    select entry.key as service, entry.value, samples.weight, samples.interval_seconds from samples
    cross join lateral jsonb_each(case when jsonb_typeof(dimensions -> 'services') = 'object' then dimensions -> 'services' else '{}'::jsonb end) entry
    where entry.key in (${sql.join(BOT_NETWORK_SERVICES.map((key) => sql`${key}`), sql`, `)})
  ), services as (
    select service, jsonb_build_object('receivedBytes', sum(${valueCounter("receivedBytes")} * weight / nullif(interval_seconds, 0)),
      'sentBytes', sum(${valueCounter("sentBytes")} * weight / nullif(interval_seconds, 0))) as counters
    from service_values group by service
  ) select (select count(*) from samples) as sample_count,
    (select sampled_at from ${relation} where scope = ${scope} and (dimensions ? 'commands' or dimensions ? 'services') order by sampled_at asc limit 1) as collection_started_at,
    coalesce((select jsonb_object_agg(command, counters) from commands), '{}'::jsonb) as commands,
    coalesce((select jsonb_object_agg(service, counters) from services), '{}'::jsonb) as services`;
}

export async function getBotDimensions(scope: string, from: Date, to: Date): Promise<BotDimensions> {
  const rows = databaseResultRows(await getDb().execute(botDimensionsQuery(scope, from, to)));
  const row = rows[0] as { sample_count?: unknown; collection_started_at?: unknown; commands?: unknown; services?: unknown } | undefined;
  const dimensions = sanitizeBotDimensions({ commands: row?.commands, services: row?.services });
  const started = row?.collection_started_at instanceof Date ? row.collection_started_at : new Date(String(row?.collection_started_at ?? ""));
  const sampleCount = Number(row?.sample_count ?? 0);
  return {
    collectionStartedAt: Number.isFinite(started.getTime()) ? started.toISOString() : null,
    sampleCount: Number.isFinite(sampleCount) ? Math.max(0, Math.floor(sampleCount)) : 0,
    commands: Object.entries(dimensions.commands).map(([command, counters]) => ({
      command, ...counters, failureRate: counters.attempts ? counters.failures / counters.attempts * 100 : 0,
      averageDurationMs: counters.completed ? counters.durationMsTotal / counters.completed : null,
      averageAckMs: counters.acknowledged ? counters.ackMsTotal / counters.acknowledged : null,
    })).sort((left, right) => right.attempts - left.attempts || left.command.localeCompare(right.command)),
    services: BOT_NETWORK_SERVICES.flatMap((service) => dimensions.services[service] ? [{ service, ...dimensions.services[service]! }] : []),
  };
}

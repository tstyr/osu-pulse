import { sql } from "drizzle-orm";

import { databaseResultRows, getDb } from "./index";
import { botTelemetrySamples } from "./schema";
import { cachedAsync } from "../lib/async-cache";
import { BOT_STATISTIC_METRICS, type BotMetricKey, type BotMetricValues, type BotStatisticsData, type BotTelemetryInput } from "../lib/bot-statistics";

const CAPACITY_CACHE_MS = 5 * 60_000;
const CONTEXT_KEYS: BotMetricKey[] = ["osuActivePlayers", "trackedPlayers", "storedScores", "uniqueBeatmaps", "osuLifetimePlayCount", "osuLifetimePlaySeconds", "notificationPending", "notificationFailed"];

export function botStatisticsGuildId(scope: string) {
  if (scope === "global") return null;
  if (!/^guild:\d{17,20}$/.test(scope)) throw new Error("Invalid Bot statistics scope");
  return scope.slice(6);
}

export function sanitizeBotMetricValues(input: BotMetricValues): BotMetricValues {
  const metrics: BotMetricValues = {};
  for (const key of Object.keys(BOT_STATISTIC_METRICS) as BotMetricKey[]) {
    if (!(key in input)) continue;
    const value = input[key];
    metrics[key] = typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }
  return metrics;
}

/** Atomic, idempotent batches: a retry must not add a second traffic delta. */
export async function insertBotTelemetrySamples(input: BotTelemetryInput[]) {
  const unique = new Map<string, typeof botTelemetrySamples.$inferInsert>();
  for (const sample of input) {
    botStatisticsGuildId(sample.scope);
    if (!sample.sessionId || !Number.isFinite(sample.sampledAt.getTime()) || !Number.isFinite(sample.intervalSeconds) || sample.intervalSeconds <= 0) continue;
    const key = `${sample.scope}:${sample.sessionId}:${sample.sampledAt.toISOString()}`;
    if (!unique.has(key)) unique.set(key, {
      ...sample,
      scopeLabel: sample.scopeLabel.trim().slice(0, 150) || sample.scope,
      metrics: sanitizeBotMetricValues(sample.metrics),
    });
  }
  const values = [...unique.values()];
  let inserted = 0;
  for (let offset = 0; offset < values.length; offset += 500) {
    const rows = await getDb().insert(botTelemetrySamples).values(values.slice(offset, offset + 500)).onConflictDoNothing({
      target: [botTelemetrySamples.scope, botTelemetrySamples.sessionId, botTelemetrySamples.sampledAt],
    }).returning({ id: botTelemetrySamples.id });
    inserted += rows.length;
  }
  return inserted;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function readCapacity() {
  const db = getDb();
  const [database, renderer, audio, renders] = await Promise.allSettled([
    db.execute(sql`select pg_database_size(current_database()) as bytes,
      (select coalesce(sum(n_live_tup), 0) from pg_stat_user_tables) as rows`),
    db.execute(sql`select dependencies, last_seen_at from cloud_renderer_state order by last_seen_at desc limit 1`),
    db.execute(sql`select coalesce(sum(size_bytes), 0) as bytes from music_local_audio_tracks`),
    db.execute(sql`select count(*) filter (where status = 'queued') as queued,
      count(*) filter (where status in ('claimed','resolving_score','downloading_replay','resolving_beatmap','rendering','encoding','uploading')) as active from cloud_render_jobs`),
  ]);
  const databaseRow = database.status === "fulfilled" ? databaseResultRows<Record<string, unknown>>(database.value)[0] : undefined;
  const rendererRow = renderer.status === "fulfilled" ? databaseResultRows<Record<string, unknown>>(renderer.value)[0] : undefined;
  const audioRow = audio.status === "fulfilled" ? databaseResultRows<Record<string, unknown>>(audio.value)[0] : undefined;
  const renderRow = renders.status === "fulfilled" ? databaseResultRows<Record<string, unknown>>(renders.value)[0] : undefined;
  const dependencies = object(rendererRow?.dependencies);
  const system = object(dependencies.system);
  const stats = object(dependencies.render_stats);
  const rendererSeen = rendererRow?.last_seen_at ? new Date(String(rendererRow.last_seen_at)).getTime() : NaN;
  const rendererFresh = Number.isFinite(rendererSeen) && Date.now() - rendererSeen < CAPACITY_CACHE_MS;
  const available = rendererFresh && system.disk_available !== false;
  const cloudQueue = numberOrNull(renderRow?.queued);
  const localQueue = rendererFresh ? numberOrNull(stats.queue_size) : null;
  const metrics: BotMetricValues = {
    dbBytes: numberOrNull(databaseRow?.bytes), dbRows: numberOrNull(databaseRow?.rows),
    diskUsedBytes: available ? numberOrNull(system.disk_used_bytes) : null,
    diskTotalBytes: available ? numberOrNull(system.disk_total_bytes) : null,
    videoBytes: available && object(stats.storage).available !== false ? numberOrNull(stats.video_bytes) : null,
    audioBytes: numberOrNull(audioRow?.bytes),
    // Claimed cloud jobs are no longer queued in the DB: adding the local
    // waiting queue includes direct Bot jobs without counting them twice.
    renderQueue: cloudQueue === null ? null : cloudQueue + (localQueue ?? 0),
    activeRenders: (rendererFresh ? numberOrNull(stats.active_count) : null) ?? numberOrNull(renderRow?.active),
  };
  return metrics;
}

const capacity = cachedAsync(readCapacity, CAPACITY_CACHE_MS);

async function readContext() {
  const rows = databaseResultRows<{ scope: string; metrics: BotMetricValues }>(await getDb().execute(sql`
    with scopes as (
      select 'global'::text as scope union select 'guild:' || guild_id from guild_settings
    ), membership as (
      select 'global'::text as scope, id as account_id from accounts
      union all select 'guild:' || guild_id, account_id from account_guilds
    ), player_stats as (
      select m.scope, count(distinct m.account_id) as players from membership m group by m.scope
    ), score_stats as (
      select m.scope, count(*) as scores, count(distinct s.beatmap_id) as maps,
        count(distinct s.account_id) filter (where s.ended_at >= now() - interval '30 minutes' and s.ended_at <= now()) as active
      from membership m join score_events s on s.account_id = m.account_id group by m.scope
    ), latest_profiles as (
      select a.id as account_id, m.mode, p.play_count, p.play_time_seconds
      from accounts a cross join unnest(enum_range(null::osu_mode)) as m(mode)
      join lateral (select play_count, play_time_seconds from profile_snapshots p
        where p.account_id = a.id and p.mode = m.mode order by captured_at desc limit 1) p on true
    ), lifetime as (
      select m.scope, sum(p.play_count) as plays, sum(p.play_time_seconds) as seconds
      from membership m join latest_profiles p on p.account_id = m.account_id group by m.scope
    ), notification_stats as (
      select 'global'::text as scope,
        count(*) filter (where status in ('pending', 'sending')) as pending,
        count(*) filter (where status = 'failed') as failed from score_notification_deliveries
      union all select 'guild:' || r.guild_id,
        count(*) filter (where d.status in ('pending', 'sending')),
        count(*) filter (where d.status = 'failed')
      from score_notification_deliveries d join notification_rules r on r.id = d.rule_id group by r.guild_id
    )
    select sc.scope, jsonb_build_object(
      'trackedPlayers', coalesce(p.players, 0), 'storedScores', coalesce(s.scores, 0),
      'uniqueBeatmaps', coalesce(s.maps, 0), 'osuActivePlayers', coalesce(s.active, 0),
      'osuLifetimePlayCount', l.plays, 'osuLifetimePlaySeconds', l.seconds,
      'notificationPending', coalesce(n.pending, 0), 'notificationFailed', coalesce(n.failed, 0)
    ) as metrics
    from scopes sc left join player_stats p on p.scope = sc.scope left join score_stats s on s.scope = sc.scope
      left join lifetime l on l.scope = sc.scope left join notification_stats n on n.scope = sc.scope
  `));
  return rows;
}

const context = cachedAsync(readContext, 30_000);

export async function getBotTelemetryContext(): Promise<{ global: BotMetricValues; guilds: Record<string, BotMetricValues> }> {
  const unknown = Object.fromEntries(CONTEXT_KEYS.map((key) => [key, null])) as BotMetricValues;
  const [rows, storage] = await Promise.allSettled([context(), capacity()]);
  const global: BotMetricValues = { ...unknown, ...(storage.status === "fulfilled" ? storage.value : {
    dbBytes: null, dbRows: null, diskUsedBytes: null, diskTotalBytes: null, videoBytes: null, audioBytes: null, renderQueue: null, activeRenders: null,
  }) };
  const guilds: Record<string, BotMetricValues> = {};
  if (rows.status === "fulfilled") for (const row of rows.value) {
    if (row.scope === "global") Object.assign(global, sanitizeBotMetricValues(row.metrics));
    else guilds[row.scope.slice(6)] = sanitizeBotMetricValues(row.metrics);
  }
  return { global, guilds };
}

function scoreScope(scope: string, alias = "s") {
  const guildId = botStatisticsGuildId(scope);
  return guildId ? sql`exists (select 1 from account_guilds ag where ag.account_id = ${sql.raw(alias)}.account_id and ag.guild_id = ${guildId})` : sql`true`;
}

function discordScope(scope: string, alias = "d") {
  const guildId = botStatisticsGuildId(scope);
  return guildId ? sql`${sql.raw(alias)}.guild_id = ${guildId}` : sql`true`;
}

export type BotStatisticsExtent = { firstSampleAt: string | Date | null; lastSampleAt: string | Date | null; historyStartedAt: string | Date | null; scopes: BotStatisticsData["scopes"] };

export async function getBotStatisticsExtent(scope: string): Promise<BotStatisticsExtent> {
  botStatisticsGuildId(scope);
  const [row] = databaseResultRows<{ first_sample_at: string | null; last_sample_at: string | null; history_started_at: string | null; scopes: BotStatisticsData["scopes"] }>(await getDb().execute(sql`
    -- Enumerate distinct scopes using the scope/time index, not a full scan of
    -- years of samples. Retain historical scopes even after a guild is removed.
    with recursive recorded_scopes(scope) as (
      select min(scope) from bot_telemetry_samples
      union all select (select min(t.scope) from bot_telemetry_samples t where t.scope > r.scope)
        from recorded_scopes r where r.scope is not null
    ), known_scopes as (
      select scope from recorded_scopes where scope is not null
      union select 'global'::text union select 'guild:' || guild_id from guild_settings
    )
    select (select min(sampled_at) from bot_telemetry_samples where scope = ${scope}) as first_sample_at,
      (select max(sampled_at) from bot_telemetry_samples where scope = ${scope}) as last_sample_at,
      least((select min(ended_at) from score_events s where ${scoreScope(scope)}),
        (select min(bucket_hour) from discord_activity_buckets d where ${discordScope(scope)})) as history_started_at,
      (select coalesce(jsonb_agg(jsonb_build_object('id', k.scope, 'label', coalesce(label.scope_label,
        case when k.scope = 'global' then 'Bot全体' else k.scope end)) order by k.scope), '[]'::jsonb)
       from known_scopes k left join lateral (select scope_label from bot_telemetry_samples t
         where t.scope = k.scope order by sampled_at desc limit 1) label on true) as scopes
  `));
  return { firstSampleAt: row?.first_sample_at ?? null, lastSampleAt: row?.last_sample_at ?? null, historyStartedAt: row?.history_started_at ?? null, scopes: row?.scopes ?? [] };
}

export type BotTelemetryAggregate = { summary: BotStatisticsData["summary"]; points: BotStatisticsData["points"]; sampleCount: number; observedSeconds: number };

/** All raw samples remain in PostgreSQL; only bounded rollups leave the DB. */
export async function getBotTelemetryAggregate(scope: string, from: Date, to: Date, bucketSeconds: number): Promise<BotTelemetryAggregate> {
  botStatisticsGuildId(scope);
  const definitions = sql.join(Object.entries(BOT_STATISTIC_METRICS).map(([key, definition]) => sql`(${key}::text, ${definition.kind}::text)`), sql`, `);
  const fromValue = from.toISOString();
  const toValue = to.toISOString();
  const stride = sql`${bucketSeconds} * interval '1 second'`;
  const [row] = databaseResultRows<{ summary: BotStatisticsData["summary"]; points: BotStatisticsData["points"]; sample_count: number | string; observed_seconds: number | string }>(await getDb().execute(sql`
    with definitions(metric, kind) as (values ${definitions}), samples as materialized (
      select id, sampled_at, metrics, greatest(0, least(interval_seconds,
        extract(epoch from sampled_at - ${fromValue}::timestamptz)))::double precision as weight,
        greatest(${fromValue}::timestamptz, sampled_at - interval_seconds * interval '1 second') as observed_from
      from bot_telemetry_samples where scope = ${scope} and sampled_at >= ${fromValue}::timestamptz and sampled_at <= ${toValue}::timestamptz
    ), valued as materialized (
      select s.id, s.sampled_at, s.weight, d.metric, d.kind,
        case when jsonb_typeof(e.value) = 'number' then e.value::text::double precision end as value
      from samples s cross join lateral jsonb_each(s.metrics) e join definitions d on d.metric = e.key
    ), latest as (
      select distinct on (metric) metric, value from valued order by metric, sampled_at desc, id desc
    ), summaries as (
      select metric, min(value) as minimum, max(value) as maximum,
        case when kind = 'delta' then sum(value) end as total,
        case when kind = 'delta' then sum(value) / nullif(count(distinct (sampled_at at time zone 'Asia/Tokyo')::date) filter (where value is not null), 0)
          else sum(value * weight) / nullif(sum(weight) filter (where value is not null), 0) end as average
      from valued group by metric, kind
    ), buckets as (
      select date_bin(${stride}, sampled_at, ${fromValue}::timestamptz) as bucket, metric,
        case when kind = 'delta' then sum(value) else sum(value * weight) / nullif(sum(weight) filter (where value is not null), 0) end as value
      from valued group by bucket, metric, kind
    ), timeline as (
      select at, jsonb_object_agg(d.metric, b.value) as values
      from generate_series(${fromValue}::timestamptz, ${toValue}::timestamptz, ${stride}) at
        cross join definitions d left join buckets b on b.bucket = at and b.metric = d.metric group by at
    ), observed as (
      select range_agg(tstzrange(observed_from, sampled_at, '[)')) as spans from samples
    )
    select (select coalesce(jsonb_object_agg(s.metric, jsonb_build_object('latest', l.value, 'average', s.average,
      'minimum', s.minimum, 'maximum', s.maximum, 'total', s.total)), '{}'::jsonb) from summaries s left join latest l on l.metric = s.metric) as summary,
      (select coalesce(jsonb_agg(jsonb_build_object('at', at, 'values', values) order by at), '[]'::jsonb) from timeline) as points,
      (select count(*) from samples) as sample_count,
      (select coalesce(sum(extract(epoch from upper(span) - lower(span))), 0) from observed cross join lateral unnest(spans) span) as observed_seconds
  `));
  return { summary: row?.summary ?? {}, points: row?.points ?? [], sampleCount: Number(row?.sample_count ?? 0), observedSeconds: Number(row?.observed_seconds ?? 0) };
}

export type BotHistoricalAggregate = Pick<BotStatisticsData, "activityHours" | "modeBreakdown" | "historical" | "historicalTotals">;

export async function getBotHistoricalAggregate(scope: string, from: Date, to: Date, bucketSeconds: number): Promise<BotHistoricalAggregate> {
  botStatisticsGuildId(scope);
  const fromValue = from.toISOString();
  const toValue = to.toISOString();
  const stride = sql`${bucketSeconds} * interval '1 second'`;
  const [row] = databaseResultRows<BotHistoricalAggregate>(await getDb().execute(sql`
    with scores as materialized (
      select s.account_id, s.mode, s.beatmap_id, s.ended_at, coalesce(s.beatmap_length_seconds, 0) as seconds
      from score_events s where s.ended_at >= ${fromValue}::timestamptz and s.ended_at <= ${toValue}::timestamptz and ${scoreScope(scope)}
    ), discord as materialized (
      select d.bucket_hour, d.message_count from discord_activity_buckets d
      where d.bucket_hour >= ${fromValue}::timestamptz and d.bucket_hour <= ${toValue}::timestamptz and ${discordScope(scope)}
    ), voice as materialized (
      select sampled_at, (metrics->>'voiceMemberSeconds')::double precision as seconds
      from bot_telemetry_samples where scope = ${scope} and sampled_at >= ${fromValue}::timestamptz and sampled_at <= ${toValue}::timestamptz
        and jsonb_typeof(metrics->'voiceMemberSeconds') = 'number'
    ), dates as (
      select (ended_at at time zone 'Asia/Tokyo')::date as date from scores
      union select (bucket_hour at time zone 'Asia/Tokyo')::date from discord
      union select (sampled_at at time zone 'Asia/Tokyo')::date from voice
    ), score_hours as (
      select extract(hour from ended_at at time zone 'Asia/Tokyo')::int as hour, count(*) as plays from scores group by 1
    ), discord_hours as (
      select extract(hour from bucket_hour at time zone 'Asia/Tokyo')::int as hour, sum(message_count) as messages from discord group by 1
    ), voice_hours as (
      select extract(hour from sampled_at at time zone 'Asia/Tokyo')::int as hour, sum(seconds) as voice_seconds from voice group by 1
    ), hours as (
      select h.hour, d.messages, coalesce(s.plays, 0) as plays, v.voice_seconds
      from generate_series(0, 23) h(hour) left join score_hours s on s.hour = h.hour
        left join discord_hours d on d.hour = h.hour left join voice_hours v on v.hour = h.hour
    ), score_buckets as (
      select date_bin(${stride}, ended_at, ${fromValue}::timestamptz) as bucket, count(*) as plays,
        count(distinct beatmap_id) as maps, count(distinct account_id) as players, sum(seconds) as seconds from scores group by bucket
    ), discord_buckets as (
      select date_bin(${stride}, bucket_hour, ${fromValue}::timestamptz) as bucket, sum(message_count) as messages from discord group by bucket
    ), history as (
      select t.bucket, d.messages, coalesce(s.plays, 0) as plays,
        coalesce(s.maps, 0) as maps, coalesce(s.players, 0) as players, coalesce(s.seconds, 0) as seconds
      from generate_series(${fromValue}::timestamptz, ${toValue}::timestamptz, ${stride}) t(bucket)
        left join score_buckets s on s.bucket = t.bucket left join discord_buckets d on d.bucket = t.bucket
    ), modes as (
      select mode, count(*) as scores, count(distinct account_id) as players, count(distinct beatmap_id) as maps, sum(seconds) as seconds from scores group by mode
    )
    select (select jsonb_agg(jsonb_build_object('hour', hour, 'messages', messages, 'plays', plays, 'voiceMemberSeconds', voice_seconds,
      'days', (select count(*) from dates),
      'averageMessages', messages / nullif((select count(distinct (bucket_hour at time zone 'Asia/Tokyo')::date) from discord), 0)::double precision,
      'averagePlays', plays / greatest(1, (select count(distinct (ended_at at time zone 'Asia/Tokyo')::date) from scores))::double precision,
      'averageVoiceMemberSeconds', voice_seconds / nullif((select count(distinct (sampled_at at time zone 'Asia/Tokyo')::date) from voice), 0)::double precision) order by hour) from hours) as "activityHours",
      (select coalesce(jsonb_agg(jsonb_build_object('mode', mode, 'scores', scores, 'activePlayers', players, 'uniqueBeatmaps', maps, 'playTimeSeconds', seconds) order by mode), '[]'::jsonb) from modes) as "modeBreakdown",
      (select coalesce(jsonb_agg(jsonb_build_object('at', bucket, 'messages', messages, 'plays', plays, 'uniqueBeatmaps', maps, 'activePlayers', players, 'playTimeSeconds', seconds) order by bucket), '[]'::jsonb) from history) as historical,
      jsonb_build_object('messages', (select coalesce(sum(message_count), 0) from discord), 'plays', (select count(*) from scores),
        'uniqueBeatmaps', (select count(distinct beatmap_id) from scores), 'activePlayers', (select count(distinct account_id) from scores),
        'playTimeSeconds', (select coalesce(sum(seconds), 0) from scores), 'days', (select count(*) from dates)) as "historicalTotals"
  `));
  return row ?? { activityHours: [], modeBreakdown: [], historical: [], historicalTotals: { messages: 0, plays: 0, uniqueBeatmaps: 0, activePlayers: 0, playTimeSeconds: 0, days: 0 } };
}

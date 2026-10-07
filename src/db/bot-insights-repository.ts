import { sql } from "drizzle-orm";

import { databaseResultRows, getDb } from "./index";
import { botStatisticsGuildId, sanitizeBotMetricValues } from "./bot-telemetry-repository";
import type { BotDiskHistory, BotHeatmapCell, BotInsightSample } from "../lib/bot-insights";
import type { BotMetricValues } from "../lib/bot-statistics";

function optionalNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Aggregation stays in PG: one bounded 168-cell result, not years of raw rows. */
export async function getBotHeatmap(scope: string, from: Date, to: Date): Promise<BotHeatmapCell[]> {
  const guildId = botStatisticsGuildId(scope);
  const fromValue = from.toISOString();
  const toValue = to.toISOString();
  const rows = databaseResultRows<BotHeatmapCell>(await getDb().execute(sql`
    with scores as materialized (
      select ended_at at time zone 'Asia/Tokyo' as local_at from score_events s
      where s.ended_at >= ${fromValue}::timestamptz and s.ended_at <= ${toValue}::timestamptz
        and ${guildId ? sql`exists (select 1 from account_guilds ag where ag.account_id = s.account_id and ag.guild_id = ${guildId})` : sql`true`}
    ), discord as materialized (
      select bucket_hour at time zone 'Asia/Tokyo' as local_at, message_count from discord_activity_buckets d
      where d.bucket_hour >= ${fromValue}::timestamptz and d.bucket_hour <= ${toValue}::timestamptz
        and ${guildId ? sql`d.guild_id = ${guildId}` : sql`true`}
    ), voice_samples as materialized (
      select sampled_at, interval_seconds,
        (metrics->>'voiceMemberSeconds')::double precision as seconds,
        greatest(${fromValue}::timestamptz, sampled_at - interval_seconds * interval '1 second') as observed_from
      from bot_telemetry_samples where scope = ${scope}
        and sampled_at >= ${fromValue}::timestamptz and sampled_at <= ${toValue}::timestamptz
        and interval_seconds > 0 and jsonb_typeof(metrics->'voiceMemberSeconds') = 'number'
        and jsonb_typeof(metrics->'botOnlineSeconds') = 'number' and (metrics->>'botOnlineSeconds')::double precision > 0
    ), voice as materialized (
      -- Split every observed interval at hour boundaries. Allocation is a
      -- reference estimate because the original interval stores only a total.
      select h.at at time zone 'Asia/Tokyo' as local_at,
        v.seconds * extract(epoch from least(v.sampled_at, h.at + interval '1 hour')
          - greatest(v.observed_from, h.at)) / v.interval_seconds as seconds
      from voice_samples v cross join lateral generate_series(
        date_trunc('hour', v.observed_from at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo',
        date_trunc('hour', (v.sampled_at - interval '1 microsecond') at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo', interval '1 hour') h(at)
      where v.sampled_at > v.observed_from
    ), score_cells as (
      select extract(isodow from local_at)::int - 1 as weekday, extract(hour from local_at)::int as hour, count(*) as plays
      from scores group by 1, 2
    ), message_cells as (
      select extract(isodow from local_at)::int - 1 as weekday, extract(hour from local_at)::int as hour, sum(message_count) as messages
      from discord group by 1, 2
    ), voice_cells as (
      select extract(isodow from local_at)::int - 1 as weekday, extract(hour from local_at)::int as hour, sum(seconds) as seconds
      from voice group by 1, 2
    ), score_days as (
      select extract(isodow from local_at)::int - 1 as weekday, count(distinct local_at::date) as days from scores group by 1
    ), message_days as (
      select extract(isodow from local_at)::int - 1 as weekday, count(distinct local_at::date) as days from discord group by 1
    ), voice_days as (
      select extract(isodow from local_at)::int - 1 as weekday, count(distinct local_at::date) as days from voice group by 1
    )
    select w.day as weekday, h.hour, coalesce(s.plays, 0) as plays, m.messages, v.seconds as "voiceMemberSeconds",
      coalesce(s.plays, 0) / greatest(1, coalesce(sd.days, 0))::double precision as "averagePlays",
      m.messages / nullif(md.days, 0)::double precision as "averageMessages",
      v.seconds / nullif(vd.days, 0)::double precision as "averageVoiceMemberSeconds",
      coalesce(sd.days, 0)::int as "playDays", coalesce(md.days, 0)::int as "messageDays", coalesce(vd.days, 0)::int as "voiceDays"
    from generate_series(0, 6) w(day) cross join generate_series(0, 23) h(hour)
      left join score_cells s on s.weekday = w.day and s.hour = h.hour
      left join message_cells m on m.weekday = w.day and m.hour = h.hour
      left join voice_cells v on v.weekday = w.day and v.hour = h.hour
      left join score_days sd on sd.weekday = w.day left join message_days md on md.weekday = w.day left join voice_days vd on vd.weekday = w.day
    order by w.day, h.hour
  `));
  return rows.map((row) => ({
    weekday: Number(row.weekday), hour: Number(row.hour), plays: optionalNumber(row.plays), messages: optionalNumber(row.messages),
    voiceMemberSeconds: optionalNumber(row.voiceMemberSeconds), averagePlays: optionalNumber(row.averagePlays),
    averageMessages: optionalNumber(row.averageMessages), averageVoiceMemberSeconds: optionalNumber(row.averageVoiceMemberSeconds),
    playDays: Number(row.playDays), messageDays: Number(row.messageDays), voiceDays: Number(row.voiceDays),
  }));
}

/** Fixed short recent window used only for explainable, consecutive anomalies. */
export async function getBotInsightSamples(scope: string, to: Date): Promise<BotInsightSample[]> {
  botStatisticsGuildId(scope);
  const rows = databaseResultRows<{ sampled_at: string | Date; session_id: string; interval_seconds: number | string; metrics: BotMetricValues }>(await getDb().execute(sql`
    select sampled_at, session_id, interval_seconds, metrics from bot_telemetry_samples
    where scope = ${scope} and sampled_at >= ${new Date(to.getTime() - 2 * 3_600_000).toISOString()}::timestamptz
      and sampled_at <= ${to.toISOString()}::timestamptz
    order by sampled_at desc, id desc limit 180
  `));
  return rows.map((row) => ({ at: new Date(row.sampled_at).toISOString(), sessionId: row.session_id,
    intervalSeconds: Number(row.interval_seconds), metrics: sanitizeBotMetricValues(row.metrics) })).reverse();
}

/** Daily rollup of only the latest constant-capacity segment, maximum 31 rows. */
export async function getBotDiskHistory(to: Date): Promise<BotDiskHistory> {
  const [row] = databaseResultRows<{ points: Array<{ at: string; usedBytes: unknown; totalBytes: unknown }>; observations: unknown; segment_from: string | null; last_sample_at: string | null }>(await getDb().execute(sql`
    with observations as materialized (
      select id, sampled_at, (metrics->>'diskUsedBytes')::double precision as used,
        (metrics->>'diskTotalBytes')::double precision as capacity
      from bot_telemetry_samples where scope = 'global'
        and sampled_at >= ${new Date(to.getTime() - 30 * 86_400_000).toISOString()}::timestamptz
        and sampled_at <= ${to.toISOString()}::timestamptz
        and jsonb_typeof(metrics->'diskUsedBytes') = 'number' and jsonb_typeof(metrics->'diskTotalBytes') = 'number'
    ), changed as (
      select *, lag(capacity) over (order by sampled_at, id) as previous_capacity from observations where capacity > 0 and used <= capacity
    ), segments as (
      select *, sum(case when previous_capacity is distinct from capacity then 1 else 0 end)
        over (order by sampled_at, id) as segment from changed
    ), current_segment as materialized (
      select * from segments where segment = (select max(segment) from segments)
    ), daily as (
      select distinct on ((sampled_at at time zone 'Asia/Tokyo')::date) sampled_at, used, capacity
      from current_segment order by (sampled_at at time zone 'Asia/Tokyo')::date, sampled_at desc, id desc
    )
    select (select coalesce(jsonb_agg(jsonb_build_object('at', sampled_at, 'usedBytes', used, 'totalBytes', capacity) order by sampled_at), '[]'::jsonb) from daily) as points,
      (select count(*) from current_segment) as observations,
      (select min(sampled_at) from current_segment) as segment_from,
      (select max(sampled_at) from current_segment) as last_sample_at
  `));
  return {
    points: (row?.points ?? []).flatMap((point) => {
      const usedBytes = optionalNumber(point.usedBytes); const totalBytes = optionalNumber(point.totalBytes);
      return usedBytes !== null && totalBytes !== null ? [{ at: new Date(point.at).toISOString(), usedBytes, totalBytes }] : [];
    }), observations: Number(row?.observations ?? 0), segmentFrom: row?.segment_from ?? null, lastSampleAt: row?.last_sample_at ?? null,
  };
}

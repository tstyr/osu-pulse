import { getBotHistoricalAggregate, getBotStatisticsExtent, getBotTelemetryAggregate, botStatisticsGuildId } from "../db/bot-telemetry-repository";
import { BOT_STATISTICS_RANGES, type BotStatisticsData, type BotStatisticsRange } from "../lib/bot-statistics";

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 3_600_000;
const MAX_POINTS = 480;

function iso(value: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function botStatisticsPeriod(range: BotStatisticsRange, now: Date, earliest: string | Date | null = null) {
  const midnightJst = Math.floor((now.getTime() + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS;
  const earliestTime = earliest ? new Date(earliest).getTime() : NaN;
  const from = range === "all" && Number.isFinite(earliestTime)
    ? Math.min(midnightJst, Math.floor((earliestTime + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS)
    : midnightJst - (range === "week" ? 6 : range === "month" ? 29 : 0) * DAY_MS;
  return { from: new Date(from), to: now };
}

export function botStatisticsBucketSeconds(range: BotStatisticsRange, periodSeconds: number) {
  const minimum = range === "all" ? 86_400 : range === "month" ? 21_600 : range === "week" ? 3_600 : 300;
  const needed = Math.max(minimum, Math.ceil(periodSeconds / (MAX_POINTS - 1)));
  return [300, 900, 1_800, 3_600, 21_600, 86_400, 604_800, 2_592_000, 7_776_000, 31_536_000].find((value) => value >= needed) ?? Math.ceil(needed / 86_400) * 86_400;
}

async function buildBotStatistics(range: BotStatisticsRange, scope: string): Promise<BotStatisticsData> {
  const now = new Date();
  const extent = await getBotStatisticsExtent(scope);
  const starts = [iso(extent.firstSampleAt), iso(extent.historyStartedAt)].filter((value): value is string => value !== null).sort();
  const { from, to } = botStatisticsPeriod(range, now, starts[0] ?? null);
  const periodSeconds = Math.max(0, (to.getTime() - from.getTime()) / 1_000);
  const bucketSeconds = botStatisticsBucketSeconds(range, periodSeconds);
  const [telemetry, historical] = await Promise.all([
    getBotTelemetryAggregate(scope, from, to, bucketSeconds), getBotHistoricalAggregate(scope, from, to, Math.max(86_400, bucketSeconds)),
  ]);
  const observedSeconds = Math.min(periodSeconds, Math.max(0, telemetry.observedSeconds));
  const lastSampleAt = iso(extent.lastSampleAt);
  const scopes = extent.scopes.some((item) => item.id === "global") ? extent.scopes : [{ id: "global", label: "Bot全体" }, ...extent.scopes];
  return {
    range, scope, generatedAt: now.toISOString(), from: from.toISOString(), to: to.toISOString(),
    collectionStartedAt: iso(extent.firstSampleAt), lastSampleAt,
    stale: !lastSampleAt || now.getTime() - Date.parse(lastSampleAt) > 180_000,
    bucketSeconds, scopes, summary: telemetry.summary,
    points: telemetry.points.map((point) => ({ ...point, at: iso(point.at) ?? point.at })),
    coverage: { sampleCount: telemetry.sampleCount, observedSeconds, periodSeconds, percent: periodSeconds > 0 ? observedSeconds / periodSeconds * 100 : 0 },
    ...historical,
    historical: historical.historical.map((point) => ({ ...point, at: iso(point.at) ?? point.at })),
    notes: [
      "通信量・コマンド数などの平均は、値を観測したJSTの日数あたりの1日平均です。未収集日は分母に含めません。",
      "Ping・人数・使用率などは観測間隔で重み付けした平均です。未収集区間は補間せずnull表示します。",
      "期間境界をまたぐ計測区間の通信量・件数・接続時間は、期間に重なる秒数で按分した参考値です。",
      "保存プレイ履歴はDBに記録された分だけです。プレイ時間は譜面の長さが保存された分の参考合計で、失敗・速度MODの補正を含みません。",
      "プロフィール累計は各プレイヤー×各モードの最新記録だけを合計しています。サーバー別集計は現在の登録プレイヤー所属を使います。",
      "メッセージ履歴は既存のDiscord活動記録、VC延べ時間は新しいBot統計の観測分です。欠測は復元できません。",
      "DB行数はPostgresの概算値です。容量・ディスク・レンダー待機値は最大5分のキャッシュを使います。音源容量はDB音源索引の合計です。",
      ...(scope === "global" ? [] : ["通信量・CPU・メモリ・PC容量はBot全体の値です。サーバー別の値として複製していません。"]),
    ],
  };
}

const results = new Map<string, { expiresAt: number; promise: Promise<BotStatisticsData> }>();

export function getBotStatistics(input: { range: BotStatisticsRange; scope: string }): Promise<BotStatisticsData> {
  if (!BOT_STATISTICS_RANGES.includes(input.range)) throw new Error("Invalid Bot statistics range");
  botStatisticsGuildId(input.scope);
  const key = `${input.range}:${input.scope}`;
  const cached = results.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  // Bound distinct scope/range cache keys even if a long-lived server sees
  // arbitrary requests. Failed reads are evicted and remain retryable.
  if (results.size >= 100) results.delete(results.keys().next().value!);
  const current = { expiresAt: Infinity, promise: buildBotStatistics(input.range, input.scope) };
  results.set(key, current);
  void current.promise.then(() => { current.expiresAt = Date.now() + 15_000; }, () => { if (results.get(key) === current) results.delete(key); });
  return current.promise;
}

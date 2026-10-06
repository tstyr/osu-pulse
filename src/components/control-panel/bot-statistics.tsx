"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Bot, Database, HardDrive, RefreshCw, Users } from "lucide-react";
import { Bar, BarChart, Brush, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BOT_STATISTIC_METRICS, type BotMetricKey, type BotStatisticsData, type BotStatisticsRange } from "@/lib/bot-statistics";
import { liveRequestOptions, requestJson } from "@/lib/client/request-json";
import { RefreshNotice } from "./refresh-notice";
import { botMetricIsGlobalOnly, botSeriesOpacity, botStatisticsScopeLabel, botTabNavigationIndex, formatBotAxisDate, formatBotAxisValue, formatBotDate, formatBotValue, matchingBotStatistics } from "./bot-statistics-presentation";

const ranges: Array<{ id: BotStatisticsRange; label: string }> = [
  { id: "today", label: "今日" }, { id: "week", label: "7日" }, { id: "month", label: "30日" }, { id: "all", label: "全期間" },
];
const tabs = [
  { id: "network", label: "通信・Ping" }, { id: "community", label: "Discord" },
  { id: "osu", label: "osu!" }, { id: "resources", label: "処理・容量" },
] as const;
type Tab = typeof tabs[number]["id"];
type ChartPoint = { at: string; label: string; [key: string]: string | number | null };
type Series = { key: string; label: string; color: string; metric: BotMetricKey; axis?: "right" };
const colors = ["#0051c3", "#ee7b16", "#16976c", "#9254cc", "#db426d", "#178aa6"];
const metricSeries = (keys: BotMetricKey[]): Series[] => keys.map((key, index) => ({
  key, label: BOT_STATISTIC_METRICS[key].label, color: colors[index % colors.length], metric: key,
}));
const metricKeys = Object.keys(BOT_STATISTIC_METRICS) as BotMetricKey[];
const groupLabels: Record<string, string> = {
  network: "通信", latency: "応答時間", community: "Discord人数", activity: "Discord利用", osu: "osu!", resources: "Bot処理", storage: "保存容量", operations: "キュー",
};

function StatisticsChart({ title, description, data, series, bar = false, emptyDescription }: {
  title: string; description: string; data: ChartPoint[]; series: Series[]; bar?: boolean; emptyDescription?: string;
}) {
  const [focused, setFocused] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ from: string; to: string } | null>(null);
  const hasValues = data.some((point) => series.some((item) => typeof point[item.key] === "number" && Number.isFinite(point[item.key])));
  const startIndex = zoom ? Math.max(0, data.findIndex((point) => point.at >= zoom.from)) : 0;
  const lastInZoom = zoom ? data.findLastIndex((point) => point.at <= zoom.to) : data.length - 1;
  const endIndex = Math.max(startIndex, lastInZoom);
  const leftMetrics = series.filter((item) => item.axis !== "right").map((item) => item.metric);
  const rightMetrics = series.filter((item) => item.axis === "right").map((item) => item.metric);
  const chartChildren = <>
    <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" vertical={false} />
    <XAxis dataKey="label" minTickGap={52} tick={{ fontSize: 10, fill: "#778296" }} />
    <YAxis yAxisId="left" width={82} tick={{ fontSize: 10 }} tickFormatter={(value) => formatBotAxisValue(leftMetrics, Number(value))} />
    {rightMetrics.length ? <YAxis yAxisId="right" orientation="right" width={82} tick={{ fontSize: 10 }} tickFormatter={(value) => formatBotAxisValue(rightMetrics, Number(value))} /> : null}
    <Tooltip labelFormatter={(label, payload) => {
      const at = payload[0]?.payload?.at;
      return `${typeof at === "string" && /^\d{4}-\d{2}-\d{2}/.test(at) ? formatBotDate(at) : String(label)} · JST`;
    }} formatter={(value, name) => {
      const item = series.find((entry) => entry.key === String(name));
      return [item ? formatBotValue(item.metric, value) : String(value), item?.label ?? String(name)];
    }} contentStyle={{ borderRadius: 8, fontSize: 11, borderColor: "#d8dfe9" }} />
    {series.map((item) => bar ? <Bar key={item.key} dataKey={item.key} name={item.key} yAxisId={item.axis ?? "left"} fill={item.color} fillOpacity={botSeriesOpacity(focused, item.key)} isAnimationActive={false} onClick={() => setFocused((current) => current === item.key ? null : item.key)} /> : <Line
      key={item.key} dataKey={item.key} name={item.key} yAxisId={item.axis ?? "left"} type="linear" stroke={item.color}
      strokeOpacity={botSeriesOpacity(focused, item.key)} strokeWidth={focused === item.key ? 3 : 2}
      dot={data.filter((point) => typeof point[item.key] === "number" && Number.isFinite(point[item.key])).length === 1 ? { r: 3 } : false} connectNulls={false}
      activeDot={{ r: 4, onClick: () => setFocused((current) => current === item.key ? null : item.key) }}
      onClick={() => setFocused((current) => current === item.key ? null : item.key)} isAnimationActive={false}
    />)}
    {data.length > 2 ? <Brush dataKey="label" height={25} stroke="#8fa4c1" startIndex={startIndex} endIndex={endIndex} travellerWidth={9} tickFormatter={(value) => String(value)} onChange={(next) => {
      const from = data[next.startIndex ?? 0]?.at;
      const to = data[next.endIndex ?? data.length - 1]?.at;
      if (from && to) setZoom({ from, to });
    }} /> : null}
  </>;

  return <section className="cp-panel min-w-0 overflow-hidden">
    <div className="border-b px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">{title}</h2>
        {(zoom || focused) ? <button type="button" className="text-[11px] font-medium text-[#0051c3]" onClick={() => { setZoom(null); setFocused(null); }}>表示をリセット</button> : null}
      </div>
      <p className="mt-1 text-[11px] leading-5 text-[#748094]">{description}</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2" aria-label={`${title}の凡例。クリックでフォーカス`}>
        {series.map((item) => <button key={item.key} type="button" aria-pressed={focused === item.key} onClick={() => setFocused((current) => current === item.key ? null : item.key)} className="inline-flex items-center gap-1.5 text-[11px]" style={{ opacity: focused && focused !== item.key ? 0.45 : 1 }}>
          <span className="h-0.5 w-4" style={{ backgroundColor: item.color }} />{item.label}{item.axis === "right" ? "（右軸）" : ""}
        </button>)}
      </div>
    </div>
    {hasValues ? <div className="h-80 px-2 pb-2 pt-5 sm:px-4"><ResponsiveContainer width="100%" height="100%">
      {bar ? <BarChart data={data} margin={{ left: 0, right: 6 }} accessibilityLayer>{chartChildren}</BarChart> : <LineChart data={data} margin={{ left: 0, right: 6 }} accessibilityLayer>{chartChildren}</LineChart>}
    </ResponsiveContainer></div> : <div className="flex h-52 items-center justify-center px-5 text-center text-sm leading-6 text-[#7b8492]">{emptyDescription ?? "この期間・範囲の記録はまだありません。"}</div>}
  </section>;
}

function SummaryCard({ label, metric, value, detail, icon: Icon }: {
  label: string; metric: BotMetricKey; value: number | null | undefined; detail: string; icon: typeof Activity;
}) {
  return <div className="cp-panel min-w-0 p-4">
    <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-medium text-[#637084]">{label}</p><Icon className="size-4 text-[#8c98aa]" /></div>
    <p className="mt-3 break-words text-2xl font-semibold tracking-[-0.025em]">{formatBotValue(metric, value)}</p>
    <p className="mt-1 text-[10px] leading-4 text-[#7e899a]">{detail}</p>
  </div>;
}

export function BotStatistics() {
  const [range, setRange] = useState<BotStatisticsRange>("today");
  const [scope, setScope] = useState("global");
  const [tab, setTab] = useState<Tab>("network");
  const [hourView, setHourView] = useState<"total" | "average">("total");
  const query = useSWR<BotStatisticsData>(`/api/control/bot-statistics?range=${range}&scope=${encodeURIComponent(scope)}`, requestJson, {
    ...liveRequestOptions, refreshInterval: 30_000, revalidateOnFocus: false, revalidateOnReconnect: true, dedupingInterval: 10_000,
  });
  const data = matchingBotStatistics(query.data, range, scope);
  const points = useMemo<ChartPoint[]>(() => data?.points.map((point) => ({ at: point.at, label: formatBotAxisDate(point.at, range, data.bucketSeconds < 86_400), ...point.values })) ?? [], [data, range]);
  const historical = useMemo<ChartPoint[]>(() => data?.historical.map((point) => ({ ...point, label: formatBotAxisDate(point.at, range === "today" ? "week" : range) })) ?? [], [data, range]);
  const hourly = useMemo<ChartPoint[]>(() => data?.activityHours.map((point) => ({
    ...point, at: String(point.hour).padStart(2, "0"), label: `${point.hour}時`,
    messages: hourView === "average" ? point.averageMessages : point.messages,
    plays: hourView === "average" ? point.averagePlays : point.plays,
    voiceMemberSeconds: hourView === "average" ? point.averageVoiceMemberSeconds : point.voiceMemberSeconds,
  })) ?? [], [data, hourView]);
  const refresh = () => { void query.mutate().catch(() => undefined); };
  const summary = data?.summary;
  const scopeLabel = botStatisticsScopeLabel(query.data?.scopes, scope);
  const globalOnlyDescription = scope === "global" ? undefined : "この指標はサーバー別に計測しません。「Bot全体（全サーバー）」を選ぶと確認できます。";
  const visibleMetricKeys = scope === "global" ? metricKeys : metricKeys.filter((key) => !botMetricIsGlobalOnly(key));
  const historyBucketDays = Math.max(1, (data?.bucketSeconds ?? 86_400) / 86_400);
  const historyInterval = historyBucketDays === 1 ? "1日" : `${historyBucketDays.toLocaleString("ja-JP")}日`;

  return <div>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Bot observability</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-[-0.03em]"><Bot className="size-6" />Bot統計</h1>
        <p className="mt-1 text-sm text-[#6f7a8c]">通信・Discord利用・osu!活動・保存容量を、同じ期間で確認できます。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="bot-statistics-range">統計期間</label>
        <select id="bot-statistics-range" value={range} onChange={(event) => setRange(event.target.value as BotStatisticsRange)} className="cp-select !mt-0 !w-28">
          {ranges.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="bot-statistics-scope">対象サーバー</label>
        <select id="bot-statistics-scope" value={scope} onChange={(event) => setScope(event.target.value)} className="cp-select !mt-0 max-w-56 !w-48">
          <option value="global">Bot全体（全サーバー）</option>{query.data?.scopes.filter((item) => item.id !== "global").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <button type="button" disabled={query.isValidating} onClick={refresh} className="inline-flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-xs disabled:opacity-50"><RefreshCw className={`size-3.5 ${query.isValidating ? "animate-spin" : ""}`} />更新</button>
      </div>
    </header>
    <RefreshNotice error={query.error} retry={refresh} />
    {!data ? <div role="status" className="cp-panel mt-5 p-8 text-center text-sm text-[#738094]">{query.error ? "統計を表示できません。再試行してください。" : "選択した期間・サーバーの統計を読み込み中…"}</div> : <>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border bg-white px-4 py-3 text-[11px] text-[#68768a]">
        <span className={`font-semibold ${data.stale || query.error ? "text-amber-700" : "text-emerald-700"}`}>{data.lastSampleAt ? data.stale ? "記録更新が止まっています" : query.error ? "通信エラー・保存済み記録" : "記録更新中" : "計測開始待ち"}</span>
        <span>{scopeLabel} · 最終記録 {formatBotDate(data.lastSampleAt)} JST</span>
        <span>観測カバー率 {data.coverage.percent.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}% · {data.coverage.sampleCount.toLocaleString()}サンプル</span>
        <span>収集開始 {formatBotDate(data.collectionStartedAt)} JST</span>
      </div>
      {(data.stale || !data.lastSampleAt) ? <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900" role="status">{data.lastSampleAt ? "Botの接続・収集状態を確認してください。以下は最後に保存された値で、現在値とは限りません。" : "Bot統計の実測記録はまだありません。過去の通信・Ping・VC値は補完せず、収集開始後から記録します。保存済みosu!リザルトは下の履歴で確認できます。"}</p> : null}
      {scope !== "global" ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">
        <p>このサーバーの人数・VC・Discord活動・関連プレイヤーと、接続ShardのPingを表示しています。通信量・処理・PC/DB容量はBot全体で確認できます。</p>
        <button type="button" onClick={() => setScope("global")} className="shrink-0 font-semibold underline underline-offset-2">Bot全体を見る</button>
      </div> : null}
      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {scope === "global" ? <>
          <SummaryCard label="期間のBot TCP受信量" metric="receivedBytes" value={summary?.receivedBytes?.total} detail={`観測日平均 ${formatBotValue("receivedBytes", summary?.receivedBytes?.average)}`} icon={ArrowDownToLine} />
          <SummaryCard label="期間のBot TCP送信量" metric="sentBytes" value={summary?.sentBytes?.total} detail={`観測日平均 ${formatBotValue("sentBytes", summary?.sentBytes?.average)}`} icon={ArrowUpFromLine} />
        </> : null}
        <SummaryCard label={scope === "global" ? "Gateway Ping" : "Gateway Ping（接続Shard）"} metric="gatewayPingMs" value={summary?.gatewayPingMs?.latest} detail={`観測平均 ${formatBotValue("gatewayPingMs", summary?.gatewayPingMs?.average)}`} icon={Activity} />
        <SummaryCard label="VC接続人数" metric="voiceMembers" value={summary?.voiceMembers?.latest} detail={`延べ接続 ${formatBotValue("voiceMemberSeconds", summary?.voiceMemberSeconds?.total)}`} icon={Users} />
        <SummaryCard label="osu!アクティブ人数" metric="osuActivePlayers" value={summary?.osuActivePlayers?.latest} detail="DB保存リザルトの直近30分で判定" icon={Users} />
        <SummaryCard label="受信メッセージ" metric="messageCount" value={summary?.messageCount?.total} detail={`観測日平均 ${formatBotValue("messageCount", summary?.messageCount?.average)}`} icon={Activity} />
        {scope === "global" ? <>
          <SummaryCard label="DB使用容量" metric="dbBytes" value={summary?.dbBytes?.latest} detail={`行数 ${formatBotValue("dbRows", summary?.dbRows?.latest)}（概算）`} icon={Database} />
          <SummaryCard label="PCディスク使用量" metric="diskUsedBytes" value={summary?.diskUsedBytes?.latest} detail={`総容量 ${formatBotValue("diskTotalBytes", summary?.diskTotalBytes?.latest)}`} icon={HardDrive} />
        </> : null}
      </section>
      <div className="mt-5 flex gap-1 overflow-x-auto rounded-md border bg-white p-1" role="tablist" aria-label="Bot統計の種類">
        {tabs.map((item, index) => <button key={item.id} type="button" role="tab" id={`bot-tab-${item.id}`} aria-controls="bot-metric-panel" aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => {
          const next = botTabNavigationIndex(index, event.key, tabs.length);
          if (next == null) return;
          event.preventDefault();
          setTab(tabs[next].id);
          event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#bot-tab-${tabs[next].id}`)?.focus();
        }} className={`shrink-0 rounded px-4 py-2 text-xs font-medium ${tab === item.id ? "bg-[#eef4fc] text-[#0051c3]" : "text-[#657389] hover:bg-[#f5f7fa]"}`}>{item.label}</button>)}
      </div>
      <div id="bot-metric-panel" role="tabpanel" aria-labelledby={`bot-tab-${tab}`} className="mt-4 grid gap-4 xl:grid-cols-2">
        {tab === "network" ? <>
          <StatisticsChart key={`${range}:${scope}:traffic`} title="Bot TCP送信・受信データ量" description={`各区間のTCP通信量。集約幅 約${Math.max(1, data.bucketSeconds / 60).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}分。音楽のUDP・別プロセスは対象外。`} data={points} series={metricSeries(["receivedBytes", "sentBytes"])} emptyDescription={globalOnlyDescription} />
          <StatisticsChart key={`${range}:${scope}:ping`} title="定期Ping" description={scope === "global" ? "Gateway・Discord API・DBを色で区別。値が低いほど応答が速いことを示します。" : "このサーバーが接続しているShardのGateway Ping。Discord API・DB PingはBot全体で確認できます。"} data={points} series={metricSeries(scope === "global" ? ["gatewayPingMs", "discordApiPingMs", "dbPingMs"] : ["gatewayPingMs"])} />
          <StatisticsChart key={`${range}:${scope}:speed`} title="通信速度" description="サンプル区間の平均速度。受信は青、送信は橙です。" data={points} series={metricSeries(["receiveBps", "sendBps"])} emptyDescription={globalOnlyDescription} />
          <StatisticsChart key={`${range}:${scope}:network-scope`} title="外部・ローカル通信の内訳" description="外部宛てとPC内の通信を分離。Bot以外の通信は含めません。" data={points} series={metricSeries(["externalReceivedBytes", "externalSentBytes", "localReceivedBytes", "localSentBytes"])} emptyDescription={globalOnlyDescription} />
        </> : null}
        {tab === "community" ? <>
          <StatisticsChart key={`${range}:${scope}:vc`} title="VC・Discordアクティブ人数" description="VC接続人数、使用中VC数、直近のDiscord活動人数。全体のVC・活動人数は同じユーザーIDを重複計上しません。" data={points} series={metricSeries(["voiceMembers", "voiceChannels", "activeDiscordUsers"])} />
          <StatisticsChart key={`${range}:${scope}:members`} title="サーバー人数・参加サーバー数" description="人数は左軸、参加サーバー数は右軸。Discordの近似人数（約5分キャッシュ）またはGateway人数。全体では同じユーザーを重複計上します。" data={points} series={[...metricSeries(["memberCount"]), { key: "guildCount", label: "参加サーバー数", color: colors[1], metric: "guildCount", axis: "right" }]} />
          <StatisticsChart key={`${range}:${scope}:commands`} title="メッセージ・コマンド利用" description="受信メッセージと呼び出されたスラッシュコマンド数（成功・失敗を含む）。この統計では本文を保存しません。" data={points} series={metricSeries(["messageCount", "commandCount"])} bar />
          <StatisticsChart key={`${range}:${scope}:vc-time`} title="VC延べ接続時間" description="各サーバーのVC人数×接続時間の合計。同じユーザーの複数サーバー接続は加算するため、重複除外したVC人数とは別です。" data={points} series={metricSeries(["voiceMemberSeconds"])} />
          <StatisticsChart key={`${range}:${scope}:bot-online`} title="Bot接続時間" description={`観測した接続時間の区間合計。期間合計 ${formatBotValue("botOnlineSeconds", summary?.botOnlineSeconds?.total)} · 観測日平均 ${formatBotValue("botOnlineSeconds", summary?.botOnlineSeconds?.average)}。未収集時間は補完しません。`} data={points} series={metricSeries(["botOnlineSeconds"])} />
        </> : null}
        {tab === "osu" ? <>
          <StatisticsChart key={`${range}:${scope}:osu-active`} title="追跡・osu!アクティブ人数" description="アクティブ人数はDBに保存された直近30分のリザルトがあるプレイヤー。ゲーム内オンライン人数ではありません。" data={points} series={metricSeries(["osuActivePlayers", "trackedPlayers"])} />
          <StatisticsChart key={`${range}:${scope}:osu-maps`} title="保存済みプレイ・ユニーク譜面" description="DB内のリザルト件数と譜面IDの重複を除いた件数。未取得のプレイは含みません。" data={points} series={metricSeries(["storedScores", "uniqueBeatmaps"])} />
          <StatisticsChart key={`${range}:${scope}:osu-profile-count`} title="osu!プロフィール累計プレイ回数" description="追跡プレイヤー×モードの最新プロフィール値を合計。下の保存済みリザルト件数とは別で、登録プレイヤーの変更でも値が変わります。" data={points} series={metricSeries(["osuLifetimePlayCount"])} />
          <StatisticsChart key={`${range}:${scope}:osu-profile-time`} title="osu!プロフィール累計プレイ時間" description="追跡プレイヤー×モードの最新プロフィール値を合計。保存済み譜面長から推定した時間とは別です。" data={points} series={metricSeries(["osuLifetimePlaySeconds"])} />
        </> : null}
        {tab === "resources" ? scope !== "global" ? <>
          <section className="cp-panel px-5 py-8 text-sm leading-6 text-[#68768a]">
            <h2 className="font-semibold text-[#39475b]">PC・DB容量とレンダー処理はBot全体の指標です</h2><p className="mt-2">これらはサーバーごとに分割できないため、この範囲では表示しません。通知キューはこのサーバーの通知ルールに対応する値です。</p>
            <button type="button" onClick={() => setScope("global")} className="mt-3 font-semibold text-[#0051c3] underline underline-offset-2">Bot全体の処理・容量を見る</button>
          </section>
          <StatisticsChart key={`${range}:${scope}:notifications`} title="このサーバーの通知キュー" description="このサーバーの通知ルールによる待機件数と再試行待ち件数。レンダリングキューはBot全体で確認できます。" data={points} series={metricSeries(["notificationPending", "notificationFailed"])} />
        </> : <>
          <StatisticsChart key={`${range}:${scope}:resources`} title="Bot CPU・メモリ" description="CPUは左軸（1コア=100%、複数コア利用時は100%超）、メモリは右軸。PC全体とは別です。" data={points} series={[...metricSeries(["cpuPercent"]), { key: "memoryBytes", label: "Botメモリ使用量", color: colors[2], metric: "memoryBytes", axis: "right" }]} />
          <StatisticsChart key={`${range}:${scope}:loop`} title="イベントループ遅延" description="Botが処理を再開するまでの遅れ。CPU負荷・長い同期処理の影響を確認できます。" data={points} series={metricSeries(["eventLoopLagMs"])} />
          <StatisticsChart key={`${range}:${scope}:storage`} title="DB・動画・音源の保存容量" description="DB、Renderer動画、音源それぞれの使用容量。取得できない保存先は未収集です。" data={points} series={metricSeries(["dbBytes", "videoBytes", "audioBytes"])} />
          <StatisticsChart key={`${range}:${scope}:disk`} title="PCディスク使用量・総容量" description="容量計測対象ディスクの使用量と総容量。動画・音源だけでなく、ディスク上の他のファイルも含みます。" data={points} series={metricSeries(["diskUsedBytes", "diskTotalBytes"])} />
          <StatisticsChart key={`${range}:${scope}:db-rows`} title="DB使用容量・データ行数" description="使用容量は左軸、行数は右軸。行数はPostgresの概算値で、厳密な全行カウントではありません。" data={points} series={[...metricSeries(["dbBytes"]), { key: "dbRows", label: "DBデータ行数（概算）", color: colors[3], metric: "dbRows", axis: "right" }]} />
          <StatisticsChart key={`${range}:${scope}:operations`} title="通知・レンダリングキュー" description="待機件数と処理中本数。過去の完了件数ではありません。" data={points} series={metricSeries(["notificationPending", "notificationFailed", "renderQueue", "activeRenders"])} />
        </> : null}
      </div>
      <section className="mt-7">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">保存済み活動履歴</h2>
          <label className="flex items-center gap-2 text-xs text-[#68768a]">時間帯グラフ<select value={hourView} onChange={(event) => setHourView(event.target.value as "total" | "average")} className="cp-select !mt-0 !w-36"><option value="total">期間合計</option><option value="average">観測日平均</option></select></label>
        </div><p className="mt-1 text-xs leading-5 text-[#748094]">上の期間・サーバー設定が適用されます。osu!はDB保存リザルト、メッセージは保存済みDiscord活動記録です。プロフィール累計値とは別です。</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="保存済みプレイ" metric="storedScores" value={data.historicalTotals.plays} detail={`${data.historicalTotals.days}日分のDB履歴`} icon={Activity} />
          <SummaryCard label="ユニーク譜面" metric="uniqueBeatmaps" value={data.historicalTotals.uniqueBeatmaps} detail="選択期間で譜面IDの重複を除外" icon={Database} />
          <SummaryCard label="活動プレイヤー" metric="osuActivePlayers" value={data.historicalTotals.activePlayers} detail="選択期間に保存リザルトがある人数" icon={Users} />
          <SummaryCard label="保存プレイ時間（参考）" metric="osuLifetimePlaySeconds" value={data.historicalTotals.playTimeSeconds} detail="保存済み譜面長の合計・失敗/速度MOD補正なし" icon={Activity} />
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <StatisticsChart key={`${range}:${scope}:history`} title={`メッセージ・プレイ回数（${historyInterval}単位）`} description={`JST基準・集約幅 ${historyInterval}。各区間の合計を比較。欠測は補間しません。`} data={historical} series={[{ key: "messages", label: "メッセージ", color: colors[0], metric: "messageCount" }, { key: "plays", label: "保存プレイ", color: colors[1], metric: "storedScores" }]} bar />
          <StatisticsChart key={`${range}:${scope}:history-time`} title={`プレイ時間・譜面数（${historyInterval}単位）`} description={`集約幅 ${historyInterval}。参考プレイ時間は左軸、ユニーク譜面数は右軸。`} data={historical} series={[{ key: "playTimeSeconds", label: "プレイ時間", color: colors[2], metric: "osuLifetimePlaySeconds" }, { key: "uniqueBeatmaps", label: "ユニーク譜面", color: colors[3], metric: "uniqueBeatmaps", axis: "right" }]} />
          <StatisticsChart key={`${range}:${scope}:hours`} title={`活動時間帯（JST・${hourView === "average" ? "観測日平均" : "合計"}）`} description="メッセージとプレイ回数の活発な時間を比較。未収集は0ではなく空白です。" data={hourly} series={[{ key: "messages", label: "メッセージ", color: colors[0], metric: "messageCount" }, { key: "plays", label: "保存プレイ", color: colors[1], metric: "storedScores" }]} bar />
          <StatisticsChart key={`${range}:${scope}:vc-hours`} title={`VC利用時間帯（JST・${hourView === "average" ? "観測日平均" : "合計"}）`} description="人数×接続時間の延べ秒数。サンプル区間から集計した実測値です。" data={hourly} series={[{ key: "voiceMemberSeconds", label: "VC延べ接続", color: colors[4], metric: "voiceMemberSeconds" }]} bar />
        </div>
        <div className="cp-panel mt-4 overflow-x-auto">
          <div className="border-b px-5 py-4"><h3 className="text-sm font-semibold">osu!モード別内訳</h3></div>
          <table className="w-full min-w-[570px] text-xs"><thead className="bg-[#f8fafc] text-[#6c788d]"><tr>{["モード", "保存プレイ", "活動人数", "ユニーク譜面", "プレイ時間"].map((label) => <th key={label} className="px-5 py-3 text-left font-medium">{label}</th>)}</tr></thead>
            <tbody>{data.modeBreakdown.length ? data.modeBreakdown.map((item) => <tr key={item.mode} className="border-t"><td className="px-5 py-3 font-semibold">{item.mode === "fruits" ? "catch" : item.mode}</td><td className="px-5 py-3">{formatBotValue("storedScores", item.scores)}</td><td className="px-5 py-3">{formatBotValue("osuActivePlayers", item.activePlayers)}</td><td className="px-5 py-3">{formatBotValue("uniqueBeatmaps", item.uniqueBeatmaps)}</td><td className="px-5 py-3">{formatBotValue("osuLifetimePlaySeconds", item.playTimeSeconds)}</td></tr>) : <tr><td colSpan={5} className="px-5 py-6 text-[#7b8492]">保存済みリザルトはありません。</td></tr>}</tbody>
          </table>
        </div>
      </section>
      <section className="cp-panel mt-7 overflow-hidden">
        <div className="border-b px-5 py-4"><h2 className="text-sm font-semibold">全計測値の詳細</h2><p className="mt-1 text-[11px] leading-5 text-[#748094]">人数・Ping・容量は観測時間で加重した平均。通信量・件数・接続時間は合計÷観測したJST日数で、未観測日を平均の分母に含めません。最小・最大・直近値は各サンプル区間の値です。</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-xs"><thead className="bg-[#f8fafc] text-[#6c788d]"><tr>{["分類 / 計測値", "直近", "平均", "最小", "最大", "期間合計"].map((label) => <th key={label} className="px-4 py-3 text-left font-medium">{label}</th>)}</tr></thead>
          <tbody>{visibleMetricKeys.map((key) => {
            const metric = BOT_STATISTIC_METRICS[key]; const item = summary?.[key];
            return <tr key={key} className="border-t hover:bg-[#fafbfd]"><td className="px-4 py-3"><span className="mr-2 text-[10px] text-[#8a94a3]">{groupLabels[metric.group]}</span>{metric.label}</td>
              <td className="whitespace-nowrap px-4 py-3">{formatBotValue(key, item?.latest)}</td><td className="whitespace-nowrap px-4 py-3">{formatBotValue(key, item?.average)}{item?.average != null && metric.kind === "delta" ? " /日" : ""}</td>
              <td className="whitespace-nowrap px-4 py-3">{formatBotValue(key, item?.minimum)}</td><td className="whitespace-nowrap px-4 py-3">{formatBotValue(key, item?.maximum)}</td><td className="whitespace-nowrap px-4 py-3 text-[#68768a]">{metric.kind === "delta" ? formatBotValue(key, item?.total) : "—（現在値の計測）"}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </section>
      <details className="cp-panel mt-5 px-5 py-4 text-xs text-[#6f7c90]"><summary className="cursor-pointer font-semibold text-[#39475b]">計測範囲・欠測について</summary>
        <div className="mt-3 space-y-2 leading-5"><p>対象期間: {formatBotDate(data.from)} ～ {formatBotDate(data.to)} JST。観測時間 {formatBotValue("botOnlineSeconds", data.coverage.observedSeconds)} / 対象時間 {formatBotValue("botOnlineSeconds", data.coverage.periodSeconds)}。</p>
          <p>サーバー個別では、そのサーバーの人数・活動・関連プレイヤーと、接続先ShardのGateway Pingを表示します。同じShardのサーバーは同じPingになる場合があります。TCP通信・Discord API/DB Ping・PC容量などBot全体の指標は個別へ按分しません。</p>
          <p>通信はBotが計測対象として監視できる接続のみです。PC全体・音楽中継・動画アップロード等の総通信量と一致するとは限りません。</p>
          <p>Bot TCP通信には音楽送信のUDP、別のJava/Lavalink・Rendererプロセスは含まれません。欠測期間は値を補間せず、過去の通信量やVC利用を推測しません。</p>
          <p>時間帯グラフの観測日平均は、指標ごとの記録があるJST日数で割ります。プレイは保存プレイがある日、メッセージはDiscord活動記録がある日、VCはVC計測がある日が対象です。暦日平均ではありません。</p>
          {data.notes.map((note, index) => <p key={index}>{note}</p>)}
        </div>
      </details>
    </>}
  </div>;
}

"use client";

import { useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, HardDrive, Radio, Terminal, TrendingUp } from "lucide-react";
import type { BotStatisticsData } from "@/lib/bot-statistics";
import type { BotHeatmapCell, BotInsights } from "@/lib/bot-insights";
import type { BotDimensions } from "@/lib/bot-dimensions";
import { BOT_STATISTIC_METRICS } from "@/lib/bot-statistics";
import { botTabNavigationIndex, formatBotDate, formatBotValue } from "./bot-statistics-presentation";
import { BotWeeklyReportSettings } from "./bot-weekly-report-settings";

const views = [
  { id: "comparison", label: "期間比較", icon: TrendingUp }, { id: "heatmap", label: "活動ヒートマップ", icon: CalendarDays },
  { id: "health", label: "容量予測・異常", icon: HardDrive }, { id: "commands", label: "コマンド分析", icon: Terminal },
  { id: "services", label: "接続先別通信", icon: Radio }, { id: "weekly", label: "Discord週報", icon: CalendarDays },
] as const;
type View = typeof views[number]["id"];
const weekdays = ["月", "火", "水", "木", "金", "土", "日"];
const tableCell = "whitespace-nowrap px-4 py-3 text-left";
const networkLabels: Record<string, string> = { discord: "Discord", osu: "osu! API", youtube: "YouTube / Google", db: "データベース", local: "PC内のその他通信", other: "その他・分類不能" };

function Comparison({ data }: { data: BotInsights["comparison"] }) {
  return <div>
    <h3 className="text-sm font-semibold">{data.label}</h3>
    <p className="mt-1 text-xs leading-6 text-[#748094]">{data.note}</p>
    {data.from ? <p className="mt-2 text-[11px] text-[#748094]">比較先 {formatBotDate(data.from)} 〜 {formatBotDate(data.to)} JST · 観測率 今期 {data.currentCoveragePercent == null ? "未収集" : `${data.currentCoveragePercent.toFixed(1)}%`} / 前期 {data.previousCoveragePercent == null ? "未収集" : `${data.previousCoveragePercent.toFixed(1)}%`}</p> : null}
    {data.metrics.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[680px] text-xs">
      <thead className="bg-[#f8fafc] text-[#748094]"><tr>{["計測値", "選択期間", "比較期間", "差分", "増減率"].map((label) => <th key={label} className={tableCell}>{label}</th>)}</tr></thead>
      <tbody>{data.metrics.map((row) => <tr key={row.metric} className="border-t">
        <th className={`${tableCell} font-medium`}>{row.label}</th><td className={tableCell}>{formatBotValue(row.metric, row.current)}</td><td className={tableCell}>{formatBotValue(row.metric, row.previous)}</td>
        <td className={tableCell}>{row.change == null ? "比較に必要な記録不足" : `${row.change > 0 ? "+" : row.change < 0 ? "−" : ""}${formatBotValue(row.metric, Math.abs(row.change))}`}</td>
        <td className={tableCell}>{row.changePercent == null ? row.status === "zero_baseline" ? "前期0のため算出不可" : "—" : `${row.changePercent > 0 ? "+" : ""}${row.changePercent.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}%`}</td>
      </tr>)}</tbody>
    </table></div> : <p className="mt-4 rounded-md bg-[#f8fafc] p-4 text-xs text-[#748094]">{data.status === "not_applicable" ? "全期間には比較元がありません。今日・7日・30日を選択してください。" : "比較に必要な過去の観測が揃うまでお待ちください。"}</p>}
  </div>;
}

function ActivityHeatmap({ data }: { data: BotInsights["heatmap"] }) {
  const [metric, setMetric] = useState<"plays" | "messages" | "voiceMemberSeconds">("plays");
  const [average, setAverage] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const averageKeys = { plays: "averagePlays", messages: "averageMessages", voiceMemberSeconds: "averageVoiceMemberSeconds" } as const;
  const value = (cell: BotHeatmapCell) => cell[average ? averageKeys[metric] : metric];
  const metricKey = metric === "plays" ? "storedScores" : metric === "messages" ? "messageCount" : "voiceMemberSeconds";
  const maximum = Math.max(1, ...data.cells.map((cell) => value(cell) ?? 0));
  const lookup = new Map(data.cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  const picked = selected ? lookup.get(selected) : undefined;
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">曜日 × 時間帯（JST）</h3>
      <div className="flex flex-wrap items-center gap-3"><label className="text-xs text-[#748094]">対象 <select aria-label="ヒートマップの対象" value={metric} onChange={(event) => setMetric(event.target.value as typeof metric)} className="ml-1 rounded-md border p-2 text-[#39475b]"><option value="plays">保存プレイ</option><option value="messages">メッセージ</option><option value="voiceMemberSeconds">VC延べ時間</option></select></label>
        <label className="flex items-center gap-2 text-xs text-[#748094]"><input type="checkbox" checked={average} onChange={(event) => setAverage(event.target.checked)} />観測日平均</label></div>
    </div>
    <p className="mt-2 text-xs leading-6 text-[#748094]">濃いほど活動が多い時間帯。灰色は未収集、白は保存済み0です。セルをクリック・タップすると詳細を表示します。小さい画面は表内を横スクロールできます。</p>
    <div className="mt-4 overflow-x-auto pb-2" role="region" aria-label="活動ヒートマップ" tabIndex={0}>
      <div className="grid min-w-[820px] gap-1" style={{ gridTemplateColumns: "2.5rem repeat(24, minmax(1.8rem, 1fr))" }}>
        <span />{Array.from({ length: 24 }, (_, hour) => <span key={`hour:${hour}`} className="text-center text-[10px] text-[#748094]">{hour}時</span>)}
        {weekdays.flatMap((label, weekday) => [<span key={`weekday:${weekday}`} className="flex items-center text-xs text-[#68768a]">{label}</span>, ...Array.from({ length: 24 }, (_, hour) => {
          const key = `${weekday}:${hour}`, cell = lookup.get(key), amount = cell ? value(cell) : null;
          const text = amount == null ? "未収集" : formatBotValue(metricKey, amount);
          return <button key={key} type="button" aria-label={`${label}曜日 ${hour}時 ${text}`} aria-pressed={selected === key} title={`${label}曜日 ${hour}時: ${text}`} onClick={() => setSelected(selected === key ? null : key)} className={`h-7 rounded border ${selected === key ? "ring-2 ring-blue-600 ring-offset-1" : ""}`}
            style={{ backgroundColor: amount == null ? "#e7ebef" : amount === 0 ? "#ffffff" : `rgba(0,81,195,${0.12 + 0.83 * Math.sqrt(amount / maximum)})`, borderColor: "#d8dfe9" }} />;
        })])}
      </div>
    </div>
    <div className="mt-2 rounded-md border bg-[#f8fafc] px-4 py-3 text-xs leading-6 text-[#68768a]" aria-live="polite">{picked ? <>
      <strong>{weekdays[picked.weekday]}曜日 {picked.hour}:00〜{picked.hour + 1}:00 JST</strong> · {formatBotValue(metricKey, value(picked))}{average ? "/観測日" : ""}
      <span className="ml-3">保存プレイ {formatBotValue("storedScores", picked.plays)} / メッセージ {formatBotValue("messageCount", picked.messages)} / VC {formatBotValue("voiceMemberSeconds", picked.voiceMemberSeconds)}</span>
      <p>観測日数: 保存プレイ {picked.playDays} / メッセージ {picked.messageDays} / VC {picked.voiceDays}</p>
    </> : "セルを選ぶと活動量と観測日数がここに表示されます。"}</div>
    {data.notes.map((note) => <p key={note} className="mt-2 text-[11px] leading-5 text-[#748094]">{note}</p>)}
  </div>;
}

function Health({ insights }: { insights: BotInsights }) {
  const { disk, anomalies } = insights;
  return <div className="grid gap-5 lg:grid-cols-2">
    <section><h3 className="flex items-center gap-2 text-sm font-semibold"><HardDrive className="size-4" />ディスク残容量予測</h3>
      <p className="mt-3 text-2xl font-semibold">{formatBotValue("diskUsedBytes", disk.freeBytes)}<span className="ml-2 text-xs font-normal text-[#748094]">空き容量</span></p>
      <p className="mt-2 text-xs text-[#748094]">使用率 {disk.usedPercent == null ? "未収集" : `${disk.usedPercent.toFixed(1)}%`} · {disk.observedDays}日 / {disk.observations.toLocaleString()}観測</p>
      {disk.usedPercent != null ? <div className="mt-3 h-2 overflow-hidden rounded bg-[#e7ebef]"><div className={`h-full ${disk.usedPercent >= 90 ? "bg-rose-500" : "bg-[#0051c3]"}`} style={{ width: `${Math.min(100, Math.max(0, disk.usedPercent))}%` }} /></div> : null}
      <p className="mt-3 text-sm font-medium">{disk.status === "ready" ? `満杯予測: ${formatBotDate(disk.projectedFullAt)} JST（約${disk.daysUntilFull?.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}日後）` : disk.status === "not_applicable" ? "PC全体の指標です。Bot全体で確認してください。" : disk.status === "non_growing" ? "容量は増加していないため、満杯時期は算出しません。" : "予測に必要なデータが不足しています。"}</p>
      {disk.bytesPerDay != null ? <p className="mt-2 text-xs text-[#748094]">推定増加量 {formatBotValue("diskUsedBytes", disk.bytesPerDay)}/日 · 容量減少の観測 {disk.cleanupCount}回</p> : null}
      <p className="mt-3 text-xs leading-6 text-[#748094]">{disk.note}</p>
    </section>
    <section><h3 className="flex items-center gap-2 text-sm font-semibold">{anomalies.findings.length ? <AlertTriangle className="size-4 text-amber-600" /> : <CheckCircle2 className="size-4 text-emerald-600" />}直近の異常検知</h3>
      <p className="mt-2 text-[11px] text-[#748094]">{formatBotDate(anomalies.checkedAt)} JST · 直近 {anomalies.observationCount} / 基準 {anomalies.baselineObservationCount}観測</p>
      <div className="mt-3 space-y-2">{anomalies.findings.length ? anomalies.findings.map((finding) => <div key={finding.metric} className={`rounded-md border px-4 py-3 ${finding.level === "critical" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
        <p className="text-xs font-semibold">{BOT_STATISTIC_METRICS[finding.metric].label}: {formatBotValue(finding.metric, finding.current)}</p>
        <p className="mt-1 text-[11px] leading-5">基準 {formatBotValue(finding.metric, finding.baseline)} / 検出閾値 {formatBotValue(finding.metric, finding.threshold)} · {finding.note}</p>
      </div>) : <p className="rounded-md bg-[#f8fafc] p-4 text-xs leading-6 text-[#748094]">{anomalies.status === "insufficient" ? "検知に必要な連続観測が不足しています。" : "継続した異常は検出されていません。"}</p>}</div>
      {anomalies.notes.map((note) => <p key={note} className="mt-2 text-[11px] leading-5 text-[#748094]">{note}</p>)}
    </section>
  </div>;
}

function CommandAnalysis({ data }: { data: BotDimensions | undefined }) {
  const [sort, setSort] = useState<"attempts" | "failureRate" | "averageDurationMs">("attempts");
  const rows = [...data?.commands ?? []].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1) || a.command.localeCompare(b.command));
  return <div><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">コマンド別 利用・失敗・応答時間</h3>
    <select aria-label="コマンド分析の並び順" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="rounded-md border p-2 text-xs"><option value="attempts">利用数が多い順</option><option value="failureRate">失敗率が高い順</option><option value="averageDurationMs">処理時間が長い順</option></select></div>
    <p className="mt-2 text-xs leading-6 text-[#748094]">完了した実行を集計。ACKは最初の応答・遅延応答通知まで、処理時間はハンドラー完了までです。失敗は例外・エラー報告を捕捉した実行。音楽再生やレンダー完了までの時間ではありません。</p>
    {rows.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[780px] text-xs"><thead className="bg-[#f8fafc] text-[#748094]"><tr>{["コマンド", "実行数", "失敗数", "失敗率", "平均ACK", "平均処理時間", "最大処理時間"].map((label) => <th key={label} className={tableCell}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.command} className="border-t"><th className={`${tableCell} font-mono font-medium`}>/{row.command}</th><td className={tableCell}>{row.attempts.toLocaleString()}</td><td className={tableCell}>{row.failures.toLocaleString()}</td><td className={tableCell}>{row.failureRate.toFixed(1)}%</td><td className={tableCell}>{formatBotValue("gatewayPingMs", row.averageAckMs)}</td><td className={tableCell}>{formatBotValue("gatewayPingMs", row.averageDurationMs)}</td><td className={tableCell}>{formatBotValue("gatewayPingMs", row.durationMsMax)}</td></tr>)}</tbody>
    </table></div> : <p className="mt-4 rounded-md bg-[#f8fafc] p-4 text-xs text-[#748094]">この期間のコマンド別記録はまだありません。機能追加後から蓄積します。</p>}
  </div>;
}

function ServiceTraffic({ data, global }: { data: BotDimensions | undefined; global: boolean }) {
  const services = [...data?.services ?? []].sort((a, b) => b.receivedBytes + b.sentBytes - a.receivedBytes - a.sentBytes);
  const total = services.reduce((sum, service) => sum + service.receivedBytes + service.sentBytes, 0);
  return <div><h3 className="text-sm font-semibold">接続先サービス別 TCP通信量</h3><p className="mt-2 text-xs leading-6 text-[#748094]">BotプロセスのTCP通信のみ。音声UDP・yt-dlp・Rendererなど別プロセスは含めません。接続先を固定カテゴリに分類し、URL・通信本文・認証情報は保存しません。</p>
    {!global ? <p className="mt-4 rounded-md bg-blue-50 p-4 text-xs text-blue-900">通信量はサーバー別に分割できません。上の対象サーバーを「Bot全体」に切り替えてください。</p> : services.length ? <div className="mt-4 space-y-4">{services.map((service) => {
      const share = total > 0 ? (service.receivedBytes + service.sentBytes) / total * 100 : 0;
      return <div key={service.service}><div className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-semibold">{networkLabels[service.service] ?? "その他"}</span><span className="text-[#748094]">受信 {formatBotValue("receivedBytes", service.receivedBytes)} / 送信 {formatBotValue("sentBytes", service.sentBytes)} · {share.toFixed(1)}%</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded bg-[#eef1f5]"><div className="h-full bg-[#0051c3]" style={{ width: `${share}%` }} /></div></div>;
    })}</div> : <p className="mt-4 rounded-md bg-[#f8fafc] p-4 text-xs text-[#748094]">接続先別記録は機能追加後から蓄積します。</p>}
  </div>;
}

export function BotInsightsPanel({ data }: { data: BotStatisticsData & { insights?: BotInsights; dimensions?: BotDimensions } }) {
  const [view, setView] = useState<View>("comparison");
  return <section className="cp-panel mt-5 overflow-hidden">
    <div className="border-b px-5 py-4"><h2 className="text-sm font-semibold">分析・運用</h2><p className="mt-1 text-[11px] leading-5 text-[#748094]">比較・活動・コマンド・通信は上の期間とサーバーを使用。容量予測と異常検知は直近の実測から判断します。</p>
      <div className="mt-3 flex gap-1 overflow-x-auto" role="tablist" aria-label="Bot統計の分析">{views.map((item, index) => <button key={item.id} type="button" id={`bot-insight-${item.id}`} role="tab" aria-selected={view === item.id} aria-controls="bot-insight-panel" tabIndex={view === item.id ? 0 : -1} onClick={() => setView(item.id)} onKeyDown={(event) => {
        const next = botTabNavigationIndex(index, event.key, views.length); if (next == null) return; event.preventDefault(); setView(views[next].id); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#bot-insight-${views[next].id}`)?.focus();
      }} className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs ${view === item.id ? "bg-[#eef4fc] font-semibold text-[#0051c3]" : "text-[#68768a]"}`}><item.icon className="size-3.5" />{item.label}</button>)}</div>
    </div>
    <div role="tabpanel" id="bot-insight-panel" aria-labelledby={`bot-insight-${view}`} className="p-5">
      {view === "weekly" ? <BotWeeklyReportSettings /> : view === "commands" ? <CommandAnalysis data={data.dimensions} /> : view === "services" ? <ServiceTraffic data={data.dimensions} global={data.scope === "global"} /> : data.insights ? view === "comparison" ? <Comparison data={data.insights.comparison} /> : view === "heatmap" ? <ActivityHeatmap data={data.insights.heatmap} /> : <Health insights={data.insights} /> : <p className="text-xs text-[#748094]">分析データはまだ取得されていません。更新してください。</p>}
    </div>
  </section>;
}

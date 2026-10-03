import { AlertTriangle, BellRing, CheckCircle2, Gauge, Megaphone, MessageSquareText, ScrollText, ServerCog } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { getMonthlyUsageForecast, getServiceUsageToday, listAdminAudits, listBotErrors, listBotFeedback, listGuildAutomationChannels, listNotificationRules } from "@/db/feature-repository";
import { listAccounts } from "@/db/repository";
import { listServiceControlCommands } from "@/db/service-control-repository";
import { getControlSettings } from "@/lib/control/settings";
import { ServiceRestartPanel } from "@/components/control-panel/service-restart-panel";
import { configureControlAdminChannels, createControlNotificationRule, deleteControlNotificationRule, resolveControlError, sendControlAnnouncement, setControlNotificationRuleState } from "./actions";

export const metadata: Metadata = { title: "運用センター" };

function percent(value: number, limit: number) {
  return limit > 0 ? Math.min(100, value / limit * 100) : 0;
}

function UsageCard({ label, value, detail, ratio }: { label: string; value: string; detail: string; ratio: number }) {
  const tone = ratio >= 100 ? "bg-red-500" : ratio >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return <div className="cp-panel p-4"><div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7d8795]">{label}</p><Gauge className="size-4 text-[#667184]" /></div><p className="mt-3 text-xl font-semibold">{value}</p><p className="mt-1 text-[10px] text-[#7d8795]">{detail}</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#edf0f4]"><span className={`block h-full ${tone}`} style={{ width: `${ratio}%` }} /></div></div>;
}

function bytesLabel(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export default async function OperationsPage() {
  await connection();
  const [errors, feedback, usage, forecast, settings, rules, accounts, audits, automationChannels, serviceCommands] = await Promise.all([
    listBotErrors(100),
    listBotFeedback(100),
    getServiceUsageToday(),
    getMonthlyUsageForecast(),
    getControlSettings(),
    listNotificationRules(),
    listAccounts(),
    listAdminAudits(200),
    listGuildAutomationChannels(),
    listServiceControlCommands(),
  ]);
  const monitoring = settings.values.monitoring;
  const osuRequests = usage.usage.find((row) => row.service === "osu_api")?.operations ?? 0;
  const r2Gb = usage.r2Bytes / 1024 ** 3;
  return <div>
    <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Operations</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">運用センター</h1><p className="mt-1 text-sm text-[#6f7a8c]">Discord告知、API使用量、エラーID、ユーザー要望をまとめて管理します。</p></div>

    <section className="mt-6 grid gap-3 sm:grid-cols-3">
      <UsageCard label="osu! API / today" value={osuRequests.toLocaleString()} detail={`警告値 ${monitoring.osuDailyRequestLimit.toLocaleString()}回`} ratio={percent(osuRequests, monitoring.osuDailyRequestLimit)} />
      <UsageCard label="YouTube quota / estimate" value={`${usage.youtubeQuotaUnits.toLocaleString()} units`} detail={`${usage.youtubeUploads} uploads · 警告値 ${monitoring.youtubeDailyQuota.toLocaleString()}`} ratio={percent(usage.youtubeQuotaUnits, monitoring.youtubeDailyQuota)} />
      <UsageCard label="R2 retained" value={`${r2Gb.toFixed(2)} GiB`} detail={`警告値 ${monitoring.r2StorageLimitGb.toFixed(1)} GiB`} ratio={percent(r2Gb, monitoring.r2StorageLimitGb)} />
    </section>

    <section className="cp-panel mt-5 overflow-hidden">
      <div className="border-b border-[#e2e6eb] px-5 py-4"><h2 className="text-sm font-semibold">{forecast.month} 月間使用量予測</h2><p className="mt-1 text-[11px] text-[#7d8795]">{forecast.elapsedDays}/{forecast.daysInMonth}日経過時点のペースから月末値を推定します。</p></div>
      <div className="grid gap-px bg-[#e7ebef] sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-white p-5"><p className="text-[10px] font-semibold uppercase text-[#7d8795]">YouTube uploads</p><p className="mt-2 text-xl font-semibold">{forecast.youtubeUploads} → {forecast.forecastYoutubeUploads}</p><p className="mt-1 text-[10px] text-[#7d8795]">予測 {forecast.forecastYoutubeQuotaUnits.toLocaleString()} quota units</p></div>
        <div className="bg-white p-5"><p className="text-[10px] font-semibold uppercase text-[#7d8795]">Uploaded video</p><p className="mt-2 text-xl font-semibold">{bytesLabel(forecast.uploadedBytes)}</p><p className="mt-1 text-[10px] text-[#7d8795]">月末予測 {bytesLabel(forecast.forecastUploadedBytes)}</p></div>
        <div className="bg-white p-5"><p className="text-[10px] font-semibold uppercase text-[#7d8795]">R2 retained</p><p className="mt-2 text-xl font-semibold">{bytesLabel(forecast.retainedBytes)}</p><p className="mt-1 text-[10px] text-[#7d8795]">投稿後削除済み動画は除外</p></div>
        <div className="bg-white p-5"><p className="text-[10px] font-semibold uppercase text-[#7d8795]">API operations</p><p className="mt-2 text-xl font-semibold">{forecast.services.reduce((sum, row) => sum + row.operations, 0).toLocaleString()}</p><p className="mt-1 text-[10px] text-[#7d8795]">月末予測 {forecast.services.reduce((sum, row) => sum + row.forecastOperations, 0).toLocaleString()}回</p></div>
      </div>
      {forecast.services.length ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-xs"><thead className="bg-[#fafbfc] text-[10px] uppercase text-[#7d8795]"><tr><th className="px-5 py-3 text-left">Service</th><th className="px-4 py-3 text-right">今月 operations</th><th className="px-4 py-3 text-right">月末予測</th><th className="px-5 py-3 text-right">転送量 → 予測</th></tr></thead><tbody className="divide-y divide-[#e8ebef]">{forecast.services.map((row) => <tr key={row.service}><td className="px-5 py-3 font-mono font-semibold">{row.service}</td><td className="px-4 py-3 text-right font-mono">{row.operations.toLocaleString()}</td><td className="px-4 py-3 text-right font-mono">{row.forecastOperations.toLocaleString()}</td><td className="px-5 py-3 text-right font-mono">{bytesLabel(row.bytes)} → {bytesLabel(row.forecastBytes)}</td></tr>)}</tbody></table></div> : null}
    </section>

    <ServiceRestartPanel initial={serviceCommands.map((command) => ({ ...command, requestedAt: command.requestedAt.toISOString(), claimedAt: command.claimedAt?.toISOString() ?? null, completedAt: command.completedAt?.toISOString() ?? null }))} />

    <section className="cp-panel mt-5 overflow-hidden">
      <div className="border-b border-[#e2e6eb] px-5 py-4"><div className="flex items-center gap-2"><BellRing className="size-4 text-[#f48120]" /><h2 className="text-sm font-semibold">通知ルールビルダー</h2></div><p className="mt-1 text-[11px] text-[#7d8795]">例: 「mania・A以上・150pp以上・98%」のような条件で新しい保存スコアをDiscordへ通知します。</p></div>
      <form action={createControlNotificationRule} className="grid gap-4 bg-[#fafbfc] p-5 sm:grid-cols-2 xl:grid-cols-4">
        <label className="cp-label">ルール名<input name="name" required maxLength={100} placeholder="A判定 150pp以上" className="cp-input" /></label>
        <label className="cp-label">Discord Server ID<input name="guildId" required pattern="[0-9]{17,20}" className="cp-input font-mono" /></label>
        <label className="cp-label">通知チャンネルID<input name="channelId" required pattern="[0-9]{17,20}" className="cp-input font-mono" /></label>
        <label className="cp-label">対象プレイヤー<select name="accountId" className="cp-select"><option value="">登録者全員</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.username} ({account.osuUserId})</option>)}</select></label>
        <fieldset className="sm:col-span-2"><legend className="text-xs font-semibold">モード</legend><div className="mt-2 flex flex-wrap gap-2">{[["osu","std"],["taiko","taiko"],["fruits","catch"],["mania","mania"]].map(([value,label]) => <label key={value} className="rounded-md border bg-white px-3 py-2 text-xs"><input name="modes" value={value} type="checkbox" defaultChecked={value === "osu" || value === "mania"} className="mr-2 accent-[#f48120]" />{label}</label>)}</div></fieldset>
        <fieldset className="sm:col-span-2"><legend className="text-xs font-semibold">判定（未選択なら全部）</legend><div className="mt-2 flex flex-wrap gap-2">{["XH","X","SH","S","A","B","C","D","F"].map((rank) => <label key={rank} className="rounded-md border bg-white px-3 py-2 text-xs"><input name="ranks" value={rank} type="checkbox" className="mr-2 accent-[#f48120]" />{rank}</label>)}</div></fieldset>
        <label className="cp-label">最低PP<input name="minimumPp" type="number" min="0" max="5000" step="0.1" defaultValue="0" className="cp-input" /></label>
        <label className="cp-label">最大PP（空欄=無制限）<input name="maximumPp" type="number" min="0" max="5000" step="0.1" className="cp-input" /></label>
        <label className="cp-label">最低精度 %<input name="minimumAccuracy" type="number" min="0" max="100" step="0.01" defaultValue="0" className="cp-input" /></label>
        <label className="cp-label">必須MOD<input name="requiredMods" placeholder="HD DT" className="cp-input uppercase" /></label>
        <label className="flex items-center gap-2 text-xs font-medium"><input name="personalBestOnly" type="checkbox" className="size-4 accent-[#f48120]" />PB更新だけ</label>
        <label className="flex items-center gap-2 text-xs font-medium"><input name="anomalyOnly" type="checkbox" className="size-4 accent-[#f48120]" />異常値検知だけ</label>
        <div className="sm:col-span-2 xl:text-right"><button className="cp-button-primary" type="submit"><BellRing className="size-4" />ルールを作成</button></div>
      </form>
      <div className="divide-y divide-[#e8ebef]">{rules.map(({ rule, accountUsername }) => <article key={rule.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${rule.enabled ? "bg-emerald-500" : "bg-slate-300"}`} /><h3 className="truncate text-xs font-semibold">{rule.name}</h3><code className="text-[9px] text-[#8b94a1]">{rule.id.slice(0, 8)}</code></div><p className="mt-1 text-[10px] text-[#667184]">{accountUsername ?? "全員"} · {rule.conditions.modes.join("/")} · {rule.conditions.ranks.join(",") || "全判定"} · {rule.conditions.minimumPp}pp〜 · {rule.conditions.minimumAccuracy}%〜 · &lt;#{rule.channelId}&gt;</p></div><div className="flex gap-2"><form action={setControlNotificationRuleState}><input type="hidden" name="id" value={rule.id} /><input type="hidden" name="enabled" value={String(!rule.enabled)} /><button className="rounded-md border px-3 py-2 text-[10px] font-semibold">{rule.enabled ? "停止" : "有効化"}</button></form><form action={deleteControlNotificationRule}><input type="hidden" name="id" value={rule.id} /><button className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-semibold text-red-700">削除</button></form></div></article>)}{!rules.length ? <p className="px-5 py-8 text-center text-xs text-[#8b94a1]">通知ルールはまだありません。</p> : null}</div>
    </section>

    <section className="cp-panel mt-5 p-5">
      <div className="flex items-center gap-2"><ServerCog className="size-4 text-[#0051c3]" /><h2 className="text-sm font-semibold">Discord管理チャンネル</h2></div><p className="mt-1 text-[11px] text-[#7d8795]">コンソールログはBot・Renderer・Lavalinkをまとめ、トークン等をマスクして送信します。</p>
      <form action={configureControlAdminChannels} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><label className="cp-label">Server ID<input name="guildId" required pattern="[0-9]{17,20}" defaultValue={automationChannels[0]?.guildId} className="cp-input font-mono" /></label><label className="cp-label">監査ログ<input name="auditLogChannelId" required pattern="[0-9]{17,20}" defaultValue={automationChannels[0]?.auditLogChannelId ?? ""} className="cp-input font-mono" /></label><label className="cp-label">コンソールログ<input name="consoleLogChannelId" required pattern="[0-9]{17,20}" defaultValue={automationChannels[0]?.consoleLogChannelId ?? ""} className="cp-input font-mono" /></label><label className="cp-label">デイリーレポート<input name="dailyReportChannelId" required pattern="[0-9]{17,20}" defaultValue={automationChannels[0]?.dailyReportChannelId ?? ""} className="cp-input font-mono" /></label><label className="cp-label">週間表彰<input name="weeklyAwardsChannelId" required pattern="[0-9]{17,20}" defaultValue={automationChannels[0]?.weeklyAwardsChannelId ?? ""} className="cp-input font-mono" /></label><button className="cp-button-primary w-fit xl:col-span-5">保存</button></form>
    </section>

    <section className="cp-panel mt-5 overflow-hidden"><div className="border-b border-[#e2e6eb] px-5 py-4"><div className="flex items-center gap-2"><ScrollText className="size-4 text-[#475569]" /><h2 className="text-sm font-semibold">管理操作監査ログ</h2></div></div><div className="max-h-[32rem] divide-y divide-[#e8ebef] overflow-auto">{audits.map((item) => <article key={item.id} className="px-5 py-3"><div className="flex flex-wrap items-center gap-2"><code className="text-[9px] font-semibold text-[#0051c3]">{item.action}</code><span className="text-[10px] text-[#7d8795]">{item.source}</span><span className="ml-auto text-[9px] text-[#929aa6]">{item.createdAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</span></div><p className="mt-1 text-[11px] text-[#4f5a6b]">{item.summary}</p></article>)}{!audits.length ? <p className="p-8 text-center text-xs text-[#8b94a1]">監査ログはまだありません。</p> : null}</div></section>

    <section className="cp-panel mt-5 p-5">
      <div className="flex items-center gap-2"><Megaphone className="size-4 text-[#f48120]" /><h2 className="text-sm font-semibold">Discordへお知らせ</h2></div>
      <p className="mt-1 text-[11px] text-[#7d8795]">メンションは展開しない安全設定で送信します。</p>
      <form action={sendControlAnnouncement} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="cp-label">チャンネルID<input name="channelId" required pattern="[0-9]{17,20}" className="cp-input font-mono" placeholder="123456789012345678" /></label>
        <label className="cp-label">タイトル<input name="title" required maxLength={256} className="cp-input" /></label>
        <label className="cp-label sm:col-span-2">本文<textarea name="message" required maxLength={4000} rows={5} className="cp-input !h-auto py-2" /></label>
        <button className="cp-button-primary w-fit" type="submit"><Megaphone className="size-4" />送信</button>
      </form>
    </section>

    <section className="cp-panel mt-5 overflow-hidden">
      <div className="border-b border-[#e2e6eb] px-5 py-4"><div className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-600" /><h2 className="text-sm font-semibold">Botエラー</h2></div><p className="mt-1 text-[11px] text-[#7d8795]">Discordに表示されたエラーIDから原因を追跡できます。</p></div>
      <div className="divide-y divide-[#e8ebef]">{errors.map((error) => <details key={error.traceId} className="group px-5 py-4"><summary className="flex cursor-pointer items-center gap-3 text-xs"><span className={`size-2 rounded-full ${error.resolvedAt ? "bg-emerald-500" : "bg-red-500"}`} /><code className="font-semibold text-[#0051c3]">{error.traceId}</code><span className="font-medium">{error.command}</span><span className="ml-auto text-[10px] text-[#7d8795]">{error.createdAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</span></summary><div className="mt-3 rounded-md bg-[#f7f8fa] p-3 text-[11px] leading-5"><p className="font-semibold text-red-700">{error.message}</p>{error.stack ? <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap font-mono text-[9px] text-[#596477]">{error.stack}</pre> : null}{!error.resolvedAt ? <form action={resolveControlError} className="mt-3"><input type="hidden" name="traceId" value={error.traceId} /><button className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-700"><CheckCircle2 className="size-3" />対応済みにする</button></form> : null}</div></details>)}{!errors.length ? <p className="px-5 py-10 text-center text-xs text-[#7d8795]">記録されたエラーはありません。</p> : null}</div>
    </section>

    <section className="cp-panel mt-5 overflow-hidden">
      <div className="border-b border-[#e2e6eb] px-5 py-4"><div className="flex items-center gap-2"><MessageSquareText className="size-4 text-[#0051c3]" /><h2 className="text-sm font-semibold">要望・不具合報告</h2></div><p className="mt-1 text-[11px] text-[#7d8795]">Discordの `/feedback` から届いた内容です。</p></div>
      <div className="divide-y divide-[#e8ebef]">{feedback.map((item) => <article key={item.id} className="px-5 py-4"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-blue-50 px-2 py-1 text-[9px] font-semibold uppercase text-blue-700">{item.kind}</span><h3 className="text-xs font-semibold">{item.title}</h3><code className="ml-auto text-[9px] text-[#8a94a3]">{item.discordUserId}</code></div><p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-[#596477]">{item.details}</p><p className="mt-2 text-[9px] text-[#929aa6]">{item.createdAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p></article>)}{!feedback.length ? <p className="px-5 py-10 text-center text-xs text-[#7d8795]">まだ届いていません。</p> : null}</div>
    </section>
  </div>;
}

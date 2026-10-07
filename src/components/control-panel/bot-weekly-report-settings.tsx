"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import type { BotWeeklyReportResponse, BotWeeklyReportSettings as Settings } from "@/lib/bot-weekly-report";
import { requestJson } from "@/lib/client/request-json";
import { formatBotDate } from "./bot-statistics-presentation";

const weekdays = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
const endpoint = "/api/control/bot-statistics/report";

function ReportForm({ data, saved }: { data: BotWeeklyReportResponse; saved: (data: BotWeeklyReportResponse) => Promise<unknown> }) {
  const [settings, setSettings] = useState<Settings>(data.settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guild = data.guilds.find((item) => item.id === settings.guildId);
  const channels = guild?.channels ?? [];
  const update = (patch: Partial<Settings>) => { setSettings({ ...settings, ...patch }); setMessage(null); setError(null); };
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const response = await fetch(endpoint, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings), signal: AbortSignal.timeout(30_000) });
      const result = await response.json() as BotWeeklyReportResponse & { error?: string };
      if (!response.ok) throw new Error(response.status === 401 ? "ログインの期限が切れました。再ログインしてください。" : result.error ?? "週報設定を保存できませんでした。");
      await saved(result); setMessage("週報設定を保存しました。");
    } catch (caught) { setError(caught instanceof Error && !["TypeError", "TimeoutError"].includes(caught.name) ? caught.message : "保存の応答を確認できませんでした。設定を更新して保存結果を確認してください。"); }
    finally { setSaving(false); }
  }
  const validDestination = !!guild && channels.some((channel) => channel.id === settings.channelId);
  return <form onSubmit={(event) => void submit(event)}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Discordへ統計週報を自動送信</h3><p className="mt-1 text-xs leading-6 text-[#748094]">直前の月曜0時〜日曜24時（JST）を集計。送信先のサーバーの活動と、Bot全体の通信・処理を区別して送ります。</p></div>
      <label className="flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-xs"><input type="checkbox" checked={settings.enabled} onChange={(event) => update({ enabled: event.target.checked })} />週報を有効にする</label>
    </div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="text-xs text-[#68768a]">送信先サーバー<select aria-label="週報の送信先サーバー" className="cp-select" value={settings.guildId} onChange={(event) => update({ guildId: event.target.value, channelId: "" })}><option value="">選択してください</option>{data.guilds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{settings.guildId && !guild ? <option value={settings.guildId}>現在取得できないサーバー</option> : null}</select></label>
      <label className="text-xs text-[#68768a]">送信先チャンネル<select aria-label="週報の送信先チャンネル" className="cp-select" value={settings.channelId} disabled={!guild} onChange={(event) => update({ channelId: event.target.value })}><option value="">選択してください</option>{channels.map((item) => <option key={item.id} value={item.id}>#{item.name}</option>)}{settings.channelId && !channels.some((channel) => channel.id === settings.channelId) ? <option value={settings.channelId}>現在取得できないチャンネル</option> : null}</select></label>
      <label className="text-xs text-[#68768a]">毎週の送信曜日<select aria-label="週報の送信曜日" className="cp-select" value={settings.weekdayJst} onChange={(event) => update({ weekdayJst: Number(event.target.value) })}>{weekdays.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label>
      <label className="text-xs text-[#68768a]">送信時刻（JST）<input aria-label="週報の送信時刻" type="time" required className="cp-input" value={`${String(settings.hourJst).padStart(2, "0")}:${String(settings.minuteJst).padStart(2, "0")}`} onChange={(event) => { const [hour, minute] = event.target.value.split(":").map(Number); if (Number.isFinite(hour) && Number.isFinite(minute)) update({ hourJst: hour, minuteJst: minute }); }} /></label>
    </div>
    <p className="mt-3 text-[11px] leading-6 text-[#748094]">Botが起動・接続している時に送信します。停止中の週報は復帰後に直近1週分のみ再試行し、大量の過去分は送りません。チャンネル候補はBotの保存済み索引です。送信時にも権限を再確認します。不要なメンションは行いません。</p>
    {!data.botOnline ? <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Botがオフラインのため、送信とチャンネル索引の更新は停止中です。</p> : null}
    {error ? <p role="alert" className="mt-3 rounded-md bg-rose-50 p-3 text-xs text-rose-700">{error}</p> : null}
    {message ? <p role="status" className="mt-3 text-xs text-emerald-700">{message}</p> : null}
    <div className="mt-4 flex flex-wrap items-center gap-4"><button type="submit" disabled={saving || (settings.enabled && !validDestination)} className="rounded-md bg-[#0051c3] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{saving ? "保存中…" : "週報設定を保存"}</button>
      <p className="text-[11px] text-[#748094]">保存済み設定: {data.settings.enabled ? "有効" : "無効"} · 次の定期送信 {data.nextDueAt ? `${formatBotDate(data.nextDueAt)} JST` : "未設定"}</p></div>
    {data.lastDelivery ? <p className="mt-3 text-[11px] text-[#748094]">前回: {data.lastDelivery.periodStart}週 · {data.lastDelivery.status === "sent" ? `送信済み ${formatBotDate(data.lastDelivery.sentAt)} JST` : data.lastDelivery.status === "sending" ? "送信処理中" : "送信失敗・再試行待ち"}</p> : null}
  </form>;
}

export function BotWeeklyReportSettings() {
  const query = useSWR<BotWeeklyReportResponse>(endpoint, requestJson, { revalidateOnFocus: false, errorRetryCount: 1 });
  const [saveMessage, setSaveMessage] = useState(false);
  return <div>
    <div className="mb-3 flex justify-end"><button type="button" disabled={query.isValidating} onClick={() => { setSaveMessage(false); void query.mutate().catch(() => undefined); }} className="text-[11px] text-[#0051c3] disabled:opacity-40">{query.isValidating ? "設定を更新中…" : "設定・チャンネル候補を更新"}</button></div>
    {query.error ? <p role="alert" className="mb-3 rounded-md bg-rose-50 p-3 text-xs text-rose-700">週報設定を取得できませんでした。更新を試してください。</p> : null}
    {saveMessage ? <p role="status" className="mb-3 text-xs text-emerald-700">週報設定を保存しました。</p> : null}
    {query.data ? <ReportForm key={JSON.stringify(query.data.settings)} data={query.data} saved={async (next) => { await query.mutate(next, { revalidate: false }); setSaveMessage(true); }} /> : <p role="status" className="text-xs text-[#748094]">週報設定を読み込み中…</p>}
  </div>;
}

"use client";

import { Activity, Bot, Cpu, ExternalLink, Gauge, MessageSquareText, Music2, RadioTower, Settings2, TicketCheck, Users, Video } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import { liveRequestOptions, requestJson } from "@/lib/client/request-json";
import { RefreshNotice } from "@/components/control-panel/refresh-notice";

import type { CommandCenterView } from "@/lib/control/command-center";

const fetcher = (url: string) => requestJson<CommandCenterView>(url);

function statusTone(status: string) {
  return ["operational", "online", "ready", "ok", "playing", "paused", "idle"].includes(status)
    ? "bg-emerald-50 text-emerald-700"
    : status === "offline" || status === "error"
      ? "bg-red-50 text-red-700"
      : "bg-amber-50 text-amber-700";
}

function ago(value: string, reference: string) {
  const seconds = Math.max(0, Math.round((new Date(reference).getTime() - new Date(value).getTime()) / 1_000));
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}分前`;
  return `${Math.floor(seconds / 3_600)}時間前`;
}

function formatJstTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function CommandCenter({ initial }: { initial: CommandCenterView }) {
  const { data = initial, error, mutate } = useSWR<CommandCenterView>("/api/control/command-center", fetcher, {
    ...liveRequestOptions,
    fallbackData: initial,
    refreshInterval: 5_000,
    revalidateOnFocus: true,
  });
  const openTickets = data.tickets.filter((row) => row.status === "open");
  const activeEvents = data.events.filter((row) => row.status === "active");
  const activeMusic = data.music.states.filter((row) => row.connected || row.currentTrack);
  const maxActivity = Math.max(1, ...data.activity.hours.map((row) => row.messages + row.voiceJoins));
  const topHour = [...data.activity.hours].sort((a, b) => (b.messages + b.voiceJoins) - (a.messages + a.voiceJoins))[0];

  return <div>
    <section className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Live command center</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">リアルタイム司令画面</h1><p className="mt-1 text-xs text-[#727d8d]">Bot・Renderer・音楽・コミュニティを5秒ごとに統合更新</p></div>
      <div className="flex items-center gap-2"><span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[10px] font-semibold ${error ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}><span className={`size-1.5 rounded-full ${error ? "bg-amber-500" : "animate-pulse bg-emerald-500"}`} />{error ? "更新待ち" : "LIVE"}</span><span className="font-mono text-[9px] text-[#8a94a3]">更新 {formatJstTime(data.generatedAt)}</span></div>
    </section>

    <nav aria-label="管理画面ショートカット" className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {[
        { href: "/dashboard/render", label: "レンダー管理", icon: Video },
        { href: "/dashboard/music", label: "音楽コントロール", icon: Music2 },
        { href: "/dashboard/performance", label: "PC性能履歴", icon: Gauge },
        { href: "/dashboard/database", label: "DB管理", icon: Users },
        { href: "/dashboard/settings", label: "全設定", icon: Settings2 },
      ].map((item) => <Link key={item.href} href={item.href} className="group flex items-center gap-2 rounded-md border border-[#dfe4ea] bg-white px-3 py-2.5 text-[10px] font-semibold text-[#526075] transition hover:border-[#b9c7d8] hover:bg-[#f8fafc] hover:text-[#0051c3]"><item.icon className="size-3.5" /><span>{item.label}</span><ExternalLink className="ml-auto size-3 opacity-40 transition group-hover:opacity-100" /></Link>)}
    </nav>
    <RefreshNotice error={error} retry={() => { void mutate().catch(() => undefined); }} />

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[
        { label: "System", value: data.services.overall, detail: `推定稼働率 ${data.services.uptimeEstimate}%`, icon: RadioTower },
        { label: "Render", value: `${data.overview.renders.active} active`, detail: `${data.overview.renders.completed}/${data.overview.renders.total} 完了`, icon: Cpu },
        { label: "Music", value: `${activeMusic.length} player`, detail: activeMusic[0]?.currentTrack?.title ?? "待機中", icon: Music2 },
        { label: "Tickets", value: `${openTickets.length} open`, detail: `累計 ${data.tickets.length}件表示`, icon: TicketCheck },
        { label: "Active users", value: data.activity.uniqueActiveUsers.toLocaleString(), detail: `過去${data.activity.days}日`, icon: Users },
      ].map((card) => <article key={card.label} className="cp-panel p-4"><div className="flex items-center justify-between"><p className="text-[9px] font-semibold uppercase tracking-[.1em] text-[#7d8795]">{card.label}</p><card.icon className="size-4 text-[#64748b]" /></div><p className="mt-3 truncate font-mono text-lg font-semibold">{card.value}</p><p className="mt-1 truncate text-[10px] text-[#7d8795]">{card.detail}</p></article>)}
    </section>

    <section className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
      <article className="cp-panel overflow-hidden"><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><Activity className="size-4 text-[#0051c3]" />時間帯別アクティビティ</h2><p className="mt-1 text-[10px] text-[#7d8795]">JST・過去30日 · メッセージとVC参加回数を統合</p></div><div className="p-5"><div className="flex h-52 items-end gap-1">{data.activity.hours.map((hour) => {const total=hour.messages+hour.voiceJoins;return <div key={hour.hour} className="group relative flex h-full min-w-0 flex-1 items-end"><div className="w-full rounded-t bg-[#8c7cff] transition hover:bg-[#6548db]" style={{height:`${Math.max(total?4:0,total/maxActivity*100)}%`}}/><div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-32 -translate-x-1/2 rounded bg-[#171a20] p-2 text-[9px] text-white shadow-lg group-hover:block"><strong>{String(hour.hour).padStart(2,"0")}:00</strong><br/>{hour.activeUsers}人 · {hour.messages}msg · VC {hour.voiceJoins}</div></div>})}</div><div className="mt-2 flex justify-between font-mono text-[9px] text-[#8a94a3]"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div><p className="mt-4 rounded-md bg-[#f6f8fa] px-3 py-2 text-[10px] text-[#667184]">最も活発: <strong>{String(topHour?.hour ?? 0).padStart(2,"0")}:00</strong> · メッセージ {data.activity.totalMessages.toLocaleString()}件 · VC参加 {data.activity.totalVoiceJoins.toLocaleString()}回</p></div></article>
      <article className="cp-panel overflow-hidden"><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><Bot className="size-4 text-[#f48120]" />サービス状態</h2></div><div className="divide-y">{data.services.services.map((service) => <div key={service.name} className="flex items-center gap-3 px-5 py-3"><span className={`rounded-full px-2 py-1 font-mono text-[8px] font-semibold uppercase ${statusTone(service.status)}`}>{service.status}</span><span className="text-xs font-medium">{service.name}</span><span className="ml-auto text-[9px] text-[#8a94a3]">{ago(service.lastSeenAt, data.generatedAt)}</span></div>)}</div></article>
    </section>

    <section className="mt-5 grid gap-5 xl:grid-cols-3">
      <article className="cp-panel overflow-hidden"><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><Music2 className="size-4 text-[#6c55d9]" />音楽接続品質</h2></div><div className="divide-y">{data.music.states.map((state) => <div key={state.guildId} className="px-5 py-3"><div className="flex items-center gap-2"><p className="truncate text-xs font-semibold">{state.guildName ?? state.guildId}</p><span className={`ml-auto rounded-full px-2 py-1 text-[8px] ${statusTone(state.status)}`}>{state.status}</span></div><p className="mt-1 truncate text-[10px] text-[#748094]">{state.currentTrack?.title ?? "再生なし"}</p><p className="mt-2 font-mono text-[9px] text-[#667184]">PING {state.voicePingMs ?? "—"}ms · LOSS {state.frameLossPercent?.toFixed(2) ?? "—"}% · RECOVERY {state.reconnectAttempts}</p></div>)}</div></article>
      <article className="cp-panel overflow-hidden"><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><TicketCheck className="size-4 text-[#0f67d8]" />最近のチケット</h2></div><div className="divide-y">{data.tickets.slice(0,8).map((ticket) => <div key={ticket.id} className="px-5 py-3"><div className="flex gap-2"><code className="text-[9px] text-[#0051c3]">{ticket.id.slice(0,8)}</code><span className={`ml-auto rounded-full px-2 py-0.5 text-[8px] ${statusTone(ticket.status)}`}>{ticket.status}</span></div><p className="mt-1 text-[10px] text-[#667184]">user {ticket.openerDiscordUserId} · {ago(ticket.createdAt, data.generatedAt)}</p></div>)}{!data.tickets.length?<p className="p-8 text-center text-xs text-[#8a94a3]">まだありません。</p>:null}</div></article>
      <article className="cp-panel overflow-hidden"><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><MessageSquareText className="size-4 text-[#f48120]" />監査・コミュニティ</h2><p className="mt-1 text-[10px] text-[#7d8795]">開催中 {activeEvents.length}件</p></div>{activeEvents.length ? <div className="border-b bg-[#fffaf4] px-5 py-3">{activeEvents.slice(0,3).map((event) => <div key={event.id} className="flex items-center gap-2 py-1 text-[9px]"><span className="rounded bg-[#f48120]/10 px-1.5 py-0.5 font-semibold uppercase text-[#b85e0c]">{event.kind}</span><span className="min-w-0 flex-1 truncate font-medium">{event.title}</span><span className="font-mono text-[#8b6b4e]">終了 {formatJstTime(event.endsAt)}</span></div>)}</div> : null}<div className="max-h-80 divide-y overflow-auto">{data.audits.slice(0,12).map((audit) => <div key={audit.id} className="px-5 py-3"><div className="flex gap-2"><code className="text-[8px] font-semibold text-[#0051c3]">{audit.action}</code><span className="ml-auto text-[8px] text-[#929aa6]">{ago(audit.createdAt, data.generatedAt)}</span></div><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#596477]">{audit.summary}</p></div>)}</div></article>
    </section>
  </div>;
}

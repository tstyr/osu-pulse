"use client";

import { useEffect, useState } from "react";
import { Activity, ArrowDownToLine, ArrowUpFromLine, ChevronLeft, ChevronRight, Database, HardDrive, Pin, Users } from "lucide-react";
import type { BotStatisticsData } from "@/lib/bot-statistics";
import { BOT_CARD_IDS, BOT_CARD_LAYOUT_KEY, botCardDisplayOrder, moveBotCard, normalizeBotCardLayout, toggleBotCardFavorite, type BotCardId, type BotCardLayout } from "./bot-card-layout";
import { formatBotValue } from "./bot-statistics-presentation";

export function BotSummaryCards({ data }: { data: BotStatisticsData }) {
  const [layout, setLayout] = useState<BotCardLayout>(() => normalizeBotCardLayout(null));
  const [editing, setEditing] = useState(false);
  const [sessionOnly, setSessionOnly] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(BOT_CARD_LAYOUT_KEY);
        if (saved) setLayout(normalizeBotCardLayout(JSON.parse(saved)));
      } catch { setSessionOnly(true); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const save = (next: BotCardLayout) => {
    setLayout(next);
    try { localStorage.setItem(BOT_CARD_LAYOUT_KEY, JSON.stringify(next)); } catch { setSessionOnly(true); }
  };
  const summary = data.summary;
  const cards: Record<BotCardId, { label: string; value: number | null | undefined; detail: string; icon: typeof Activity }> = {
    receivedBytes: { label: "期間のBot TCP受信量", value: summary.receivedBytes?.total, detail: `観測日平均 ${formatBotValue("receivedBytes", summary.receivedBytes?.average)}`, icon: ArrowDownToLine },
    sentBytes: { label: "期間のBot TCP送信量", value: summary.sentBytes?.total, detail: `観測日平均 ${formatBotValue("sentBytes", summary.sentBytes?.average)}`, icon: ArrowUpFromLine },
    gatewayPingMs: { label: data.scope === "global" ? "Gateway Ping" : "Gateway Ping（接続Shard）", value: summary.gatewayPingMs?.latest, detail: `観測平均 ${formatBotValue("gatewayPingMs", summary.gatewayPingMs?.average)}`, icon: Activity },
    voiceMembers: { label: "VC接続人数", value: summary.voiceMembers?.latest, detail: `延べ接続 ${formatBotValue("voiceMemberSeconds", summary.voiceMemberSeconds?.total)}`, icon: Users },
    osuActivePlayers: { label: "osu!アクティブ人数", value: summary.osuActivePlayers?.latest, detail: "DB保存リザルトの直近30分で判定", icon: Users },
    messageCount: { label: "受信メッセージ", value: summary.messageCount?.total, detail: `観測日平均 ${formatBotValue("messageCount", summary.messageCount?.average)}`, icon: Activity },
    dbBytes: { label: "DB使用容量", value: summary.dbBytes?.latest, detail: `行数 ${formatBotValue("dbRows", summary.dbRows?.latest)}（概算）`, icon: Database },
    diskUsedBytes: { label: "PCディスク使用量", value: summary.diskUsedBytes?.latest, detail: `総容量 ${formatBotValue("diskTotalBytes", summary.diskTotalBytes?.latest)}`, icon: HardDrive },
  };
  const visible = BOT_CARD_IDS.filter((key) => data.scope === "global" || !["receivedBytes", "sentBytes", "dbBytes", "diskUsedBytes"].includes(key));
  const order = botCardDisplayOrder(layout, visible);
  return <section aria-label="統計カード" className="mt-5">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#758196]">
      <span>{editing ? "ピンで先頭へ固定。矢印で同じグループ内の順番を変更。" : layout.favorites.length ? "お気に入りを先頭に固定" : "現在値・期間合計"}{editing ? ` ${sessionOnly ? "この画面のみ有効です。" : "配置はこのブラウザーに保存します。"}` : ""}</span>
      <div className="flex gap-3"><button type="button" aria-pressed={editing} onClick={() => setEditing(!editing)} className="font-medium text-[#0051c3]">{editing ? "編集を終了" : "カードの配置を編集"}</button>
        {editing ? <button type="button" onClick={() => save(normalizeBotCardLayout(null))}>配置をリセット</button> : null}</div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{order.map((key) => {
      const card = cards[key], Icon = card.icon, pinned = layout.favorites.includes(key);
      const peers = order.filter((item) => layout.favorites.includes(item) === pinned);
      return <article key={key} data-bot-card={key} className={`cp-panel min-w-0 p-4 ${pinned ? "!border-blue-300" : ""}`}>
        <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-medium text-[#637084]">{pinned ? <Pin className="mr-1 inline size-3 text-[#0051c3]" aria-label="お気に入り" /> : null}{card.label}</p><Icon className="size-4 shrink-0 text-[#8c98aa]" /></div>
        <p className="mt-3 break-words text-2xl font-semibold tracking-[-0.025em]">{formatBotValue(key, card.value)}</p>
        <p className="mt-1 text-[10px] leading-4 text-[#7e899a]">{card.detail}</p>
        {editing ? <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2">
          <button type="button" aria-label={`${card.label}のお気に入り固定`} aria-pressed={pinned} onClick={() => save(toggleBotCardFavorite(layout, key))} className={`inline-flex items-center gap-1 text-[11px] ${pinned ? "text-[#0051c3]" : "text-[#738094]"}`}><Pin className="size-3" />{pinned ? "固定中" : "固定"}</button>
          <div className="flex gap-1">{([-1, 1] as const).map((direction) => <button key={direction} type="button" aria-label={`${card.label}を${direction === -1 ? "前" : "後"}へ移動`} disabled={direction === -1 ? peers[0] === key : peers.at(-1) === key} onClick={() => save(moveBotCard(layout, key, direction, visible))} className="rounded border p-1 text-[#657389] disabled:opacity-30">{direction === -1 ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button>)}</div>
        </div> : null}
      </article>;
    })}</div>
  </section>;
}

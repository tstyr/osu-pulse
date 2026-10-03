"use client";

import { Bot, LoaderCircle, RotateCcw, Server, Waves } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { liveRequestOptions, requestJson } from "@/lib/client/request-json";

type Command = { id: string; service: string; status: string; error: string | null; requestedAt: string; completedAt: string | null };

const SERVICES = [
  { key: "bot", label: "Discord Bot", detail: "Gateway worker / yt-dlp proxy", icon: Bot },
  { key: "renderer", label: "Renderer", detail: "danser / FFmpeg / cloud bridge", icon: Server },
  { key: "lavalink", label: "Lavalink", detail: "Discord audio node", icon: Waves },
] as const;

function formatJst(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function ServiceRestartPanel({ initial }: { initial: Command[] }) {
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const data = useSWR<{ commands: Command[] }>("/api/control/services", requestJson, {
    ...liveRequestOptions,
    fallbackData: { commands: initial },
    refreshInterval: (result) => result?.commands.some((command) => ["pending", "claimed"].includes(command.status)) ? 2_000 : 15_000,
  });
  async function restart(service: typeof SERVICES[number]["key"], label: string) {
    if (!window.confirm(`${label}を再起動しますか？進行中の接続や処理は一時的に中断されます。`)) return;
    setPending(service); setNotice(null);
    try {
      const response = await fetch("/api/control/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service, action: "restart" }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "再起動指示を送信できませんでした。");
      setNotice(`${label}の再起動指示をローカルBotへ送りました。`);
      await data.mutate().catch(() => undefined);
    } catch (error) { setNotice(error instanceof Error ? error.message : "再起動指示に失敗しました。"); }
    finally { setPending(null); }
  }
  return <section className="cp-panel mt-5 overflow-hidden"><div className="border-b border-[#e2e6eb] px-5 py-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><RotateCcw className="size-4 text-[#0051c3]" /> ローカルサービス再起動</h2><p className="mt-1 text-[11px] text-[#7d8795]">VercelからDB経由でローカルPCへ安全に再起動指示を送ります。Botが停止中の場合はWindowsのWatchdogが復旧します。</p></div><div className="grid gap-px bg-[#e6eaef] sm:grid-cols-3">{SERVICES.map((service) => { const Icon = service.icon; return <div key={service.key} className="bg-white p-5"><Icon className="size-5 text-[#667184]" /><p className="mt-3 text-sm font-semibold">{service.label}</p><p className="mt-1 text-[10px] text-[#7d8795]">{service.detail}</p><button type="button" disabled={pending !== null} onClick={() => void restart(service.key, service.label)} className="mt-4 inline-flex h-8 items-center gap-2 rounded-md border border-[#d6dce4] bg-white px-3 text-[10px] font-semibold hover:bg-[#f5f7f9] disabled:opacity-50">{pending === service.key ? <LoaderCircle className="size-3 animate-spin" /> : <RotateCcw className="size-3" />} 再起動</button></div>; })}</div>{notice ? <p className="border-t border-[#e2e6eb] bg-[#fafbfc] px-5 py-3 text-[10px] text-[#526075]">{notice}</p> : null}<div className="max-h-40 divide-y divide-[#edf0f3] overflow-auto">{data.data?.commands.slice(0, 8).map((command) => <div key={command.id} className="flex items-center gap-3 px-5 py-2 text-[9px]"><span className="font-mono font-semibold">{command.service}</span><span className={command.status === "failed" ? "text-red-600" : command.status === "completed" ? "text-emerald-700" : "text-amber-700"}>{command.status}</span><span className="ml-auto text-[#8b94a1]">{formatJst(command.requestedAt)}</span>{command.error ? <span className="text-red-600">{command.error}</span> : null}</div>)}</div></section>;
}

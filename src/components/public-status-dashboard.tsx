"use client";

import { Activity, CheckCircle2, CircleAlert, Clock3, Server } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import { liveRequestOptions, requestJson } from "@/lib/client/request-json";
import { RefreshNotice } from "@/components/control-panel/refresh-notice";

type StatusData = {
  generatedAt: string;
  overall: string;
  uptimeEstimate: number;
  services: Array<{ name: string; status: string; lastSeenAt: string }>;
  incidents: Array<{ id: string; service: string; title: string; message: string; severity: string; startedAt: string; resolvedAt: string | null }>;
};

function operational(value: string) { return value === "operational" || value === "ready" || value === "ok" || value === "online"; }

export function PublicStatusDashboard({ initial }: { initial: StatusData }) {
  const { data = initial, error, mutate } = useSWR<StatusData>("/api/status", requestJson, {
    ...liveRequestOptions,
    fallbackData: initial,
    refreshInterval: 15_000,
  });
  const ok = data.overall === "operational";
  return <main className="mx-auto min-h-screen max-w-4xl px-4 py-12 sm:px-7">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#f48120]">osu! Pulse</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Service Status</h1></div><Link href="/" className="text-xs font-semibold text-[#0051c3] hover:underline">管理画面</Link></header>
    <RefreshNotice error={error} retry={() => { void mutate().catch(() => undefined); }} />
    <section className={`mt-8 rounded-xl border p-6 ${ok?"border-emerald-200 bg-emerald-50":"border-amber-200 bg-amber-50"}`}><div className="flex items-center gap-3">{ok?<CheckCircle2 className="size-6 text-emerald-600"/>:<CircleAlert className="size-6 text-amber-600"/>}<div><h2 className="text-lg font-semibold">{ok?"すべて正常に稼働しています":"一部サービスに問題があります"}</h2><p className="mt-1 text-xs text-[#667184]">Renderer 24時間推定稼働率 {data.uptimeEstimate.toFixed(2)}%</p></div></div></section>
    <section className="cp-panel mt-6 overflow-hidden"><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><Server className="size-4"/>サービス</h2></div><div className="divide-y">{data.services.map((service)=><div key={service.name} className="flex items-center gap-3 px-5 py-4"><span className={`size-2.5 rounded-full ${operational(service.status)?"bg-emerald-500":service.status==="offline"?"bg-red-500":"bg-amber-500"}`}/><span className="flex-1 text-sm font-medium capitalize">{service.name.replaceAll("-"," ")}</span><span className="font-mono text-[10px] uppercase text-[#667184]">{service.status}</span></div>)}</div></section>
    <section className="cp-panel mt-6 overflow-hidden"><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><Activity className="size-4"/>直近7日のインシデント</h2></div><div className="divide-y">{data.incidents.map((incident)=><article key={incident.id} className="px-5 py-4"><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${incident.resolvedAt?"bg-emerald-500":"bg-red-500"}`}/><h3 className="text-xs font-semibold">{incident.title}</h3><span className="ml-auto font-mono text-[9px] text-[#8a94a3]">{incident.service}</span></div><p className="mt-2 text-[11px] leading-5 text-[#667184]">{incident.message}</p><p className="mt-2 flex items-center gap-1 text-[9px] text-[#8a94a3]"><Clock3 className="size-3"/>{new Date(incident.startedAt).toLocaleString("ja-JP")}{incident.resolvedAt?" · 解決済み":" · 対応中"}</p></article>)}{!data.incidents.length?<p className="px-5 py-10 text-center text-xs text-[#8a94a3]">直近のインシデントはありません。</p>:null}</div></section>
    <p className="mt-6 text-center font-mono text-[9px] text-[#9aa2ad]">15秒ごとに自動更新 · {new Date(data.generatedAt).toLocaleString("ja-JP")}</p>
  </main>;
}

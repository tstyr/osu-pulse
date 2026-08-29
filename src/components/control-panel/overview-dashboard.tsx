"use client";

import {
  Activity,
  CheckCircle2,
  CircleGauge,
  Cloud,
  Cpu,
  Database,
  Disc3,
  ExternalLink,
  Gauge,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Users,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { DashboardOverview } from "@/lib/control/dashboard";

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function StatCard({ label, value, detail, icon: Icon, tone = "blue" }: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone?: "blue" | "green" | "orange" | "slate";
}) {
  const tones = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    orange: "bg-orange-50 text-orange-700",
    slate: "bg-slate-100 text-slate-700",
  };
  return (
    <div className="cp-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#778294]">{label}</p><p className="mt-2 text-2xl font-semibold tracking-[-0.035em]">{value}</p></div>
        <span className={`grid size-9 place-items-center rounded-md ${tones[tone]}`}><Icon className="size-4" /></span>
      </div>
      <p className="mt-3 text-[11px] text-[#7b8492]">{detail}</p>
    </div>
  );
}

function ResourceCard({ label, value, percent, detail, icon: Icon }: {
  label: string;
  value: string;
  percent: number;
  detail: string;
  icon: typeof Cpu;
}) {
  const safePercent = Math.max(0, Math.min(100, percent));
  return (
    <div className="rounded-lg border border-[#e0e4ea] bg-white p-4">
      <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-semibold text-[#394354]"><Icon className="size-4 text-[#637084]" /> {label}</span><span className="font-mono text-sm font-semibold">{value}</span></div>
      <div className="cp-meter mt-3"><span style={{ width: `${safePercent}%`, background: safePercent >= 90 ? "#dc3d43" : safePercent >= 75 ? "#f48120" : undefined }} /></div>
      <p className="mt-2 text-[10px] text-[#8a94a3]">{detail}</p>
    </div>
  );
}

export function OverviewDashboard({ initial }: { initial: DashboardOverview }) {
  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/control/overview", { cache: "no-store" });
      if (response.ok) setData(await response.json() as DashboardOverview);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const maxTrend = Math.max(1, ...data.trend.map((item) => item.total));
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Overview</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">システム概要</h1><p className="mt-1 text-sm text-[#6f7a8c]">レンダー、ストレージ、DBの現在地を15秒ごとに更新します。</p></div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d5dae2] bg-white px-3 text-xs font-medium text-[#4f5a6b] hover:bg-[#f7f8f9]"><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /> 更新</button>
      </div>

      {data.renderer.restartRequired ? <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">設定を受信しました。実行中の処理が終わるとRendererが自動再起動して反映します。</div> : null}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Renderer" value={data.renderer.online ? "Online" : "Offline"} detail={`${data.renderer.activeCount}/${data.renderer.capacity} 実行中 · ${String(data.renderer.encoder)}`} icon={Cloud} tone={data.renderer.online ? "green" : "slate"} />
        <StatCard label="Render jobs" value={data.renders.total.toLocaleString()} detail={`${data.renders.active} 処理中 · 成功率 ${data.renders.successRate}%`} icon={CircleGauge} />
        <StatCard label="YouTube" value={data.renders.youtubeUploaded.toLocaleString()} detail="公開済みレンダー" icon={Video} tone="orange" />
        <StatCard label="Linked users" value={data.community.discordLinks.toLocaleString()} detail={`${data.community.osuAccounts} osu!アカウント · ${data.community.guilds}サーバー`} icon={Users} tone="slate" />
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,.8fr)]">
        <section className="cp-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e3e7ec] px-5 py-4"><div><h2 className="text-sm font-semibold">処理本数</h2><p className="mt-1 text-[11px] text-[#7d8795]">直近14日</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 font-mono text-[10px] font-semibold text-emerald-700">{data.renders.completed} completed</span></div>
          <div className="p-5">
            <div className="flex h-44 items-end gap-2 border-b border-[#e4e8ed] px-1">
              {data.trend.map((item) => (
                <div key={item.date} className="group flex h-full min-w-0 flex-1 items-end" title={`${item.date}: ${item.total}本`}>
                  <div className="relative w-full rounded-t-sm bg-[#dce9f8] transition hover:bg-[#b8d2f1]" style={{ height: `${Math.max(item.total ? 8 : 2, item.total / maxTrend * 100)}%` }}>
                    {item.failed ? <span className="absolute inset-x-0 bottom-0 bg-red-300" style={{ height: `${Math.max(4, item.failed / item.total * 100)}%` }} /> : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[9px] text-[#9098a5]"><span>{data.trend[0]?.date.slice(5)}</span><span>{data.trend.at(-1)?.date.slice(5)}</span></div>
          </div>
        </section>

        <section className="cp-panel overflow-hidden">
          <div className="border-b border-[#e3e7ec] px-5 py-4"><h2 className="text-sm font-semibold">ローカルリソース</h2><p className="mt-1 text-[11px] text-[#7d8795]">Renderer PC</p></div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <ResourceCard label="CPU" value={`${data.system.cpuPercent.toFixed(1)}%`} percent={data.system.cpuPercent} detail="プロセッサ使用率" icon={Cpu} />
            <ResourceCard label="GPU" value={data.system.gpuPercent === null ? "—" : `${data.system.gpuPercent.toFixed(1)}%`} percent={data.system.gpuPercent ?? 0} detail="3D / Compute / Encode" icon={Gauge} />
            <ResourceCard label="Memory" value={`${data.system.memoryPercent.toFixed(1)}%`} percent={data.system.memoryPercent} detail={`${formatBytes(data.system.memoryUsedBytes)} / ${formatBytes(data.system.memoryTotalBytes)}`} icon={MemoryStick} />
            <ResourceCard label="Disk" value={`${data.system.diskPercent.toFixed(1)}%`} percent={data.system.diskPercent} detail={`${formatBytes(data.system.diskUsedBytes)} / ${formatBytes(data.system.diskTotalBytes)}`} icon={HardDrive} />
          </div>
        </section>
      </div>

      <section className="cp-panel mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#e3e7ec] px-5 py-4"><div><h2 className="text-sm font-semibold">最近のレンダー</h2><p className="mt-1 text-[11px] text-[#7d8795]">クラウドキューと完了履歴</p></div><Disc3 className="size-4 text-[#7d8795]" /></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[0.08em] text-[#7d8795]"><tr><th className="px-5 py-3 font-semibold">Result</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Output</th><th className="px-4 py-3 font-semibold">Created</th></tr></thead>
            <tbody className="divide-y divide-[#e8ebef]">
              {data.recentJobs.map((job) => {
                const metadata = job.metadata ?? {};
                const title = [metadata.artist, metadata.title].filter(Boolean).join(" — ") || job.message;
                return <tr key={job.id} className="hover:bg-[#fbfcfd]"><td className="max-w-[480px] px-5 py-3"><p className="truncate font-medium text-[#242b35]">{title}</p><p className="mt-1 font-mono text-[9px] text-[#929aa6]">{job.id.slice(0, 8)} · {job.options.resolution} / {job.options.fps}fps</p></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 font-mono text-[9px] font-semibold uppercase ${job.status === "completed" ? "bg-emerald-50 text-emerald-700" : job.status === "failed" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>{job.status}</span></td><td className="px-4 py-3">{job.videoUrl ? <a href={job.videoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#0051c3] hover:underline">開く <ExternalLink className="size-3" /></a> : <span className="text-[#9aa1ac]">—</span>}</td><td className="px-4 py-3 text-[#667184]">{formatDate(job.createdAt)}</td></tr>;
              })}
              {!data.recentJobs.length ? <tr><td colSpan={4} className="px-5 py-12 text-center text-[#8b94a1]">まだレンダー履歴がありません。</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="cp-panel flex items-center gap-3 p-4"><Database className="size-5 text-[#0051c3]" /><div><p className="text-xs font-semibold">Neon DB</p><p className="mt-1 text-[10px] text-[#7d8795]">詳細はデータベース画面</p></div></div>
        <div className="cp-panel flex items-center gap-3 p-4"><CheckCircle2 className="size-5 text-emerald-600" /><div><p className="text-xs font-semibold">ローカル動画 {data.renders.localVideoCount}本</p><p className="mt-1 text-[10px] text-[#7d8795]">{formatBytes(data.renders.localVideoBytes)} 使用中</p></div></div>
        <div className="cp-panel flex items-center gap-3 p-4"><Activity className="size-5 text-[#f48120]" /><div><p className="text-xs font-semibold">Config v{data.renderer.configurationVersion}</p><p className="mt-1 text-[10px] text-[#7d8795]">{data.renderer.restartRequired ? "再起動待ち" : "同期済み"}</p></div></div>
      </section>
    </div>
  );
}

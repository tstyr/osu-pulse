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
import Link from "next/link";
import useSWR from "swr";
import { liveRequestOptions, requestJson } from "@/lib/client/request-json";
import { RefreshNotice } from "@/components/control-panel/refresh-notice";
import { formatRenderTime, isRenderTerminal, renderPhase, youtubeOutcome } from "./render-presentation";

import type { DashboardOverview } from "@/lib/control/dashboard";

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

function formatDate(value: string | null) {
  return formatRenderTime(value);
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

function ResourceCard({ label, value, percent, detail, icon: Icon, available = true }: {
  label: string;
  value: string;
  percent: number;
  detail: string;
  icon: typeof Cpu;
  available?: boolean;
}) {
  const safePercent = Math.max(0, Math.min(100, percent));
  return (
    <div className="rounded-lg border border-[#e0e4ea] bg-white p-4">
      <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-semibold text-[#394354]"><Icon className="size-4 text-[#637084]" /> {label}</span><span className="font-mono text-sm font-semibold">{available ? value : "—"}</span></div>
      {available ? <div className="cp-meter mt-3"><span style={{ width: `${safePercent}%`, background: safePercent >= 90 ? "#dc3d43" : safePercent >= 75 ? "#f48120" : undefined }} /></div> : <p className="mt-3 text-[11px] text-amber-800">現在の値を取得できません</p>}
      <p className="mt-2 text-[10px] text-[#8a94a3]">{detail}</p>
    </div>
  );
}

export function OverviewDashboard({ initial }: { initial: DashboardOverview }) {
  const { data = initial, error, isValidating: refreshing, mutate } = useSWR<DashboardOverview>(
    "/api/control/overview", requestJson,
    { ...liveRequestOptions, fallbackData: initial, refreshInterval: 5_000 },
  );
  const refresh = () => mutate().catch(() => undefined);

  const maxTrend = Math.max(1, ...data.trend.map((item) => item.total));
  const storageMissing = data.renderer.storage.available === false || data.renderer.storage.songsAvailable === false || data.renderer.storage.outputAvailable === false;
  const youtubeReauth = data.renderer.youtube.authStatus === "reauthorization_required";
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Live overview</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">システム概要</h1><p className="mt-1 text-sm text-[#6f7a8c]">レンダー、ストレージ、DBの現在地を画面表示中は5秒ごとに更新します。</p></div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d5dae2] bg-white px-3 text-xs font-medium text-[#4f5a6b] hover:bg-[#f7f8f9]"><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /> 更新</button>
      </div>

      <RefreshNotice error={error} retry={() => { void refresh(); }} />
      {storageMissing ? <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-xs leading-5 text-red-800"><p className="font-semibold">USB保存先に接続できません · レンダー開始を保留中</p><p className="mt-1">USBのSongsフォルダ・動画保存先が利用できません。ドライブ文字／マウントを復旧してください。受付済みのジョブは待機列を確認し、重複追加しないでください。</p><Link href="/dashboard/render" className="mt-2 inline-block font-semibold underline">レンダーの接続・待機列を見る</Link></div> : !data.renderer.online ? <div role="status" className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">Rendererとの通信がありません。PC側のRendererを起動してください。リソースの値は現在の使用率ではありません。最終通信：{formatDate(data.renderer.lastSeenAt)} JST。<Link href="/dashboard/operations" className="ml-2 font-semibold underline">サービス・ログ</Link></div> : null}
      {youtubeReauth ? <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><p className="font-semibold">YouTubeの再認証が必要です · 未投稿 {data.renderer.youtube.pendingCount}本</p><p className="mt-1">Googleの認証が失効しています。PC側でGoogleの認証をやり直してください。レンダーが完成していても、自動投稿は完了していません。</p>{data.renderer.youtube.lastError ? <details className="mt-2"><summary className="cursor-pointer">最新の投稿エラー</summary><p className="mt-1 break-words font-mono text-[10px]">{data.renderer.youtube.lastError}</p></details> : null}<Link href="/dashboard/settings" className="mt-2 inline-block font-semibold underline">YouTube設定を確認</Link></div> : null}
      {data.renderer.restartRequired ? <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">設定を受信しました。実行中の処理が終わるとRendererが自動再起動して反映します。</div> : null}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Renderer" value={storageMissing ? "保存先エラー" : data.renderer.online ? data.renderer.status === "degraded" ? "要確認" : "接続中" : "停止・未接続"} detail={data.renderer.online ? `${data.renderer.activeCount}/${data.renderer.capacity} 実行中 · ${String(data.renderer.encoder)}` : `最終通信 ${formatDate(data.renderer.lastSeenAt)} JST`} icon={Cloud} tone={storageMissing ? "orange" : data.renderer.online ? "green" : "slate"} />
        <StatCard label="Render jobs" value={data.renders.total.toLocaleString()} detail={`${data.renders.active} 処理中 · 成功率 ${data.renders.successRate}%`} icon={CircleGauge} />
        <StatCard label="YouTube 投稿済み" value={data.renders.youtubeUploaded.toLocaleString()} detail={!data.renderer.online ? "投稿台帳 · 認証はRenderer接続後に確認" : `${data.renderer.youtube.pendingCount}本 未投稿 · ${youtubeReauth ? "再認証が必要" : !data.renderer.youtube.enabled ? "自動投稿OFF" : !data.renderer.youtube.configured ? "未設定" : "認証未確認"}`} icon={Video} tone="orange" />
        <StatCard label="Linked users" value={data.community.discordLinks.toLocaleString()} detail={`${data.community.osuAccounts} osu!アカウント · ${data.community.guilds}サーバー`} icon={Users} tone="slate" />
      </section>

      <section className="mt-4 grid gap-2 sm:grid-cols-3" aria-label="レンダー管理のショートカット">{[{ href: "/dashboard/render", label: "レンダー・待機列", detail: `${data.renderer.cloudQueue}件 受付済み・処理中` }, { href: "/dashboard/videos", label: "投稿済み動画", detail: "YouTubeリンク・保存後の整理" }, { href: "/dashboard/operations", label: "サービス・ログ", detail: "Bot / Rendererの状態を確認" }].map((item) => <Link key={item.href} href={item.href} className="rounded-md border border-[#dce2eb] bg-white p-3 hover:bg-[#f7faff]"><p className="text-xs font-semibold text-[#0051c3]">{item.label}</p><p className="mt-1 text-[10px] text-[#7d8795]">{item.detail}</p></Link>)}</section>
      {data.renderer.startPolicy.allowed === false ? <p className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">自動レンダーは許可時間・PCのアイドル条件を待っています。手動レンダーは対象外です。{data.renderer.startPolicy.reason ? <span className="mt-1 block font-mono text-[10px] text-blue-700">{data.renderer.startPolicy.reason}</span> : null}</p> : null}

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
            <ResourceCard label="CPU" value={`${data.system.cpuPercent.toFixed(1)}%`} percent={data.system.cpuPercent} available={data.renderer.online} detail="プロセッサ使用率" icon={Cpu} />
            <ResourceCard label="GPU" value={data.system.gpuPercent === null ? "—" : `${data.system.gpuPercent.toFixed(1)}%`} percent={data.system.gpuPercent ?? 0} available={data.renderer.online && data.system.gpuPercent !== null} detail="3D / Compute / Encode" icon={Gauge} />
            <ResourceCard label="Memory" value={`${data.system.memoryPercent.toFixed(1)}%`} percent={data.system.memoryPercent} available={data.renderer.online} detail={data.renderer.online ? `${formatBytes(data.system.memoryUsedBytes)} / ${formatBytes(data.system.memoryTotalBytes)}` : "Renderer接続後に取得"} icon={MemoryStick} />
            <ResourceCard label="Disk" value={`${data.system.diskPercent.toFixed(1)}%`} percent={data.system.diskPercent} available={data.renderer.online && data.system.diskAvailable !== false && !storageMissing} detail={data.system.diskAvailable === false || storageMissing ? "USB保存先に接続できません" : data.renderer.online ? `${formatBytes(data.system.diskUsedBytes)} / ${formatBytes(data.system.diskTotalBytes)}` : "Renderer接続後に取得"} icon={HardDrive} />
          </div>
        </section>
      </div>

      <section className="cp-panel mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#e3e7ec] px-5 py-4"><div><h2 className="text-sm font-semibold">最近のレンダー</h2><p className="mt-1 text-[11px] text-[#7d8795]">クラウドキューと完了履歴</p></div><Disc3 className="size-4 text-[#7d8795]" /></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-[#fafbfc] text-[10px] tracking-[0.08em] text-[#7d8795]"><tr><th className="px-5 py-3 font-semibold">リザルト</th><th className="px-4 py-3 font-semibold">レンダー段階</th><th className="px-4 py-3 font-semibold">動画・YouTube投稿</th><th className="px-4 py-3 font-semibold">受付日時 (JST)</th></tr></thead>
            <tbody className="divide-y divide-[#e8ebef]">
              {data.recentJobs.map((job) => {
                const metadata = job.metadata ?? {};
                const title = [metadata.artist, metadata.title].filter(Boolean).join(" — ") || job.message;
                const phase = renderPhase(job);
                const youtube = youtubeOutcome(job);
                return <tr key={job.id} className="hover:bg-[#fbfcfd]"><td className="max-w-[380px] px-5 py-3"><p className="truncate font-medium text-[#242b35]" title={title}>{title}</p><p className="mt-1 font-mono text-[9px] text-[#929aa6]">{job.id.slice(0, 8)} · {job.options.resolution} / {job.options.fps}fps</p><p className={`mt-2 line-clamp-2 text-[11px] leading-5 ${job.error ? "text-red-700" : "text-[#7d8795]"}`} title={job.error ?? job.message}>{job.error ?? job.message}</p>{job.errorCode ? <p className="mt-1 font-mono text-[9px] text-red-700">{job.errorCode}</p> : null}</td><td className="px-4 py-3"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${phase.tone}`}>{phase.label}{!isRenderTerminal(job.status) ? ` ${phase.progress}%` : ""}</span><p className="mt-2 text-[9px] leading-4 text-[#929aa6]">報告 {formatDate(job.updatedAt)}</p></td><td className="max-w-64 px-4 py-3"><p className={`text-[10px] font-medium ${youtube.kind === "failed" ? "text-amber-800" : youtube.kind === "uploaded" ? "text-emerald-700" : "text-[#7d8795]"}`}>{job.status === "cancelled" ? "投稿なし" : youtube.label}</p>{youtube.error ? <details className="mt-2 text-[10px] leading-5 text-amber-800"><summary className="cursor-pointer">投稿エラーを見る</summary><p className="mt-1 break-words">{youtube.error}</p><Link href="/dashboard/settings" className="underline">設定・認証を確認</Link></details> : null}{youtube.url || job.videoUrl ? <a href={youtube.url ?? job.videoUrl!} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[#0051c3] hover:underline">{youtube.url ? "YouTubeで開く" : "保存済み動画"} <ExternalLink className="size-3" /></a> : null}</td><td className="whitespace-nowrap px-4 py-3 text-[#667184]">{formatDate(job.createdAt)}</td></tr>;
              })}
              {!data.recentJobs.length ? <tr><td colSpan={4} className="px-5 py-12 text-center text-[#8b94a1]">まだレンダー履歴がありません。</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="cp-panel flex items-center gap-3 p-4"><Database className="size-5 text-[#0051c3]" /><div><p className="text-xs font-semibold">{data.databaseProvider}</p><p className="mt-1 text-[10px] text-[#7d8795]">詳細はデータベース画面</p></div></div>
        <div className="cp-panel flex items-center gap-3 p-4"><CheckCircle2 className={`size-5 ${storageMissing ? "text-amber-600" : "text-emerald-600"}`} /><div><p className="text-xs font-semibold">{storageMissing ? "ローカル動画：保存先に接続できません" : !data.renderer.online ? "ローカル動画：Renderer未接続" : `ローカル動画 ${data.renders.localVideoCount}本`}</p><p className="mt-1 text-[10px] text-[#7d8795]">{storageMissing || !data.renderer.online ? "0本・0 Bではなく、取得できない状態です" : `${formatBytes(data.renders.localVideoBytes)} 使用中`}</p></div></div>
        <div className="cp-panel flex items-center gap-3 p-4"><Activity className="size-5 text-[#f48120]" /><div><p className="text-xs font-semibold">Config v{data.renderer.configurationVersion}</p><p className="mt-1 text-[10px] text-[#7d8795]">{data.renderer.restartRequired ? "再起動待ち" : "同期済み"}</p></div></div>
      </section>
    </div>
  );
}

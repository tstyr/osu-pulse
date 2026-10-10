"use client";

import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleGauge,
  Cloud,
  Cpu,
  Database,
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
import styles from "./overview.module.css";

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
  return (
    <div className={styles.metric} data-tone={tone}>
      <p className={styles.metricLabel}><Icon aria-hidden="true" />{label}</p>
      <p className={styles.metricValue}>{value}</p>
      <p className={styles.metricDetail}>{detail}</p>
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
    <div className={styles.resource}>
      <div className={styles.resourceTitle}><span><Icon aria-hidden="true" /> {label}</span><span>{available ? value : "—"}</span></div>
      {available ? <div className={styles.meter}><span style={{ width: `${safePercent}%`, background: safePercent >= 90 ? "#dc3d43" : safePercent >= 75 ? "#b77a39" : undefined }} /></div> : <p>現在の値を取得できません</p>}
      <p>{detail}</p>
    </div>
  );
}

export function OverviewDashboard({ initial }: { initial: DashboardOverview }) {
  const { data = initial, error, isValidating: refreshing, mutate } = useSWR<DashboardOverview>(
    "/api/control/overview", requestJson,
    { ...liveRequestOptions, fallbackData: initial, refreshInterval: 5_000 },
  );
  const refresh = () => mutate().catch(() => undefined);

  const maxTrend = Math.max(2, Math.ceil(Math.max(0, ...data.trend.map((item) => item.total)) / 2) * 2);
  const storageMissing = data.renderer.storage.available === false || data.renderer.storage.songsAvailable === false || data.renderer.storage.outputAvailable === false;
  const youtubeReauth = data.renderer.youtube.authStatus === "reauthorization_required";
  return (
    <div>
      <div className={styles.heading}>
        <div><h1>システム概要</h1><p>レンダー、投稿、保存先の状態をまとめて確認。表示中は5秒ごとに更新します。</p></div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className={styles.refresh}><RefreshCw aria-hidden="true" className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /> 更新</button>
      </div>

      <RefreshNotice error={error} retry={() => { void refresh(); }} />
      {storageMissing ? <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-xs leading-5 text-red-800"><p className="font-semibold">USB保存先に接続できません · レンダー開始を保留中</p><p className="mt-1">USBのSongsフォルダ・動画保存先が利用できません。ドライブ文字／マウントを復旧してください。受付済みのジョブは待機列を確認し、重複追加しないでください。</p><Link href="/dashboard/render" className="mt-2 inline-block font-semibold underline">レンダーの接続・待機列を見る</Link></div> : !data.renderer.online ? <div role="status" className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">Rendererとの通信がありません。PC側のRendererを起動してください。リソースの値は現在の使用率ではありません。最終通信：{formatDate(data.renderer.lastSeenAt)} JST。<Link href="/dashboard/operations" className="ml-2 font-semibold underline">サービス・ログ</Link></div> : null}
      {youtubeReauth ? <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><p className="font-semibold">YouTubeの再認証が必要です · 未投稿 {data.renderer.youtube.pendingCount}本</p><p className="mt-1">Googleの認証が失効しています。PC側でGoogleの認証をやり直してください。レンダーが完成していても、自動投稿は完了していません。</p>{data.renderer.youtube.lastError ? <details className="mt-2"><summary className="cursor-pointer">最新の投稿エラー</summary><p className="mt-1 break-words font-mono text-[10px]">{data.renderer.youtube.lastError}</p></details> : null}<Link href="/dashboard/settings" className="mt-2 inline-block font-semibold underline">YouTube設定を確認</Link></div> : null}
      {data.renderer.restartRequired ? <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">設定を受信しました。実行中の処理が終わるとRendererが自動再起動して反映します。</div> : null}

      <section className={styles.metrics} aria-label="システムの主要指標">
        <StatCard label="Renderer" value={storageMissing ? "保存先エラー" : data.renderer.online ? data.renderer.status === "degraded" ? "要確認" : "接続中" : "停止・未接続"} detail={data.renderer.online ? `${data.renderer.activeCount}/${data.renderer.capacity} 実行中 · ${String(data.renderer.encoder)}` : `最終通信 ${formatDate(data.renderer.lastSeenAt)} JST`} icon={Cloud} tone={storageMissing ? "orange" : data.renderer.online ? "green" : "slate"} />
        <StatCard label="レンダー総数" value={data.renders.total.toLocaleString()} detail={`${data.renders.active} 処理中 · 成功率 ${data.renders.successRate}%`} icon={CircleGauge} />
        <StatCard label="YouTube 投稿済み" value={data.renders.youtubeUploaded.toLocaleString()} detail={!data.renderer.online ? "投稿台帳 · 認証はRenderer接続後に確認" : `${data.renderer.youtube.pendingCount}本 未投稿 · ${youtubeReauth ? "再認証が必要" : !data.renderer.youtube.enabled ? "自動投稿OFF" : !data.renderer.youtube.configured ? "未設定" : "認証未確認"}`} icon={Video} tone={youtubeReauth ? "orange" : "slate"} />
        <StatCard label="Discord連携ユーザー" value={data.community.discordLinks.toLocaleString()} detail={`${data.community.osuAccounts} osu!アカウント · ${data.community.guilds}サーバー`} icon={Users} tone="slate" />
      </section>

      <section className={styles.shortcuts} aria-label="レンダー管理のショートカット">{[{ href: "/dashboard/render", label: "レンダー・待機列", detail: `${data.renderer.cloudQueue}件 受付済み・処理中` }, { href: "/dashboard/videos", label: "投稿済み動画", detail: "YouTubeリンク・保存後の整理" }, { href: "/dashboard/operations", label: "サービス・ログ", detail: "Bot / Rendererの状態を確認" }].map((item) => <Link key={item.href} href={item.href} prefetch={false} className={styles.shortcut}><div><strong>{item.label}</strong><p>{item.detail}</p></div><ArrowRight aria-hidden="true" /></Link>)}</section>
      {data.renderer.startPolicy.allowed === false ? <p className={styles.policyNotice}>自動レンダーは許可時間・PCのアイドル条件を待っています。手動レンダーは対象外です。{data.renderer.startPolicy.reason ? <span>{data.renderer.startPolicy.reason}</span> : null}</p> : null}

      <div className={styles.columns}>
        <section className="cp-panel overflow-hidden">
          <div className={styles.sectionHead}><div><h2>レンダー処理の推移</h2><p>直近14日 · 単位：本</p></div><span>累計完了 {data.renders.completed.toLocaleString()}本</span></div>
          <div>
            <div className={styles.chart} role="img" aria-label={`直近14日のレンダー総数 ${data.trend.reduce((sum, item) => sum + item.total, 0)}本。赤は失敗した処理です。`}>
              {[0, 0.5, 1].map((fraction) => <div key={fraction} className={styles.gridLine} style={{ bottom: `${fraction * 100}%` }}><span>{Number((maxTrend * fraction).toFixed(1))}</span></div>)}
              <div className={styles.bars}>
              {data.trend.map((item) => (
                <div key={item.date} className={styles.barSlot} title={`${item.date}: ${item.total}本 / 失敗 ${item.failed}本`}>
                  <div className={styles.bar} data-empty={item.total === 0 ? "true" : undefined} style={{ height: `${item.total / maxTrend * 100}%` }}>
                    {item.failed && item.total > 0 ? <span className={styles.barFailed} style={{ height: `${item.failed / item.total * 100}%` }} /> : null}
                  </div>
                </div>
              ))}
              </div>
            </div>
            <div className={styles.chartDates}><span>{data.trend[0]?.date.slice(5)}</span><span>{data.trend.at(-1)?.date.slice(5)}</span></div>
            <div className={styles.chartFoot}><span><i aria-hidden="true" />処理総数</span><span className={styles.failureKey}><i aria-hidden="true" />失敗</span>{data.trend.every((item) => item.total === 0) ? <p>この期間のレンダー記録はありません。</p> : null}</div>
          </div>
        </section>

        <section className="cp-panel overflow-hidden">
          <div className={styles.sectionHead}><div><h2>レンダーPCのリソース</h2><p>Oracle側の指標は性能履歴で確認できます</p></div><Link href="/dashboard/performance" prefetch={false}>履歴へ</Link></div>
          <div className={styles.resources}>
            <ResourceCard label="CPU" value={`${data.system.cpuPercent.toFixed(1)}%`} percent={data.system.cpuPercent} available={data.renderer.online} detail="プロセッサ使用率" icon={Cpu} />
            <ResourceCard label="GPU" value={data.system.gpuPercent === null ? "—" : `${data.system.gpuPercent.toFixed(1)}%`} percent={data.system.gpuPercent ?? 0} available={data.renderer.online && data.system.gpuPercent !== null} detail="3D / Compute / Encode" icon={Gauge} />
            <ResourceCard label="Memory" value={`${data.system.memoryPercent.toFixed(1)}%`} percent={data.system.memoryPercent} available={data.renderer.online} detail={data.renderer.online ? `${formatBytes(data.system.memoryUsedBytes)} / ${formatBytes(data.system.memoryTotalBytes)}` : "Renderer接続後に取得"} icon={MemoryStick} />
            <ResourceCard label="Disk" value={`${data.system.diskPercent.toFixed(1)}%`} percent={data.system.diskPercent} available={data.renderer.online && data.system.diskAvailable !== false && !storageMissing} detail={data.system.diskAvailable === false || storageMissing ? "USB保存先に接続できません" : data.renderer.online ? `${formatBytes(data.system.diskUsedBytes)} / ${formatBytes(data.system.diskTotalBytes)}` : "Renderer接続後に取得"} icon={HardDrive} />
          </div>
        </section>
      </div>

      <section className="cp-panel mt-5 overflow-hidden">
        <div className={styles.sectionHead}><div><h2>最近のレンダー</h2><p>クラウドキューと完了履歴</p></div><Link href="/dashboard/render" prefetch={false}>すべて見る →</Link></div>
        <div className="overflow-x-auto">
          <table className={styles.table}>
            <thead><tr><th scope="col">リザルト</th><th scope="col">レンダー段階</th><th scope="col">動画・YouTube投稿</th><th scope="col">受付日時 (JST)</th></tr></thead>
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

      <section className={styles.footer} aria-label="保存先と設定の補足">
        <div className={styles.footerItem}><Database aria-hidden="true" /><div><p>{data.databaseProvider}</p><p>詳細はデータベース画面</p></div></div>
        <div className={styles.footerItem}><CheckCircle2 aria-hidden="true" /><div><p>{storageMissing ? "ローカル動画：保存先に接続できません" : !data.renderer.online ? "ローカル動画：Renderer未接続" : `ローカル動画 ${data.renders.localVideoCount}本`}</p><p>{storageMissing || !data.renderer.online ? "保存先への接続後に容量を取得します" : `${formatBytes(data.renders.localVideoBytes)} 使用中`}</p></div></div>
        <div className={styles.footerItem}><Activity aria-hidden="true" /><div><p>設定バージョン {data.renderer.configurationVersion}</p><p>{data.renderer.restartRequired ? "再起動待ち" : "同期済み"}</p></div></div>
      </section>
    </div>
  );
}

"use client";

import {
  AlertCircle,
  CheckCircle2,
  CircleStop,
  CloudUpload,
  ExternalLink,
  FileUp,
  Film,
  LoaderCircle,
  Play,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import useSWR from "swr";
import { liveRequestOptions, RequestError, requestJson } from "@/lib/client/request-json";
import { RefreshNotice } from "@/components/control-panel/refresh-notice";
import { formatRenderTime, isRenderTerminal, missingRenderDependencies, readRenderResponse, renderOperationError, renderPhase, renderPollingInterval, renderRuntimeHealth, youtubeOutcome } from "./render-presentation";

import type { CloudRenderOptions } from "@/db/schema";
import { WEB_REPLAY_MAX_BYTES, type CloudRenderStatus } from "@/lib/render/constants";

type RenderDefaults = CloudRenderOptions;
type RenderJob = {
  jobId: string;
  status: CloudRenderStatus;
  progress: number;
  message: string;
  metadata: Record<string, unknown> | null;
  options: CloudRenderOptions;
  videoUrl: string | null;
  videoSize: number | null;
  error: string | null;
  errorCode: string | null;
  cancelRequested: boolean;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type RendererStatus = {
  online: boolean;
  status: string;
  busy: boolean;
  queueSize: number;
  localQueueSize: number;
  dependencies: Record<string, unknown>;
  configurationVersion: number;
  restartRequired: boolean;
  lastSeenAt: string | null;
};

const JOB_STORAGE = "osu-pulse-control-render-job:v1";
const JOB_STORAGE_VERSION = 1;

function loadStoredJob() {
  try {
    const stored = sessionStorage.getItem(JOB_STORAGE);
    if (!stored) return null;
    const saved = JSON.parse(stored) as { version?: number; jobId?: string; jobToken?: string };
    if (saved.version !== JOB_STORAGE_VERSION || !saved.jobId || !saved.jobToken) return null;
    return { jobId: saved.jobId, jobToken: saved.jobToken };
  } catch {
    return null;
  }
}

function storeJob(jobId: string, jobTokenValue: string) {
  try {
    sessionStorage.setItem(JOB_STORAGE, JSON.stringify({
      version: JOB_STORAGE_VERSION,
      jobId,
      jobToken: jobTokenValue,
    }));
  } catch {
    // The active tab can still track the job when storage is unavailable.
  }
}

function clearStoredJob() {
  try {
    sessionStorage.removeItem(JOB_STORAGE);
  } catch {
    // Storage can be disabled by the browser.
  }
}

function formatBytes(value: number | null) {
  if (!value) return "";
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function resultName(metadata: Record<string, unknown> | null) {
  if (!metadata) return null;
  const values = [metadata.artist, metadata.title].filter((value): value is string => typeof value === "string" && Boolean(value));
  const difficulty = typeof metadata.difficulty === "string" ? ` [${metadata.difficulty}]` : "";
  return values.length ? `${values.join(" — ")}${difficulty}` : null;
}

async function readJob([url, token]: readonly [string, string]): Promise<{ job: RenderJob }> {
  try {
    const response = await fetch(url, {
      headers: { "X-Render-Job-Token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await readRenderResponse<{ job: RenderJob }>(response, "ジョブ状態を取得できません。");
    if (!payload.job?.jobId) throw new RequestError("ジョブの応答を確認できませんでした。状態を再取得してください。", 502);
    return payload;
  } catch (caught) {
    if (caught instanceof RequestError) throw caught;
    throw new RequestError("進捗を取得できませんでした。表示は最後の報告です。接続を確認して状態を更新してください。", caught instanceof Error && caught.name === "TimeoutError" ? 408 : 0);
  }
}

export function WebRenderConsole({ defaults }: { defaults: RenderDefaults }) {
  const [mode, setMode] = useState<"score_url" | "replay">("score_url");
  const [trackedJob, setTrackedJob] = useState<{ jobId: string; jobToken: string; initial?: RenderJob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedReplay, setSelectedReplay] = useState<{ name: string; size: number } | null>(null);
  const rendererQuery = useSWR<RendererStatus>("/api/render/status", requestJson, {
    ...liveRequestOptions,
    refreshInterval: 10_000,
  });
  const progress = useSWR<{ job: RenderJob }>(
    trackedJob ? [`/api/render/jobs/${encodeURIComponent(trackedJob.jobId)}`, trackedJob.jobToken] as const : null,
    readJob,
    {
      ...liveRequestOptions,
      keepPreviousData: false,
      fallbackData: trackedJob?.initial ? { job: trackedJob.initial } : undefined,
      refreshInterval: (data) => renderPollingInterval(data?.job),
      shouldRetryOnError: (caught) => !(caught instanceof RequestError && [401, 403, 404].includes(caught.status)),
    },
  );
  const renderer = rendererQuery.data;
  const checking = rendererQuery.isValidating;
  const job = progress.data?.job ?? trackedJob?.initial ?? null;
  const runtimeHealth = renderRuntimeHealth(renderer?.dependencies ?? {});
  const missingDependencies = missingRenderDependencies(renderer?.dependencies ?? {});
  const checkRenderer = () => rendererQuery.mutate().catch(() => undefined);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      const saved = loadStoredJob();
      if (saved) setTrackedJob(saved);
    }, 0);
    return () => window.clearTimeout(initialize);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || runtimeHealth.storageAvailable === false || (trackedJob && (progress.isLoading || (job && !isRenderTerminal(job.status))))) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      let response: Response;
      if (mode === "score_url") {
        response = await fetch("/api/render/jobs", {
          method: "POST",
          signal: AbortSignal.timeout(60_000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "score_url",
            url: form.get("url"),
            resolution: form.get("resolution"),
            fps: form.get("fps"),
            speed: form.get("speed"),
            motionBlur: form.get("motionBlur") === "on",
            highlight: form.get("highlight") === "on",
            scheduledAt: form.get("scheduledAt") ? new Date(String(form.get("scheduledAt"))).toISOString() : null,
          }),
        });
      } else {
        const replay = form.get("replay");
        if (!(replay instanceof File) || !replay.name.toLowerCase().endsWith(".osr")) throw new Error(".osrファイルを選択してください。");
        if (!replay.size || replay.size > WEB_REPLAY_MAX_BYTES) throw new Error(".osrは空でない3 MB以下のファイルを選択してください。");
        form.set("type", "replay");
        response = await fetch("/api/render/jobs", { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
      }
      const payload = await readRenderResponse<{ job: RenderJob; jobToken: string }>(response, "レンダーを開始できませんでした。");
      const nextJob = payload.job;
      const nextToken = payload.jobToken;
      if (!nextJob?.jobId || typeof nextToken !== "string" || !nextToken) throw new Error("受付結果を確認できません。待機列を更新してから再試行してください。");
      setTrackedJob({ jobId: nextJob.jobId, jobToken: nextToken, initial: nextJob });
      storeJob(nextJob.jobId, nextToken);
      await checkRenderer();
    } catch (caught) {
      setError(renderOperationError(caught, "レンダーを開始できませんでした。"));
    } finally {
      setBusy(false);
    }
  }

  async function cancelJob() {
    if (!job || !trackedJob) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/render/jobs/${encodeURIComponent(job.jobId)}`, {
        method: "DELETE",
        headers: { "X-Render-Job-Token": trackedJob.jobToken },
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await readRenderResponse<{ job: RenderJob }>(response, "キャンセルできませんでした。");
      if (!payload.job?.jobId) throw new Error("キャンセル結果を確認できません。ジョブの状態を更新してください。");
      await progress.mutate({ job: payload.job }, { revalidate: false });
    } catch (caught) {
      setError(renderOperationError(caught, "キャンセルできませんでした。"));
    } finally {
      setBusy(false);
    }
  }

  const running = Boolean(job && !isRenderTerminal(job.status));
  const phase = job ? renderPhase(job) : null;
  const youtube = job ? youtubeOutcome(job) : null;
  const submitBlockReason = busy ? "操作を送信しています。" : trackedJob && progress.isLoading ? "前回のジョブを確認しています。" : running ? "この画面で追跡中のジョブがあります。複数追加は下の一括レンダーをご利用ください。" : runtimeHealth.storageAvailable === false ? "USB保存先に接続できません。Songs・動画保存先を復旧してから接続更新してください。" : !renderer ? rendererQuery.error ? "Rendererの状態を取得できません。接続更新をお試しください。" : "Rendererとの接続を確認しています。" : !renderer.online ? "このPCのRendererを起動し、接続更新してください。" : null;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Replay renderer</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">レンダーを開始</h1><p className="mt-1 text-sm text-[#6f7a8c]">Botを起動していなくても利用できます。手動レンダーはスマート実行時間の対象外で、いつでも開始します。</p></div>
        <button type="button" onClick={() => void checkRenderer()} disabled={checking} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d5dae2] bg-white px-3 text-xs font-medium text-[#4f5a6b] hover:bg-[#f7f8f9]"><RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} /> 接続更新</button>
      </div>

      <RefreshNotice error={rendererQuery.error} retry={() => { void checkRenderer(); }} />
      <RefreshNotice error={progress.error} retry={() => {
        if (progress.error instanceof RequestError && progress.error.status === 404) {
          clearStoredJob();
          setTrackedJob(null);
        } else {
          void progress.mutate().catch(() => undefined);
        }
      }} />

      {runtimeHealth.storageAvailable === false ? <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-xs leading-5 text-red-800"><p className="font-semibold">USB保存先に接続できません</p><p className="mt-1">{runtimeHealth.songsAvailable === false ? "Songsフォルダ " : ""}{runtimeHealth.outputAvailable === false ? "動画保存先 " : ""}が利用できません。USBの接続・マウント先を確認し、復旧後に「接続更新」を押してください。受付済みのジョブを重複して追加する必要はありません。</p></div> : null}
      {runtimeHealth.youtubeAuthStatus === "reauthorization_required" ? <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><p className="font-semibold">YouTubeの再認証が必要です</p><p className="mt-1">Googleの認証が失効しているため、自動投稿できません。PC側でGoogleの認証手続きを再実行してください。{runtimeHealth.youtubePendingCount !== null ? ` 未投稿 ${runtimeHealth.youtubePendingCount}本。` : ""}再レンダーする前に認証を復旧してください。</p><Link href="/dashboard/settings" className="mt-2 inline-block font-semibold underline underline-offset-2">YouTube設定を確認</Link></div> : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="cp-panel overflow-hidden">
          <div className="border-b border-[#e2e6eb] px-5 py-4"><div className="flex items-center gap-2 text-sm font-semibold"><CloudUpload className="size-4 text-[#0051c3]" /> 新しいジョブ</div></div>
          <form onSubmit={submit} className="p-5 sm:p-6">
            <div className="mb-5 flex w-fit rounded-md border border-[#d8dde5] bg-[#f4f6f8] p-1">
              <button type="button" onClick={() => { setMode("score_url"); setSelectedReplay(null); }} className={`rounded px-4 py-2 text-xs font-medium ${mode === "score_url" ? "bg-white text-[#1f2732] shadow-sm" : "text-[#6f7a8c]"}`}>スコアURL</button>
              <button type="button" onClick={() => { if (mode !== "replay") setSelectedReplay(null); setMode("replay"); }} className={`rounded px-4 py-2 text-xs font-medium ${mode === "replay" ? "bg-white text-[#1f2732] shadow-sm" : "text-[#6f7a8c]"}`}>.osrファイル</button>
            </div>

            {mode === "score_url" ? (
              <label className="cp-label">osu! Score URL<input name="url" type="url" required placeholder="https://osu.ppy.sh/scores/1234567890" className="cp-input !h-11 font-mono" /></label>
            ) : (
              <label className="grid min-h-32 cursor-pointer place-items-center rounded-lg border border-dashed border-[#bdc5d0] bg-[#fafbfc] p-5 text-center hover:border-[#7da4d6] hover:bg-[#f6f9fd]">
                <input name="replay" type="file" accept=".osr,application/octet-stream" required className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; setSelectedReplay(file ? { name: file.name, size: file.size } : null); }} />
                <span className="min-w-0 max-w-full"><FileUp className="mx-auto size-5 text-[#0051c3]" /><span className="mt-2 block break-all text-xs font-semibold">{selectedReplay?.name ?? ".osrを選択"}</span><span className="mt-1 block text-[10px] text-[#7f8998]">{selectedReplay ? `${formatBytes(selectedReplay.size)} · クリックして変更` : "最大3 MB"}</span></span>
              </label>
            )}

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <label className="cp-label">解像度<select name="resolution" defaultValue={defaults.resolution} className="cp-select"><option>1920x1080</option><option>2560x1440</option><option>2560x1600</option><option>3840x2160</option></select></label>
              <label className="cp-label">フレームレート<select name="fps" defaultValue={String(defaults.fps)} className="cp-select"><option value="60">60 FPS</option><option value="120">120 FPS</option><option value="240">240 FPS</option></select></label>
              <label className="cp-label">再生速度<select name="speed" defaultValue={defaults.speed} className="cp-select"><option value="original">Original</option><option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1.0">1.0x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2.0">2.0x</option></select></label>
            </div>
            <label className="mt-4 flex items-center gap-2 text-xs font-medium text-[#4e596b]"><input name="motionBlur" type="checkbox" defaultChecked={defaults.motionBlur} className="size-4 accent-[#f48120]" /> Motion blurを使用</label>
            <label className="mt-2 flex items-center gap-2 text-xs font-medium text-[#4e596b]"><input name="highlight" type="checkbox" className="size-4 accent-[#f48120]" /> 終盤30秒のハイライトも生成</label>
            {mode === "score_url" ? <label className="cp-label mt-4">予約時刻（空欄ならすぐ開始）<input name="scheduledAt" type="datetime-local" className="cp-input" /></label> : null}
            <button type="submit" disabled={Boolean(submitBlockReason)} aria-describedby={submitBlockReason ? "render-submit-help" : undefined} className="cp-button-primary mt-6 w-full !min-h-11 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />} {busy ? "操作を送信中…" : "レンダーを開始"}</button>
            {submitBlockReason ? <p id="render-submit-help" className="mt-2 text-xs leading-5 text-[#697587]">{submitBlockReason}</p> : <p className="mt-2 text-[11px] leading-5 text-[#7d8795]">空き枠がなければ待機列に入ります。YouTube投稿には別途、有効な認証が必要です。</p>}
            {error ? <p role="alert" className="mt-4 flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700"><AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}</p> : null}
            <details className="mt-5 rounded-md border border-[#e2e6eb] px-3 py-2 text-xs leading-5 text-[#687386]"><summary className="cursor-pointer font-medium text-[#4f5a6b]">開始しない・進捗が止まって見える場合</summary><ul className="mt-2 list-disc space-y-1 pl-4"><li>RendererはPC上で起動する必要があります。Botだけの起動ではレンダーできません。</li><li>5%付近はリプレイ・譜面の準備です。下の待機列と現在のジョブの詳細メッセージを確認してください。</li><li>圧縮・アップロード中は進捗が均等には進みません。接続が続いている間は、すぐ再送しないでください。</li><li>通信エラー時は待機列を更新し、受付済みのジョブがあるか確認してください。</li></ul><div className="mt-3 flex flex-wrap gap-4"><Link href="/dashboard/operations" className="text-[#0051c3] underline">サービス・ログ</Link><Link href="/dashboard/settings" className="text-[#0051c3] underline">レンダー・YouTube設定</Link><Link href="/dashboard/videos" className="text-[#0051c3] underline">投稿済み動画</Link></div></details>
          </form>
        </section>

        <aside className="space-y-5">
          <section className="cp-panel p-5">
            <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Local Renderer</h2><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${runtimeHealth.storageAvailable === false ? "bg-red-50 text-red-700" : renderer?.online ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}><span className={`size-1.5 rounded-full ${runtimeHealth.storageAvailable === false ? "bg-red-500" : renderer?.online ? "bg-emerald-500" : "bg-slate-400"}`} /> {!renderer ? rendererQuery.error ? "取得できません" : "接続確認中" : runtimeHealth.storageAvailable === false ? "保存先エラー" : renderer.online ? renderer.status === "degraded" ? "要確認" : "接続中" : "停止・未接続"}</span></div>
            <dl className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-md bg-[#f6f8fa] p-3"><dt className="text-[10px] text-[#7d8795]">受付済み・処理中</dt><dd className="mt-1 font-mono text-lg font-semibold">{renderer?.queueSize ?? "—"}</dd></div><div className="rounded-md bg-[#f6f8fa] p-3"><dt className="text-[10px] text-[#7d8795]">実行状態</dt><dd className="mt-2 text-xs font-semibold">{renderer?.busy ? "処理中" : renderer?.online ? "待機中" : "—"}</dd></div></dl>
            <p className="mt-3 text-[10px] text-[#8a94a3]">Renderer最終通信：{formatRenderTime(renderer?.lastSeenAt)} JST</p>
            {renderer && !renderer.online ? <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-[#687386]">Rendererからの通信がありません。PC・USBの接続とRendererの起動状態を確認してください。受付済みジョブは待機列に残ります。</p> : null}
            {missingDependencies.length ? <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">要確認：{missingDependencies.join("、")}</p> : null}
            <div className="mt-3 border-t border-[#e2e6eb] pt-3 text-xs leading-5"><p className="font-medium">YouTube：{!renderer?.online ? "Renderer接続後に確認" : runtimeHealth.youtubeAuthStatus === "reauthorization_required" ? "再認証が必要" : runtimeHealth.youtubeEnabled === false ? "自動投稿OFF" : runtimeHealth.youtubeConfigured === false || runtimeHealth.youtubeAuthStatus === "not_configured" ? "未設定" : "認証未確認"}</p>{runtimeHealth.youtubePendingCount !== null ? <p className="mt-1 text-[11px] text-[#7d8795]">未投稿 {runtimeHealth.youtubePendingCount}本{runtimeHealth.youtubeNextRetryAt ? ` · 次回確認 ${formatRenderTime(runtimeHealth.youtubeNextRetryAt)} JST` : ""}</p> : null}{runtimeHealth.youtubeLastError ? <details className="mt-2 text-[11px] text-amber-800"><summary className="cursor-pointer">最新の投稿エラー</summary><p className="mt-1 break-words">{runtimeHealth.youtubeLastError}</p></details> : null}</div>
            {renderer?.restartRequired ? <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-800">設定反映のため再起動待ちです。</p> : null}
          </section>

          <section className="cp-panel overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-[#e2e6eb] px-5 py-4"><div className="flex items-center gap-2"><Film className="size-4 text-[#f48120]" /><h2 className="text-sm font-semibold">現在のジョブ</h2></div>{trackedJob ? <button type="button" aria-label="ジョブの状態を更新" disabled={progress.isValidating} onClick={() => void progress.mutate().catch(() => undefined)} className="rounded-md border border-[#d8dde5] p-1.5 text-[#687386] disabled:opacity-50"><RefreshCw className={`size-3.5 ${progress.isValidating ? "animate-spin" : ""}`} /></button> : null}</div>
            {!job || !phase || !youtube ? <div className="grid min-h-56 place-items-center p-6 text-center"><div>{trackedJob && progress.isLoading ? <LoaderCircle className="mx-auto size-6 animate-spin text-[#0051c3]" /> : <Film className="mx-auto size-6 text-[#bdc4cd]" />}<p className="mt-3 text-xs text-[#8a94a3]">{trackedJob && progress.isLoading ? "前回のジョブを確認中…" : "ジョブはありません"}</p></div></div> : (
              <div className="p-5">
                <div className="flex items-center justify-between gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${phase.tone}`}>{phase.label}</span><span className="font-mono text-xs font-semibold">{phase.progress}%</span></div>
                <div className="cp-meter mt-3" role="progressbar" aria-label={phase.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase.progress}><span style={{ width: `${phase.progress}%` }} /></div>
                <ol className="mt-3 grid grid-cols-5 gap-1 text-center text-[9px] leading-4">{["準備", "映像生成", "圧縮", "送信", "完了"].map((label, index) => <li key={label} className={`rounded px-1 py-1 ${phase.stage >= index ? "bg-blue-50 font-semibold text-blue-700" : "bg-[#f6f8fa] text-[#919aaa]"}`} aria-current={phase.stage === index ? "step" : undefined}>{label}</li>)}</ol>
                <p className="mt-3 text-xs leading-5 text-[#687386]">{phase.detail}</p>
                {running && renderer && !renderer.online ? <p className="mt-3 rounded-md bg-amber-50 p-3 text-xs leading-5 text-amber-800">Rendererの通信が途切れています。表示は最後に受信した進捗です。再送せず、Rendererを復旧してください。</p> : null}
                <p className={`mt-3 break-words text-xs leading-5 ${job.error ? "text-red-700" : "text-[#687386]"}`}>{job.error ?? job.message}</p>
                {job.errorCode ? <p className="mt-1 font-mono text-[10px] text-red-700">エラー：{job.errorCode}</p> : null}
                <p className="mt-2 font-mono text-[9px] leading-5 text-[#8a94a3]">Job {job.jobId.slice(0, 8)} · 最終報告 {formatRenderTime(job.updatedAt)} JST{job.scheduledAt ? ` · 予約 ${formatRenderTime(job.scheduledAt)} JST` : ""}</p>
                {resultName(job.metadata) ? <p className="mt-3 rounded-md bg-[#f6f8fa] p-3 text-[11px] leading-5 text-[#4f5a6b]">{resultName(job.metadata)}</p> : null}
                {job.status !== "cancelled" ? <div className={`mt-3 rounded-md border p-3 text-[11px] leading-5 ${youtube.kind === "failed" ? "border-amber-200 bg-amber-50 text-amber-900" : youtube.kind === "uploaded" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-[#e2e6eb] text-[#687386]"}`}><p className="font-semibold">{youtube.label}</p><p className="mt-1">{youtube.detail}</p>{youtube.error ? <p className="mt-2 break-words font-mono text-[10px]">{youtube.error}</p> : null}{["failed", "unconfirmed"].includes(youtube.kind) ? <Link href="/dashboard/settings" className="mt-2 inline-block font-semibold underline">YouTube設定・認証を確認</Link> : null}</div> : null}
                {job.status === "completed" && (youtube.url || job.videoUrl) ? <a href={youtube.url ?? job.videoUrl!} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-emerald-600 bg-emerald-600 px-2 text-xs font-semibold text-white hover:bg-emerald-700"><CheckCircle2 className="size-4" /> {youtube.url ? "YouTubeで開く" : "保存済み動画を開く"} {formatBytes(job.videoSize)} <ExternalLink className="size-3" /></a> : running ? <button type="button" onClick={() => void cancelJob()} disabled={busy || job.cancelRequested} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"><CircleStop className="size-3.5" /> {job.cancelRequested ? "キャンセル反映待ち" : "キャンセル"}</button> : null}
                {job.status === "failed" ? <p className="mt-3 text-[11px] leading-5 text-[#7d8795]">原因を解消してから左の入力内容で再実行できます。YouTube投稿だけが失敗した場合、再レンダーは不要です。</p> : null}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

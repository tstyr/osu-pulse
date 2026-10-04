"use client";

import { ChevronDown, ChevronUp, GitCompareArrows, GripVertical, Layers3, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { liveRequestOptions, requestJson } from "@/lib/client/request-json";
import { RefreshNotice } from "@/components/control-panel/refresh-notice";
import { moveQueuedJobBefore } from "@/lib/control/queue-order";
import { formatRenderTime, readRenderResponse, renderOperationError, renderPhase, renderSourceLabel } from "./render-presentation";

type QueueJob = {
  jobId: string;
  status: string;
  progress: number;
  message: string;
  priority: number;
  batchId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  scheduledAt: string | null;
  updatedAt?: string;
  requestSource?: string;
  error?: string | null;
  errorCode?: string | null;
  cancelRequested?: boolean;
};

function title(job: QueueJob) {
  const metadata = job.metadata ?? {};
  return [metadata.artist, metadata.title].filter(Boolean).join(" — ") || job.message;
}

export function RenderQueueManager({ initial, defaults }: {
  initial: QueueJob[];
  defaults: { resolution: string; fps: number; speed: string; motionBlur: boolean };
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [comparisonNotice, setComparisonNotice] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState(false);
  const [comparisonError, setComparisonError] = useState(false);

  const queue = useSWR<{ jobs: QueueJob[] }>("/api/render/queue", requestJson, {
    ...liveRequestOptions,
    fallbackData: { jobs: initial },
    refreshInterval: (data) => data?.jobs.length ? 5_000 : 15_000,
  });
  const jobs = queue.data?.jobs ?? initial;
  const queued = jobs.filter((job) => job.status === "queued");
  const refresh = () => queue.mutate();

  async function persistOrder(next: QueueJob[]) {
    setDragging(null);
    setBusy(true);
    setNotice(null);
    setNoticeError(false);
    try {
      // SWR discards an earlier polling response while this mutation is in progress.
      await queue.mutate(async () => {
        const response = await fetch("/api/render/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobIds: next.filter((job) => job.status === "queued").map((job) => job.jobId) }), signal: AbortSignal.timeout(30_000) });
        const payload = await readRenderResponse<{ jobs: QueueJob[] }>(response, "待機順の保存に失敗しました。");
        if (!Array.isArray(payload.jobs)) throw new Error("待機列の保存結果を確認できません。更新して確認してください。");
        return { jobs: payload.jobs };
      }, { optimisticData: { jobs: next }, rollbackOnError: true, revalidate: false });
    } catch (error) {
      setNoticeError(true);
      setNotice(renderOperationError(error, "待機順の保存に失敗しました。"));
    } finally { setBusy(false); }
  }

  async function moveBefore(targetId: string) {
    if (!dragging || dragging === targetId || busy) return;
    const next = moveQueuedJobBefore(jobs, dragging, targetId);
    if (!next) return;
    await persistOrder(next);
  }

  async function moveBy(jobId: string, direction: -1 | 1) {
    if (busy) return;
    const queued = jobs.filter((job) => job.status === "queued");
    const current = queued.findIndex((job) => job.jobId === jobId);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= queued.length) return;
    [queued[current], queued[target]] = [queued[target], queued[current]];
    let queuedIndex = 0;
    const next = jobs.map((job) => job.status === "queued" ? queued[queuedIndex++] : job);
    await persistOrder(next);
  }

  async function submitBatch(formData: FormData) {
    if (busy) return;
    const urls = String(formData.get("urls") ?? "").match(/https:\/\/osu\.ppy\.sh\/scores\/(?:osu\/|mania\/)?[1-9][0-9]{0,18}/gi) ?? [];
    if (!urls.length) { setNoticeError(true); setNotice("osu! Score URLを入力してください。"); return; }
    setBusy(true); setNotice(null); setNoticeError(false);
    try {
      const scheduled = String(formData.get("scheduledAt") ?? "");
      const response = await fetch("/api/render/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: [...new Set(urls)].slice(0, 20), ...defaults, highlight: formData.get("highlight") === "on", scheduledAt: scheduled ? new Date(scheduled).toISOString() : null }), signal: AbortSignal.timeout(60_000) });
      const payload = await readRenderResponse<{ jobs?: unknown[]; batchId?: string }>(response, "一括追加に失敗しました。");
      if (!Array.isArray(payload.jobs)) throw new Error("一括追加の受付結果を確認できません。待機列を更新してください。");
      setNotice(`${payload.jobs.length}件を追加しました。${payload.batchId ? `Batch ${payload.batchId.slice(0, 8)}` : ""}${new Set(urls).size > 20 ? "（先頭20件のみ受付）" : ""}`);
      await refresh().catch(() => undefined);
    } catch (error) { setNoticeError(true); setNotice(renderOperationError(error, "一括追加に失敗しました。")); }
    finally { setBusy(false); }
  }

  async function submitComparison(formData: FormData) {
    if (busy) return;
    setBusy(true); setComparisonNotice(null); setComparisonError(false);
    try {
      const response = await fetch("/api/render/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: formData.get("kind"), firstUrl: formData.get("firstUrl"), secondUrl: formData.get("secondUrl") }),
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await readRenderResponse<{ jobId?: string }>(response, "比較レンダーを追加できませんでした。");
      if (!payload.jobId) throw new Error("比較レンダーの受付結果を確認できません。待機列を更新してください。");
      setComparisonNotice(`比較レンダーを追加しました。Job ${payload.jobId.slice(0, 8)}`);
      await refresh().catch(() => undefined);
    } catch (error) { setComparisonError(true); setComparisonNotice(renderOperationError(error, "比較レンダーを追加できませんでした。")); }
    finally { setBusy(false); }
  }

  return <section className="cp-panel mt-6 overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e6eb] px-4 py-4 sm:px-5"><div><div className="flex items-center gap-2"><Layers3 className="size-4 text-[#0051c3]" /><h2 className="text-sm font-semibold">一括レンダー・待機列</h2><span className="rounded-full bg-[#f3f6fa] px-2 py-1 text-[10px] text-[#637084]">待機 {queued.length} · 処理 {jobs.length - queued.length}</span></div><p className="mt-1 text-[11px] leading-5 text-[#7d8795]">ドラッグまたは矢印で待機順を変更できます。ジョブあり5秒・なし15秒更新。手動ジョブは自動レンダーの時間制限を受けません。</p></div><button type="button" disabled={busy || queue.isValidating} onClick={() => void refresh().catch(() => undefined)} className="inline-flex h-8 items-center gap-2 rounded-md border border-[#d8dde5] px-3 text-xs disabled:opacity-50"><RefreshCw className={`size-3.5 ${queue.isValidating ? "animate-spin" : ""}`} />更新</button></div>
    <RefreshNotice error={queue.error} retry={() => { void refresh().catch(() => undefined); }} />
    <form action={submitBatch} className="grid gap-3 border-b border-[#e2e6eb] bg-[#fafbfc] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5">
      <label className="cp-label">Score URL（最大20件）<textarea name="urls" required rows={4} placeholder="1行に1 URL" className="cp-input min-h-24 resize-y py-3 font-mono" /></label>
      <div className="flex flex-col justify-end gap-3"><label className="cp-label">予約時刻<input name="scheduledAt" type="datetime-local" className="cp-input" /></label><label className="flex items-center gap-2 text-xs"><input name="highlight" type="checkbox" className="size-4 accent-[#f48120]" />ハイライト生成</label><button disabled={busy} className="cp-button-primary min-w-32">{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}一括追加</button></div>
      {notice ? <p role={noticeError ? "alert" : "status"} className={`rounded-md px-3 py-2 text-xs leading-5 sm:col-span-2 ${noticeError ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{notice}</p> : null}
    </form>
    <form action={submitComparison} className="grid gap-3 border-b border-[#e2e6eb] p-4 sm:grid-cols-2 xl:grid-cols-[180px_1fr_1fr_auto] sm:p-5">
      <label className="cp-label">比較種類<select name="kind" className="cp-select"><option value="same-beatmap">同じ譜面の昔 / 現在</option><option value="versus">2プレイヤー横並び</option></select></label>
      <label className="cp-label">Score URL 1<input name="firstUrl" type="url" required placeholder="https://osu.ppy.sh/scores/..." className="cp-input font-mono" /></label>
      <label className="cp-label">Score URL 2<input name="secondUrl" type="url" required placeholder="https://osu.ppy.sh/scores/..." className="cp-input font-mono" /></label>
      <button disabled={busy} className="cp-button-primary self-end"><GitCompareArrows className="size-4" />比較動画を追加</button>
      {comparisonNotice ? <p role={comparisonError ? "alert" : "status"} className={`rounded-md px-3 py-2 text-xs leading-5 sm:col-span-2 xl:col-span-4 ${comparisonError ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{comparisonNotice}</p> : null}
    </form>
    <div className="divide-y divide-[#e8ebef]">
      {jobs.map((job, index) => {
        const phase = renderPhase(job);
        const queuedIndex = queued.findIndex((item) => item.jobId === job.jobId);
        return <div key={job.jobId} draggable={job.status === "queued" && !busy} onDragStart={() => setDragging(job.jobId)} onDragEnd={() => setDragging(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => void moveBefore(job.jobId)} className={`flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap sm:px-5 ${dragging === job.jobId ? "opacity-50" : ""}`}>
        <GripVertical className={`size-4 shrink-0 ${job.status === "queued" ? "cursor-grab text-[#8b94a1]" : "text-[#d5dae2]"}`} />
        <span className="w-6 font-mono text-[10px] text-[#8b94a1]">{index + 1}</span>
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={title(job)}>{title(job)}</p><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[#687386]" title={job.error ?? job.message}>{job.error ?? job.message}</p><p className="mt-1 text-[10px] leading-5 text-[#8b94a1]"><span className="mr-2 rounded border border-[#e2e6eb] px-1.5 py-0.5">{renderSourceLabel(job)}</span><span className="font-mono">{job.jobId.slice(0, 8)} {job.batchId ? `· batch ${job.batchId.slice(0, 8)}` : ""}</span>{job.scheduledAt ? ` · 予約 ${formatRenderTime(job.scheduledAt)} JST` : ""}{job.updatedAt ? ` · 報告 ${formatRenderTime(job.updatedAt)} JST` : ""}</p></div>
        {job.status === "queued" ? <div className="flex shrink-0"><button type="button" disabled={busy || queuedIndex <= 0} onClick={() => void moveBy(job.jobId, -1)} aria-label={`${title(job)}の優先順位を上げる`} className="rounded-l-md border p-1.5 text-[#657083] disabled:opacity-30"><ChevronUp className="size-3.5" /></button><button type="button" disabled={busy || queuedIndex >= queued.length - 1} onClick={() => void moveBy(job.jobId, 1)} aria-label={`${title(job)}の優先順位を下げる`} className="rounded-r-md border border-l-0 p-1.5 text-[#657083] disabled:opacity-30"><ChevronDown className="size-3.5" /></button></div> : null}
        <div className="ml-auto w-32 shrink-0 text-right"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${phase.tone}`}>{phase.label} {phase.progress}%</span><div className="cp-meter mt-2" role="progressbar" aria-label={`${title(job)}の進捗`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase.progress}><span style={{ width: `${phase.progress}%` }} /></div></div>
      </div>; })}
      {!jobs.length ? <p className="px-5 py-10 text-center text-xs text-[#8b94a1]">待機中のジョブはありません。</p> : null}
    </div>
  </section>;
}

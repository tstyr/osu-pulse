"use client";

import { ChevronDown, ChevronUp, GitCompareArrows, GripVertical, Layers3, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { liveRequestOptions, requestJson } from "@/lib/client/request-json";
import { RefreshNotice } from "@/components/control-panel/refresh-notice";
import { moveQueuedJobBefore } from "@/lib/control/queue-order";

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

  const queue = useSWR<{ jobs: QueueJob[] }>("/api/render/queue", requestJson, {
    ...liveRequestOptions,
    fallbackData: { jobs: initial },
    refreshInterval: (data) => data?.jobs.length ? 5_000 : 15_000,
  });
  const jobs = queue.data?.jobs ?? initial;
  const refresh = () => queue.mutate();

  async function persistOrder(next: QueueJob[]) {
    setDragging(null);
    setBusy(true);
    setNotice(null);
    try {
      // SWR discards an earlier polling response while this mutation is in progress.
      await queue.mutate(async () => {
        const response = await fetch("/api/render/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobIds: next.filter((job) => job.status === "queued").map((job) => job.jobId) }), signal: AbortSignal.timeout(30_000) });
        const payload = await response.json() as { jobs: QueueJob[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "待機順の保存に失敗しました。");
        return { jobs: payload.jobs };
      }, { optimisticData: { jobs: next }, rollbackOnError: true, revalidate: false });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "待機順の保存に失敗しました。");
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
    const urls = String(formData.get("urls") ?? "").match(/https:\/\/osu\.ppy\.sh\/scores\/(?:osu\/|mania\/)?[1-9][0-9]{0,18}/gi) ?? [];
    if (!urls.length) { setNotice("osu! Score URLを入力してください。"); return; }
    setBusy(true); setNotice(null);
    try {
      const scheduled = String(formData.get("scheduledAt") ?? "");
      const response = await fetch("/api/render/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: [...new Set(urls)].slice(0, 20), ...defaults, highlight: formData.get("highlight") === "on", scheduledAt: scheduled ? new Date(scheduled).toISOString() : null }), signal: AbortSignal.timeout(60_000) });
      const payload = await response.json() as { jobs?: unknown[]; batchId?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "一括追加に失敗しました。");
      setNotice(`${payload.jobs?.length ?? 0}件を追加しました。Batch ${payload.batchId?.slice(0, 8)}`);
      await refresh().catch(() => undefined);
    } catch (error) { setNotice(error instanceof Error ? error.message : "一括追加に失敗しました。"); }
    finally { setBusy(false); }
  }

  async function submitComparison(formData: FormData) {
    setBusy(true); setComparisonNotice(null);
    try {
      const response = await fetch("/api/render/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: formData.get("kind"), firstUrl: formData.get("firstUrl"), secondUrl: formData.get("secondUrl") }),
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await response.json() as { jobId?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "比較レンダーを追加できませんでした。");
      setComparisonNotice(`比較レンダーを追加しました。Job ${payload.jobId?.slice(0, 8)}`);
      await refresh().catch(() => undefined);
    } catch (error) { setComparisonNotice(error instanceof Error ? error.message : "比較レンダーを追加できませんでした。"); }
    finally { setBusy(false); }
  }

  return <section className="cp-panel mt-6 overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e6eb] px-4 py-4 sm:px-5"><div><div className="flex items-center gap-2"><Layers3 className="size-4 text-[#0051c3]" /><h2 className="text-sm font-semibold">一括レンダー・待機列</h2></div><p className="mt-1 text-[10px] text-[#7d8795]">ドラッグまたは矢印で優先順を変更できます。処理中は5秒、待機中は15秒ごとに更新します。</p></div><button type="button" disabled={busy || queue.isValidating} onClick={() => void refresh().catch(() => undefined)} className="inline-flex h-8 items-center gap-2 rounded-md border border-[#d8dde5] px-3 text-xs disabled:opacity-50"><RefreshCw className={`size-3.5 ${queue.isValidating ? "animate-spin" : ""}`} />更新</button></div>
    <RefreshNotice error={queue.error} retry={() => { void refresh().catch(() => undefined); }} />
    <form action={submitBatch} className="grid gap-3 border-b border-[#e2e6eb] bg-[#fafbfc] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5">
      <label className="cp-label">Score URL（最大20件）<textarea name="urls" rows={4} placeholder="1行に1 URL" className="cp-input min-h-24 resize-y py-3 font-mono" /></label>
      <div className="flex flex-col justify-end gap-3"><label className="cp-label">予約時刻<input name="scheduledAt" type="datetime-local" className="cp-input" /></label><label className="flex items-center gap-2 text-xs"><input name="highlight" type="checkbox" className="size-4 accent-[#f48120]" />ハイライト生成</label><button disabled={busy} className="cp-button-primary min-w-32">{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}一括追加</button></div>
      {notice ? <p className="text-xs text-[#4f5a6b] sm:col-span-2">{notice}</p> : null}
    </form>
    <form action={submitComparison} className="grid gap-3 border-b border-[#e2e6eb] p-4 sm:grid-cols-2 xl:grid-cols-[180px_1fr_1fr_auto] sm:p-5">
      <label className="cp-label">比較種類<select name="kind" className="cp-select"><option value="same-beatmap">同じ譜面の昔 / 現在</option><option value="versus">2プレイヤー横並び</option></select></label>
      <label className="cp-label">Score URL 1<input name="firstUrl" type="url" required placeholder="https://osu.ppy.sh/scores/..." className="cp-input font-mono" /></label>
      <label className="cp-label">Score URL 2<input name="secondUrl" type="url" required placeholder="https://osu.ppy.sh/scores/..." className="cp-input font-mono" /></label>
      <button disabled={busy} className="cp-button-primary self-end"><GitCompareArrows className="size-4" />比較動画を追加</button>
      {comparisonNotice ? <p role="status" className="text-xs text-[#4f5a6b] sm:col-span-2 xl:col-span-4">{comparisonNotice}</p> : null}
    </form>
    <div className="divide-y divide-[#e8ebef]">
      {jobs.map((job, index) => <div key={job.jobId} draggable={job.status === "queued" && !busy} onDragStart={() => setDragging(job.jobId)} onDragEnd={() => setDragging(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => void moveBefore(job.jobId)} className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${dragging === job.jobId ? "opacity-50" : ""}`}>
        <GripVertical className={`size-4 shrink-0 ${job.status === "queued" ? "cursor-grab text-[#8b94a1]" : "text-[#d5dae2]"}`} />
        <span className="w-6 font-mono text-[10px] text-[#8b94a1]">{index + 1}</span>
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{title(job)}</p><p className="mt-1 font-mono text-[9px] text-[#8b94a1]">{job.jobId.slice(0, 8)} {job.batchId ? `· batch ${job.batchId.slice(0, 8)}` : ""}{job.scheduledAt ? ` · 予約 ${new Date(job.scheduledAt).toLocaleString("ja-JP")}` : ""}</p></div>
        {job.status === "queued" ? <div className="flex shrink-0"><button type="button" disabled={busy} onClick={() => void moveBy(job.jobId, -1)} aria-label="優先順位を上げる" className="rounded-l-md border p-1.5 text-[#657083]"><ChevronUp className="size-3.5" /></button><button type="button" disabled={busy} onClick={() => void moveBy(job.jobId, 1)} aria-label="優先順位を下げる" className="rounded-r-md border border-l-0 p-1.5 text-[#657083]"><ChevronDown className="size-3.5" /></button></div> : null}
        <span className="rounded-full bg-blue-50 px-2 py-1 font-mono text-[9px] font-semibold text-blue-700">{job.status} {job.progress}%</span>
      </div>)}
      {!jobs.length ? <p className="px-5 py-10 text-center text-xs text-[#8b94a1]">待機中のジョブはありません。</p> : null}
    </div>
  </section>;
}

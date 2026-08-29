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
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import type { CloudRenderOptions } from "@/db/schema";
import type { CloudRenderStatus } from "@/lib/render/constants";

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
};

const JOB_STORAGE = "osu-pulse-control-render-job:v1";
const JOB_STORAGE_VERSION = 1;
const TERMINAL = new Set<CloudRenderStatus>(["completed", "failed", "cancelled"]);

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

function errorMessage(payload: unknown, fallback: string) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : fallback;
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

export function WebRenderConsole({ defaults }: { defaults: RenderDefaults }) {
  const [mode, setMode] = useState<"score_url" | "replay">("score_url");
  const [renderer, setRenderer] = useState<RendererStatus | null>(null);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [jobToken, setJobToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const checkRenderer = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/render/status", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "Renderer状態を取得できません。"));
      setRenderer(payload as RendererStatus);
      setError("");
    } catch (caught) {
      setRenderer(null);
      setError(caught instanceof Error ? caught.message : "接続確認に失敗しました。");
    } finally {
      setChecking(false);
    }
  }, []);

  const fetchJob = useCallback(async (id: string, token: string) => {
    const response = await fetch(`/api/render/jobs/${encodeURIComponent(id)}`, {
      headers: { "X-Render-Job-Token": token },
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(errorMessage(payload, "ジョブ状態を取得できません。"));
    const next = payload.job as RenderJob;
    setJob(next);
    return next;
  }, []);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      void checkRenderer();
      const saved = loadStoredJob();
      if (saved) {
        setJobToken(saved.jobToken);
        void fetchJob(saved.jobId, saved.jobToken).catch(clearStoredJob);
      }
    }, 0);
    return () => window.clearTimeout(initialize);
  }, [checkRenderer, fetchJob]);

  useEffect(() => {
    const timer = window.setInterval(() => void checkRenderer(), 10_000);
    return () => window.clearInterval(timer);
  }, [checkRenderer]);

  useEffect(() => {
    if (!job || !jobToken || TERMINAL.has(job.status)) return;
    const timer = window.setInterval(() => {
      void fetchJob(job.jobId, jobToken).catch((caught) => setError(caught instanceof Error ? caught.message : "進捗更新に失敗しました。"));
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [fetchJob, job, jobToken]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      let response: Response;
      if (mode === "score_url") {
        response = await fetch("/api/render/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "score_url",
            url: form.get("url"),
            resolution: form.get("resolution"),
            fps: form.get("fps"),
            speed: form.get("speed"),
            motionBlur: form.get("motionBlur") === "on",
          }),
        });
      } else {
        form.set("type", "replay");
        response = await fetch("/api/render/jobs", { method: "POST", body: form });
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "レンダーを開始できませんでした。"));
      const nextJob = payload.job as RenderJob;
      const nextToken = payload.jobToken as string;
      setJob(nextJob);
      setJobToken(nextToken);
      storeJob(nextJob.jobId, nextToken);
      await checkRenderer();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "レンダーを開始できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function cancelJob() {
    if (!job || !jobToken) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/render/jobs/${encodeURIComponent(job.jobId)}`, {
        method: "DELETE",
        headers: { "X-Render-Job-Token": jobToken },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "キャンセルできませんでした。"));
      setJob(payload.job as RenderJob);
    } finally {
      setBusy(false);
    }
  }

  const running = Boolean(job && !TERMINAL.has(job.status));
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Replay renderer</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">レンダーを開始</h1><p className="mt-1 text-sm text-[#6f7a8c]">Botを起動していなくても、ローカルRendererがオンラインなら利用できます。</p></div>
        <button type="button" onClick={() => void checkRenderer()} disabled={checking} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d5dae2] bg-white px-3 text-xs font-medium text-[#4f5a6b] hover:bg-[#f7f8f9]"><RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} /> 接続更新</button>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="cp-panel overflow-hidden">
          <div className="border-b border-[#e2e6eb] px-5 py-4"><div className="flex items-center gap-2 text-sm font-semibold"><CloudUpload className="size-4 text-[#0051c3]" /> 新しいジョブ</div></div>
          <form onSubmit={submit} className="p-5 sm:p-6">
            <div className="mb-5 flex w-fit rounded-md border border-[#d8dde5] bg-[#f4f6f8] p-1">
              <button type="button" onClick={() => setMode("score_url")} className={`rounded px-4 py-2 text-xs font-medium ${mode === "score_url" ? "bg-white text-[#1f2732] shadow-sm" : "text-[#6f7a8c]"}`}>スコアURL</button>
              <button type="button" onClick={() => setMode("replay")} className={`rounded px-4 py-2 text-xs font-medium ${mode === "replay" ? "bg-white text-[#1f2732] shadow-sm" : "text-[#6f7a8c]"}`}>.osrファイル</button>
            </div>

            {mode === "score_url" ? (
              <label className="cp-label">osu! Score URL<input name="url" type="url" required placeholder="https://osu.ppy.sh/scores/1234567890" className="cp-input !h-11 font-mono" /></label>
            ) : (
              <label className="grid min-h-32 cursor-pointer place-items-center rounded-lg border border-dashed border-[#bdc5d0] bg-[#fafbfc] p-5 text-center hover:border-[#7da4d6] hover:bg-[#f6f9fd]">
                <input name="replay" type="file" accept=".osr,application/octet-stream" required className="sr-only" />
                <span><FileUp className="mx-auto size-5 text-[#0051c3]" /><span className="mt-2 block text-xs font-semibold">.osrを選択</span><span className="mt-1 block text-[10px] text-[#7f8998]">最大3 MB</span></span>
              </label>
            )}

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <label className="cp-label">解像度<select name="resolution" defaultValue={defaults.resolution} className="cp-select"><option>1920x1080</option><option>2560x1440</option><option>2560x1600</option><option>3840x2160</option></select></label>
              <label className="cp-label">フレームレート<select name="fps" defaultValue={String(defaults.fps)} className="cp-select"><option value="60">60 FPS</option><option value="120">120 FPS</option><option value="240">240 FPS</option></select></label>
              <label className="cp-label">再生速度<select name="speed" defaultValue={defaults.speed} className="cp-select"><option value="original">Original</option><option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1.0">1.0x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2.0">2.0x</option></select></label>
            </div>
            <label className="mt-4 flex items-center gap-2 text-xs font-medium text-[#4e596b]"><input name="motionBlur" type="checkbox" defaultChecked={defaults.motionBlur} className="size-4 accent-[#f48120]" /> Motion blurを使用</label>
            <button type="submit" disabled={busy || !renderer?.online || running} className="cp-button-primary mt-6 w-full !min-h-11">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />} レンダーを開始</button>
            {error ? <p role="alert" className="mt-4 flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700"><AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}</p> : null}
          </form>
        </section>

        <aside className="space-y-5">
          <section className="cp-panel p-5">
            <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Local Renderer</h2><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[9px] font-semibold ${renderer?.online ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}><span className={`size-1.5 rounded-full ${renderer?.online ? "bg-emerald-500" : "bg-slate-400"}`} /> {renderer?.online ? "ONLINE" : "OFFLINE"}</span></div>
            <dl className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-md bg-[#f6f8fa] p-3"><dt className="text-[10px] text-[#7d8795]">Cloud queue</dt><dd className="mt-1 font-mono text-lg font-semibold">{renderer?.queueSize ?? "—"}</dd></div><div className="rounded-md bg-[#f6f8fa] p-3"><dt className="text-[10px] text-[#7d8795]">State</dt><dd className="mt-2 font-mono text-xs font-semibold">{renderer?.busy ? "BUSY" : renderer?.online ? "READY" : "—"}</dd></div></dl>
            {renderer?.restartRequired ? <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-800">設定反映のため再起動待ちです。</p> : null}
          </section>

          <section className="cp-panel overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[#e2e6eb] px-5 py-4"><Film className="size-4 text-[#f48120]" /><h2 className="text-sm font-semibold">現在のジョブ</h2></div>
            {!job ? <div className="grid min-h-56 place-items-center p-6 text-center"><div><Film className="mx-auto size-6 text-[#bdc4cd]" /><p className="mt-3 text-xs text-[#8a94a3]">ジョブはありません</p></div></div> : (
              <div className="p-5">
                <div className="flex items-center justify-between"><span className="font-mono text-[10px] font-semibold uppercase text-[#0051c3]">{job.status.replaceAll("_", " ")}</span><span className="font-mono text-xs font-semibold">{job.progress}%</span></div>
                <div className="cp-meter mt-2"><span style={{ width: `${job.progress}%` }} /></div>
                <p className="mt-3 text-xs leading-5 text-[#687386]">{job.error ?? job.message}</p>
                {resultName(job.metadata) ? <p className="mt-3 rounded-md bg-[#f6f8fa] p-3 text-[11px] leading-5 text-[#4f5a6b]">{resultName(job.metadata)}</p> : null}
                {job.status === "completed" && job.videoUrl ? <a href={job.videoUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-emerald-600 bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"><CheckCircle2 className="size-4" /> 動画を開く {formatBytes(job.videoSize)} <ExternalLink className="size-3" /></a> : running ? <button type="button" onClick={() => void cancelJob()} disabled={busy} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 text-xs font-semibold text-red-700 hover:bg-red-100"><CircleStop className="size-3.5" /> キャンセル</button> : null}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

"use client";

import {
  AlertCircle,
  CheckCircle2,
  CircleStop,
  CloudUpload,
  Film,
  Gauge,
  KeyRound,
  LoaderCircle,
  MonitorUp,
  Play,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type { CloudRenderStatus } from "@/lib/render/constants";

type RenderJob = {
  jobId: string;
  status: CloudRenderStatus;
  progress: number;
  message: string;
  metadata: Record<string, unknown> | null;
  options: { resolution: string; fps: number; speed: string; motionBlur: boolean };
  videoUrl: string | null;
  videoSize: number | null;
  errorCode: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
};

type RendererStatus = {
  online: boolean;
  status: string;
  busy: boolean;
  queueSize: number;
  localQueueSize: number;
  dependencies: Record<string, unknown>;
  lastSeenAt: string | null;
};

const KEY_STORAGE = "osu-pulse-render-access";
const JOB_STORAGE = "osu-pulse-render-job";
const TERMINAL = new Set<CloudRenderStatus>(["completed", "failed", "cancelled"]);

function errorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

function formatBytes(value: number | null) {
  if (!value) return "";
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function isYouTubeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "youtu.be";
  } catch {
    return false;
  }
}

function metadataText(metadata: Record<string, unknown> | null) {
  if (!metadata) return null;
  const artist = typeof metadata.artist === "string" ? metadata.artist : null;
  const title = typeof metadata.title === "string" ? metadata.title : null;
  const difficulty = typeof metadata.difficulty === "string" ? metadata.difficulty : null;
  const player = typeof metadata.player_name === "string" ? metadata.player_name : null;
  const map = [artist, title].filter(Boolean).join(" — ");
  return [map, difficulty ? `[${difficulty}]` : null, player ? `played by ${player}` : null].filter(Boolean).join(" ");
}

export function RenderClient() {
  const [accessKey, setAccessKey] = useState("");
  const [mode, setMode] = useState<"score_url" | "replay">("score_url");
  const [renderer, setRenderer] = useState<RendererStatus | null>(null);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [jobToken, setJobToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);

  const checkRenderer = useCallback(async (key = accessKey) => {
    if (!key) return;
    setChecking(true);
    try {
      const response = await fetch("/api/render/status", {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "Renderer 状態を取得できません。"));
      sessionStorage.setItem(KEY_STORAGE, key);
      setRenderer(payload as RendererStatus);
      setError("");
    } catch (caught) {
      setRenderer(null);
      setError(caught instanceof Error ? caught.message : "接続確認に失敗しました。");
    } finally {
      setChecking(false);
    }
  }, [accessKey]);

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
    if (restoredRef.current) return;
    restoredRef.current = true;
    const timer = window.setTimeout(() => {
      const savedKey = sessionStorage.getItem(KEY_STORAGE) ?? "";
      if (savedKey) {
        setAccessKey(savedKey);
        void checkRenderer(savedKey);
      }
      const savedJob = sessionStorage.getItem(JOB_STORAGE);
      if (savedJob) {
        try {
          const parsed = JSON.parse(savedJob) as { jobId: string; jobToken: string };
          setJobToken(parsed.jobToken);
          void fetchJob(parsed.jobId, parsed.jobToken).catch(() => sessionStorage.removeItem(JOB_STORAGE));
        } catch {
          sessionStorage.removeItem(JOB_STORAGE);
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkRenderer, fetchJob]);

  useEffect(() => {
    if (!job || !jobToken || TERMINAL.has(job.status)) return;
    const timer = window.setInterval(() => {
      void fetchJob(job.jobId, jobToken).catch((caught) => {
        setError(caught instanceof Error ? caught.message : "進捗更新に失敗しました。");
      });
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [fetchJob, job, jobToken]);

  useEffect(() => {
    if (!accessKey || !renderer) return;
    const timer = window.setInterval(() => void checkRenderer(), 10_000);
    return () => window.clearInterval(timer);
  }, [accessKey, checkRenderer, renderer]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessKey) {
      setError("レンダーアクセスキーを入力してください。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      let response: Response;
      if (mode === "score_url") {
        response = await fetch("/api/render/jobs", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessKey}`, "Content-Type": "application/json" },
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
        response = await fetch("/api/render/jobs", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessKey}` },
          body: form,
        });
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "レンダーを開始できませんでした。"));
      const nextJob = payload.job as RenderJob;
      const nextToken = payload.jobToken as string;
      setJob(nextJob);
      setJobToken(nextToken);
      sessionStorage.setItem(KEY_STORAGE, accessKey);
      sessionStorage.setItem(JOB_STORAGE, JSON.stringify({ jobId: nextJob.jobId, jobToken: nextToken }));
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "キャンセルできませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-7 sm:py-10">
      <section className="mb-6 max-w-3xl">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-pink-300/15 bg-pink-300/[0.055] px-3 py-1.5 font-mono text-[10px] text-pink-200">
          <CloudUpload className="size-3.5" /> VERCEL → LOCAL RENDERER
        </div>
        <h1 className="text-3xl font-medium tracking-[-0.045em] text-white sm:text-4xl">Web Replay Renderer</h1>
        <p className="mt-3 text-sm leading-7 text-zinc-500">
          サイトからジョブを登録し、起動中のローカル Renderer が外向き通信で取得します。Discord Bot は停止したままでも利用できます。
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_350px]">
        <section className="surface p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <KeyRound className="size-4 text-pink-300" /> アクセス
          </div>
          <div className="mt-4 flex gap-2">
            <input
              type="password"
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              placeholder="render access key"
              autoComplete="off"
              className="h-11 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-black/20 px-3 font-mono text-xs text-white outline-none placeholder:text-zinc-700 focus:border-pink-300/30"
            />
            <button
              type="button"
              onClick={() => void checkRenderer()}
              disabled={!accessKey || checking}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-xs font-semibold text-[#101017] transition hover:bg-pink-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {checking ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} 接続確認
            </button>
          </div>

          <div className="my-6 h-px bg-white/[0.06]" />

          <div className="mb-5 flex rounded-xl border border-white/[0.07] bg-black/20 p-1">
            <button
              type="button"
              onClick={() => setMode("score_url")}
              className={`flex-1 rounded-lg px-3 py-2.5 text-xs font-medium transition ${mode === "score_url" ? "bg-white/[0.1] text-white" : "text-zinc-600 hover:text-zinc-300"}`}
            >
              osu! スコアURL
            </button>
            <button
              type="button"
              onClick={() => setMode("replay")}
              className={`flex-1 rounded-lg px-3 py-2.5 text-xs font-medium transition ${mode === "replay" ? "bg-white/[0.1] text-white" : "text-zinc-600 hover:text-zinc-300"}`}
            >
              .osr アップロード
            </button>
          </div>

          <form onSubmit={submit}>
            {mode === "score_url" ? (
              <label className="block text-[11px] font-medium text-zinc-400">
                Score URL
                <input
                  name="url"
                  type="url"
                  required
                  placeholder="https://osu.ppy.sh/scores/1234567890"
                  className="mt-2 h-12 w-full rounded-xl border border-white/[0.08] bg-black/20 px-4 font-mono text-xs text-white outline-none placeholder:text-zinc-700 focus:border-pink-300/30"
                />
              </label>
            ) : (
              <label className="grid min-h-32 cursor-pointer place-items-center rounded-xl border border-dashed border-white/[0.12] bg-black/15 p-5 text-center transition hover:border-pink-300/25 hover:bg-pink-300/[0.025]">
                <input ref={fileRef} name="replay" type="file" accept=".osr,application/octet-stream" required className="sr-only" />
                <span>
                  <Upload className="mx-auto size-5 text-pink-300" />
                  <span className="mt-2 block text-xs font-medium text-zinc-300">.osr を選択</span>
                  <span className="mt-1 block text-[10px] text-zinc-600">Web 上限 3 MB</span>
                </span>
              </label>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className="text-[10px] text-zinc-500">解像度
                <select name="resolution" defaultValue="1920x1080" className="mt-1.5 h-10 w-full rounded-lg border border-white/[0.08] bg-[#111119] px-2 text-xs text-zinc-200 outline-none">
                  <option>1920x1080</option><option>2560x1440</option><option>2560x1600</option><option>3840x2160</option>
                </select>
              </label>
              <label className="text-[10px] text-zinc-500">FPS
                <select name="fps" defaultValue="60" className="mt-1.5 h-10 w-full rounded-lg border border-white/[0.08] bg-[#111119] px-2 text-xs text-zinc-200 outline-none">
                  <option value="60">60</option><option value="120">120</option><option value="240">240</option>
                </select>
              </label>
              <label className="text-[10px] text-zinc-500">速度
                <select name="speed" defaultValue="original" className="mt-1.5 h-10 w-full rounded-lg border border-white/[0.08] bg-[#111119] px-2 text-xs text-zinc-200 outline-none">
                  <option value="original">Original</option><option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1.0">1.0x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2.0">2.0x</option>
                </select>
              </label>
            </div>
            <label className="mt-4 flex items-center gap-2 text-xs text-zinc-400">
              <input name="motionBlur" type="checkbox" className="size-4 accent-pink-400" /> Motion blur
            </label>
            <button
              type="submit"
              disabled={busy || !renderer?.online || Boolean(job && !TERMINAL.has(job.status))}
              className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-300 to-violet-300 text-sm font-semibold text-[#111118] transition hover:brightness-110 disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40"
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />} レンダーを開始
            </button>
          </form>

          {error ? (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-300/15 bg-rose-300/[0.055] p-3 text-xs leading-5 text-rose-200">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
            </div>
          ) : null}
        </section>

        <aside className="space-y-5">
          <section className="surface p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-white"><MonitorUp className="size-4 text-sky-300" /> Local Renderer</div>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[9px] ${renderer?.online ? "bg-emerald-300/10 text-emerald-300" : "bg-zinc-500/10 text-zinc-500"}`}>
                <span className={`size-1.5 rounded-full ${renderer?.online ? "animate-pulse bg-emerald-300" : "bg-zinc-600"}`} /> {renderer?.online ? "ONLINE" : "OFFLINE"}
              </span>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-[10px]">
              <div className="rounded-xl bg-white/[0.025] p-3"><dt className="text-zinc-600">Cloud queue</dt><dd className="mt-1 font-mono text-base text-white">{renderer?.queueSize ?? "—"}</dd></div>
              <div className="rounded-xl bg-white/[0.025] p-3"><dt className="text-zinc-600">Render state</dt><dd className="mt-1 truncate font-mono text-xs text-white">{renderer?.busy ? "BUSY" : renderer?.online ? "READY" : "—"}</dd></div>
            </dl>
            {!renderer?.online ? <p className="mt-4 text-[10px] leading-5 text-zinc-600">このPCで <code className="text-zinc-400">renderer/start_renderer.bat</code> を起動してください。Bot の起動は不要です。</p> : null}
          </section>

          <section className="surface overflow-hidden">
            <div className="border-b border-white/[0.06] px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white"><Gauge className="size-4 text-violet-300" /> Render job</div>
            </div>
            {!job ? (
              <div className="grid min-h-56 place-items-center p-6 text-center"><div><Film className="mx-auto size-6 text-zinc-700" /><p className="mt-3 text-xs text-zinc-600">まだジョブはありません</p></div></div>
            ) : (
              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase text-pink-200">{job.status.replaceAll("_", " ")}</span>
                  <span className="font-mono text-xs text-white">{job.progress}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-pink-400 to-violet-400 transition-all" style={{ width: `${job.progress}%` }} /></div>
                <p className="mt-3 text-[11px] leading-5 text-zinc-500">{job.error ?? job.message}</p>
                {metadataText(job.metadata) ? <p className="mt-3 rounded-lg bg-black/20 p-2.5 text-[10px] leading-5 text-zinc-400">{metadataText(job.metadata)}</p> : null}
                {job.status === "completed" && job.videoUrl ? (
                  <a href={job.videoUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-300 text-xs font-semibold text-emerald-950 hover:bg-emerald-200">
                    <CheckCircle2 className="size-4" /> {isYouTubeUrl(job.videoUrl) ? "YouTubeで見る" : `MP4 を開く ${formatBytes(job.videoSize)}`}
                  </a>
                ) : !TERMINAL.has(job.status) ? (
                  <button type="button" onClick={() => void cancelJob()} disabled={busy} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-rose-300/15 bg-rose-300/[0.05] text-xs text-rose-200 hover:bg-rose-300/[0.09]">
                    <CircleStop className="size-3.5" /> キャンセル
                  </button>
                ) : null}
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

"use client";

import { CheckCircle2, Clapperboard, ExternalLink, Film, HardDrive, RefreshCw, Trash2 } from "lucide-react";

import { requestVideoDeletion } from "@/app/dashboard/videos/actions";
import type { VideoLibrary } from "@/lib/control/videos";

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index >= 3 ? 1 : 0)} ${units[index]}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function statusClass(status: string) {
  if (status === "active") return "bg-emerald-50 text-emerald-700";
  if (status === "deleted") return "bg-slate-100 text-slate-600";
  if (status === "delete_failed") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

function statusLabel(status: string) {
  if (status === "active") return "公開中";
  if (status === "deleted") return "削除済み";
  if (status === "delete_failed") return "削除失敗";
  if (status === "delete_requested") return "削除待ち";
  return status;
}

export function VideoLibraryView({ data }: { data: VideoLibrary }) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Video library</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">動画一覧</h1><p className="mt-1 text-sm text-[#6f7a8c]">ローカルRendererのYouTube台帳と同期し、公開動画を管理します。</p></div>
        <button type="button" onClick={() => window.location.reload()} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d5dae2] bg-white px-3 text-xs font-medium text-[#4f5a6b] hover:bg-[#f7f8f9]"><RefreshCw className="size-3.5" /> 更新</button>
      </div>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="cp-panel p-4"><Clapperboard className="size-5 text-red-600" /><p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7d8795]">公開中</p><p className="mt-1 text-2xl font-semibold">{data.active.toLocaleString()}本</p></div>
        <div className="cp-panel p-4"><Film className="size-5 text-[#0051c3]" /><p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7d8795]">台帳合計</p><p className="mt-1 text-2xl font-semibold">{data.total.toLocaleString()}本</p></div>
        <div className="cp-panel p-4"><HardDrive className="size-5 text-[#f48120]" /><p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7d8795]">レンダー時の元容量</p><p className="mt-1 text-2xl font-semibold">{formatBytes(data.sourceBytes)}</p></div>
      </section>

      <div className="mt-5 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-[11px] leading-5 text-blue-800">Renderer起動中は約5秒ごとに台帳を同期します。「YouTubeから削除」は復元できません。R2/ローカルの削除状況も各動画に表示します。</div>

      <section className="cp-panel mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="bg-[#fafbfc] text-[10px] uppercase tracking-[0.08em] text-[#7d8795]"><tr><th className="px-5 py-3 font-semibold">動画</th><th className="px-4 py-3 font-semibold">状態</th><th className="px-4 py-3 font-semibold">容量</th><th className="px-4 py-3 font-semibold">後処理</th><th className="px-4 py-3 font-semibold">投稿日時</th><th className="px-5 py-3 text-right font-semibold">操作</th></tr></thead>
            <tbody className="divide-y divide-[#e8ebef]">
              {data.videos.map((video) => {
                const cleanup = video.cleanup ?? {};
                const pending = video.status === "delete_requested";
                const deleted = video.status === "deleted";
                return (
                  <tr key={video.videoId} className="hover:bg-[#fbfcfd]">
                    <td className="max-w-[500px] px-5 py-4"><p className="truncate font-medium text-[#242b35]" title={video.title}>{video.title}</p><p className="mt-1 font-mono text-[9px] text-[#929aa6]">{video.videoId} · score {video.scoreId ?? "—"}</p>{video.deleteError ? <p className="mt-1 text-[10px] text-red-600">{video.deleteError}</p> : null}</td>
                    <td className="px-4 py-4"><span className={`rounded-full px-2 py-1 font-mono text-[9px] font-semibold ${statusClass(video.status)}`}>{statusLabel(video.status)}</span><p className="mt-1 text-[9px] text-[#8b94a1]">{video.privacyStatus}</p></td>
                    <td className="px-4 py-4 font-mono text-[#596477]">{formatBytes(video.sourceSize)}</td>
                    <td className="px-4 py-4"><div className="space-y-1 text-[10px]"><p className={cleanup.r2_deleted ? "text-emerald-700" : "text-[#8b94a1]"}>{cleanup.r2_deleted ? "✓" : "—"} R2</p><p className={cleanup.local_deleted ? "text-emerald-700" : "text-[#8b94a1]"}>{cleanup.local_deleted ? "✓" : "—"} ローカル</p></div></td>
                    <td className="px-4 py-4 text-[#667184]">{formatDate(video.uploadedAt)}</td>
                    <td className="px-5 py-4"><div className="flex justify-end gap-2">{!deleted ? <a href={video.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d8dde5] bg-white px-2.5 text-[10px] font-semibold text-[#40506a] hover:bg-[#f4f6f8]">開く <ExternalLink className="size-3" /></a> : null}{!deleted ? <form action={requestVideoDeletion} onSubmit={(event) => { if (!window.confirm(`「${video.title}」をYouTubeから完全に削除しますか？この操作は元に戻せません。`)) event.preventDefault(); }}><input type="hidden" name="videoId" value={video.videoId} /><button type="submit" disabled={pending} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 text-[10px] font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 className="size-3" /> {pending ? "削除待ち" : video.status === "delete_failed" ? "再試行" : "削除"}</button></form> : <span className="inline-flex h-8 items-center gap-1 text-[10px] text-emerald-700"><CheckCircle2 className="size-3" /> 完了</span>}</div></td>
                  </tr>
                );
              })}
              {!data.videos.length ? <tr><td colSpan={6} className="px-5 py-16 text-center text-[#8b94a1]">Rendererの次回同期後に動画が表示されます。</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

"use client";

import {
  Clock3,
  BarChart3,
  FastForward,
  History,
  GripVertical,
  Link2,
  ListMusic,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Rewind,
  SkipForward,
  Square,
  Trash2,
  Volume2,
  CirclePlay,
  FileAudio,
  HardDrive,
  Upload,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { liveRequestOptions, requestJson } from "@/lib/client/request-json";
import { RefreshNotice } from "@/components/control-panel/refresh-notice";

import type { MusicLibraryView, MusicPlaybackView } from "@/db/music-repository";

type MusicCandidate = NonNullable<MusicPlaybackView["states"][number]["currentTrack"]> & {
  kind: "track" | "yt-dlp";
};

type MusicAnalytics = {
  generatedAt: string;
  days: number;
  users: Array<{ discordUserId: string; requestCount: number; playbackMs: number; completed: number; skipped: number }>;
  resolvers: Array<{ resolver: string; attempts: number; successes: number; successRate: number; averageLatencyMs: number; lastError: string | null }>;
};

const fetcher = <T,>(url: string) => requestJson<T>(url);

async function waitForCommand(commandId: string, timeoutMs = 100_000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  while (!timeout.aborted) {
    const result = await requestJson<{ status?: string; result?: Record<string, unknown> | null; error?: string | null }>(`/api/control/music?commandId=${encodeURIComponent(commandId)}`, timeout);
    if (result.status === "completed") return result.result ?? {};
    if (result.status === "failed") throw new Error(result.error || "Bot操作に失敗しました。");
    await new Promise((resolve) => window.setTimeout(resolve, 800));
  }
  throw new Error("Botからの応答がタイムアウトしました。ローカルBotの起動状態を確認してください。");
}

function durationLabel(milliseconds: number) {
  if (!milliseconds) return "LIVE / 不明";
  const seconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1_024 && unit < units.length - 1) {
    value /= 1_024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function transferredBytes(positionMs: number, bitrateKbps: number | null | undefined, maximum: number | null | undefined) {
  if (!bitrateKbps || bitrateKbps <= 0) return null;
  const estimate = bitrateKbps * 1_000 / 8 * (Math.max(0, positionMs) / 1_000);
  return maximum ? Math.min(maximum, estimate) : estimate;
}

function statusPresentation(status: string, fresh: boolean) {
  if (!fresh) return { label: "Bot offline", className: "bg-slate-100 text-slate-600" };
  if (status === "playing") return { label: "再生中", className: "bg-emerald-50 text-emerald-700" };
  if (status === "paused") return { label: "一時停止", className: "bg-amber-50 text-amber-700" };
  if (status === "error") return { label: "再生エラー", className: "bg-red-50 text-red-700" };
  if (status === "disconnected") return { label: "切断", className: "bg-slate-100 text-slate-600" };
  return { label: "待機中", className: "bg-blue-50 text-blue-700" };
}

function repeatPresentation(mode: "off" | "track" | "queue" | undefined) {
  if (mode === "track") return { label: "1曲", value: 2 };
  if (mode === "queue") return { label: "キュー", value: 0 };
  return { label: "OFF", value: 1 };
}

export function MusicDashboard({
  initialPlayback,
  initialLibrary,
}: {
  initialPlayback: MusicPlaybackView;
  initialLibrary: MusicLibraryView;
}) {
  const [historyLimit, setHistoryLimit] = useState(100);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState(initialPlayback.states[0]?.guildId ?? "");
  const [searchCandidates, setSearchCandidates] = useState<MusicCandidate[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [draggedQueueEntry, setDraggedQueueEntry] = useState<{ guildId: string; id: string } | null>(null);
  const playback = useSWR<MusicPlaybackView>("/api/control/music?view=playback", fetcher, {
    ...liveRequestOptions,
    fallbackData: initialPlayback,
    refreshInterval: 2_000,
    revalidateOnFocus: true,
  });
  const libraryKey = `/api/control/music?historyLimit=${historyLimit}`;
  const library = useSWR<MusicLibraryView>(libraryKey, fetcher, {
    ...liveRequestOptions,
    fallbackData: historyLimit === 100 ? initialLibrary : undefined,
    keepPreviousData: true,
    revalidateOnFocus: true,
  });
  const analytics = useSWR<MusicAnalytics>("/api/control/music?view=analytics&days=30", fetcher, {
    ...liveRequestOptions,
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });
  const playbackData = playback.data ?? initialPlayback;
  const libraryData = library.data ?? initialLibrary;
  const playbackStates = [...playbackData.states].sort((left, right) =>
    (left.guildName || left.guildId).localeCompare(right.guildName || right.guildId, "ja"),
  );

  async function mutateMusic(action: Record<string, unknown>, key: string, success: string) {
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch("/api/control/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "更新に失敗しました。");
      await Promise.all([library.mutate(), playback.mutate()]);
      setNotice({ kind: "success", text: success });
      return true;
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "更新に失敗しました。" });
      return false;
    } finally {
      setPending(null);
    }
  }

  async function postCommand(action: Record<string, unknown>) {
    const response = await fetch("/api/control/music", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    const result = await response.json().catch(() => ({})) as { commandId?: string; error?: string };
    if (!response.ok || !result.commandId) throw new Error(result.error || "Botへ操作を送信できませんでした。");
    return result.commandId;
  }

  async function searchMusic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("query") ?? "").trim();
    if (!selectedGuildId || !query) return;
    setPending("search");
    setNotice(null);
    setSearchCandidates([]);
    try {
      const commandId = await postCommand({ action: "search", guildId: selectedGuildId, query });
      const result = await waitForCommand(commandId);
      const candidates = Array.isArray(result.candidates) ? result.candidates as MusicCandidate[] : [];
      setSearchCandidates(candidates);
      setNotice({ kind: candidates.length ? "success" : "error", text: candidates.length ? `${candidates.length}件の候補を取得しました。` : "再生可能な候補がありませんでした。" });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "検索に失敗しました。" });
    } finally {
      setPending(null);
    }
  }

  async function playCandidate(candidate: MusicCandidate) {
    const state = playbackData.states.find((row) => row.guildId === selectedGuildId);
    const voiceChannelId = state?.voiceChannelId || state?.availableVoiceChannels[0]?.id;
    if (!voiceChannelId) {
      setNotice({ kind: "error", text: "再生先ボイスチャンネルがありません。先にDiscordでボイスチャンネルへ参加してください。" });
      return;
    }
    setPending(`play:${candidate.uri}`);
    try {
      const commandId = await postCommand({ action: "playCandidate", guildId: selectedGuildId, voiceChannelId, candidate });
      await waitForCommand(commandId);
      setNotice({ kind: "success", text: `「${candidate.title}」をキューへ追加しました。` });
      await playback.mutate();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "再生に失敗しました。" });
    } finally {
      setPending(null);
    }
  }

  async function uploadLocalAudio(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGuildId) {
      setNotice({ kind: "error", text: "先にDiscordサーバーを選択してください。" });
      return;
    }
    const form = event.currentTarget;
    const files = Array.from(new FormData(form).getAll("files")).filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length) return;
    if (files.length > 10) {
      setNotice({ kind: "error", text: "一度にアップロードできるのは10ファイルまでです。" });
      return;
    }
    setPending("local-upload");
    setNotice(null);
    setUploadProgress(0);
    try {
      let completed = 0;
      for (const file of files) {
        if (!/\.(flac|wav|mp3|m4a)$/i.test(file.name)) throw new Error(`${file.name}: 対応形式は FLAC / WAV / MP3 / M4A です。`);
        const contentType = file.type || "application/octet-stream";
        const signResponse = await fetch("/api/control/music/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, contentType, sizeBytes: file.size, origin: window.location.origin }),
        });
        const signed = await signResponse.json().catch(() => ({})) as { uploadUrl?: string; objectKey?: string; error?: string };
        if (!signResponse.ok || !signed.uploadUrl || !signed.objectKey) throw new Error(signed.error || "R2アップロードURLを作成できませんでした。");
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", signed.uploadUrl!);
          xhr.setRequestHeader("Content-Type", contentType);
          xhr.upload.addEventListener("progress", (progress) => {
            if (progress.lengthComputable) setUploadProgress(Math.round((completed + progress.loaded / progress.total) / files.length * 100));
          });
          xhr.addEventListener("load", () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`R2への送信に失敗しました (HTTP ${xhr.status})。`)));
          xhr.addEventListener("error", () => reject(new Error("R2へ接続できませんでした。R2 CORS設定を確認してください。")));
          xhr.send(file);
        });
        const commandId = await postCommand({
          action: "importLocalAudio",
          guildId: selectedGuildId,
          objectKey: signed.objectKey,
          originalFilename: file.name,
          sizeBytes: file.size,
        });
        await waitForCommand(commandId, 15 * 60_000);
        completed += 1;
        setUploadProgress(Math.round(completed / files.length * 100));
      }
      form.reset();
      await library.mutate();
      setNotice({ kind: "success", text: `${files.length}件の音源をPCへ保存しました。` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "音源のアップロードに失敗しました。" });
    } finally {
      setPending(null);
      window.setTimeout(() => setUploadProgress(0), 1_000);
    }
  }

  async function playLocalAudio(id: string, title: string) {
    const state = playbackData.states.find((row) => row.guildId === selectedGuildId);
    const voiceChannelId = state?.voiceChannelId || state?.availableVoiceChannels[0]?.id;
    if (!selectedGuildId || !voiceChannelId) {
      setNotice({ kind: "error", text: "再生先ボイスチャンネルがありません。Discordでボイスチャンネルへ参加してください。" });
      return;
    }
    setPending(`local-play:${id}`);
    try {
      const commandId = await postCommand({ action: "playLocalAudio", guildId: selectedGuildId, voiceChannelId, id });
      await waitForCommand(commandId);
      await playback.mutate();
      setNotice({ kind: "success", text: `「${title}」をキューへ追加しました。` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "ローカル音源を再生できませんでした。" });
    } finally {
      setPending(null);
    }
  }

  async function deleteLocalAudio(id: string, title: string) {
    if (!selectedGuildId || !window.confirm(`PCから「${title}」を削除しますか？`)) return;
    setPending(`local-delete:${id}`);
    try {
      const commandId = await postCommand({ action: "deleteLocalAudio", guildId: selectedGuildId, id });
      await waitForCommand(commandId);
      await library.mutate();
      setNotice({ kind: "success", text: `「${title}」をPCから削除しました。` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "ローカル音源を削除できませんでした。" });
    } finally {
      setPending(null);
    }
  }

  async function reorderQueue(guildId: string, targetId: string) {
    if (!draggedQueueEntry || draggedQueueEntry.guildId !== guildId || draggedQueueEntry.id === targetId) return;
    const state = playbackData.states.find((row) => row.guildId === guildId);
    const order = state?.queue.flatMap((track) => track.queueEntryId ? [track.queueEntryId] : []) ?? [];
    if (order.length !== state?.queue.length) return;
    const sourceIndex = order.indexOf(draggedQueueEntry.id);
    const targetIndex = order.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    order.splice(targetIndex, 0, order.splice(sourceIndex, 1)[0]);
    setDraggedQueueEntry(null);
    const sent = await mutateMusic({ action: "reorderQueue", guildId, order }, `reorder:${guildId}`, "キューの順番を更新しました。");
    if (sent) window.setTimeout(() => void playback.mutate(), 1_200);
  }

  async function createPlaylist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const created = await mutateMusic({
      action: "createPlaylist",
      guildId: values.get("guildId"),
      name: values.get("name"),
      description: values.get("description"),
    }, "create", "プレイリストを作成しました。");
    if (created) form.reset();
  }

  async function controlMusic(guildId: string, command: string, value?: number) {
    const key = `control:${guildId}:${command}`;
    const sent = await mutateMusic({ action: "control", guildId, command, value }, key, "Botへ操作を送信しました。");
    if (sent) window.setTimeout(() => void playback.mutate(), 1_200);
  }

  const guildOptions = Array.from(new Map([
    ...playbackData.states.map((state) => [state.guildId, state.guildName || state.guildId] as const),
    ...libraryData.playlists.map((playlist) => [playlist.guildId, playlist.guildId] as const),
  ]).entries());

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f48120]">Music control</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">音楽プレイヤー</h1>
          <p className="mt-1 text-sm text-[#6f7a8c]">ローカルBotの再生状況を確認し、プレイリストと再生履歴を管理します。</p>
        </div>
        <button type="button" onClick={() => void Promise.allSettled([playback.mutate(), library.mutate(), analytics.mutate()])} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d5dae2] bg-white px-3 text-xs font-medium text-[#4f5a6b] hover:bg-[#f7f8f9]">
          <RefreshCw className={`size-3.5 ${playback.isValidating || library.isValidating ? "animate-spin" : ""}`} /> 更新
        </button>
      </div>
      <RefreshNotice error={playback.error || library.error || analytics.error} retry={() => { void Promise.allSettled([playback.mutate(), library.mutate(), analytics.mutate()]); }} />

      {notice ? <div className={`mt-5 rounded-md border px-4 py-3 text-xs ${notice.kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{notice.text}</div> : null}

      <section className="cp-panel mt-6 overflow-hidden">
        <div className="border-b border-[#e2e6eb] px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Search className="size-4 text-[#0051c3]" /> Webから検索・再生</h2>
          <p className="mt-1 text-[11px] text-[#7d8795]">検索語またはYouTube URLを送り、yt-dlp・YouTube・SoundCloudから候補を選んで再生します。</p>
        </div>
        <form onSubmit={searchMusic} className="grid gap-3 bg-[#fafbfc] p-5 sm:grid-cols-[220px_1fr_auto]">
          <select value={selectedGuildId} onChange={(event) => { setSelectedGuildId(event.target.value); setSearchCandidates([]); }} required className="h-10 rounded-md border border-[#d8dde5] bg-white px-3 text-xs">
            <option value="">Discordサーバーを選択</option>
            {playbackData.states.map((state) => <option key={state.guildId} value={state.guildId}>{state.guildName || state.guildId}</option>)}
          </select>
          <input name="query" required maxLength={500} placeholder="曲名、アーティスト、YouTube URL" className="h-10 rounded-md border border-[#d8dde5] bg-white px-3 text-xs outline-none focus:border-[#0051c3]" />
          <button disabled={pending === "search" || !selectedGuildId} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#171a20] px-5 text-xs font-semibold text-white disabled:opacity-50">{pending === "search" ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />} 候補を検索</button>
        </form>
        {searchCandidates.length ? <div className="grid gap-px border-t border-[#e2e6eb] bg-[#e8ebef] sm:grid-cols-2 xl:grid-cols-3">
          {searchCandidates.map((candidate, index) => <button key={`${candidate.uri}:${index}`} type="button" disabled={pending?.startsWith("play:")} onClick={() => void playCandidate(candidate)} className="flex min-h-20 items-center gap-3 bg-white p-4 text-left hover:bg-[#f7f9fb] disabled:opacity-50">
            {candidate.thumbnailUrl ? <span role="img" aria-label="" className="h-12 w-20 shrink-0 rounded bg-cover bg-center" style={{ backgroundImage: `url(${JSON.stringify(candidate.thumbnailUrl).slice(1, -1)})` }} /> : <span className="grid h-12 w-20 shrink-0 place-items-center rounded bg-[#f2f4f7]"><Music2 className="size-5 text-[#8792a2]" /></span>}
            <span className="min-w-0"><span className="block truncate text-xs font-semibold">{candidate.title}</span><span className="mt-1 block truncate text-[9px] text-[#7d8795]">{candidate.author} · {durationLabel(candidate.duration)} · {candidate.resolver || candidate.source}</span></span>
          </button>)}
        </div> : null}
      </section>

      <section className="cp-panel mt-6 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e2e6eb] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold"><HardDrive className="size-4 text-[#6c55d9]" /> PCローカル音源</h2>
            <p className="mt-1 text-[11px] text-[#7d8795]">FLAC / WAV / MP3 / M4A対応。R2を一時搬送に使い、PC保存後はR2から削除します。256kbps超とロスレス音源はAACへ変換します。</p>
          </div>
          <span className="rounded-full bg-[#f1efff] px-2.5 py-1 font-mono text-[9px] font-semibold text-[#5c45c2]">{libraryData.localTracks.length}曲 · {formatBytes(libraryData.localTracks.reduce((sum, track) => sum + track.sizeBytes, 0))}</span>
        </div>
        <form onSubmit={uploadLocalAudio} className="grid gap-3 bg-[#fafbfc] p-5 sm:grid-cols-[1fr_auto]">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-dashed border-[#cbd2dc] bg-white px-4 text-xs text-[#657083] hover:border-[#6c55d9]">
            <FileAudio className="size-4 text-[#6c55d9]" />
            <span className="min-w-0 flex-1 truncate">音源を選択（1回10件・1ファイル最大200MB）</span>
            <input name="files" type="file" multiple required accept=".flac,.wav,.mp3,.m4a,audio/flac,audio/wav,audio/mpeg,audio/mp4" className="max-w-52 text-[10px] file:mr-2 file:rounded file:border-0 file:bg-[#ece8ff] file:px-3 file:py-1.5 file:text-[10px] file:font-semibold file:text-[#5c45c2]" />
          </label>
          <button disabled={pending === "local-upload" || !selectedGuildId} className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#6c55d9] px-5 text-xs font-semibold text-white hover:bg-[#5942c4] disabled:opacity-50">
            {pending === "local-upload" ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />} PCへ保存
          </button>
          {pending === "local-upload" ? <div className="sm:col-span-2"><div className="h-1.5 overflow-hidden rounded-full bg-[#e2e6eb]"><div className="h-full rounded-full bg-[#6c55d9] transition-[width]" style={{ width: `${uploadProgress}%` }} /></div><p className="mt-1 text-right font-mono text-[9px] text-[#7d8795]">upload / normalize {uploadProgress}%</p></div> : null}
        </form>
        <div className="max-h-[420px] overflow-auto border-t border-[#e2e6eb]">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="sticky top-0 bg-[#fafbfc] text-[9px] uppercase tracking-[0.08em] text-[#7d8795]"><tr><th className="px-5 py-3">曲</th><th className="px-4 py-3">音声</th><th className="px-4 py-3">長さ / 容量</th><th className="px-4 py-3">追加元</th><th className="px-5 py-3 text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-[#e8ebef]">
              {libraryData.localTracks.map((track) => <tr key={track.id} className="hover:bg-[#fbfcfd]">
                <td className="max-w-[360px] px-5 py-3"><p className="truncate font-semibold">{track.title}</p><p className="mt-1 truncate text-[9px] text-[#8791a0]">{track.artist} · {track.originalFilename}</p><p className="mt-1 font-mono text-[8px] text-[#a0a7b2]">{track.id}</p></td>
                <td className="px-4 py-3"><p className="font-mono text-[10px] font-semibold">{track.bitrateKbps} kbps</p><p className="mt-1 text-[9px] text-[#8791a0]">{track.codec} / {track.format}{track.sampleRateHz ? ` · ${(track.sampleRateHz / 1_000).toFixed(1)}kHz` : ""}{track.channels ? ` · ${track.channels}ch` : ""}</p></td>
                <td className="px-4 py-3"><p className="font-mono text-[10px]">{durationLabel(track.durationMs)}</p><p className="mt-1 text-[9px] text-[#8791a0]">{formatBytes(track.sizeBytes)}</p></td>
                <td className="px-4 py-3"><span className="rounded-full bg-[#f1f3f6] px-2 py-1 text-[9px] font-medium text-[#697586]">{track.uploadedVia === "web-ui" ? "Web UI" : "Discord"}</span><p className="mt-1 text-[8px] text-[#9aa2ae]">{dateLabel(track.createdAt)}</p></td>
                <td className="px-5 py-3"><div className="flex justify-end gap-2"><button type="button" disabled={Boolean(pending)} onClick={() => void playLocalAudio(track.id, track.title)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#171a20] px-3 text-[10px] font-semibold text-white disabled:opacity-40"><Play className="size-3" /> 再生</button><button type="button" disabled={Boolean(pending)} onClick={() => void deleteLocalAudio(track.id, track.title)} className="grid size-8 place-items-center rounded-md border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40"><Trash2 className="size-3" /></button></div></td>
              </tr>)}
              {!libraryData.localTracks.length ? <tr><td colSpan={5} className="px-5 py-12 text-center text-[#8a94a3]"><FileAudio className="mx-auto mb-2 size-6 text-[#b0b7c1]" />Discordの <code>/music upload</code> または上のフォームから追加できます。</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="flex items-center gap-2 text-sm font-semibold"><Radio className="size-4 text-emerald-600" /> リアルタイム再生状況</h2><p className="mt-1 text-[11px] text-[#7d8795]">BotからDBへ同期し、2秒ごとに自動更新します。</p></div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9px] font-semibold ${playback.error ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{playback.error ? "更新待ち" : "LIVE"}</span>
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          {playbackStates.map((state) => {
            const age = new Date(playbackData.generatedAt).getTime() - new Date(state.updatedAt).getTime();
            const fresh = age < (!state.connected && !state.currentTrack ? 90_000 : 12_000);
            const status = statusPresentation(state.status, fresh);
            const duration = state.currentTrack?.duration ?? 0;
            const progress = duration > 0 ? Math.min(100, Math.max(0, state.positionMs / duration * 100)) : 0;
            const transferred = transferredBytes(
              state.positionMs,
              state.currentTrack?.audioBitrateKbps,
              state.currentTrack?.contentLength,
            );
            const controlsDisabled = !fresh || !state.currentTrack || pending?.startsWith(`control:${state.guildId}:`);
            const repeat = repeatPresentation(state.currentTrack?.repeatMode);
            return (
              <article key={state.guildId} className="cp-panel flex min-h-[560px] flex-col overflow-hidden">
                <div className="flex items-start justify-between gap-3 border-b border-[#e4e8ed] px-5 py-4">
                  <div><p className="font-semibold text-[#242b35]">{state.guildName || `Discord server ${state.guildId}`}</p><p className="mt-1 font-mono text-[9px] text-[#8a94a3]">{state.voiceChannelName ? `🔊 ${state.voiceChannelName}` : `guild ${state.guildId}`}</p></div>
                  <div className="flex items-center gap-2"><button type="button" disabled={pending === `autoplay:${state.guildId}`} onClick={() => void mutateMusic({ action: "setAutoplay", guildId: state.guildId, enabled: !state.autoplayRelated }, `autoplay:${state.guildId}`, `関連曲オートプレイを${state.autoplayRelated ? "無効" : "有効"}にしました。`)} className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold ${state.autoplayRelated ? "border-violet-200 bg-violet-50 text-violet-700" : "border-[#d9dee7] bg-white text-[#788291]"}`}>∞ AUTO {state.autoplayRelated ? "ON" : "OFF"}</button><span className={`rounded-full px-2.5 py-1 font-mono text-[9px] font-semibold ${status.className}`}>{status.label}</span></div>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <div className="min-h-[150px]">
                  {state.currentTrack ? <>
                    <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-md bg-[#f3f0ff] text-[#6c55d9]"><Music2 className="size-5" /></div><div className="min-w-0"><a href={state.currentTrack.uri} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold text-[#263143] hover:text-[#0051c3] hover:underline">{state.currentTrack.title}</a><p className="mt-1 truncate text-[11px] text-[#748094]">{state.currentTrack.author} · {state.currentTrack.source}</p></div></div>
                    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#e8ebef]"><div className="h-full rounded-full bg-[#ff66aa] transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
                    <div className="mt-2 flex justify-between font-mono text-[9px] text-[#7c8695]"><span>{durationLabel(state.positionMs)}</span><span>{durationLabel(duration)}</span></div>
                    <div className="mt-4 grid grid-cols-5 gap-1.5">
                      <button type="button" aria-label="10秒戻る" disabled={controlsDisabled} onClick={() => void controlMusic(state.guildId, "seek", Math.max(0, state.positionMs - 10_000))} className="grid h-9 place-items-center rounded-md border border-[#d9dee5] bg-white text-[#576273] hover:bg-[#f4f6f8] disabled:opacity-40"><Rewind className="size-3.5" /></button>
                      <button type="button" aria-label={state.paused ? "再開" : "一時停止"} disabled={controlsDisabled} onClick={() => void controlMusic(state.guildId, "toggle")} className="grid h-9 place-items-center rounded-md bg-[#171a20] text-white hover:bg-black disabled:opacity-40">{state.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}</button>
                      <button type="button" aria-label="10秒進む" disabled={controlsDisabled} onClick={() => void controlMusic(state.guildId, "seek", Math.min(duration || state.positionMs + 10_000, state.positionMs + 10_000))} className="grid h-9 place-items-center rounded-md border border-[#d9dee5] bg-white text-[#576273] hover:bg-[#f4f6f8] disabled:opacity-40"><FastForward className="size-3.5" /></button>
                      <button type="button" aria-label="スキップ" disabled={controlsDisabled} onClick={() => void controlMusic(state.guildId, "skip")} className="grid h-9 place-items-center rounded-md border border-[#d9dee5] bg-white text-[#576273] hover:bg-[#f4f6f8] disabled:opacity-40"><SkipForward className="size-3.5" /></button>
                      <button type="button" aria-label="停止して退出" disabled={!fresh || !state.connected || Boolean(pending?.startsWith(`control:${state.guildId}:`))} onClick={() => void controlMusic(state.guildId, "stop")} className="grid h-9 place-items-center rounded-md border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40"><Square className="size-3.5" /></button>
                    </div>
                  </> : <div className="grid min-h-[150px] place-items-center rounded-md border border-dashed border-[#dce1e7] bg-[#fafbfc] text-xs text-[#8a94a3]">再生中の曲はありません</div>}
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-px overflow-hidden rounded-md border border-[#e1e5ea] bg-[#e1e5ea] text-center">
                    <div className="bg-white px-2 py-2.5"><p className="text-[9px] text-[#8a94a3]">PLAYER</p><p className="mt-1 flex items-center justify-center gap-1 text-[11px] font-semibold">{state.paused ? <Pause className="size-3" /> : <Play className="size-3" />} {state.paused ? "Pause" : "Play"}</p></div>
                    <div className="bg-white px-2 py-2.5"><p className="text-[9px] text-[#8a94a3]">VOLUME</p><p className="mt-1 flex items-center justify-center gap-1 text-[11px] font-semibold"><Volume2 className="size-3" /> {state.volume}%</p></div>
                    <div className="bg-white px-2 py-2.5"><p className="text-[9px] text-[#8a94a3]">QUEUE</p><p className="mt-1 text-[11px] font-semibold">{state.queue.length}曲</p></div>
                    <button type="button" disabled={!fresh || !state.connected || Boolean(pending?.startsWith(`control:${state.guildId}:`))} onClick={() => void controlMusic(state.guildId, "repeat", repeat.value)} className={`px-2 py-2.5 disabled:opacity-40 ${repeat.label === "OFF" ? "bg-white" : "bg-[#f0ecff] text-[#5c45c2]"}`}><p className="text-[9px] text-[#8a94a3]">LOOP</p><p className="mt-1 text-[11px] font-semibold">🔁 {repeat.label}</p></button>
                  </div>
                  <div className="mt-2 flex items-center gap-2 rounded-md border border-[#e1e5ea] bg-[#fafbfc] px-3 py-2">
                    <Volume2 className="size-3.5 text-[#697586]" />
                    <button type="button" disabled={!fresh || !state.connected || Boolean(pending?.startsWith(`control:${state.guildId}:`))} onClick={() => void controlMusic(state.guildId, "volume", Math.max(0, state.volume - 10))} className="rounded border border-[#d8dde5] bg-white px-2 py-1 font-mono text-[9px] font-semibold disabled:opacity-40">−10</button>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e2e6eb]"><div className="h-full rounded-full bg-[#6c55d9]" style={{ width: `${Math.min(100, state.volume / 1.5)}%` }} /></div>
                    <button type="button" disabled={!fresh || !state.connected || Boolean(pending?.startsWith(`control:${state.guildId}:`))} onClick={() => void controlMusic(state.guildId, "volume", Math.min(150, state.volume + 10))} className="rounded border border-[#d8dde5] bg-white px-2 py-1 font-mono text-[9px] font-semibold disabled:opacity-40">+10</button>
                  </div>
                  {state.currentTrack ? <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#e1e5ea] bg-[#e1e5ea] sm:grid-cols-4">
                    <div className="bg-[#fafbfc] px-3 py-2.5"><p className="text-[8px] uppercase tracking-wide text-[#8a94a3]">Bitrate</p><p className="mt-1 font-mono text-[10px] font-semibold">{state.currentTrack.audioBitrateKbps ? `${Math.round(state.currentTrack.audioBitrateKbps)} kbps` : "—"}</p></div>
                    <div className="bg-[#fafbfc] px-3 py-2.5"><p className="text-[8px] uppercase tracking-wide text-[#8a94a3]">Codec</p><p className="mt-1 font-mono text-[10px] font-semibold">{state.currentTrack.audioCodec || "—"}{state.currentTrack.container ? ` / ${state.currentTrack.container}` : ""}</p></div>
                    <div className="bg-[#fafbfc] px-3 py-2.5"><p className="text-[8px] uppercase tracking-wide text-[#8a94a3]">Audio</p><p className="mt-1 font-mono text-[10px] font-semibold">{state.currentTrack.audioSampleRateHz ? `${(state.currentTrack.audioSampleRateHz / 1_000).toFixed(1)} kHz` : "—"}{state.currentTrack.audioChannels ? ` · ${state.currentTrack.audioChannels}ch` : ""}</p></div>
                    <div className="bg-[#fafbfc] px-3 py-2.5"><p className="text-[8px] uppercase tracking-wide text-[#8a94a3]">Transferred</p><p className="mt-1 font-mono text-[10px] font-semibold">{formatBytes(transferred)} / {formatBytes(state.currentTrack.contentLength)}</p></div>
                  </div> : null}
                  <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#e1e5ea] bg-[#e1e5ea] sm:grid-cols-5">
                    <div className="bg-white px-3 py-2.5"><p className="text-[8px] uppercase tracking-wide text-[#8a94a3]">Voice ping</p><p className={`mt-1 font-mono text-[10px] font-semibold ${state.voicePingMs !== null && state.voicePingMs > 180 ? "text-red-600" : "text-emerald-700"}`}>{state.voicePingMs === null ? "—" : `${state.voicePingMs} ms`}</p></div>
                    <div className="bg-white px-3 py-2.5"><p className="text-[8px] uppercase tracking-wide text-[#8a94a3]">Frame loss</p><p className={`mt-1 font-mono text-[10px] font-semibold ${(state.frameLossPercent ?? 0) > 2 ? "text-red-600" : "text-emerald-700"}`}>{state.frameLossPercent === null ? "—" : `${state.frameLossPercent.toFixed(2)}%`}</p></div>
                    <div className="bg-white px-3 py-2.5"><p className="text-[8px] uppercase tracking-wide text-[#8a94a3]">Node uptime</p><p className="mt-1 font-mono text-[10px] font-semibold">{state.nodeUptimeMs === null ? "—" : durationLabel(state.nodeUptimeMs)}</p></div>
                    <div className="bg-white px-3 py-2.5"><p className="text-[8px] uppercase tracking-wide text-[#8a94a3]">Recovery</p><p className="mt-1 font-mono text-[10px] font-semibold">{state.reconnectAttempts}回</p></div>
                    <div className="bg-white px-3 py-2.5"><p className="text-[8px] uppercase tracking-wide text-[#8a94a3]">Recovered</p><p className="mt-1 font-mono text-[9px] font-semibold">{state.lastRecoveredAt ? dateLabel(state.lastRecoveredAt) : "—"}</p></div>
                  </div>
                  {state.currentTrack?.resolver ? <p className="mt-2 font-mono text-[8px] text-[#929aa6]">resolver {state.currentTrack.resolver}{state.currentTrack.videoId ? ` · youtube ${state.currentTrack.videoId}` : ""}</p> : null}
                  {state.queue.length ? <div className="mt-3 overflow-hidden rounded-md border border-[#e1e5ea]">
                    <div className="flex items-center justify-between bg-[#fafbfc] px-3 py-2"><p className="text-[9px] font-semibold uppercase tracking-wide text-[#6d7787]">待機キュー</p><span className="text-[8px] text-[#929aa6]">ドラッグして並べ替え</span></div>
                    <div className="max-h-44 divide-y divide-[#edf0f3] overflow-y-auto">{state.queue.map((track, index) => <div
                      key={track.queueEntryId || `${track.uri}:${index}`}
                      draggable={Boolean(track.queueEntryId)}
                      onDragStart={() => track.queueEntryId && setDraggedQueueEntry({ guildId: state.guildId, id: track.queueEntryId })}
                      onDragEnd={() => setDraggedQueueEntry(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => track.queueEntryId && void reorderQueue(state.guildId, track.queueEntryId)}
                      className="flex cursor-grab items-center gap-2 bg-white px-3 py-2 active:cursor-grabbing"
                    ><GripVertical className="size-3 shrink-0 text-[#a4acb7]" /><span className="w-4 font-mono text-[8px] text-[#9ba3ae]">{index + 1}</span><span className="min-w-0 flex-1 truncate text-[10px] font-medium">{track.title}</span><span className="text-[8px] text-[#8b94a1]">{durationLabel(track.duration)}</span></div>)}</div>
                  </div> : null}
                  {state.issue ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-[10px] leading-4 text-red-700">{state.issue.title}: {state.issue.detail}</p> : null}
                  <p className="mt-3 text-right font-mono text-[9px] text-[#929aa6]">同期 {dateLabel(state.updatedAt)}</p>
                </div>
              </article>
            );
          })}
          {!playbackData.states.length ? <div className="cp-panel grid min-h-48 place-items-center p-6 text-center text-xs text-[#7d8795] xl:col-span-2"><div><Radio className="mx-auto mb-3 size-6 text-[#a5adba]" /><p>再生状態はまだ同期されていません。</p><p className="mt-1 text-[10px]">更新後のBotを起動すると、ここにサーバーごとの状態が表示されます。</p></div></div> : null}
        </div>
      </section>

      <section className="mt-7">
        <div><h2 className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="size-4 text-[#f48120]" /> 音楽利用・Resolver統計</h2><p className="mt-1 text-[11px] text-[#7d8795]">直近30日。ユーザー別の再生時間・リクエスト数と、yt-dlp / YouTube / SoundCloudの成功率です。</p></div>
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <div className="cp-panel overflow-hidden"><div className="border-b border-[#e3e7ec] px-4 py-3 text-xs font-semibold">ユーザー別</div><div className="max-h-64 overflow-auto"><table className="w-full text-left text-[10px]"><thead className="bg-[#fafbfc] text-[#7d8795]"><tr><th className="px-4 py-2">Discord User</th><th className="px-3 py-2">再生時間</th><th className="px-3 py-2">Request</th><th className="px-3 py-2">Skip</th></tr></thead><tbody className="divide-y divide-[#edf0f3]">{analytics.data?.users.map((row) => <tr key={row.discordUserId}><td className="px-4 py-2 font-mono">{row.discordUserId}</td><td className="px-3 py-2 font-semibold">{durationLabel(row.playbackMs)}</td><td className="px-3 py-2">{row.requestCount}</td><td className="px-3 py-2">{row.skipped}</td></tr>)}{!analytics.data?.users.length ? <tr><td colSpan={4} className="p-6 text-center text-[#8b94a1]">集計できる履歴がまだありません。</td></tr> : null}</tbody></table></div></div>
          <div className="cp-panel overflow-hidden"><div className="border-b border-[#e3e7ec] px-4 py-3 text-xs font-semibold">Resolver別</div><div className="divide-y divide-[#edf0f3]">{analytics.data?.resolvers.map((row) => <div key={row.resolver} className="px-4 py-3"><div className="flex items-center justify-between gap-3"><span className="font-mono text-[10px] font-semibold">{row.resolver}</span><span className="text-[10px] font-semibold text-emerald-700">{(row.successRate * 100).toFixed(1)}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e8ebef]"><div className="h-full bg-emerald-500" style={{ width: `${row.successRate * 100}%` }} /></div><p className="mt-1 text-[8px] text-[#8a94a3]">{row.successes}/{row.attempts} success · avg {row.averageLatencyMs} ms{row.lastError ? ` · last: ${row.lastError}` : ""}</p></div>)}{!analytics.data?.resolvers.length ? <p className="p-6 text-center text-[10px] text-[#8b94a1]">Bot更新後の検索から記録を開始します。</p> : null}</div></div>
        </div>
      </section>

      <section className="mt-7">
        <div><h2 className="flex items-center gap-2 text-sm font-semibold"><ListMusic className="size-4 text-[#6c55d9]" /> プレイリスト</h2><p className="mt-1 text-[11px] text-[#7d8795]">URLから曲を追加するか、現在の再生キューをそのまま取り込めます。</p></div>
        <form onSubmit={createPlaylist} className="cp-panel mt-3 grid gap-3 p-4 lg:grid-cols-[180px_minmax(180px,0.8fr)_minmax(240px,1.5fr)_auto]">
          {guildOptions.length ? <select name="guildId" required className="h-9 rounded-md border border-[#d8dde5] bg-white px-3 text-xs outline-none focus:border-[#0051c3]">{guildOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select> : <input name="guildId" required placeholder="Discord Guild ID" className="h-9 rounded-md border border-[#d8dde5] px-3 text-xs outline-none focus:border-[#0051c3]" />}
          <input name="name" required maxLength={80} placeholder="プレイリスト名" className="h-9 rounded-md border border-[#d8dde5] px-3 text-xs outline-none focus:border-[#0051c3]" />
          <input name="description" maxLength={300} placeholder="説明（任意）" className="h-9 rounded-md border border-[#d8dde5] px-3 text-xs outline-none focus:border-[#0051c3]" />
          <button disabled={pending === "create"} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#171a20] px-4 text-xs font-semibold text-white hover:bg-black disabled:opacity-50"><Plus className="size-3.5" /> 作成</button>
        </form>
        <div className="mt-3 grid gap-4 xl:grid-cols-2">
          {libraryData.playlists.map((playlist) => (
            <article key={playlist.id} className="cp-panel overflow-hidden">
              <div className="flex items-start justify-between gap-3 border-b border-[#e3e7ec] px-5 py-4"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{playlist.name}</h3><p className="mt-1 text-[10px] text-[#7f8997]">{playlist.description || "説明なし"} · {playlist.tracks.length}曲 · guild {playlist.guildId}</p><p className="mt-1 font-mono text-[8px] text-[#a0a7b2]">ID {playlist.id}</p></div><button type="button" disabled={pending === `playlist:${playlist.id}`} onClick={() => { if (window.confirm(`「${playlist.name}」を削除しますか？`)) void mutateMusic({ action: "deletePlaylist", playlistId: playlist.id }, `playlist:${playlist.id}`, "プレイリストを削除しました。"); }} className="rounded-md border border-red-200 bg-red-50 p-2 text-red-600 hover:bg-red-100"><Trash2 className="size-3.5" /></button></div>
              <div className="max-h-72 divide-y divide-[#edf0f3] overflow-y-auto">
                {playlist.tracks.map((track, index) => <div key={track.id} className="flex items-center gap-3 px-5 py-3"><span className="w-5 text-right font-mono text-[9px] text-[#9aa2ae]">{index + 1}</span><div className="min-w-0 flex-1"><a href={track.uri} target="_blank" rel="noreferrer" className="block truncate text-xs font-medium hover:text-[#0051c3] hover:underline">{track.title}</a><p className="mt-0.5 truncate text-[9px] text-[#88919f]">{track.author} · {track.source} · {durationLabel(track.duration)}</p></div><button type="button" aria-label="曲を削除" onClick={() => void mutateMusic({ action: "deleteTrack", trackId: track.id }, `track:${track.id}`, "曲をプレイリストから削除しました。") } className="p-1.5 text-[#9ba3ae] hover:text-red-600"><Trash2 className="size-3" /></button></div>)}
                {!playlist.tracks.length ? <p className="px-5 py-8 text-center text-[11px] text-[#929aa6]">曲はまだありません。</p> : null}
              </div>
              <div className="border-t border-[#e3e7ec] bg-[#fafbfc] p-4">
                <form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); void mutateMusic({ action: "addTrack", playlistId: playlist.id, title: values.get("title"), author: values.get("author"), uri: values.get("uri") }, `add:${playlist.id}`, "曲を追加しました。").then((added) => { if (added) form.reset(); }); }} className="grid gap-2 sm:grid-cols-2">
                  <input name="title" required maxLength={200} placeholder="曲名" className="h-8 rounded-md border border-[#d9dee5] bg-white px-2.5 text-[10px] outline-none focus:border-[#0051c3]" />
                  <input name="author" maxLength={120} placeholder="アーティスト（任意）" className="h-8 rounded-md border border-[#d9dee5] bg-white px-2.5 text-[10px] outline-none focus:border-[#0051c3]" />
                  <input name="uri" type="url" required placeholder="YouTube / SoundCloud URL" className="h-8 rounded-md border border-[#d9dee5] bg-white px-2.5 text-[10px] outline-none focus:border-[#0051c3] sm:col-span-2" />
                  <button disabled={pending === `add:${playlist.id}`} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[#cfd6df] bg-white text-[10px] font-semibold hover:bg-[#f3f5f7]"><Link2 className="size-3" /> URLを追加</button>
                  <button type="button" disabled={!playbackData.states.some((state) => state.guildId === playlist.guildId && (state.currentTrack || state.queue.length)) || pending === `queue:${playlist.id}`} onClick={() => void mutateMusic({ action: "importQueue", playlistId: playlist.id, guildId: playlist.guildId }, `queue:${playlist.id}`, "現在のキューを取り込みました。")} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#ece8ff] text-[10px] font-semibold text-[#5c45c2] hover:bg-[#e3ddff] disabled:cursor-not-allowed disabled:opacity-50"><ListMusic className="size-3" /> 現在のキューを追加</button>
                </form>
                <form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const url = new FormData(form).get("url"); void mutateMusic({ action: "importYoutubePlaylist", playlistId: playlist.id, guildId: playlist.guildId, url }, `youtube:${playlist.id}`, "YouTubeプレイリストの取り込みを開始しました。完了後に一覧へ反映されます。").then((ok) => { if (ok) window.setTimeout(() => void library.mutate(), 4_000); }); }} className="mt-3 flex gap-2">
                  <input name="url" type="url" required placeholder="YouTubeプレイリストURL" className="h-8 min-w-0 flex-1 rounded-md border border-[#d9dee5] bg-white px-2.5 text-[10px]" />
                  <button disabled={pending === `youtube:${playlist.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-[10px] font-semibold text-red-700"><CirclePlay className="size-3" /> YouTube取込</button>
                </form>
                <form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const url = new FormData(form).get("url"); void mutateMusic({ action: "importSpotifyPlaylist", playlistId: playlist.id, url }, `spotify:${playlist.id}`, "Spotifyの曲名を取り込みました。再生時にYouTube音源へ解決します。"); }} className="mt-2 flex gap-2">
                  <input name="url" required placeholder="SpotifyプレイリストURL / URI" className="h-8 min-w-0 flex-1 rounded-md border border-[#d9dee5] bg-white px-2.5 text-[10px]" />
                  <button disabled={pending === `spotify:${playlist.id}`} className="h-8 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-semibold text-emerald-700">Spotify取込</button>
                </form>
              </div>
            </article>
          ))}
          {!libraryData.playlists.length ? <div className="cp-panel grid min-h-40 place-items-center p-6 text-center text-xs text-[#8a94a3] xl:col-span-2">上のフォームから最初のプレイリストを作成できます。</div> : null}
        </div>
      </section>

      <section className="mt-7">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><History className="size-4 text-[#0051c3]" /> 再生履歴</h2><p className="mt-1 text-[11px] text-[#7d8795]">{libraryData.history.length.toLocaleString()} / {libraryData.historyTotal.toLocaleString()}件を表示。履歴からプレイリストへ再追加できます。</p></div><button type="button" onClick={() => { if (window.confirm("すべての再生履歴を削除しますか？")) void mutateMusic({ action: "clearHistory", guildId: null }, "history:clear", "再生履歴を削除しました。"); }} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-[10px] font-semibold text-red-700 hover:bg-red-100"><Trash2 className="size-3" /> 履歴を全削除</button></div>
        <div className="cp-panel mt-3 overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-[#fafbfc] text-[9px] uppercase tracking-[0.08em] text-[#7d8795]"><tr><th className="px-5 py-3 font-semibold">曲</th><th className="px-4 py-3 font-semibold">Server</th><th className="px-4 py-3 font-semibold">開始</th><th className="px-4 py-3 font-semibold">終了理由</th><th className="px-4 py-3 font-semibold">プレイリストへ</th><th className="px-5 py-3 text-right font-semibold">削除</th></tr></thead><tbody className="divide-y divide-[#e8ebef]">
            {libraryData.history.map((entry) => <tr key={entry.id} className="hover:bg-[#fbfcfd]"><td className="max-w-[390px] px-5 py-3"><a href={entry.uri} target="_blank" rel="noreferrer" className="block truncate font-medium hover:text-[#0051c3] hover:underline">{entry.title}</a><p className="mt-1 truncate text-[9px] text-[#8a94a3]">{entry.author} · {entry.source} · {durationLabel(entry.duration)}</p></td><td className="px-4 py-3 font-mono text-[9px] text-[#667184]">{entry.guildId}</td><td className="px-4 py-3 text-[10px] text-[#667184]"><span className="inline-flex items-center gap-1"><Clock3 className="size-3" /> {dateLabel(entry.startedAt)}</span></td><td className="px-4 py-3 font-mono text-[9px] text-[#667184]">{entry.endReason || "再生中"}</td><td className="px-4 py-3">{libraryData.playlists.some((playlist) => playlist.guildId === entry.guildId) ? <form onSubmit={(event) => { event.preventDefault(); const playlistId = new FormData(event.currentTarget).get("playlistId"); void mutateMusic({ action: "addTrack", playlistId, title: entry.title, author: entry.author, uri: entry.uri, source: entry.source, duration: entry.duration }, `history-add:${entry.id}`, "履歴からプレイリストへ追加しました。"); }} className="flex gap-1.5"><select name="playlistId" className="h-7 max-w-36 rounded border border-[#d8dde5] bg-white px-1.5 text-[9px]">{libraryData.playlists.filter((playlist) => playlist.guildId === entry.guildId).map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}</select><button className="h-7 rounded border border-[#d8dde5] bg-white px-2 text-[9px] font-semibold hover:bg-[#f4f6f8]">追加</button></form> : <span className="text-[9px] text-[#9ca4af]">同サーバーのリストなし</span>}</td><td className="px-5 py-3 text-right"><button type="button" onClick={() => void mutateMusic({ action: "deleteHistory", historyId: entry.id }, `history:${entry.id}`, "履歴を1件削除しました。") } className="p-1.5 text-[#9ba3ae] hover:text-red-600"><Trash2 className="size-3" /></button></td></tr>)}
            {!libraryData.history.length ? <tr><td colSpan={6} className="px-5 py-14 text-center text-[#8a94a3]">再生履歴はまだありません。</td></tr> : null}
          </tbody></table></div>
          {libraryData.history.length < libraryData.historyTotal ? <div className="border-t border-[#e3e7ec] p-3 text-center"><button type="button" disabled={library.isLoading} onClick={() => setHistoryLimit((value) => value + 100)} className="inline-flex h-8 items-center gap-2 rounded-md border border-[#d8dde5] bg-white px-4 text-[10px] font-semibold hover:bg-[#f5f6f8]">{library.isLoading ? <LoaderCircle className="size-3 animate-spin" /> : <Plus className="size-3" />} さらに100件</button></div> : null}
        </div>
      </section>
    </div>
  );
}

import { RequestError } from "../../lib/client/request-json";

type JobState = {
  status: string;
  progress: number;
  message?: string;
  metadata?: Record<string, unknown> | null;
  videoUrl?: string | null;
  error?: string | null;
  errorCode?: string | null;
  cancelRequested?: boolean;
  requestSource?: string;
  scheduledAt?: string | null;
};

const PHASES: Record<string, { label: string; stage: number; detail: string }> = {
  queued: { label: "待機中", stage: 0, detail: "受付済みです。予約時刻・実行枠・Rendererの接続を待っています。" },
  claimed: { label: "開始準備", stage: 0, detail: "Rendererがジョブを受け取りました。" },
  resolving_score: { label: "スコア取得", stage: 0, detail: "osu!からスコアの詳細を取得しています。" },
  downloading_replay: { label: "リプレイ取得", stage: 0, detail: "レンダーに必要なリプレイを取得しています。" },
  resolving_beatmap: { label: "譜面準備", stage: 0, detail: "譜面・音源・スキンを準備しています。" },
  rendering: { label: "レンダリング", stage: 1, detail: "プレイ映像を生成しています。高解像度・高FPSでは時間がかかります。" },
  encoding: { label: "圧縮・エンコード", stage: 2, detail: "映像を圧縮しています。この段階では進捗の数字がしばらく変わらない場合があります。" },
  uploading: { label: "アップロード", stage: 3, detail: "動画を送信・確認しています。回線速度やYouTube側の応答で時間がかかる場合があります。" },
  completed: { label: "レンダー完了", stage: 4, detail: "動画が完成しました。YouTubeへの投稿結果は別に確認してください。" },
  failed: { label: "失敗", stage: -1, detail: "原因を確認してから再実行してください。" },
  cancelled: { label: "キャンセル済み", stage: -1, detail: "このジョブの処理を終了しました。" },
};

export function renderPhase(job: JobState) {
  const phase = PHASES[job.status] ?? { label: job.status, stage: -1, detail: "詳細メッセージを確認してください。" };
  return {
    ...phase,
    label: job.cancelRequested && !isRenderTerminal(job.status) ? "キャンセル要求中" : phase.label,
    progress: Number.isFinite(job.progress) ? Math.max(0, Math.min(100, job.progress)) : 0,
    tone: job.status === "failed" ? "bg-red-50 text-red-700" : job.status === "completed" ? "bg-emerald-50 text-emerald-700" : job.status === "cancelled" ? "bg-slate-100 text-slate-600" : "bg-blue-50 text-blue-700",
  };
}

export function isRenderTerminal(status: string) {
  return ["completed", "failed", "cancelled"].includes(status);
}

export function renderPollingInterval(job?: { status: string }) {
  if (job && isRenderTerminal(job.status)) return 0;
  return job?.status === "queued" ? 8_000 : job?.status === "uploading" ? 5_000 : 2_500;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function youtubeVideoUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host) ? url.href : null;
  } catch { return null; }
}

export function youtubeOutcome(job: JobState) {
  const url = youtubeVideoUrl(job.metadata?.youtube_url) ?? youtubeVideoUrl(job.videoUrl);
  const error = stringValue(job.metadata?.youtube_error);
  const privacy = stringValue(job.metadata?.youtube_privacy_status);
  const privacyLabel = privacy === "public" ? "公開" : privacy === "unlisted" ? "限定公開" : privacy === "private" ? "非公開" : "公開範囲未確認";
  if (url) return { kind: "uploaded", label: `YouTube投稿済み · ${privacyLabel}`, detail: "YouTubeの動画リンクを取得済みです。画質の処理はYouTube側で続く場合があります。", url, error: null };
  if (error) return { kind: "failed", label: "YouTube投稿に失敗", detail: "動画の完成とYouTube投稿の成功は別です。設定・ログで原因を確認してください。", url: null, error };
  if (job.status === "uploading") return { kind: "uploading", label: "アップロード先を確認中", detail: "YouTubeへの投稿完了はまだ確認されていません。詳細メッセージを確認してください。", url: null, error: null };
  if (job.status === "completed") return { kind: "unconfirmed", label: "YouTube投稿未確認", detail: "この履歴にはYouTubeの動画リンクがありません。外部ストレージへの保存だけで完了している場合があります。", url: null, error: null };
  return { kind: "pending", label: "YouTube投稿はレンダー後", detail: "自動投稿が有効で、YouTube認証が利用可能な場合に投稿します。", url: null, error: null };
}

export function renderSourceLabel(job: JobState) {
  const source = job.requestSource ?? job.metadata?.request_source;
  if (source === "automatic") return "自動";
  if (source === "scheduled" || job.scheduledAt) return "予約";
  return "手動";
}

export function missingRenderDependencies(dependencies: Record<string, unknown>) {
  return Object.entries({ danser: "stdレンダー", mania_renderer: "maniaレンダー", ffmpeg: "FFmpeg", osu_songs: "Songsフォルダ", standard_skin: "stdスキン", mania_skin: "maniaスキン", osu_api: "osu! API認証", songs_index_ready: "譜面インデックス" })
    .filter(([key]) => dependencies[key] === false).map(([, label]) => label);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function renderRuntimeHealth(dependencies: Record<string, unknown>) {
  const stats = objectValue(dependencies.render_stats);
  const storage = objectValue(stats.storage);
  const youtube = objectValue(stats.youtube);
  const pending = Number(youtube.pending_count);
  return {
    storageAvailable: typeof storage.available === "boolean" ? storage.available : null,
    songsAvailable: typeof storage.songs_available === "boolean" ? storage.songs_available : null,
    outputAvailable: typeof storage.output_available === "boolean" ? storage.output_available : null,
    youtubeEnabled: typeof youtube.enabled === "boolean" ? youtube.enabled : null,
    youtubeConfigured: typeof youtube.configured === "boolean" ? youtube.configured : typeof dependencies.youtube_upload === "boolean" ? dependencies.youtube_upload : null,
    youtubeAuthStatus: stringValue(youtube.auth_status),
    youtubePendingCount: Number.isFinite(pending) && pending >= 0 ? pending : null,
    youtubeLastError: stringValue(youtube.last_error),
    youtubeNextRetryAt: stringValue(youtube.next_retry_at),
  };
}

export function formatRenderTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Tokyo" }).format(new Date(value));
}

/** Keep server diagnostics, but do not display an HTML proxy error or JSON parser stack. */
export async function readRenderResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = response.status === 401 ? "ログインの有効期限が切れました。再ログインしてください。" : stringValue(payload?.error) ?? `${fallback}（HTTP ${response.status}）`;
    const code = stringValue(payload?.errorCode);
    throw new RequestError(code ? `${message} [${code}]` : message, response.status);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RequestError("サーバーの応答を確認できませんでした。待機列を更新し、受付済みか確認してください。", 502);
  }
  return payload as T;
}

export function renderOperationError(error: unknown, fallback: string) {
  if (error instanceof Error && ["TimeoutError", "AbortError", "TypeError"].includes(error.name)) {
    return "通信が途切れたため、操作の完了を確認できません。重複送信を避けるため待機列を更新し、受付済みか確認してから再試行してください。";
  }
  return error instanceof Error ? error.message : fallback;
}

import type { Attachment } from "discord.js";

export type RendererHealth = {
  status: "online" | "degraded";
  busy: boolean;
  queue_size: number;
  rendering: number;
  danser: boolean;
  ffmpeg: boolean;
  osu_songs: boolean;
  osu_api: boolean;
  nvenc: boolean;
  songs_index_ready: boolean;
  songs_index_count: number;
  songs_index_error?: string | null;
};

export type RenderMetadata = {
  score_id: number | null;
  player_name: string | null;
  user_id: number | null;
  beatmap_id: number | null;
  beatmapset_id: number | null;
  artist: string | null;
  title: string | null;
  difficulty: string | null;
  mapper: string | null;
  ruleset: string;
  mods: string[];
  score: number | null;
  accuracy: number | null;
  max_combo: number | null;
  miss_count: number | null;
  ended_at: string | null;
  has_replay: boolean | null;
};

export type RenderJobStatus = {
  job_id: string;
  status: "created" | "resolving_score" | "downloading_replay" | "resolving_beatmap" | "queued" | "rendering" | "encoding" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  queue_position: number | null;
  metadata: RenderMetadata | null;
  options: {
    resolution: string;
    fps: number;
    speed: string;
    motion_blur: boolean;
  };
  error_code: string | null;
  error: string | null;
  render_duration_seconds: number | null;
};

export type RenderOptions = {
  resolution: string;
  fps: number;
  speed: string;
  motionBlur: boolean;
};

export class RendererClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "RendererClientError";
  }
}

function numberEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeRendererBaseUrl(value = process.env.RENDER_SERVER_URL ?? "http://127.0.0.1:8765") {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RendererClientError("INVALID_RENDERER_URL", "RENDER_SERVER_URL が正しくありません。");
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || (url.pathname !== "/" && url.pathname !== "")) {
    throw new RendererClientError("INVALID_RENDERER_URL", "Renderer URL は http://127.0.0.1:<port> のみ使用できます。");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export class RendererClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;

  constructor() {
    this.baseUrl = normalizeRendererBaseUrl();
    this.token = process.env.RENDER_SERVER_TOKEN || undefined;
  }

  async health(): Promise<RendererHealth> {
    return this.requestJson("/health", { method: "GET" }, numberEnv("RENDER_HEALTH_TIMEOUT_MS", 2_000));
  }

  async submitScore(userId: string, url: string, options: RenderOptions): Promise<{ job_id: string }> {
    return this.requestJson("/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "score_url",
        user_id: userId,
        url,
        resolution: options.resolution,
        fps: options.fps,
        speed: options.speed,
        motion_blur: options.motionBlur,
      }),
    });
  }

  async submitReplay(userId: string, replay: Uint8Array, options: RenderOptions): Promise<{ job_id: string }> {
    const replayBuffer = new ArrayBuffer(replay.byteLength);
    new Uint8Array(replayBuffer).set(replay);
    const form = new FormData();
    form.set("type", "replay");
    form.set("user_id", userId);
    form.set("resolution", options.resolution);
    form.set("fps", String(options.fps));
    form.set("speed", options.speed);
    form.set("motion_blur", String(options.motionBlur));
    form.set("replay", new Blob([replayBuffer], { type: "application/octet-stream" }), "replay.osr");
    return this.requestJson("/render", { method: "POST", body: form });
  }

  async getJob(jobId: string): Promise<RenderJobStatus> {
    return this.requestJson(`/jobs/${encodeURIComponent(jobId)}`, { method: "GET" });
  }

  async cancel(jobId: string): Promise<void> {
    await this.requestJson(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  }

  async downloadVideo(jobId: string, maximumBytes: number): Promise<Buffer> {
    const response = await this.request(`/jobs/${encodeURIComponent(jobId)}/video`, { method: "GET" }, numberEnv("RENDER_REQUEST_TIMEOUT_MS", 10_000) * 6);
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
    if (contentLength > maximumBytes) {
      await response.body?.cancel();
      throw new RendererClientError("VIDEO_TOO_LARGE", "動画がDiscordのアップロード上限を超えています。");
    }
    if (!response.body) throw new RendererClientError("VIDEO_DOWNLOAD_FAILED", "動画を取得できませんでした。");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new RendererClientError("VIDEO_TOO_LARGE", "動画がDiscordのアップロード上限を超えています。");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  }

  private async requestJson<T>(path: string, init: RequestInit, timeoutMs = numberEnv("RENDER_REQUEST_TIMEOUT_MS", 10_000)): Promise<T> {
    const response = await this.request(path, init, timeoutMs);
    try {
      return await response.json() as T;
    } catch {
      throw new RendererClientError("INVALID_RENDERER_RESPONSE", "Rendererから不正な応答が返りました。", response.status);
    }
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        let payload: { error_code?: string; error?: string } = {};
        try { payload = await response.json() as typeof payload; } catch { /* non-JSON error */ }
        throw new RendererClientError(payload.error_code ?? "RENDERER_ERROR", payload.error ?? `Renderer HTTP ${response.status}`, response.status);
      }
      return response;
    } catch (error) {
      if (error instanceof RendererClientError) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new RendererClientError("RENDERER_TIMEOUT", "Rendererとの通信がタイムアウトしました。");
      }
      throw new RendererClientError("RENDERER_OFFLINE", "Rendererへ接続できません。");
    }
  }
}

const DISCORD_ATTACHMENT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export async function downloadDiscordReplay(attachment: Attachment, maximumBytes: number): Promise<Uint8Array> {
  if (attachment.size <= 0 || attachment.size > maximumBytes) {
    throw new RendererClientError("INVALID_REPLAY", "Replayファイルが空か、サイズ上限を超えています。");
  }
  let url: URL;
  try { url = new URL(attachment.url); } catch {
    throw new RendererClientError("INVALID_REPLAY", "Discord添付URLが正しくありません。");
  }
  if (url.protocol !== "https:" || !DISCORD_ATTACHMENT_HOSTS.has(url.hostname) || url.username || url.password) {
    throw new RendererClientError("INVALID_REPLAY", "Discord以外の添付URLは取得できません。");
  }
  let response: Response;
  try {
    response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new RendererClientError("INVALID_REPLAY", "Replay添付をDiscordから取得できませんでした。");
  }
  if (!response.ok || !response.body) throw new RendererClientError("INVALID_REPLAY", "Replay添付をDiscordから取得できませんでした。");
  const declared = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
  if (declared > maximumBytes) {
    await response.body.cancel();
    throw new RendererClientError("INVALID_REPLAY", "Replayファイルがサイズ上限を超えています。");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new RendererClientError("INVALID_REPLAY", "Replayファイルがサイズ上限を超えています。");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

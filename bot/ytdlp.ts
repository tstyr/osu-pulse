import { execFile } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { basename, dirname, join, resolve as resolvePath } from "node:path";

import { localAudioFile } from "./local-audio";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SEARCH_TIMEOUT_MS = 30_000;
const RESOLVE_TIMEOUT_MS = 45_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;
const STREAM_CACHE_MS = 4 * 60 * 60_000;
const AUDIO_FILE_CACHE_TTL_MS = 24 * 60 * 60_000;
const AUDIO_FILE_CACHE_MAX_BYTES = 512 * 1_024 * 1_024;
const PREFERRED_AUDIO_BITRATE_KBPS = Math.max(32, Math.min(320, Number.parseInt(process.env.MUSIC_PREFERRED_BITRATE_KBPS ?? "256", 10) || 256));
const YOUTUBE_PLAYER_CLIENT = process.env.YT_DLP_YOUTUBE_CLIENT?.trim() || "web_embedded";
const SEARCH_TEMPLATE = "{\"id\":%(id)j,\"title\":%(title)j,\"author\":%(uploader)j,\"duration\":%(duration)j,\"webpageUrl\":%(webpage_url)j,\"thumbnail\":%(thumbnail)j}";
const RESOLVE_TEMPLATE = "{\"id\":%(id)j,\"title\":%(title)j,\"author\":%(uploader)j,\"duration\":%(duration)j,\"webpageUrl\":%(webpage_url)j,\"thumbnail\":%(thumbnail)j,\"streamUrl\":%(url)j,\"abr\":%(abr)j,\"acodec\":%(acodec)j,\"asr\":%(asr)j,\"channels\":%(audio_channels)j,\"filesize\":%(filesize_approx)j,\"ext\":%(ext)j}";

function preferredAudioFormat() {
  return `bestaudio[abr<=?${PREFERRED_AUDIO_BITRATE_KBPS}][acodec!=none]/bestaudio[acodec!=none]/bestaudio`;
}

function youtubeClientArgs() {
  return ["--extractor-args", `youtube:player_client=${YOUTUBE_PLAYER_CLIENT}`];
}

export type YtDlpCandidate = {
  videoId: string;
  title: string;
  author: string;
  duration: number;
  webpageUrl: string;
  thumbnailUrl: string | null;
};

export type YtDlpAudioDetails = YtDlpCandidate & {
  streamUrl: string;
  audioBitrateKbps: number | null;
  audioCodec: string | null;
  audioSampleRateHz: number | null;
  audioChannels: number | null;
  contentLength: number | null;
  container: string | null;
};

type CachedAudio = { details: YtDlpAudioDetails; expiresAt: number };
type CachedAudioFile = { path: string; size: number; lastAccessedAt: number };

const audioCache = new Map<string, CachedAudio>();
const audioFileCache = new Map<string, CachedAudioFile>();
const audioFileLoads = new Map<string, Promise<CachedAudioFile>>();
let proxyServer: Server | null = null;
let proxyReady: Promise<string> | null = null;
let availability: Promise<boolean> | null = null;

function ytDlpBinary() {
  return process.env.YT_DLP_PATH?.trim() || "yt-dlp";
}

function runYtDlp(args: string[], timeout: number) {
  return new Promise<string>((resolve, reject) => {
    execFile(ytDlpBinary(), args, {
      encoding: "utf8",
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message).replace(/\s+/g, " ").trim().slice(0, 500);
        reject(new Error(detail || "yt-dlp failed"));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function candidateFromJson(value: unknown): YtDlpCandidate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !VIDEO_ID_PATTERN.test(row.id) || typeof row.title !== "string") return null;
  return {
    videoId: row.id,
    title: row.title,
    author: typeof row.author === "string" ? row.author : "Unknown artist",
    duration: Math.max(0, Math.round((finiteNumber(row.duration) ?? 0) * 1_000)),
    webpageUrl: typeof row.webpageUrl === "string" ? row.webpageUrl : `https://www.youtube.com/watch?v=${row.id}`,
    thumbnailUrl: typeof row.thumbnail === "string" ? row.thumbnail : null,
  };
}

function parseJsonLines(output: string) {
  return output.split(/\r?\n/).flatMap((line) => {
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
}

export function isYoutubeUrl(value: string) {
  try {
    const url = new URL(value);
    return ["youtube.com", "www.youtube.com", "music.youtube.com", "youtu.be"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isYtDlpAvailable() {
  availability ??= runYtDlp(["--version"], 10_000).then(() => true).catch(() => false);
  return availability;
}

export async function searchYoutubeWithYtDlp(query: string, limit = 5): Promise<YtDlpCandidate[]> {
  if (!await isYtDlpAvailable()) return [];
  const safeLimit = Math.max(1, Math.min(100, Math.round(limit)));
  const direct = isYoutubeUrl(query);
  const parsedUrl = direct ? new URL(query) : null;
  const playlistOnly = Boolean(parsedUrl?.searchParams.get("list") && !parsedUrl.searchParams.get("v") && parsedUrl.hostname !== "youtu.be");
  const args = ["--no-warnings", "--output-na-placeholder", "null", ...youtubeClientArgs()];
  if (!direct || playlistOnly) {
    args.push("--flat-playlist", "--playlist-end", String(safeLimit));
  } else {
    args.push("--no-playlist", "--skip-download");
  }
  args.push("--print", SEARCH_TEMPLATE, direct ? query : `ytsearch${safeLimit}:${query}`);
  const output = await runYtDlp(args, safeLimit > 10 ? 90_000 : SEARCH_TIMEOUT_MS);
  return parseJsonLines(output).flatMap((row) => {
    const candidate = candidateFromJson(row);
    return candidate ? [candidate] : [];
  }).slice(0, safeLimit);
}

export async function resolveYoutubeAudio(videoId: string): Promise<YtDlpAudioDetails> {
  if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error("Invalid YouTube video id");
  const cached = audioCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return cached.details;
  if (!await isYtDlpAvailable()) throw new Error("yt-dlpが見つかりません。YT_DLP_PATHを確認してください。");
  const output = await runYtDlp([
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    "--output-na-placeholder",
    "null",
    ...youtubeClientArgs(),
    "-f",
    preferredAudioFormat(),
    "--print",
    RESOLVE_TEMPLATE,
    `https://www.youtube.com/watch?v=${videoId}`,
  ], RESOLVE_TIMEOUT_MS);
  const row = parseJsonLines(output)[0];
  const candidate = candidateFromJson(row);
  if (!candidate || !row || typeof row !== "object") throw new Error("yt-dlpの音声情報を解析できませんでした。");
  const values = row as Record<string, unknown>;
  if (typeof values.streamUrl !== "string" || !values.streamUrl.startsWith("http")) {
    throw new Error("yt-dlpから再生可能な音声URLを取得できませんでした。");
  }
  const details: YtDlpAudioDetails = {
    ...candidate,
    streamUrl: values.streamUrl,
    audioBitrateKbps: finiteNumber(values.abr),
    audioCodec: typeof values.acodec === "string" ? values.acodec : null,
    audioSampleRateHz: finiteNumber(values.asr),
    audioChannels: finiteNumber(values.channels),
    contentLength: finiteNumber(values.filesize),
    container: typeof values.ext === "string" ? values.ext : null,
  };
  let expiresAt = Date.now() + STREAM_CACHE_MS;
  try {
    const signedExpiry = Number.parseInt(new URL(details.streamUrl).searchParams.get("expire") ?? "", 10) * 1_000;
    if (Number.isFinite(signedExpiry)) expiresAt = Math.min(expiresAt, signedExpiry - 5 * 60_000);
  } catch {
    // The fallback cache duration is used for non-standard extractor URLs.
  }
  audioCache.set(videoId, { details, expiresAt: Math.max(Date.now() + 2 * 60_000, expiresAt) });
  return details;
}

function audioCacheDirectory() {
  return resolvePath(process.cwd(), "work", "ytdlp-audio-cache");
}

async function cleanupAudioFileCache() {
  const directory = audioCacheDirectory();
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    const path = join(directory, entry.name);
    const info = await stat(path);
    return { path, size: info.size, modifiedAt: info.mtimeMs };
  }));
  files.sort((left, right) => left.modifiedAt - right.modifiedAt);
  let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    const expired = Date.now() - file.modifiedAt > AUDIO_FILE_CACHE_TTL_MS;
    if (!expired && totalBytes <= AUDIO_FILE_CACHE_MAX_BYTES) continue;
    await unlink(file.path).catch(() => undefined);
    totalBytes -= file.size;
    for (const [videoId, cached] of audioFileCache) {
      if (cached.path === file.path) audioFileCache.delete(videoId);
    }
  }
}

async function cachedFileFor(videoId: string) {
  const cached = audioFileCache.get(videoId);
  if (cached) {
    try {
      const info = await stat(cached.path);
      if (info.isFile() && info.size > 0) {
        cached.size = info.size;
        cached.lastAccessedAt = Date.now();
        return cached;
      }
    } catch {
      audioFileCache.delete(videoId);
    }
  }
  const directory = audioCacheDirectory();
  await mkdir(directory, { recursive: true });
  const entry = (await readdir(directory, { withFileTypes: true }))
    .find((candidate) => candidate.isFile() && candidate.name.startsWith(`${videoId}.`) && !candidate.name.endsWith(".part"));
  if (!entry) return null;
  const path = join(directory, entry.name);
  const info = await stat(path);
  if (!info.size) return null;
  const restored = { path, size: info.size, lastAccessedAt: Date.now() };
  audioFileCache.set(videoId, restored);
  return restored;
}

async function ensureYoutubeAudioFile(videoId: string) {
  const cached = await cachedFileFor(videoId);
  if (cached) return cached;
  const pending = audioFileLoads.get(videoId);
  if (pending) return pending;

  const load = (async () => {
    await cleanupAudioFileCache();
    const directory = audioCacheDirectory();
    const outputTemplate = join(directory, `${videoId}.%(ext)s`);
    const output = await runYtDlp([
      "--no-warnings",
      "--no-playlist",
      "--force-overwrites",
      ...youtubeClientArgs(),
      "-f",
      preferredAudioFormat(),
      "--print",
      "after_move:filepath",
      "--output",
      outputTemplate,
      `https://www.youtube.com/watch?v=${videoId}`,
    ], DOWNLOAD_TIMEOUT_MS);
    const downloadedPath = resolvePath(output.split(/\r?\n/).filter(Boolean).at(-1) ?? "");
    if (dirname(downloadedPath) !== directory || !basename(downloadedPath).startsWith(`${videoId}.`)) {
      throw new Error("yt-dlp returned an unexpected audio cache path");
    }
    const info = await stat(downloadedPath);
    if (!info.isFile() || info.size <= 0) throw new Error("yt-dlp downloaded an empty audio file");
    const file = { path: downloadedPath, size: info.size, lastAccessedAt: Date.now() };
    audioFileCache.set(videoId, file);
    const details = await resolveYoutubeAudio(videoId);
    details.contentLength = info.size;
    return file;
  })().finally(() => audioFileLoads.delete(videoId));
  audioFileLoads.set(videoId, load);
  return load;
}

export async function prepareYoutubeAudioFile(videoId: string) {
  await ensureYoutubeAudioFile(videoId);
}

export async function invalidateYoutubeAudio(videoId: string) {
  audioCache.delete(videoId);
  const cached = audioFileCache.get(videoId);
  audioFileCache.delete(videoId);
  if (cached) await unlink(cached.path).catch(() => undefined);
}

function proxyToken() {
  return process.env.YT_DLP_PROXY_TOKEN?.trim() || process.env.LAVALINK_PASSWORD?.trim() || "osu-pulse-local-ytdlp";
}

function safeToken(value: string | null) {
  if (!value) return false;
  const expected = Buffer.from(proxyToken());
  const actual = Buffer.from(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function proxyOrigin(port: number) {
  const configured = process.env.YT_DLP_PROXY_ORIGIN?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const host = process.env.LAVALINK_HOST?.trim().toLowerCase();
  if (host && !["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("Remote Lavalink requires YT_DLP_PROXY_ORIGIN");
  }
  return `http://127.0.0.1:${port}`;
}

export function ensureYtDlpProxy() {
  if (proxyReady) return proxyReady;
  proxyReady = new Promise<string>((resolve, reject) => {
    const port = Number.parseInt(process.env.YT_DLP_PROXY_PORT ?? "2334", 10);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      reject(new Error("YT_DLP_PROXY_PORT is invalid"));
      return;
    }
    proxyServer = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const youtubeMatch = /^\/youtube\/([A-Za-z0-9_-]{11})$/.exec(url.pathname);
        const localMatch = /^\/local-audio\/([0-9a-f-]{36})$/i.exec(url.pathname);
        if ((!youtubeMatch && !localMatch) || !safeToken(url.searchParams.get("token"))) {
          response.writeHead(404).end();
          return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405, { Allow: "GET, HEAD" }).end();
          return;
        }
        try {
          const details = youtubeMatch ? await resolveYoutubeAudio(youtubeMatch[1]) : null;
          const local = localMatch ? await localAudioFile(localMatch[1]) : null;
          if (localMatch && !local) {
            response.writeHead(404).end();
            return;
          }
          const audioFile = youtubeMatch
            ? await ensureYoutubeAudioFile(youtubeMatch[1])
            : { path: local!.path, size: local!.size };
          const requestedRange = request.headers.range;
          const rangeMatch = requestedRange ? /^bytes=(\d+)-(\d*)$/.exec(requestedRange) : null;
          if (requestedRange && !rangeMatch) {
            response.writeHead(416).end();
            return;
          }
          const requestedStart = Number.parseInt(rangeMatch?.[1] ?? "0", 10);
          const requestedEnd = rangeMatch?.[2] ? Number.parseInt(rangeMatch[2], 10) : null;
          if (!Number.isSafeInteger(requestedStart) || requestedStart < 0 || (requestedEnd !== null && requestedEnd < requestedStart)) {
            response.writeHead(416).end();
            return;
          }
          const totalBytes = audioFile.size;
          if (requestedStart >= totalBytes) {
            response.writeHead(416, { "Content-Range": `bytes */${totalBytes}` }).end();
            return;
          }
          const finalEnd = Math.min(requestedEnd ?? totalBytes - 1, totalBytes - 1);
          const contentType = local?.contentType ?? (details?.container === "webm"
            ? "audio/webm"
            : details?.container === "m4a" || details?.container === "mp4"
              ? "audio/mp4"
              : "application/octet-stream");
          const forwardedHeaders: Record<string, string> = {
            "Content-Type": contentType,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store, max-age=0",
            "Content-Length": String(finalEnd - requestedStart + 1),
            "X-Audio-Bitrate-Kbps": String(local?.track.bitrateKbps ?? details?.audioBitrateKbps ?? ""),
          };
          if (requestedRange) forwardedHeaders["Content-Range"] = `bytes ${requestedStart}-${finalEnd}/${totalBytes}`;
          response.writeHead(requestedRange ? 206 : 200, forwardedHeaders);
          if (request.method === "HEAD") {
            response.end();
            return;
          }
          const stream = createReadStream(audioFile.path, { start: requestedStart, end: finalEnd });
          response.once("close", () => stream.destroy());
          for await (const chunk of stream) {
            if (response.destroyed) break;
            if (!response.write(chunk)) await new Promise<void>((resolveDrain) => response.once("drain", resolveDrain));
          }
          if (!response.destroyed) response.end();
        } catch (error) {
          if (response.destroyed) return;
          console.error(`[yt-dlp] proxy resolve failed source=${youtubeMatch?.[1] ?? localMatch?.[1] ?? "unknown"}:`, error);
          if (!response.headersSent) {
            response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
            response.end("yt-dlp resolve failed");
          } else {
            response.destroy(error instanceof Error ? error : undefined);
          }
        }
      })().catch((error) => {
        console.error("[yt-dlp] unexpected proxy error:", error);
        if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("yt-dlp proxy error");
      });
    });
    proxyServer.once("error", (error) => {
      proxyReady = null;
      reject(error);
    });
    proxyServer.listen(port, "127.0.0.1", () => {
      try {
        const origin = proxyOrigin(port);
        console.log(`[yt-dlp] local audio resolver ready at ${origin}`);
        resolve(origin);
      } catch (error) {
        proxyServer?.close();
        proxyServer = null;
        proxyReady = null;
        reject(error);
      }
    });
  });
  return proxyReady;
}

export async function ytDlpProxyUrl(videoId: string) {
  const origin = await ensureYtDlpProxy();
  return `${origin}/youtube/${videoId}?token=${encodeURIComponent(proxyToken())}`;
}

export async function localAudioProxyUrl(id: string) {
  const origin = await ensureYtDlpProxy();
  return `${origin}/local-audio/${id}?token=${encodeURIComponent(proxyToken())}`;
}

export function stopYtDlpProxy() {
  proxyServer?.close();
  proxyServer = null;
  proxyReady = null;
  audioCache.clear();
  audioFileCache.clear();
  audioFileLoads.clear();
}

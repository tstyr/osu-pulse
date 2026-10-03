import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, parse, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const ACCEPTED_EXTENSIONS = new Set([".flac", ".wav", ".mp3", ".m4a"]);
const MAX_BITRATE_KBPS = Math.max(32, Math.min(256, Number.parseInt(process.env.BOT_AUDIO_MAX_BITRATE_KBPS ?? "256", 10) || 256));
const MAX_UPLOAD_BYTES = Math.max(1_048_576, Number.parseInt(process.env.BOT_AUDIO_MAX_UPLOAD_BYTES ?? "209715200", 10) || 209_715_200);
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

export type LocalAudioTrack = {
  id: string;
  title: string;
  artist: string;
  originalFilename: string;
  fileName: string;
  format: string;
  codec: string;
  bitrateKbps: number;
  sampleRateHz: number | null;
  channels: number | null;
  durationMs: number;
  sizeBytes: number;
  uploadedBy: string | null;
  uploadedVia: "discord" | "web-ui";
  createdAt: string;
  updatedAt: string;
};

type ProbeOutput = {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    bit_rate?: string;
    sample_rate?: string;
    channels?: number;
    tags?: Record<string, string>;
  }>;
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
};

export function localAudioDirectory() {
  const configured = process.env.BOT_AUDIO_DIR?.trim() || "bot-audio";
  return resolve(process.cwd(), configured);
}

function workDirectory() {
  return resolve(process.cwd(), "work", "local-audio-imports");
}

function ffmpegBinary() {
  return process.env.BOT_AUDIO_FFMPEG_PATH?.trim() || process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

function ffprobeBinary() {
  const configured = process.env.BOT_AUDIO_FFPROBE_PATH?.trim();
  if (configured) return configured;
  const ffmpeg = ffmpegBinary();
  if (/ffmpeg(?:\.exe)?$/i.test(ffmpeg)) return ffmpeg.replace(/ffmpeg(?:\.exe)?$/i, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  return "ffprobe";
}

function exec(binary: string, args: string[], timeout = 10 * 60_000) {
  return new Promise<string>((resolvePromise, reject) => {
    execFile(binary, args, { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message).replace(/\s+/g, " ").trim().slice(0, 800);
        reject(new Error(detail || `${basename(binary)} failed`));
        return;
      }
      resolvePromise(stdout.trim());
    });
  });
}

function safeBaseName(value: string) {
  const decoded = basename(value || "audio").normalize("NFKC");
  const clean = decoded.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim();
  return (clean || "audio").slice(0, 180);
}

export function assertSupportedAudioName(fileName: string) {
  const extension = extname(fileName).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.has(extension)) throw new Error("対応形式は FLAC / WAV / MP3 / M4A です。");
  return extension;
}

function finiteInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null;
}

async function probe(path: string) {
  const output = await exec(ffprobeBinary(), [
    "-v", "error",
    "-show_entries", "format=format_name,duration,bit_rate:format_tags=title,artist:stream=codec_type,codec_name,bit_rate,sample_rate,channels:stream_tags=title,artist",
    "-of", "json",
    path,
  ], 60_000);
  const parsed = JSON.parse(output) as ProbeOutput;
  const stream = parsed.streams?.find((entry) => entry.codec_type === "audio");
  if (!stream?.codec_name) throw new Error("音声トラックを検出できませんでした。");
  const bitrate = finiteInteger(stream.bit_rate) ?? finiteInteger(parsed.format?.bit_rate) ?? 0;
  return {
    codec: stream.codec_name,
    format: parsed.format?.format_name?.split(",")[0] || extname(path).slice(1),
    bitrateKbps: Math.max(1, Math.round(bitrate / 1_000)),
    sampleRateHz: finiteInteger(stream.sample_rate),
    channels: finiteInteger(stream.channels),
    durationMs: Math.max(0, Math.round((Number.parseFloat(parsed.format?.duration ?? "0") || 0) * 1_000)),
    title: stream.tags?.title || parsed.format?.tags?.title || null,
    artist: stream.tags?.artist || parsed.format?.tags?.artist || null,
  };
}

function requiresTranscode(extension: string, codec: string, bitrateKbps: number) {
  return /^(flac|alac|wavpack|pcm_)/i.test(codec)
    || extension === ".flac"
    || extension === ".wav"
    || bitrateKbps > MAX_BITRATE_KBPS;
}

async function downloadToFile(url: string, destination: string, expectedSize?: number | null) {
  if (expectedSize && expectedSize > MAX_UPLOAD_BYTES) throw new Error(`音源は最大 ${Math.round(MAX_UPLOAD_BYTES / 1_048_576)}MB です。`);
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok || !response.body) throw new Error(`音源を取得できませんでした (HTTP ${response.status})。`);
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_UPLOAD_BYTES) throw new Error(`音源は最大 ${Math.round(MAX_UPLOAD_BYTES / 1_048_576)}MB です。`);
  let transferred = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      transferred += chunk.length;
      callback(transferred > MAX_UPLOAD_BYTES ? new Error(`音源は最大 ${Math.round(MAX_UPLOAD_BYTES / 1_048_576)}MB です。`) : null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body as never), limiter, createWriteStream(destination, { flags: "wx" }));
}

function metadataPath(id: string) {
  return join(localAudioDirectory(), `${id}.json`);
}

function safeStoredPath(fileName: string) {
  const directory = localAudioDirectory();
  const path = resolve(directory, fileName);
  if (dirname(path) !== directory) throw new Error("ローカル音源の保存先が不正です。");
  return path;
}

function validTrack(value: unknown): value is LocalAudioTrack {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<LocalAudioTrack>;
  return typeof row.id === "string" && /^[0-9a-f-]{36}$/i.test(row.id)
    && typeof row.title === "string" && typeof row.fileName === "string"
    && typeof row.bitrateKbps === "number" && typeof row.sizeBytes === "number";
}

export async function ensureLocalAudioDirectory() {
  await Promise.all([mkdir(localAudioDirectory(), { recursive: true }), mkdir(workDirectory(), { recursive: true })]);
  return localAudioDirectory();
}

export async function importLocalAudio(input: {
  url: string;
  originalFilename: string;
  uploadedBy?: string | null;
  uploadedVia: "discord" | "web-ui";
  expectedSize?: number | null;
}) {
  const extension = assertSupportedAudioName(input.originalFilename);
  await ensureLocalAudioDirectory();
  const id = randomUUID();
  const safeOriginal = safeBaseName(input.originalFilename);
  const temporaryInput = join(workDirectory(), `${id}${extension}`);
  let temporaryOutput: string | null = null;
  try {
    await downloadToFile(input.url, temporaryInput, input.expectedSize);
    const originalProbe = await probe(temporaryInput);
    const transcode = requiresTranscode(extension, originalProbe.codec, originalProbe.bitrateKbps);
    const finalExtension = transcode ? ".m4a" : extension;
    const titleStem = safeBaseName(originalProbe.title || parse(safeOriginal).name).slice(0, 100);
    const fileName = `${id}--${titleStem}${finalExtension}`;
    const destination = safeStoredPath(fileName);

    if (transcode) {
      temporaryOutput = join(workDirectory(), `${id}.normalized.m4a`);
      await exec(ffmpegBinary(), [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", temporaryInput,
        "-map", "0:a:0", "-vn",
        "-c:a", "aac", "-b:a", `${MAX_BITRATE_KBPS}k`,
        "-movflags", "+faststart",
        temporaryOutput,
      ]);
      await rename(temporaryOutput, destination);
      temporaryOutput = null;
    } else {
      await copyFile(temporaryInput, destination);
    }

    const finalProbe = await probe(destination);
    const info = await stat(destination);
    const now = new Date().toISOString();
    const track: LocalAudioTrack = {
      id,
      title: originalProbe.title || parse(safeOriginal).name,
      artist: originalProbe.artist || "Unknown artist",
      originalFilename: safeOriginal,
      fileName,
      format: finalProbe.format,
      codec: finalProbe.codec,
      bitrateKbps: Math.min(MAX_BITRATE_KBPS, finalProbe.bitrateKbps),
      sampleRateHz: finalProbe.sampleRateHz,
      channels: finalProbe.channels,
      durationMs: finalProbe.durationMs,
      sizeBytes: info.size,
      uploadedBy: input.uploadedBy?.slice(0, 100) || null,
      uploadedVia: input.uploadedVia,
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(metadataPath(id), `${JSON.stringify(track, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return track;
  } finally {
    await Promise.all([
      rm(temporaryInput, { force: true }).catch(() => undefined),
      temporaryOutput ? rm(temporaryOutput, { force: true }).catch(() => undefined) : Promise.resolve(),
    ]);
  }
}

export async function listLocalAudioTracks() {
  await ensureLocalAudioDirectory();
  const entries = await readdir(localAudioDirectory(), { withFileTypes: true });
  const tracks = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map(async (entry) => {
    try {
      const value = JSON.parse(await readFile(join(localAudioDirectory(), entry.name), "utf8")) as unknown;
      if (!validTrack(value)) return null;
      const info = await stat(safeStoredPath(value.fileName));
      return info.isFile() ? { ...value, sizeBytes: info.size } : null;
    } catch {
      return null;
    }
  }));
  return tracks.filter((track): track is LocalAudioTrack => track !== null).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function findLocalAudioTrack(idOrPrefix: string) {
  const normalized = idOrPrefix.trim().toLowerCase();
  const matches = (await listLocalAudioTracks()).filter((track) => track.id.toLowerCase() === normalized || track.id.toLowerCase().startsWith(normalized));
  return matches.length === 1 ? matches[0] : null;
}

export async function deleteLocalAudioTrack(idOrPrefix: string) {
  const track = await findLocalAudioTrack(idOrPrefix);
  if (!track) return null;
  await Promise.all([rm(safeStoredPath(track.fileName), { force: true }), rm(metadataPath(track.id), { force: true })]);
  return track;
}

export async function localAudioFile(id: string) {
  const track = await findLocalAudioTrack(id);
  if (!track) return null;
  const path = safeStoredPath(track.fileName);
  const info = await stat(path);
  const extension = extname(track.fileName).toLowerCase();
  const contentType = extension === ".mp3" ? "audio/mpeg"
    : extension === ".m4a" ? "audio/mp4"
      : extension === ".flac" ? "audio/flac"
        : "audio/wav";
  return { track, path, size: info.size, contentType, stream: (start: number, end: number) => createReadStream(path, { start, end }) };
}

export const localAudioLimits = {
  maxBitrateKbps: MAX_BITRATE_KBPS,
  maxUploadBytes: MAX_UPLOAD_BYTES,
  acceptedExtensions: [...ACCEPTED_EXTENSIONS],
};

import { z } from "zod";

import { hasControlPanelSession } from "@/lib/control/auth";
import { getBridgeConfiguration } from "@/lib/control/settings";
import {
  addMusicPlaylistTracks,
  clearMusicPlaybackHistory,
  createMusicPlaylist,
  deleteMusicHistoryEntry,
  deleteMusicPlaylist,
  deleteMusicPlaylistTrack,
  enqueueMusicControlCommand,
  getMusicAnalytics,
  getMusicControlCommand,
  getMusicLibraryView,
  getMusicPlaybackView,
  setMusicRelatedAutoplay,
} from "@/db/music-repository";
import { getSpotifyPlaylistTracks } from "@/lib/music/spotify";
import { assertR2AudioObjectKey, createR2AudioTransferUrls } from "@/lib/music/r2-audio";

const uuid = z.string().uuid();
const candidateSchema = z.object({
  kind: z.enum(["track", "yt-dlp"]),
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(200),
  uri: z.string().trim().max(2_000),
  source: z.string().trim().max(40),
  duration: z.number().int().min(0).max(86_400_000),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/).nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  resolver: z.enum(["lavalink", "yt-dlp", "local"]).optional(),
});
const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("createPlaylist"),
    guildId: z.string().trim().min(1).max(32),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).optional(),
  }),
  z.object({ action: z.literal("deletePlaylist"), playlistId: uuid }),
  z.object({
    action: z.literal("addTrack"),
    playlistId: uuid,
    title: z.string().trim().min(1).max(200),
    author: z.string().trim().max(120).optional(),
    uri: z.string().trim().url().max(2_000),
    source: z.string().trim().max(40).optional(),
    duration: z.number().int().min(0).max(86_400_000).optional(),
  }),
  z.object({ action: z.literal("importQueue"), playlistId: uuid, guildId: z.string().trim().min(1).max(32) }),
  z.object({ action: z.literal("deleteTrack"), trackId: uuid }),
  z.object({ action: z.literal("deleteHistory"), historyId: uuid }),
  z.object({ action: z.literal("clearHistory"), guildId: z.string().trim().max(32).nullable().optional() }),
  z.object({ action: z.literal("setAutoplay"), guildId: z.string().trim().min(1).max(32), enabled: z.boolean() }),
  z.object({
    action: z.literal("importLocalAudio"),
    guildId: z.string().trim().min(1).max(32),
    objectKey: z.string().trim().min(1).max(500),
    originalFilename: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().positive().max(209_715_200),
  }),
  z.object({
    action: z.literal("playLocalAudio"),
    guildId: z.string().trim().min(1).max(32),
    voiceChannelId: z.string().trim().min(1).max(32),
    id: z.string().uuid(),
  }),
  z.object({ action: z.literal("deleteLocalAudio"), guildId: z.string().trim().min(1).max(32), id: z.string().uuid() }),
  z.object({ action: z.literal("search"), guildId: z.string().trim().min(1).max(32), query: z.string().trim().min(1).max(500) }),
  z.object({
    action: z.literal("playCandidate"),
    guildId: z.string().trim().min(1).max(32),
    voiceChannelId: z.string().trim().min(1).max(32),
    candidate: candidateSchema,
  }),
  z.object({
    action: z.literal("reorderQueue"),
    guildId: z.string().trim().min(1).max(32),
    order: z.array(z.string().trim().min(1).max(100)).max(500),
  }),
  z.object({
    action: z.literal("importYoutubePlaylist"),
    guildId: z.string().trim().min(1).max(32),
    playlistId: uuid,
    url: z.string().url().max(2_000),
  }),
  z.object({ action: z.literal("importSpotifyPlaylist"), playlistId: uuid, url: z.string().trim().min(1).max(2_000) }),
  z.object({
    action: z.literal("control"),
    guildId: z.string().trim().min(1).max(32),
    command: z.enum(["toggle", "pause", "resume", "skip", "stop", "volume", "seek", "repeat"]),
    value: z.number().int().optional(),
  }),
]);

function sourceFromUri(uri: string) {
  if (/youtu(?:\.be|be\.com)/i.test(uri)) return "youtube";
  if (/soundcloud\.com/i.test(uri)) return "soundcloud";
  return "http";
}

export async function GET(request: Request) {
  if (!(await hasControlPanelSession())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const commandId = url.searchParams.get("commandId");
  if (commandId) {
    if (!z.string().uuid().safeParse(commandId).success) return Response.json({ error: "Invalid command id" }, { status: 400 });
    const command = await getMusicControlCommand(commandId);
    return command
      ? Response.json({ id: command.id, status: command.status, result: command.result, error: command.error }, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "操作が見つかりません。" }, { status: 404 });
  }
  if (url.searchParams.get("view") === "analytics") {
    const days = Number.parseInt(url.searchParams.get("days") ?? "30", 10);
    return Response.json(await getMusicAnalytics(Number.isFinite(days) ? days : 30), { headers: { "Cache-Control": "no-store" } });
  }
  if (url.searchParams.get("view") === "playback") {
    return Response.json(await getMusicPlaybackView(), { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
  const historyLimit = Number.parseInt(url.searchParams.get("historyLimit") ?? "100", 10);
  return Response.json(await getMusicLibraryView(Number.isFinite(historyLimit) ? historyLimit : 100), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  if (!(await hasControlPanelSession())) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = mutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "入力内容を確認してください。", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const payload = parsed.data;
    if (payload.action === "createPlaylist") {
      const playlist = await createMusicPlaylist(payload);
      return Response.json({ ok: true, playlist });
    }
    if (payload.action === "deletePlaylist") {
      return Response.json({ ok: Boolean(await deleteMusicPlaylist(payload.playlistId)) });
    }
    if (payload.action === "addTrack") {
      const rows = await addMusicPlaylistTracks(payload.playlistId, [{
        title: payload.title,
        author: payload.author || "Unknown artist",
        uri: payload.uri,
        source: payload.source || sourceFromUri(payload.uri),
        duration: payload.duration ?? 0,
      }]);
      if (!rows) return Response.json({ error: "プレイリストが見つかりません。" }, { status: 404 });
      return Response.json({ ok: true, tracks: rows });
    }
    if (payload.action === "importQueue") {
      const playback = await getMusicPlaybackView();
      const state = playback.states.find((row) => row.guildId === payload.guildId);
      const tracks = state ? [state.currentTrack, ...state.queue].filter((track) => track !== null) : [];
      if (!tracks.length) return Response.json({ error: "このサーバーの再生中・待機中の曲がありません。" }, { status: 409 });
      const rows = await addMusicPlaylistTracks(payload.playlistId, tracks);
      if (!rows) return Response.json({ error: "プレイリストが見つかりません。" }, { status: 404 });
      return Response.json({ ok: true, tracks: rows });
    }
    if (payload.action === "deleteTrack") {
      return Response.json({ ok: Boolean(await deleteMusicPlaylistTrack(payload.trackId)) });
    }
    if (payload.action === "deleteHistory") {
      return Response.json({ ok: Boolean(await deleteMusicHistoryEntry(payload.historyId)) });
    }
    if (payload.action === "setAutoplay") {
      return Response.json({ ok: true, enabled: await setMusicRelatedAutoplay(payload.guildId, payload.enabled) });
    }
    if (payload.action === "importLocalAudio") {
      const objectKey = assertR2AudioObjectKey(payload.objectKey);
      const transfer = await createR2AudioTransferUrls(objectKey);
      const command = await enqueueMusicControlCommand({
        guildId: payload.guildId,
        action: "import-local-audio",
        payload: { ...transfer, objectKey, originalFilename: payload.originalFilename, sizeBytes: payload.sizeBytes, uploadedBy: "web-ui" },
      });
      return Response.json({ ok: true, commandId: command?.id }, { status: 202 });
    }
    if (payload.action === "playLocalAudio") {
      const command = await enqueueMusicControlCommand({
        guildId: payload.guildId,
        action: "play-local-audio",
        payload: { id: payload.id, voiceChannelId: payload.voiceChannelId },
      });
      return Response.json({ ok: true, commandId: command?.id }, { status: 202 });
    }
    if (payload.action === "deleteLocalAudio") {
      const command = await enqueueMusicControlCommand({ guildId: payload.guildId, action: "delete-local-audio", payload: { id: payload.id } });
      return Response.json({ ok: true, commandId: command?.id }, { status: 202 });
    }
    if (payload.action === "search") {
      const command = await enqueueMusicControlCommand({ guildId: payload.guildId, action: "search", payload: { query: payload.query } });
      return Response.json({ ok: true, commandId: command?.id }, { status: 202 });
    }
    if (payload.action === "playCandidate") {
      const command = await enqueueMusicControlCommand({
        guildId: payload.guildId,
        action: "play-candidate",
        payload: { voiceChannelId: payload.voiceChannelId, candidate: payload.candidate },
      });
      return Response.json({ ok: true, commandId: command?.id }, { status: 202 });
    }
    if (payload.action === "reorderQueue") {
      const command = await enqueueMusicControlCommand({ guildId: payload.guildId, action: "reorder", payload: { order: payload.order } });
      return Response.json({ ok: true, commandId: command?.id }, { status: 202 });
    }
    if (payload.action === "importYoutubePlaylist") {
      const command = await enqueueMusicControlCommand({
        guildId: payload.guildId,
        action: "import-youtube-playlist",
        payload: { playlistId: payload.playlistId, url: payload.url },
      });
      return Response.json({ ok: true, commandId: command?.id }, { status: 202 });
    }
    if (payload.action === "importSpotifyPlaylist") {
      const bridge = await getBridgeConfiguration();
      const tracks = await getSpotifyPlaylistTracks(payload.url, 500, {
        clientId: bridge.env.SPOTIFY_CLIENT_ID,
        clientSecret: bridge.env.SPOTIFY_CLIENT_SECRET,
      });
      const rows = await addMusicPlaylistTracks(payload.playlistId, tracks.map((track) => ({
        title: track.title,
        author: track.author,
        uri: `search:${track.searchQuery}`,
        source: "spotify-import",
        duration: track.duration,
      })));
      if (!rows) return Response.json({ error: "プレイリストが見つかりません。" }, { status: 404 });
      return Response.json({ ok: true, imported: rows.length });
    }
    if (payload.action === "control") {
      if (payload.command === "volume" && (payload.value === undefined || payload.value < 0 || payload.value > 150)) {
        return Response.json({ error: "音量は0〜150で指定してください。" }, { status: 400 });
      }
      if (payload.command === "seek" && (payload.value === undefined || payload.value < 0 || payload.value > 86_400_000)) {
        return Response.json({ error: "再生位置を正しく指定してください。" }, { status: 400 });
      }
      if (payload.command === "repeat" && (payload.value === undefined || payload.value < 0 || payload.value > 2)) {
        return Response.json({ error: "ループ設定が正しくありません。" }, { status: 400 });
      }
      const command = await enqueueMusicControlCommand({
        guildId: payload.guildId,
        action: payload.command,
        value: payload.value ?? null,
      });
      return Response.json({ ok: true, commandId: command?.id }, { status: 202 });
    }
    await clearMusicPlaybackHistory(payload.guildId || null);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error && /unique|duplicate/i.test(error.message)
      ? "同じサーバーに同名のプレイリストがあります。"
      : error instanceof Error ? error.message : "音楽データの更新に失敗しました。";
    return Response.json({ error: message }, { status: 409 });
  }
}

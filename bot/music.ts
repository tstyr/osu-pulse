import { randomBytes } from "node:crypto";

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  GuildMember,
  Message,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from "discord.js";
import { LavalinkManager, type Player, type Track, type UnresolvedTrack } from "lavalink-client";

import {
  addMusicFavorite,
  deleteMusicQueue,
  listMusicFavorites,
  listMusicQueues,
  removeMusicFavorite,
  saveMusicQueue,
} from "../src/db/feature-repository";
import {
  addMusicPlaylistTracks,
  claimPendingMusicControlCommands,
  completeMusicControlCommand,
  finishMusicPlaybackHistory,
  finishMusicPlaybackHistoryEntry,
  deleteMusicLocalAudioTrack,
  upsertMusicLocalAudioTrack,
  listMusicPlaylistsForGuild,
  recordMusicResolverEvent as writeMusicResolverEvent,
  saveMusicPlaybackState,
  isMusicRelatedAutoplayEnabled,
  setMusicRelatedAutoplay,
  startMusicPlaybackHistory,
  type MusicPlaybackStatus,
} from "../src/db/music-repository";
import type { PersistedMusicTrack } from "../src/db/schema";
import {
  deleteLocalAudioTrack,
  findLocalAudioTrack,
  importLocalAudio,
  listLocalAudioTracks,
  type LocalAudioTrack,
} from "./local-audio";
import {
  ensureYtDlpProxy,
  invalidateYoutubeAudio,
  isYoutubeUrl,
  prepareYoutubeAudioFile,
  resolveYoutubeAudio,
  searchYoutubeWithYtDlp,
  stopYtDlpProxy,
  localAudioProxyUrl,
  ytDlpProxyUrl,
  type YtDlpAudioDetails,
  type YtDlpCandidate,
} from "./ytdlp";
import { isSignedR2AudioUrl } from "./r2-signed-url";
import { musicDisplayUrl } from "./music-display";
import { nonOverlappingTask } from "./non-overlapping-task";

const PANEL_UPDATE_INTERVAL_MS = 15_000;
const MUSIC_BUTTON_PREFIX = "music-panel";
const MUSIC_SEARCH_PREFIX = "music-search";
const MUSIC_SEARCH_TTL_MS = 5 * 60_000;
const PLAYBACK_SYNC_INTERVAL_MS = 2_000;
const YOUTUBE_PREFLIGHT_CANDIDATES = 5;
const YOUTUBE_PREFLIGHT_TIMEOUT_MS = 12_000;
const DEFAULT_MUSIC_VOLUME = Math.max(0, Math.min(150, Number.parseInt(process.env.MUSIC_DEFAULT_VOLUME ?? "20", 10) || 20));

type MusicPanel = {
  message: Message;
  timer: ReturnType<typeof setInterval>;
};

type MusicPlaybackIssue = {
  title: string;
  detail: string;
  occurredAt: number;
};

type SearchTrack = Track | UnresolvedTrack;

type MusicCandidate =
  | { kind: "track"; track: Track }
  | { kind: "yt-dlp"; candidate: YtDlpCandidate };

type SerializedMusicCandidate = PersistedMusicTrack & {
  kind: "track" | "yt-dlp";
};

type YtDlpTrackData = Omit<YtDlpAudioDetails, "streamUrl">;
type MusicRepeatMode = "off" | "track" | "queue";

type MusicSearchSession = {
  userId: string;
  guildId: string;
  channelId: string;
  voiceChannelId: string;
  candidates: MusicCandidate[];
  expiresAt: number;
};

const panels = new Map<string, MusicPanel>();
const playbackIssues = new Map<string, MusicPlaybackIssue>();
const searchSessions = new Map<string, MusicSearchSession>();
const activeHistoryStarts = new Map<string, Promise<string | null>>();
const lastPlayedTracks = new Map<string, PersistedMusicTrack>();
const autoplayInProgress = new Set<string>();
const playbackRecoveries = new Map<string, { attempts: number; lastAttemptAt: number; lastRecoveredAt: Date | null }>();
const idlePlaybackSyncs = new Map<string, { signature: string; syncedAt: number }>();
let queueRestorationRunning = false;
let musicClient: Client | null = null;
let playbackSyncTimer: ReturnType<typeof setInterval> | null = null;
let playbackSyncRunning = false;
let musicControlTimer: ReturnType<typeof setInterval> | null = null;
let musicControlRunning = false;

async function recordMusicResolverEvent(input: Parameters<typeof writeMusicResolverEvent>[0]) {
  // Resolver telemetry is optional. Losing a DB connection must not turn a
  // successfully resolved audio stream into a playback failure or fallback.
  await writeMusicResolverEvent(input).catch((error) => {
    console.warn("[music] resolver activity persistence failed:", error);
  });
}

function conciseIssueDetail(value: unknown) {
  const text = value instanceof Error ? value.message : String(value ?? "Unknown playback error");
  const normalized = text.replace(/\s+/g, " ").trim();
  if (/requires login|sign in to confirm|login required/i.test(normalized)) {
    return "YouTube側でログインが必要な動画です。別のYouTube候補とSoundCloud候補も自動確認しましたが、再生できませんでした。";
  }
  if (/all clients failed|no supported audio streams|video player configuration error/i.test(normalized)) {
    return "YouTubeの全再生経路で音声ストリームを取得できませんでした。SoundCloud候補も利用できない状態です。";
  }
  if (/decod(?:e|ing)|unexpected end|stream.*closed|connection reset/i.test(normalized)) {
    return "音声ストリームが途中で切れたため、URLを更新して自動再接続しました。再接続にも失敗した場合は別候補を選んでください。";
  }
  return normalized.slice(0, 300);
}

function repeatModeFromValue(value: number | null | undefined): MusicRepeatMode {
  return value === 1 ? "track" : value === 2 ? "queue" : "off";
}

function nextRepeatMode(mode: MusicRepeatMode): MusicRepeatMode {
  return mode === "off" ? "track" : mode === "track" ? "queue" : "off";
}

function repeatModeLabel(mode: MusicRepeatMode) {
  return mode === "track" ? "1曲" : mode === "queue" ? "キュー" : "OFF";
}

function lavalinkRestOrigin() {
  const host = process.env.LAVALINK_HOST;
  if (!host) return null;
  const safeHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const protocol = process.env.LAVALINK_SECURE === "true" ? "https" : "http";
  const port = Number(process.env.LAVALINK_PORT ?? 2333);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return null;
  return `${protocol}://${safeHost}:${port}`;
}

async function canStreamYoutubeTrack(track: Track) {
  if (track.info.sourceName !== "youtube") return true;
  const videoId = track.info.identifier;
  const origin = lavalinkRestOrigin();
  const authorization = process.env.LAVALINK_PASSWORD;
  if (!origin || !authorization || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return false;

  try {
    const response = await fetch(`${origin}/youtube/stream/${videoId}`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(YOUTUBE_PREFLIGHT_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      console.warn(`[music] youtube preflight rejected id=${videoId} status=${response.status}`);
      return false;
    }
    const reader = response.body.getReader();
    const first = await reader.read();
    await reader.cancel();
    return !first.done && Boolean(first.value?.byteLength);
  } catch (error) {
    console.warn(`[music] youtube preflight failed id=${videoId}: ${conciseIssueDetail(error)}`);
    return false;
  }
}

function isResolvedTrack(track: SearchTrack): track is Track {
  return typeof track.info.identifier === "string" && typeof track.info.sourceName === "string";
}

async function playableYoutubeTracks(tracks: SearchTrack[]) {
  const candidates = tracks.filter(isResolvedTrack).slice(0, YOUTUBE_PREFLIGHT_CANDIDATES);
  const playable = await Promise.all(candidates.map(async (track) => await canStreamYoutubeTrack(track)));
  return candidates.filter((_, index) => playable[index]);
}

async function loadYtDlpTrack(player: Player, candidate: YtDlpCandidate, requester: unknown) {
  const startedAt = Date.now();
  let details: YtDlpAudioDetails;
  let track: Track | null = null;
  try {
    details = await resolveYoutubeAudio(candidate.videoId);
    // Lavalink's HTTP source has a much shorter read timeout than yt-dlp may
    // need for an uncached video. Finish the local download before exposing
    // the proxy URL so Lavalink immediately receives audio bytes.
    await prepareYoutubeAudioFile(candidate.videoId);
    const proxyUrl = await ytDlpProxyUrl(candidate.videoId);
    const result = await player.search({ query: proxyUrl }, requester);
    track = result.tracks.find(isResolvedTrack) ?? null;
    if (!track) throw new Error("Lavalinkがyt-dlpの音声ストリームを読み込めませんでした。");
    await recordMusicResolverEvent({ guildId: player.guildId, resolver: "yt-dlp", outcome: "success", queryKind: "load", latencyMs: Date.now() - startedAt });
  } catch (error) {
    await recordMusicResolverEvent({ guildId: player.guildId, resolver: "yt-dlp", outcome: "failure", queryKind: "load", latencyMs: Date.now() - startedAt, error: conciseIssueDetail(error) }).catch(() => undefined);
    const fallbackStartedAt = Date.now();
    try {
      const result = await player.search({ query: `${candidate.title} ${candidate.author}`.trim(), source: "scsearch" }, requester);
      const alternatives = result.tracks.filter(isResolvedTrack);
      track = alternatives.sort((left, right) => {
        const leftDuration = Math.abs((left.info.duration ?? 0) - candidate.duration);
        const rightDuration = Math.abs((right.info.duration ?? 0) - candidate.duration);
        return leftDuration - rightDuration;
      })[0] ?? null;
      if (!track) throw error;
      await recordMusicResolverEvent({ guildId: player.guildId, resolver: "soundcloud", outcome: "success", queryKind: "load", latencyMs: Date.now() - fallbackStartedAt });
      console.warn(`[music] guild=${player.guildId} yt-dlp unavailable; using SoundCloud fallback uri=${track.info.uri}`);
      return track;
    } catch (fallbackError) {
      await recordMusicResolverEvent({ guildId: player.guildId, resolver: "soundcloud", outcome: "failure", queryKind: "load", latencyMs: Date.now() - fallbackStartedAt, error: conciseIssueDetail(fallbackError) }).catch(() => undefined);
      throw error;
    }
  }
  const safeDetails: YtDlpTrackData = {
    videoId: details.videoId,
    title: details.title,
    author: details.author,
    duration: details.duration,
    webpageUrl: details.webpageUrl,
    thumbnailUrl: details.thumbnailUrl,
    audioBitrateKbps: details.audioBitrateKbps,
    audioCodec: details.audioCodec,
    audioSampleRateHz: details.audioSampleRateHz,
    audioChannels: details.audioChannels,
    contentLength: details.contentLength,
    container: details.container,
  };
  track.info = {
    ...track.info,
    identifier: details.videoId,
    title: details.title,
    author: details.author,
    duration: details.duration || track.info.duration,
    artworkUrl: details.thumbnailUrl,
    uri: details.webpageUrl,
    sourceName: "youtube",
  };
  track.userData = { ...(track.userData ?? {}), ytDlp: safeDetails };
  return track;
}

async function loadSavedMusicTrack(
  player: Player,
  saved: Pick<PersistedMusicTrack, "title" | "author" | "uri"> & Partial<PersistedMusicTrack>,
  requester: unknown,
) {
  if (saved.uri.startsWith("local-audio:")) {
    return loadLocalAudioTrack(player, saved.uri.slice("local-audio:".length), requester);
  }
  if (saved.uri.startsWith("search:")) {
    const candidates = await searchYoutubeWithYtDlp(saved.uri.slice(7), 1);
    return candidates[0] ? loadYtDlpTrack(player, candidates[0], requester) : null;
  }
  if (isYoutubeUrl(saved.uri)) {
    try {
      const candidates = await searchYoutubeWithYtDlp(saved.uri, 1);
      if (candidates[0]) return await loadYtDlpTrack(player, candidates[0], requester);
    } catch (error) {
      console.warn(`[music] yt-dlp saved track failed uri=${saved.uri}: ${conciseIssueDetail(error)}`);
    }
  }
  const result = await player.search({ query: saved.uri }, requester);
  const track = result.tracks.find(isResolvedTrack) ?? null;
  if (track?.info.sourceName === "youtube" && !await canStreamYoutubeTrack(track)) return null;
  return track;
}

async function loadLocalAudioTrack(player: Player, id: string, requester: unknown) {
  const local = await findLocalAudioTrack(id);
  if (!local) return null;
  const url = await localAudioProxyUrl(local.id);
  const result = await player.search({ query: url }, requester);
  const track = result.tracks.find(isResolvedTrack) ?? null;
  if (!track) return null;
  track.info = {
    ...track.info,
    identifier: local.id,
    title: local.title,
    author: local.artist,
    duration: local.durationMs || track.info.duration,
    uri: `local-audio:${local.id}`,
  };
  track.userData = { ...(track.userData ?? {}), localAudio: local };
  return track;
}

function persistedTrack(track: SearchTrack | null | undefined): PersistedMusicTrack | null {
  if (!track?.info.uri) return null;
  const queueEntryId = typeof track.userData?.queueEntryId === "string"
    ? track.userData.queueEntryId
    : randomBytes(12).toString("hex");
  track.userData = { ...(track.userData ?? {}), queueEntryId };
  const ytDlp = track.userData?.ytDlp as YtDlpTrackData | undefined;
  const local = track.userData?.localAudio as LocalAudioTrack | undefined;
  return {
    queueEntryId,
    title: track.info.title,
    author: track.info.author ?? "Unknown artist",
    uri: track.info.uri,
    source: local ? "local" : track.info.sourceName ?? "unknown",
    duration: track.info.duration ?? 0,
    videoId: ytDlp?.videoId ?? null,
    thumbnailUrl: ytDlp?.thumbnailUrl ?? track.info.artworkUrl ?? null,
    audioBitrateKbps: local?.bitrateKbps ?? ytDlp?.audioBitrateKbps ?? null,
    audioCodec: local?.codec ?? ytDlp?.audioCodec ?? null,
    audioSampleRateHz: local?.sampleRateHz ?? ytDlp?.audioSampleRateHz ?? null,
    audioChannels: local?.channels ?? ytDlp?.audioChannels ?? null,
    contentLength: local?.sizeBytes ?? ytDlp?.contentLength ?? null,
    container: local?.format ?? ytDlp?.container ?? null,
    resolver: local ? "local" : ytDlp ? "yt-dlp" : "lavalink",
  };
}

async function syncLocalAudioLibrary() {
  const tracks = await listLocalAudioTracks();
  await Promise.all(tracks.map((track) => upsertMusicLocalAudioTrack(track)));
  console.log(`[music] local audio library ready: ${tracks.length} track(s)`);
}

function requesterId(track: Track | null | undefined) {
  const requester = track?.requester;
  if (!requester || typeof requester !== "object" || !("id" in requester)) return null;
  const id = (requester as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

function inferredPlaybackStatus(player: Player): MusicPlaybackStatus {
  if (playbackIssues.has(player.guildId) && !player.playing) return "error";
  if (!player.connected) return "disconnected";
  if (player.paused) return "paused";
  if (player.playing && player.queue.current) return "playing";
  return "idle";
}

async function syncPlaybackState(
  player: Player,
  options: { status?: MusicPlaybackStatus; clearTrack?: boolean } = {},
) {
  const guild = musicClient?.guilds.cache.get(player.guildId);
  const voiceChannel = player.voiceChannelId ? guild?.channels.cache.get(player.voiceChannelId) : null;
  const availableVoiceChannels = [...(guild?.channels.cache.values() ?? [])]
    .filter((channel) => channel.isVoiceBased())
    .map((channel) => ({ id: channel.id, name: channel.name, memberCount: channel.members.size }))
    .sort((left, right) => right.memberCount - left.memberCount || left.name.localeCompare(right.name));
  const currentTrack = options.clearTrack ? null : persistedTrack(player.queue.current);
  const recovery = playbackRecoveries.get(player.guildId);
  // Lavalink reports frameStats as null until the first audio frame has been
  // emitted. A freshly-created player can therefore reach this persistence
  // path before those counters exist (for example immediately after choosing
  // a search result).
  const frameStats = player.node.stats.frameStats;
  const sentFrames = frameStats?.sent ?? 0;
  const lostFrames = (frameStats?.nulled ?? 0) + (frameStats?.deficit ?? 0);
  const frameLossPercent = sentFrames + lostFrames > 0 ? lostFrames / (sentFrames + lostFrames) * 100 : 0;
  if (currentTrack) currentTrack.repeatMode = player.repeatMode;
  const queue = options.clearTrack
    ? []
    : player.queue.tracks.flatMap((track) => {
        const saved = persistedTrack(track);
        return saved ? [saved] : [];
      });
  await saveMusicPlaybackState({
    guildId: player.guildId,
    guildName: guild?.name ?? null,
    voiceChannelId: player.voiceChannelId ?? null,
    voiceChannelName: voiceChannel?.name ?? null,
    availableVoiceChannels,
    textChannelId: player.textChannelId ?? null,
    status: options.status ?? inferredPlaybackStatus(player),
    currentTrack,
    queue,
    positionMs: options.clearTrack ? 0 : player.position,
    volume: player.volume,
    paused: options.clearTrack ? false : player.paused,
    connected: options.status === "disconnected" ? false : player.connected,
    voicePingMs: Number.isFinite(player.ping.ws) && player.ping.ws >= 0 ? player.ping.ws : null,
    frameLossPercent,
    nodeUptimeMs: player.node.stats.uptime,
    reconnectAttempts: recovery?.attempts ?? 0,
    lastRecoveredAt: recovery?.lastRecoveredAt ?? null,
    issue: playbackIssues.get(player.guildId) ?? null,
  });
}

function startPlaybackStateSync(manager: LavalinkManager) {
  if (playbackSyncTimer) clearInterval(playbackSyncTimer);
  playbackSyncTimer = setInterval(() => {
    if (playbackSyncRunning) return;
    playbackSyncRunning = true;
    const players = [...manager.players.values()];
    const activeGuildIds = new Set(players.map((player) => player.guildId));
    for (const guildId of activeGuildIds) idlePlaybackSyncs.delete(guildId);
    const idleGuilds = [...(musicClient?.guilds.cache.values() ?? [])].filter((guild) => !activeGuildIds.has(guild.id));
    void Promise.allSettled([
      ...players.map((player) => syncPlaybackState(player)),
      ...idleGuilds.flatMap((guild) => {
        const availableVoiceChannels = [...guild.channels.cache.values()]
          .filter((channel) => channel.isVoiceBased())
          .map((channel) => ({ id: channel.id, name: channel.name, memberCount: channel.members.size }))
          .sort((left, right) => right.memberCount - left.memberCount || left.name.localeCompare(right.name));
        const signature = JSON.stringify([guild.name, availableVoiceChannels]);
        const previous = idlePlaybackSyncs.get(guild.id);
        const now = Date.now();
        if (previous?.signature === signature && now - previous.syncedAt < 60_000) return [];
        return [saveMusicPlaybackState({
          guildId: guild.id,
          guildName: guild.name,
          availableVoiceChannels,
          status: "idle",
          connected: false,
          paused: false,
          positionMs: 0,
          queue: [],
        }).then(() => { idlePlaybackSyncs.set(guild.id, { signature, syncedAt: Date.now() }); })];
      }),
    ])
      .then((results) => {
        for (const result of results) {
          if (result.status === "rejected") console.error("[music] playback state sync failed:", result.reason);
        }
      })
      .finally(() => { playbackSyncRunning = false; });
  }, PLAYBACK_SYNC_INTERVAL_MS);
  playbackSyncTimer.unref();
}

async function executeMusicControlCommands(manager: LavalinkManager) {
  if (musicControlRunning) return;
  musicControlRunning = true;
  try {
    const commands = await claimPendingMusicControlCommands();
    for (const command of commands) {
      try {
        if (command.action === "search") {
          const query = typeof command.payload?.query === "string" ? command.payload.query.trim() : "";
          if (!query) throw new Error("検索語またはURLがありません。");
          const node = manager.nodeManager.leastUsedNodes()[0];
          if (!node) throw new Error("接続済みのLavalinkノードがありません。");
          const candidates = await searchMusicCandidates(node, query, { id: "web-ui" }, command.guildId);
          await completeMusicControlCommand(command.id, null, {
            candidates: candidates.flatMap((entry) => {
              const saved = entry.kind === "yt-dlp"
                ? {
                    title: entry.candidate.title,
                    author: entry.candidate.author,
                    uri: entry.candidate.webpageUrl,
                    source: "youtube",
                    duration: entry.candidate.duration,
                    videoId: entry.candidate.videoId,
                    thumbnailUrl: entry.candidate.thumbnailUrl,
                    resolver: "yt-dlp" as const,
                  }
                : persistedTrack(entry.track);
              return saved ? [{ ...saved, kind: entry.kind } satisfies SerializedMusicCandidate] : [];
            }),
          });
          continue;
        }
        if (command.action === "import-youtube-playlist") {
          const playlistId = typeof command.payload?.playlistId === "string" ? command.payload.playlistId : "";
          const url = typeof command.payload?.url === "string" ? command.payload.url : "";
          if (!playlistId || !/^https?:\/\//i.test(url)) throw new Error("YouTubeプレイリストURLが正しくありません。");
          const startedAt = Date.now();
          try {
            const items = await searchYoutubeWithYtDlp(url, 100);
            const added = await addMusicPlaylistTracks(playlistId, items.map((item) => ({
              title: item.title,
              author: item.author,
              uri: item.webpageUrl,
              source: "youtube",
              duration: item.duration,
            })));
            if (!added) throw new Error("保存先プレイリストが見つかりません。");
            await recordMusicResolverEvent({ guildId: command.guildId, resolver: "yt-dlp", outcome: "success", queryKind: "playlist", latencyMs: Date.now() - startedAt });
            await completeMusicControlCommand(command.id, null, { imported: added.length });
          } catch (error) {
            await recordMusicResolverEvent({ guildId: command.guildId, resolver: "yt-dlp", outcome: "failure", queryKind: "playlist", latencyMs: Date.now() - startedAt, error: conciseIssueDetail(error) }).catch(() => undefined);
            throw error;
          }
          continue;
        }
        if (command.action === "import-local-audio") {
          const downloadUrl = typeof command.payload?.downloadUrl === "string" ? command.payload.downloadUrl : "";
          const deleteUrl = typeof command.payload?.deleteUrl === "string" ? command.payload.deleteUrl : "";
          const originalFilename = typeof command.payload?.originalFilename === "string" ? command.payload.originalFilename : "";
          const expectedSize = typeof command.payload?.sizeBytes === "number" ? command.payload.sizeBytes : null;
          if (!isSignedR2AudioUrl(downloadUrl) || !isSignedR2AudioUrl(deleteUrl) || !originalFilename) throw new Error("R2音源の受け渡し情報が正しくありません。");
          try {
            const track = await importLocalAudio({
              url: downloadUrl,
              originalFilename,
              uploadedBy: typeof command.payload?.uploadedBy === "string" ? command.payload.uploadedBy : "web-ui",
              uploadedVia: "web-ui",
              expectedSize,
            });
            await upsertMusicLocalAudioTrack(track);
            await completeMusicControlCommand(command.id, null, { track });
          } finally {
            await fetch(deleteUrl, { method: "DELETE", signal: AbortSignal.timeout(30_000) })
              .then((response) => { if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`); })
              .catch((error) => console.warn(`[music] temporary R2 cleanup failed: ${conciseIssueDetail(error)}`));
          }
          continue;
        }
        if (command.action === "delete-local-audio") {
          const id = typeof command.payload?.id === "string" ? command.payload.id : "";
          const removed = id ? await deleteLocalAudioTrack(id) : null;
          if (!removed) throw new Error("ローカル音源が見つかりません。");
          await deleteMusicLocalAudioTrack(removed.id);
          await completeMusicControlCommand(command.id, null, { track: removed });
          continue;
        }
        let player = manager.getPlayer(command.guildId);
        if ((command.action === "play-candidate" || command.action === "play-local-audio") && !player) {
          const guild = musicClient?.guilds.cache.get(command.guildId);
          const requestedVoiceChannelId = typeof command.payload?.voiceChannelId === "string" ? command.payload.voiceChannelId : "";
          const voiceChannel = guild?.channels.cache.get(requestedVoiceChannelId);
          if (!guild || !voiceChannel?.isVoiceBased()) throw new Error("再生先のボイスチャンネルを選択してください。");
          player = manager.createPlayer({
            guildId: guild.id,
            voiceChannelId: voiceChannel.id,
            textChannelId: guild.systemChannelId ?? voiceChannel.id,
            selfDeaf: true,
            volume: DEFAULT_MUSIC_VOLUME,
          });
          if (!player.connected) await player.connect();
        }
        if (!player) throw new Error("このサーバーに稼働中の音楽プレイヤーがありません。");
        if (command.action === "toggle") {
          if (player.paused) await player.resume();
          else await player.pause();
        } else if (command.action === "pause") {
          await player.pause();
        } else if (command.action === "resume") {
          await player.resume();
        } else if (command.action === "skip") {
          if (!player.queue.current) throw new Error("スキップできる再生中の曲がありません。");
          await player.skip();
        } else if (command.action === "stop") {
          await manager.destroyPlayer(command.guildId, "stopped from Web UI");
          await deleteMusicQueue(command.guildId);
          await completeMusicControlCommand(command.id);
          continue;
        } else if (command.action === "volume") {
          if (command.value === null) throw new Error("音量が指定されていません。");
          await player.setVolume(Math.max(0, Math.min(150, command.value)));
        } else if (command.action === "seek") {
          if (command.value === null || !player.queue.current) throw new Error("シーク位置または再生中の曲がありません。");
          const duration = player.queue.current.info.duration || command.value;
          await player.seek(Math.max(0, Math.min(duration, command.value)));
        } else if (command.action === "repeat") {
          await player.setRepeatMode(repeatModeFromValue(command.value));
        } else if (command.action === "play-candidate") {
          const raw = command.payload?.candidate;
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("再生候補がありません。");
          const candidate = raw as Record<string, unknown>;
          const uri = typeof candidate.uri === "string" ? candidate.uri : "";
          const videoId = typeof candidate.videoId === "string" ? candidate.videoId : "";
          let track: Track | null = null;
          if (candidate.kind === "yt-dlp" && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
            track = await loadYtDlpTrack(player, {
              videoId,
              title: String(candidate.title ?? "YouTube"),
              author: String(candidate.author ?? "Unknown artist"),
              duration: Number(candidate.duration ?? 0),
              webpageUrl: uri,
              thumbnailUrl: typeof candidate.thumbnailUrl === "string" ? candidate.thumbnailUrl : null,
            }, { id: "web-ui" });
          } else {
            if (!uri || uri.length > 2_000) throw new Error("再生候補URLが正しくありません。");
            track = await loadSavedMusicTrack(player, {
              title: String(candidate.title ?? "Unknown track"),
              author: String(candidate.author ?? "Unknown artist"),
              uri,
            }, { id: "web-ui" });
          }
          if (!track) throw new Error("選択した候補を再生用に読み込めませんでした。");
          player.queue.add(track);
          if (!player.playing && !player.paused) await player.play();
        } else if (command.action === "play-local-audio") {
          const id = typeof command.payload?.id === "string" ? command.payload.id : "";
          const track = id ? await loadLocalAudioTrack(player, id, { id: "web-ui" }) : null;
          if (!track) throw new Error("ローカル音源を再生用に読み込めませんでした。");
          player.queue.add(track);
          if (!player.playing && !player.paused) await player.play();
        } else if (command.action === "reorder") {
          const order = Array.isArray(command.payload?.order)
            ? command.payload.order.filter((value): value is string => typeof value === "string")
            : [];
          const currentTracks = [...player.queue.tracks];
          const byId = new Map(currentTracks.flatMap((track) => {
            const saved = persistedTrack(track);
            return saved?.queueEntryId ? [[saved.queueEntryId, track] as const] : [];
          }));
          if (order.length !== currentTracks.length || order.some((id) => !byId.has(id)) || new Set(order).size !== order.length) {
            throw new Error("キューが更新されたため並べ替えをやり直してください。");
          }
          player.queue.splice(0, currentTracks.length, order.map((id) => byId.get(id)!));
        } else {
          throw new Error(`未対応の音楽操作です: ${command.action}`);
        }
        await persistPlayer(player);
        await updatePanel(command.guildId, manager).catch(() => undefined);
        await completeMusicControlCommand(command.id);
      } catch (error) {
        const detail = conciseIssueDetail(error);
        console.error(`[music] Web UI control failed id=${command.id}: ${detail}`);
        await completeMusicControlCommand(command.id, detail);
      }
    }
  } finally {
    musicControlRunning = false;
  }
}

function startMusicControlDispatcher(manager: LavalinkManager) {
  if (musicControlTimer) clearInterval(musicControlTimer);
  musicControlTimer = setInterval(() => {
    void executeMusicControlCommands(manager).catch((error) => {
      console.error("[music] Web UI control dispatcher failed:", error);
    });
  }, 1_000);
  musicControlTimer.unref();
}

function searchSessionId() {
  for (const [id, session] of searchSessions) {
    if (session.expiresAt <= Date.now()) searchSessions.delete(id);
  }
  return randomBytes(9).toString("base64url");
}

function recordPlaybackIssue(player: Player, title: string, detail: unknown) {
  const issue = {
    title,
    detail: conciseIssueDetail(detail),
    occurredAt: Date.now(),
  };
  playbackIssues.set(player.guildId, issue);
  console.error(`[music] guild=${player.guildId} ${title}: ${issue.detail}`);
  void syncPlaybackState(player, { status: "error" }).catch((error) => {
    console.error(`[music] failed to persist playback error in guild ${player.guildId}:`, error);
  });
  void updatePanel(player.guildId, player.LavalinkManager).catch((error) => {
    console.error(`[music] failed to show playback error in guild ${player.guildId}:`, error);
  });
}

async function recoverYtDlpPlayback(player: Player, track: SearchTrack | null | undefined, detail: unknown) {
  const ytDlp = track?.userData?.ytDlp as YtDlpTrackData | undefined;
  const retryCount = Number(track?.userData?.ytDlpRetryCount ?? 0);
  if (!ytDlp || retryCount >= 1 || !/^[A-Za-z0-9_-]{11}$/.test(ytDlp.videoId)) return false;

  const issueDetail = String(detail ?? "");
  if (!/decod(?:e|ing)|unexpected end|stream.*closed|connection reset/i.test(issueDetail)) return false;

  const resumePosition = Math.max(0, Math.min(player.position, Math.max(0, ytDlp.duration - 1_000)));
  playbackIssues.set(player.guildId, {
    title: `「${track?.info.title ?? "曲"}」へ再接続しています`,
    detail: "音声URLを更新して同じ位置から再開します。",
    occurredAt: Date.now(),
  });
  await syncPlaybackState(player, { status: "error" }).catch(() => undefined);
  await invalidateYoutubeAudio(ytDlp.videoId);

  try {
    const retryTrack = await loadYtDlpTrack(player, {
      videoId: ytDlp.videoId,
      title: ytDlp.title,
      author: ytDlp.author,
      duration: ytDlp.duration,
      webpageUrl: ytDlp.webpageUrl,
      thumbnailUrl: ytDlp.thumbnailUrl,
    }, track?.requester ?? { id: "automatic-retry" });
    retryTrack.userData = {
      ...(retryTrack.userData ?? {}),
      ytDlpRetryCount: retryCount + 1,
      ...(typeof track?.userData?.queueEntryId === "string" ? { queueEntryId: track.userData.queueEntryId } : {}),
    };
    await player.play({ clientTrack: retryTrack, position: resumePosition });
    console.warn(`[music] guild=${player.guildId} recovered yt-dlp stream id=${ytDlp.videoId} position=${resumePosition}`);
    return true;
  } catch (error) {
    console.error(`[music] guild=${player.guildId} yt-dlp automatic retry failed: ${conciseIssueDetail(error)}`);
    return false;
  }
}

async function recoverPlayback(player: Player, track: SearchTrack | null | undefined, detail: unknown) {
  const saved = persistedTrack(track);
  if (!saved) return false;
  const now = Date.now();
  const previous = playbackRecoveries.get(player.guildId);
  const attempts = !previous || now - previous.lastAttemptAt > 60_000 ? 0 : previous.attempts;
  if (attempts >= 2) return false;
  const state = { attempts: attempts + 1, lastAttemptAt: now, lastRecoveredAt: previous?.lastRecoveredAt ?? null };
  playbackRecoveries.set(player.guildId, state);
  const resumePosition = Math.max(0, Math.min(player.position, Math.max(0, saved.duration - 1_000)));
  playbackIssues.set(player.guildId, {
    title: `「${saved.title}」を自動復旧しています`,
    detail: `再接続 ${state.attempts}/2 · ${conciseIssueDetail(detail)}`,
    occurredAt: now,
  });
  await syncPlaybackState(player, { status: "error" }).catch(() => undefined);
  try {
    if (!player.connected) await player.connect();
    const replacement = await loadSavedMusicTrack(player, saved, { id: "automatic-recovery" });
    if (!replacement) throw new Error("代替音源を読み込めませんでした。");
    await player.play({ clientTrack: replacement, position: resumePosition });
    state.lastRecoveredAt = new Date();
    playbackRecoveries.set(player.guildId, state);
    playbackIssues.delete(player.guildId);
    await syncPlaybackState(player);
    console.warn(`[music] guild=${player.guildId} automatic playback recovery succeeded attempt=${state.attempts} position=${resumePosition}`);
    return true;
  } catch (error) {
    console.error(`[music] guild=${player.guildId} automatic playback recovery failed: ${conciseIssueDetail(error)}`);
    return false;
  }
}

function persistedTracks(player: Player) {
  return [player.queue.current, ...player.queue.tracks].flatMap((track, index) => {
    const saved = persistedTrack(track);
    if (saved && index === 0) saved.repeatMode = player.repeatMode;
    return saved ? [saved] : [];
  });
}

async function persistPlayer(player: Player) {
  const tracks = persistedTracks(player);
  if (!tracks.length || !player.voiceChannelId || !player.textChannelId) {
    await Promise.all([deleteMusicQueue(player.guildId), syncPlaybackState(player)]);
    return;
  }
  await Promise.all([
    saveMusicQueue({
      guildId: player.guildId,
      voiceChannelId: player.voiceChannelId,
      textChannelId: player.textChannelId,
      volume: player.volume,
      tracks,
    }),
    syncPlaybackState(player),
  ]);
}

export async function restoreMusicQueues(manager: LavalinkManager) {
  if (queueRestorationRunning) return;
  queueRestorationRunning = true;
  try {
    const snapshots = await listMusicQueues();
    for (const snapshot of snapshots) {
      let createdPlayer: Player | undefined;
      try {
        if (manager.getPlayer(snapshot.guildId)) continue;
        const player = manager.createPlayer({
          guildId: snapshot.guildId,
          voiceChannelId: snapshot.voiceChannelId,
          textChannelId: snapshot.textChannelId,
          selfDeaf: true,
          volume: snapshot.volume,
        });
        createdPlayer = player;
        if (!player.connected) await player.connect();
        const restoredRepeatMode = snapshot.tracks[0]?.repeatMode;
        if (restoredRepeatMode) await player.setRepeatMode(restoredRepeatMode);
        for (const saved of snapshot.tracks) {
          const track = await loadSavedMusicTrack(player, saved, { restored: true });
          if (track) player.queue.add(track);
        }
        if (player.queue.tracks.length || player.queue.current) await player.play();
        else await manager.destroyPlayer(snapshot.guildId, "persisted queue was unavailable");
      } catch (error) {
        console.error(`[music] queue restore failed guild=${snapshot.guildId}:`, error);
        // A half-created player otherwise causes every later restoration to
        // skip this guild as already restored, leaving it connected and idle.
        if (createdPlayer && manager.getPlayer(snapshot.guildId) === createdPlayer) {
          await manager.destroyPlayer(snapshot.guildId, "queue restoration failed").catch((destroyError) => {
            console.warn(`[music] incomplete player cleanup failed guild=${snapshot.guildId}:`, destroyError);
          });
        }
      }
    }
  } finally {
    queueRestorationRunning = false;
  }
}

export function createLavalinkManager(client: Client) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const host = process.env.LAVALINK_HOST;
  const authorization = process.env.LAVALINK_PASSWORD;

  if (!clientId || !host || !authorization) return null;
  musicClient = client;

  const manager = new LavalinkManager({
    nodes: [
      {
        id: "osu-pulse-main",
        host,
        port: Number(process.env.LAVALINK_PORT ?? 2333),
        authorization,
        secure: process.env.LAVALINK_SECURE === "true",
        retryAmount: 10,
        retryDelay: 5_000,
      },
    ],
    client: { id: clientId, username: "osu pulse" },
    sendToShard: (guildId, payload) => {
      client.guilds.cache.get(guildId)?.shard.send(payload);
    },
    autoSkip: true,
    playerOptions: {
      defaultSearchPlatform: "ytsearch",
      onDisconnect: { autoReconnect: true, destroyPlayer: false },
      onEmptyQueue: { destroyAfterMs: 60_000 },
    },
    advancedOptions: {
      enableDebugEvents: true,
      debugOptions: { noAudio: true },
    },
  });

  client.on("raw", (payload) => manager.sendRawData(payload));
  client.once("ready", () => {
    void Promise.all([...client.guilds.cache.values()].map((guild) => {
      const player = manager.getPlayer(guild.id);
      if (player) return syncPlaybackState(player);
      return saveMusicPlaybackState({
        guildId: guild.id,
        guildName: guild.name,
        status: "idle",
        connected: false,
        paused: false,
        positionMs: 0,
        queue: [],
      });
    })).catch((error) => console.error("[music] initial playback state sync failed:", error));
  });
  manager.nodeManager.on("connect", (node) => {
    console.log(`[lavalink] connected: ${node.id}`);
    void restoreMusicQueues(manager).catch((error) => console.error("[music] queue restoration failed:", error));
  });
  manager.nodeManager.on("error", (node, error) => {
    const cause = error instanceof AggregateError ? error.errors.find((item) => item instanceof Error) : error;
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[lavalink] ${node.id}: ${message}`);
  });
  manager.on("trackStart", (player, track) => {
    playbackIssues.delete(player.guildId);
    console.log(`[music] guild=${player.guildId} started: ${track?.info.title ?? "Unknown track"}`);
    const saved = persistedTrack(track);
    if (saved) lastPlayedTracks.set(player.guildId, saved);
    const historyStart = saved
      ? startMusicPlaybackHistory({
        guildId: player.guildId,
        track: saved,
        requestedByDiscordUserId: requesterId(track),
      }).then((row) => row?.id ?? null)
      : Promise.resolve(null);
    activeHistoryStarts.set(player.guildId, historyStart);
    void Promise.all([persistPlayer(player), historyStart]).catch((error) => console.error("[music] playback start persistence failed:", error));
    void updatePanel(player.guildId, manager).catch(() => undefined);
  });
  manager.on("trackEnd", (player, _track, payload) => {
    const historyStart = activeHistoryStarts.get(player.guildId);
    activeHistoryStarts.delete(player.guildId);
    void Promise.all([
      historyStart
        ? historyStart.then((id) => id ? finishMusicPlaybackHistoryEntry(id, payload.reason) : undefined)
        : finishMusicPlaybackHistory(player.guildId, payload.reason),
      syncPlaybackState(player),
    ]).catch((error) => console.error("[music] playback end persistence failed:", error));
  });
  manager.on("trackError", (player, track, payload) => {
    const detail = payload.exception?.message ?? payload.exception?.cause ?? payload.error;
    void recoverYtDlpPlayback(player, track, detail).then(async (recovered) => recovered || await recoverPlayback(player, track, detail)).then((recovered) => {
      if (!recovered) {
        recordPlaybackIssue(player, `「${track?.info.title ?? "曲"}」を再生できませんでした`, detail);
      }
    }).catch((error) => {
      recordPlaybackIssue(player, `「${track?.info.title ?? "曲"}」を再生できませんでした`, error);
    });
  });
  manager.on("trackStuck", (player, track, payload) => {
    const detail = `Lavalink did not receive audio for ${payload.thresholdMs}ms`;
    void recoverPlayback(player, track, detail).then((recovered) => {
      if (!recovered) recordPlaybackIssue(player, `「${track?.info.title ?? "曲"}」の再生が停止しました`, detail);
    }).catch((error) => recordPlaybackIssue(player, "音楽の再生復旧に失敗しました", error));
  });
  manager.on("playerSocketClosed", (player, payload) => {
    if (payload.code < 4000) return;
    const detail = `${payload.code}: ${payload.reason}`;
    void recoverPlayback(player, player.queue.current, detail).then((recovered) => {
      if (!recovered) recordPlaybackIssue(player, "Discord音声接続が切断されました", detail);
    }).catch((error) => recordPlaybackIssue(player, "Discord音声接続の復旧に失敗しました", error));
  });
  manager.on("queueEnd", (player) => {
    console.log(`[music] guild=${player.guildId} queue ended`);
    const historyStart = activeHistoryStarts.get(player.guildId);
    activeHistoryStarts.delete(player.guildId);
    const finishPrevious = historyStart
      ? historyStart.then((id) => id ? finishMusicPlaybackHistoryEntry(id, "queueEnd") : undefined)
      : finishMusicPlaybackHistory(player.guildId, "queueEnd");
    if (!autoplayInProgress.has(player.guildId)) {
      autoplayInProgress.add(player.guildId);
      void (async () => {
        try {
          await finishPrevious;
          if (!await isMusicRelatedAutoplayEnabled(player.guildId)) return false;
          const previous = lastPlayedTracks.get(player.guildId);
          if (!previous) return false;
          const candidates = await searchMusicCandidates(player, `${previous.title} ${previous.author} related`, { id: "related-autoplay" }, player.guildId);
          const selected = candidates.find((entry) => {
            const uri = entry.kind === "yt-dlp" ? entry.candidate.webpageUrl : entry.track.info.uri;
            return uri && uri !== previous.uri;
          });
          if (!selected) return false;
          const track = selected.kind === "yt-dlp"
            ? await loadYtDlpTrack(player, selected.candidate, { id: "related-autoplay" })
            : selected.track;
          player.queue.add(track);
          playbackIssues.delete(player.guildId);
          await player.play();
          await persistPlayer(player);
          console.log(`[music] guild=${player.guildId} related autoplay: ${track.info.title}`);
          return true;
        } catch (error) {
          console.error(`[music] related autoplay failed guild=${player.guildId}: ${conciseIssueDetail(error)}`);
          return false;
        } finally {
          autoplayInProgress.delete(player.guildId);
        }
      })().then((started) => {
        if (started) return;
        void Promise.all([
          deleteMusicQueue(player.guildId),
          syncPlaybackState(player, { status: "idle", clearTrack: true }),
        ]).catch(() => undefined);
        void updatePanel(player.guildId, manager).catch(() => undefined);
      });
      return;
    }
    void Promise.all([
      deleteMusicQueue(player.guildId),
      finishPrevious,
      syncPlaybackState(player, { status: "idle", clearTrack: true }),
    ]).catch(() => undefined);
    void updatePanel(player.guildId, manager).catch(() => undefined);
  });
  manager.on("playerDisconnect", (player) => {
    void syncPlaybackState(player, { status: "disconnected" }).catch(() => undefined);
  });
  manager.on("playerReconnect", (player) => {
    const recovery = playbackRecoveries.get(player.guildId) ?? { attempts: 0, lastAttemptAt: Date.now(), lastRecoveredAt: null };
    recovery.lastRecoveredAt = new Date();
    playbackRecoveries.set(player.guildId, recovery);
    void syncPlaybackState(player).catch(() => undefined);
  });
  manager.on("playerDestroy", (player, reason) => {
    void Promise.all([
      finishMusicPlaybackHistory(player.guildId, String(reason ?? "playerDestroy")),
      syncPlaybackState(player, { status: "disconnected", clearTrack: true }),
    ]).catch(() => undefined);
  });
  manager.on("debug", (eventKey, eventData) => {
    if (eventData.state === "error" || eventData.state === "warn") {
      console.error(`[lavalink:${eventKey}] ${eventData.functionLayer}: ${eventData.message}`, eventData.error ?? "");
    }
  });
  startPlaybackStateSync(manager);
  startMusicControlDispatcher(manager);
  void syncLocalAudioLibrary().catch((error) => console.error("[music] local audio library sync failed:", error));
  void ensureYtDlpProxy().catch((error) => console.error("[yt-dlp] proxy startup failed:", error));
  return manager;
}

function durationLabel(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "LIVE";
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function searchMusicCandidates(
  player: Pick<Player, "search">,
  query: string,
  requester: unknown,
  guildId?: string,
): Promise<MusicCandidate[]> {
  let workingQuery = query.trim();
  const directTracks: Track[] = [];
  if (/^https?:\/\/(?:www\.)?soundcloud\.com\//i.test(workingQuery)) {
    const startedAt = Date.now();
    try {
      const direct = await player.search({ query: workingQuery }, requester);
      directTracks.push(...direct.tracks.filter(isResolvedTrack).slice(0, 5));
      await recordMusicResolverEvent({ guildId, resolver: "soundcloud", outcome: directTracks.length ? "success" : "failure", queryKind: "load", latencyMs: Date.now() - startedAt });
    } catch (error) {
      await recordMusicResolverEvent({ guildId, resolver: "soundcloud", outcome: "failure", queryKind: "load", latencyMs: Date.now() - startedAt, error: conciseIssueDetail(error) }).catch(() => undefined);
    }
  }
  if (/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(?:track|album)\//i.test(workingQuery)) {
    const startedAt = Date.now();
    try {
      const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(workingQuery)}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`Spotify metadata ${response.status}`);
      const metadata = await response.json() as { title?: string; author_name?: string };
      workingQuery = `${metadata.title ?? ""} ${metadata.author_name ?? ""}`.replace(/\s+/g, " ").trim();
      if (!workingQuery) throw new Error("Spotifyの曲情報を取得できませんでした。");
      await recordMusicResolverEvent({ guildId, resolver: "spotify", outcome: "success", queryKind: "load", latencyMs: Date.now() - startedAt });
    } catch (error) {
      await recordMusicResolverEvent({ guildId, resolver: "spotify", outcome: "failure", queryKind: "load", latencyMs: Date.now() - startedAt, error: conciseIssueDetail(error) }).catch(() => undefined);
    }
  }
  let ytDlpCandidates: YtDlpCandidate[] = [];
  const ytDlpStarted = Date.now();
  try {
    ytDlpCandidates = await searchYoutubeWithYtDlp(workingQuery, 5);
    await recordMusicResolverEvent({ guildId, resolver: "yt-dlp", outcome: ytDlpCandidates.length ? "success" : "failure", latencyMs: Date.now() - ytDlpStarted });
  } catch (error) {
    console.warn(`[music] yt-dlp search failed: ${conciseIssueDetail(error)}`);
    await recordMusicResolverEvent({ guildId, resolver: "yt-dlp", outcome: "failure", latencyMs: Date.now() - ytDlpStarted, error: conciseIssueDetail(error) }).catch(() => undefined);
  }
  let youtubeTracks: Track[] = [];
  if (!ytDlpCandidates.length) {
    const startedAt = Date.now();
    const youtubeResult = await player.search({ query: workingQuery, source: "ytsearch" }, requester);
    youtubeTracks = await playableYoutubeTracks(youtubeResult.tracks);
    await recordMusicResolverEvent({ guildId, resolver: "youtube", outcome: youtubeTracks.length ? "success" : "failure", latencyMs: Date.now() - startedAt }).catch(() => undefined);
  }
  const fallbackQuery = /^https?:\/\//i.test(workingQuery) && ytDlpCandidates[0]
    ? `${ytDlpCandidates[0].title} ${ytDlpCandidates[0].author}`.trim()
    : workingQuery;
  const soundcloudStarted = Date.now();
  const soundcloudResult = await player.search({ query: fallbackQuery, source: "scsearch" }, requester);
  await recordMusicResolverEvent({ guildId, resolver: "soundcloud", outcome: soundcloudResult.tracks.length ? "success" : "failure", latencyMs: Date.now() - soundcloudStarted }).catch(() => undefined);
  const candidates: MusicCandidate[] = [
    ...directTracks.map((track) => ({ kind: "track" as const, track })),
    ...ytDlpCandidates.map((candidate) => ({ kind: "yt-dlp" as const, candidate })),
    ...youtubeTracks.map((track) => ({ kind: "track" as const, track })),
    ...soundcloudResult.tracks.filter(isResolvedTrack).slice(0, 5).map((track) => ({ kind: "track" as const, track })),
  ];
  const seen = new Set<string>();
  return candidates.filter((entry) => {
    const key = entry.kind === "yt-dlp"
      ? `youtube:${entry.candidate.videoId}`
      : entry.track.info.uri ?? `${entry.track.info.sourceName}:${entry.track.info.identifier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

function trimmed(value: string, maximum: number) {
  return value.length <= maximum ? value : `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

function buildSearchSelection(sessionId: string, query: string, candidates: MusicCandidate[]) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${MUSIC_SEARCH_PREFIX}:${sessionId}`)
    .setPlaceholder("再生する曲を選択してください")
    .addOptions(candidates.map((entry, index) => ({
      label: trimmed(entry.kind === "yt-dlp" ? entry.candidate.title : entry.track.info.title || "Unknown track", 100),
      description: trimmed(entry.kind === "yt-dlp"
        ? `${entry.candidate.author} · ${durationLabel(entry.candidate.duration)} · YouTube / yt-dlp`
        : `${entry.track.info.author ?? "Unknown artist"} · ${durationLabel(entry.track.info.duration ?? 0)} · ${entry.track.info.sourceName}`, 100),
      value: String(index),
      emoji: entry.kind === "track" && entry.track.info.sourceName === "soundcloud" ? "🟠" : "🔴",
    })));
  const embed = new EmbedBuilder()
    .setColor(0x8c7cff)
    .setTitle("再生候補を選択")
    .setDescription(`「${trimmed(query, 180)}」の候補を ${candidates.length}件 見つけました。\n下のメニューから1曲選んでください。`)
    .setFooter({ text: "この候補は5分間有効です · 選択するまで再生は開始しません" });
  return {
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  };
}

function progressBar(position: number, duration: number) {
  if (!duration || duration <= 0) return "━━━━━━━━━━━━━━━━━━━━";
  const slots = 20;
  const filled = Math.max(0, Math.min(slots - 1, Math.floor((position / duration) * slots)));
  return `${"━".repeat(filled)}●${"─".repeat(slots - filled - 1)}`;
}

function buttonId(guildId: string, action: string) {
  return `${MUSIC_BUTTON_PREFIX}:${guildId}:${action}`;
}

function buildMusicPanel(guildId: string, player: Player | null) {
  const current = player?.queue.current ?? null;
  const issue = playbackIssues.get(guildId);
  const duration = current?.info.duration ?? 0;
  const position = player?.position ?? 0;
  const embed = new EmbedBuilder().setColor(player?.paused ? 0xffaa55 : 0xff66aa);

  if (issue && (!current || !player?.playing)) {
    embed
      .setColor(0xff5577)
      .setTitle("❌ 音楽を再生できませんでした")
      .setDescription(`${issue.title}\n\n${issue.detail}\n\n別の検索語またはURLで再試行してください。`)
      .setFooter({ text: "失敗内容はBotログにも保存されます" })
      .setTimestamp(issue.occurredAt);
  } else if (current) {
    embed
      .setAuthor({ name: player?.paused ? "Paused" : "Now playing" })
      .setTitle(current.info.title.slice(0, 256) || "Unknown track")
      .setDescription(
        `${current.info.author ?? "Unknown artist"}\n\n${progressBar(position, duration)}\n` +
          `\`${durationLabel(position)} / ${durationLabel(duration)}\``,
      )
      .addFields(
        { name: "音量", value: `${player?.volume ?? 0}%`, inline: true },
        { name: "Queue", value: `${player?.queue.tracks.length ?? 0}曲`, inline: true },
        { name: "接続", value: player?.connected ? "Connected" : "Reconnecting", inline: true },
        { name: "ループ", value: repeatModeLabel(player?.repeatMode ?? "off"), inline: true },
        {
          name: "Source",
          value: current.info.sourceName === "soundcloud" ? "SoundCloud fallback" : current.info.sourceName,
          inline: true,
        },
      )
      .setFooter({ text: "15秒ごとに自動更新 · ボタンは時間制限なし" })
      .setTimestamp();
    const trackUrl = musicDisplayUrl(current.info.uri);
    if (trackUrl) embed.setURL(trackUrl);
    if (current.info.artworkUrl) embed.setThumbnail(current.info.artworkUrl);
  } else {
    embed
      .setTitle("Music player")
      .setDescription("現在再生中の曲はありません。`/music play` で曲を追加できます。")
      .setFooter({ text: "このパネルは次の再生時に再利用されます" })
      .setTimestamp();
  }

  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buttonId(guildId, "toggle"))
      .setLabel(player?.paused ? "再開" : "一時停止")
      .setEmoji(player?.paused ? "▶️" : "⏸️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!current),
    new ButtonBuilder()
      .setCustomId(buttonId(guildId, "skip"))
      .setLabel("スキップ")
      .setEmoji("⏭️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!current),
    new ButtonBuilder()
      .setCustomId(buttonId(guildId, "stop"))
      .setLabel("停止")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!player),
    new ButtonBuilder()
      .setCustomId(buttonId(guildId, "volume-down"))
      .setLabel("-10")
      .setEmoji("🔉")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!player),
    new ButtonBuilder()
      .setCustomId(buttonId(guildId, "volume-up"))
      .setLabel("+10")
      .setEmoji("🔊")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!player),
  );

  const repeatControl = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buttonId(guildId, "repeat"))
      .setLabel(`ループ: ${repeatModeLabel(player?.repeatMode ?? "off")}`)
      .setEmoji("🔁")
      .setStyle(player?.repeatMode === "off" ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(!player),
  );

  return { embeds: [embed], components: [controls, repeatControl] };
}

function isUnknownMessageError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return String((error as { code?: unknown }).code) === "10008";
}

async function updatePanel(guildId: string, manager: LavalinkManager | null, message?: Message) {
  const target = message ?? panels.get(guildId)?.message;
  if (!target) return false;
  const player = manager?.getPlayer(guildId) ?? null;
  try {
    await target.edit(buildMusicPanel(guildId, player));
  } catch (error) {
    if (!isUnknownMessageError(error)) throw error;
    console.warn(`[music] discarded deleted control panel guild=${guildId} message=${target.id}`);
    forgetPanel(guildId, target.id);
    return false;
  }
  if (!player) forgetPanel(guildId, target.id);
  return true;
}

function forgetPanel(guildId: string, expectedMessageId?: string) {
  const panel = panels.get(guildId);
  if (expectedMessageId && panel?.message.id !== expectedMessageId) return;
  if (panel) clearInterval(panel.timer);
  panels.delete(guildId);
}

function rememberPanel(guildId: string, message: Message, manager: LavalinkManager | null) {
  const previous = panels.get(guildId);
  if (previous) clearInterval(previous.timer);
  const update = nonOverlappingTask(() => updatePanel(guildId, manager, message), (error) => {
      console.error(`[music] panel update failed in guild ${guildId}:`, error);
      // Keep refreshing after transient REST errors; deleted messages are
      // removed by updatePanel itself. A slow edit never overlaps the timer.
  });
  const timer = setInterval(() => { void update(); }, PANEL_UPDATE_INTERVAL_MS);
  timer.unref();
  panels.set(guildId, { message, timer });
}

function memberVoiceChannelId(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction) {
  return (interaction.member as GuildMember | null)?.voice.channelId ?? null;
}

function sharesPlayerChannel(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction, player: Player) {
  const voiceChannelId = memberVoiceChannelId(interaction);
  return Boolean(voiceChannelId && voiceChannelId === player.voiceChannelId);
}

export function isMusicButton(interaction: ButtonInteraction) {
  return interaction.customId.startsWith(`${MUSIC_BUTTON_PREFIX}:`);
}

export function isMusicSelect(interaction: StringSelectMenuInteraction) {
  return interaction.customId.startsWith(`${MUSIC_SEARCH_PREFIX}:`);
}

export async function handleMusicSelect(interaction: StringSelectMenuInteraction, manager: LavalinkManager | null) {
  const [, sessionId] = interaction.customId.split(":");
  const session = sessionId ? searchSessions.get(sessionId) : null;
  if (!manager) {
    await interaction.reply({ content: "Lavalinkノードが未設定です。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!session || session.expiresAt <= Date.now()) {
    if (sessionId) searchSessions.delete(sessionId);
    await interaction.reply({ content: "検索候補の有効期限が切れました。`/music play` でもう一度検索してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.user.id !== session.userId || interaction.guildId !== session.guildId) {
    await interaction.reply({ content: "この候補は検索した本人だけが選択できます。", flags: MessageFlags.Ephemeral });
    return;
  }
  const voiceChannelId = memberVoiceChannelId(interaction);
  if (!voiceChannelId || voiceChannelId !== session.voiceChannelId) {
    await interaction.reply({ content: "検索時と同じボイスチャンネルへ参加して選択してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  const selectedIndex = Number.parseInt(interaction.values[0] ?? "", 10);
  const selected = session.candidates[selectedIndex];
  if (!selected) {
    await interaction.reply({ content: "選択した曲が見つかりません。", flags: MessageFlags.Ephemeral });
    return;
  }
  const existing = manager.getPlayer(session.guildId);
  if (existing?.voiceChannelId && existing.voiceChannelId !== voiceChannelId) {
    await interaction.reply({ content: "Botがいるボイスチャンネルに参加してください。", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();
  const player = existing ?? manager.createPlayer({
    guildId: session.guildId,
    voiceChannelId,
    textChannelId: session.channelId,
    selfDeaf: true,
    volume: DEFAULT_MUSIC_VOLUME,
  });
  if (!player.connected) await player.connect();
  let track: Track;
  try {
    track = selected.kind === "yt-dlp"
      ? await loadYtDlpTrack(player, selected.candidate, interaction.user)
      : selected.track;
  } catch (error) {
    await interaction.editReply({
      content: `このYouTube動画の音声を取得できませんでした。${conciseIssueDetail(error)}`,
      embeds: [],
      components: [],
    });
    return;
  }
  const wasPlaying = player.playing || Boolean(player.queue.current);
  playbackIssues.delete(session.guildId);
  player.queue.add(track);
  if (!wasPlaying) await player.play();
  searchSessions.delete(sessionId);
  await persistPlayer(player);
  const message = await interaction.editReply(buildMusicPanel(session.guildId, player));
  rememberPanel(session.guildId, message, manager);
}

export async function handleMusicButton(interaction: ButtonInteraction, manager: LavalinkManager | null) {
  const [, guildId, action] = interaction.customId.split(":");
  if (!guildId || !action || interaction.guildId !== guildId) return;
  if (!manager) {
    await interaction.reply({ content: "Lavalinkノードが未設定です。", flags: MessageFlags.Ephemeral });
    return;
  }

  const player = manager.getPlayer(guildId);
  if (!player) {
    await interaction.reply({ content: "現在のプレイヤーはありません。`/music play` で開始してください。", flags: MessageFlags.Ephemeral });
    await updatePanel(guildId, manager, interaction.message);
    return;
  }
  if (!sharesPlayerChannel(interaction, player)) {
    await interaction.reply({ content: "Botと同じボイスチャンネルに参加して操作してください。", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();
  if (action === "toggle") {
    if (player.paused) await player.resume();
    else await player.pause();
  } else if (action === "skip") {
    await player.skip();
  } else if (action === "stop") {
    await manager.destroyPlayer(guildId, `stopped by ${interaction.user.id}`);
    await deleteMusicQueue(guildId);
  } else if (action === "volume-down") {
    await player.setVolume(Math.max(0, player.volume - 10));
  } else if (action === "volume-up") {
    await player.setVolume(Math.min(150, player.volume + 10));
  } else if (action === "repeat") {
    await player.setRepeatMode(nextRepeatMode(player.repeatMode));
  }

  rememberPanel(guildId, interaction.message, manager);
  if (action !== "stop") await persistPlayer(player);
  const updated = await updatePanel(guildId, manager, interaction.message);
  if (!updated && action !== "stop" && interaction.channel?.isSendable()) {
    const replacement = await interaction.channel.send(buildMusicPanel(guildId, player));
    rememberPanel(guildId, replacement, manager);
  }
}

export function destroyMusicPanels() {
  for (const guildId of panels.keys()) forgetPanel(guildId);
  if (playbackSyncTimer) clearInterval(playbackSyncTimer);
  playbackSyncTimer = null;
  if (musicControlTimer) clearInterval(musicControlTimer);
  musicControlTimer = null;
  musicControlRunning = false;
  stopYtDlpProxy();
  searchSessions.clear();
  activeHistoryStarts.clear();
  playbackRecoveries.clear();
  musicClient = null;
}

export async function handleMusicCommand(
  interaction: ChatInputCommandInteraction,
  manager: LavalinkManager | null,
) {
  if (!interaction.guildId || !interaction.channelId) {
    await interaction.reply({ content: "音楽コマンドはサーバー内で使ってください。", flags: MessageFlags.Ephemeral });
    return;
  }
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "autoplay") {
    const enabled = interaction.options.getBoolean("enabled", true);
    await setMusicRelatedAutoplay(interaction.guildId, enabled);
    await interaction.reply({ content: `${enabled ? "✅" : "⏹️"} 関連曲オートプレイを${enabled ? "有効" : "無効"}にしました。`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === "upload") {
    const attachment = interaction.options.getAttachment("file", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const track = await importLocalAudio({
        url: attachment.url,
        originalFilename: attachment.name,
        uploadedBy: interaction.user.id,
        uploadedVia: "discord",
        expectedSize: attachment.size,
      });
      await upsertMusicLocalAudioTrack(track);
      await interaction.editReply(`✅ **${track.title}** をPCの音源ライブラリへ保存しました。\n${track.format.toUpperCase()} · ${track.codec} · ${track.bitrateKbps}kbps · ${durationLabel(track.durationMs)}\nID: \`${track.id}\``);
    } catch (error) {
      await interaction.editReply(`❌ ${conciseIssueDetail(error)}`);
    }
    return;
  }

  if (subcommand === "library") {
    const tracks = await listLocalAudioTracks();
    const lines = tracks.slice(0, 25).map((track, index) =>
      `${index + 1}. **${track.title}** — ${track.artist}\n${track.format.toUpperCase()} · ${track.bitrateKbps}kbps · ${durationLabel(track.durationMs)} · \`${track.id}\``,
    );
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5d7cff).setTitle("💾 PCローカル音源").setDescription(lines.join("\n\n") || "音源はまだありません。`/music upload` で追加できます。").setFooter({ text: `${tracks.length}曲 · FLAC/WAVはAAC 256kbpsへ自動変換` })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "local-delete") {
    const id = interaction.options.getString("id", true);
    const track = await findLocalAudioTrack(id);
    const member = interaction.member as GuildMember | null;
    if (!track) {
      await interaction.reply({ content: "ローカル音源が見つかりません。", flags: MessageFlags.Ephemeral });
      return;
    }
    if (track.uploadedBy !== interaction.user.id && !member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "自分が追加した音源だけ削除できます。", flags: MessageFlags.Ephemeral });
      return;
    }
    const removed = await deleteLocalAudioTrack(track.id);
    if (removed) await deleteMusicLocalAudioTrack(removed.id);
    await interaction.reply({ content: removed ? `🗑️ **${removed.title}** を削除しました。` : "ローカル音源が見つかりません。", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!manager) {
    await interaction.reply({ content: "Lavalinkノードが未設定です。LAVALINK_HOST と LAVALINK_PASSWORD を確認してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  const existing = manager.getPlayer(interaction.guildId);

  if (subcommand === "local-play") {
    const voiceChannelId = memberVoiceChannelId(interaction);
    if (!voiceChannelId) {
      await interaction.reply({ content: "先にボイスチャンネルへ参加してください。", flags: MessageFlags.Ephemeral });
      return;
    }
    if (existing?.voiceChannelId && existing.voiceChannelId !== voiceChannelId) {
      await interaction.reply({ content: "Botがいるボイスチャンネルに参加してください。", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply();
    const player = existing ?? manager.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      volume: DEFAULT_MUSIC_VOLUME,
    });
    if (!player.connected) await player.connect();
    const track = await loadLocalAudioTrack(player, interaction.options.getString("id", true), interaction.user);
    if (!track) {
      await interaction.editReply("ローカル音源が見つからないか、Lavalinkで読み込めませんでした。");
      return;
    }
    const wasPlaying = player.playing || Boolean(player.queue.current);
    player.queue.add(track);
    if (!wasPlaying) await player.play();
    await persistPlayer(player);
    const message = await interaction.editReply(buildMusicPanel(interaction.guildId, player));
    rememberPanel(interaction.guildId, message, manager);
    return;
  }

  if (subcommand === "favorites") {
    const favorites = await listMusicFavorites(interaction.user.id);
    const lines = favorites.slice(0, 25).map((favorite, index) => `${index + 1}. **${favorite.title}** — ${favorite.author}\n\`${favorite.id}\``);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff66aa).setTitle("⭐ お気に入り").setDescription(lines.join("\n\n") || "お気に入りはまだありません。再生中に `/music favorite-add` で保存できます。")] });
    return;
  }

  if (subcommand === "playlists") {
    const playlists = await listMusicPlaylistsForGuild(interaction.guildId);
    const lines = playlists.slice(0, 25).map((playlist, index) =>
      `${index + 1}. **${playlist.name}** — ${playlist.tracks.length}曲\n\`${playlist.id}\``,
    );
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x8c7cff)
        .setTitle("🎵 サーバープレイリスト")
        .setDescription(lines.join("\n\n") || "Web UIからプレイリストを作成すると、ここに表示されます。")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "favorite-remove") {
    const id = interaction.options.getString("id", true);
    const removed = await removeMusicFavorite(id, interaction.user.id);
    await interaction.reply({ content: removed ? `✅ 「${removed.title}」を削除しました。` : "該当するお気に入りが見つかりません。", flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === "playlist-play") {
    const voiceChannelId = memberVoiceChannelId(interaction);
    if (!voiceChannelId) {
      await interaction.reply({ content: "先にボイスチャンネルへ参加してください。", flags: MessageFlags.Ephemeral });
      return;
    }
    if (existing?.voiceChannelId && existing.voiceChannelId !== voiceChannelId) {
      await interaction.reply({ content: "Botがいるボイスチャンネルに参加してください。", flags: MessageFlags.Ephemeral });
      return;
    }
    const id = interaction.options.getString("id", true);
    const playlist = (await listMusicPlaylistsForGuild(interaction.guildId)).find((row) => row.id === id || row.id.startsWith(id));
    if (!playlist) {
      await interaction.reply({ content: "プレイリストが見つかりません。`/music playlists` でIDを確認してください。", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!playlist.tracks.length) {
      await interaction.reply({ content: "このプレイリストには曲がありません。Web UIから追加してください。", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply();
    const player = existing ?? manager.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      volume: DEFAULT_MUSIC_VOLUME,
    });
    if (!player.connected) await player.connect();
    let added = 0;
    for (const saved of playlist.tracks) {
      let track = await loadSavedMusicTrack(player, saved, interaction.user);
      if (!track) {
        const fallback = await player.search({ query: `${saved.title} ${saved.author}`, source: "scsearch" }, interaction.user);
        track = fallback.tracks.find(isResolvedTrack) ?? null;
      }
      if (track) {
        player.queue.add(track);
        added += 1;
      }
    }
    if (!added) {
      await interaction.editReply("プレイリスト内に再生可能な曲が見つかりませんでした。");
      return;
    }
    const wasPlaying = player.playing || Boolean(player.queue.current);
    playbackIssues.delete(interaction.guildId);
    if (!wasPlaying) await player.play();
    await persistPlayer(player);
    const message = await interaction.editReply(buildMusicPanel(interaction.guildId, player));
    rememberPanel(interaction.guildId, message, manager);
    return;
  }

  if (subcommand === "play" || subcommand === "favorite-play") {
    const voiceChannelId = memberVoiceChannelId(interaction);
    if (!voiceChannelId) {
      await interaction.reply({ content: "先にボイスチャンネルへ参加してください。", flags: MessageFlags.Ephemeral });
      return;
    }
    if (existing?.voiceChannelId && existing.voiceChannelId !== voiceChannelId) {
      await interaction.reply({ content: "Botがいるボイスチャンネルに参加してください。", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply(subcommand === "play" ? { flags: MessageFlags.Ephemeral } : undefined);
    const player = existing ?? manager.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      volume: DEFAULT_MUSIC_VOLUME,
    });

    let query: string;
    if (subcommand === "favorite-play") {
      const id = interaction.options.getString("id", true);
      const favorite = (await listMusicFavorites(interaction.user.id)).find((row) => row.id === id || row.id.startsWith(id));
      if (!favorite) {
        await interaction.editReply("該当するお気に入りが見つかりません。`/music favorites` でIDを確認してください。");
        return;
      }
      query = favorite.uri;
    } else {
      query = interaction.options.getString("query", true);
    }

    if (subcommand === "play") {
      const candidates = await searchMusicCandidates(player, query, interaction.user);
      if (!candidates.length) {
        await interaction.editReply("YouTubeとSoundCloudの両方で再生可能な候補が見つかりませんでした。");
        return;
      }
      const sessionId = searchSessionId();
      searchSessions.set(sessionId, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        voiceChannelId,
        candidates,
        expiresAt: Date.now() + MUSIC_SEARCH_TTL_MS,
      });
      await interaction.editReply(buildSearchSelection(sessionId, query, candidates));
      return;
    }

    if (!player.connected) await player.connect();
    let track: Track | null = await loadSavedMusicTrack(player, {
      title: query,
      author: "Unknown artist",
      uri: query,
    }, interaction.user);
    if (!track) {
      const fallback = await player.search({ query, source: "scsearch" }, interaction.user);
      track = fallback.tracks.find(isResolvedTrack) ?? null;
      if (track) {
        console.warn(
          `[music] guild=${interaction.guildId} YouTube candidates unavailable; using SoundCloud id=${track.info.identifier}`,
        );
      }
    }
    if (!track) {
      await interaction.editReply("YouTubeとSoundCloudの両方で再生可能な曲が見つかりませんでした。");
      return;
    }

    const wasPlaying = player.playing || Boolean(player.queue.current);
    playbackIssues.delete(interaction.guildId);
    player.queue.add(track);
    if (!wasPlaying) await player.play();
    await persistPlayer(player);
    const message = await interaction.editReply(buildMusicPanel(interaction.guildId, player));
    rememberPanel(interaction.guildId, message, manager);
    return;
  }

  if (!existing) {
    await interaction.reply({ content: "現在のプレイヤーはありません。`/music play` で開始してください。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!sharesPlayerChannel(interaction, existing)) {
    await interaction.reply({ content: "Botと同じボイスチャンネルに参加して操作してください。", flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === "favorite-add") {
    const current = existing.queue.current;
    if (!current?.info.uri) {
      await interaction.reply({ content: "保存できる再生中の曲がありません。", flags: MessageFlags.Ephemeral });
      return;
    }
    const favorite = await addMusicFavorite({
      discordUserId: interaction.user.id,
      title: current.info.title,
      author: current.info.author ?? "Unknown artist",
      uri: current.info.uri,
      source: current.info.sourceName,
      duration: current.info.duration ?? 0,
    });
    await interaction.reply({ content: `⭐ 「${favorite?.title ?? current.info.title}」をお気に入りへ保存しました。`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === "skip") {
    await existing.skip();
    await interaction.reply("⏭️ スキップしました。");
  } else if (subcommand === "pause") {
    await existing.pause();
    await interaction.reply("⏸️ 一時停止しました。");
  } else if (subcommand === "resume") {
    await existing.resume();
    await interaction.reply("▶️ 再開しました。");
  } else if (subcommand === "volume") {
    const volume = interaction.options.getInteger("percent", true);
    await existing.setVolume(volume);
    await interaction.reply(`🔊 音量を ${volume}% に変更しました。`);
  } else if (subcommand === "loop") {
    const mode = interaction.options.getString("mode", true) as MusicRepeatMode;
    await existing.setRepeatMode(mode);
    await interaction.reply(`🔁 ループを「${repeatModeLabel(mode)}」に変更しました。`);
  } else if (subcommand === "queue") {
    const current = existing.queue.current;
    const upcoming = existing.queue.tracks.slice(0, 10);
    const lines = [
      current ? `**再生中** ${current.info.title} — ${current.info.author}` : "再生中の曲はありません。",
      ...upcoming.map((track, index) => `${index + 1}. ${track.info.title} — ${track.info.author}`),
    ];
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8c7cff).setTitle("Music queue").setDescription(lines.join("\n"))] });
  } else if (subcommand === "stop") {
    await manager.destroyPlayer(interaction.guildId, `stopped by ${interaction.user.id}`);
    await deleteMusicQueue(interaction.guildId);
    await interaction.reply("⏹️ 再生を停止して退出しました。");
  }

  if (subcommand !== "stop") await persistPlayer(existing);

  await updatePanel(interaction.guildId, manager).catch(() => undefined);
}

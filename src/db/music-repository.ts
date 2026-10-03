import { and, asc, count, desc, eq, gte, isNull, lt, max } from "drizzle-orm";

import { getDb } from "./index";
import {
  musicPlaybackHistory,
  musicPlaybackStates,
  musicControlCommands,
  musicLocalAudioTracks,
  musicResolverEvents,
  musicPlaylistTracks,
  musicPlaylists,
  type MusicPlaybackIssue,
  type MusicVoiceChannel,
  type PersistedMusicTrack,
} from "./schema";

export type MusicPlaybackStatus = "playing" | "paused" | "idle" | "disconnected" | "error";
export type MusicControlAction =
  | "toggle" | "pause" | "resume" | "skip" | "stop" | "volume" | "seek" | "repeat"
  | "autoplay"
  | "search" | "play-candidate" | "reorder" | "import-youtube-playlist"
  | "import-local-audio" | "play-local-audio" | "delete-local-audio";

export type MusicPlaybackView = {
  generatedAt: string;
  states: Array<{
    guildId: string;
    guildName: string | null;
    voiceChannelId: string | null;
    voiceChannelName: string | null;
    availableVoiceChannels: MusicVoiceChannel[];
    textChannelId: string | null;
    status: string;
    currentTrack: PersistedMusicTrack | null;
    queue: PersistedMusicTrack[];
    positionMs: number;
    volume: number;
    paused: boolean;
    connected: boolean;
    autoplayRelated: boolean;
    voicePingMs: number | null;
    frameLossPercent: number | null;
    nodeUptimeMs: number | null;
    reconnectAttempts: number;
    lastRecoveredAt: string | null;
    issue: MusicPlaybackIssue | null;
    updatedAt: string;
  }>;
};

export type MusicLibraryView = {
  generatedAt: string;
  historyTotal: number;
  localTracks: Array<{
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
    uploadedVia: string;
    createdAt: string;
    updatedAt: string;
  }>;
  playlists: Array<{
    id: string;
    guildId: string;
    name: string;
    description: string | null;
    createdByDiscordUserId: string | null;
    createdAt: string;
    updatedAt: string;
    tracks: Array<{
      id: string;
      playlistId: string;
      position: number;
      title: string;
      author: string;
      uri: string;
      source: string;
      duration: number;
      addedByDiscordUserId: string | null;
      createdAt: string;
    }>;
  }>;
  history: Array<{
    id: string;
    guildId: string;
    title: string;
    author: string;
    uri: string;
    source: string;
    duration: number;
    requestedByDiscordUserId: string | null;
    startedAt: string;
    endedAt: string | null;
    endReason: string | null;
  }>;
};

export async function saveMusicPlaybackState(input: {
  guildId: string;
  guildName?: string | null;
  voiceChannelId?: string | null;
  voiceChannelName?: string | null;
  availableVoiceChannels?: MusicVoiceChannel[];
  textChannelId?: string | null;
  status: MusicPlaybackStatus;
  currentTrack?: PersistedMusicTrack | null;
  queue?: PersistedMusicTrack[];
  positionMs?: number;
  volume?: number;
  paused?: boolean;
  connected?: boolean;
  voicePingMs?: number | null;
  frameLossPercent?: number | null;
  nodeUptimeMs?: number | null;
  reconnectAttempts?: number;
  lastRecoveredAt?: Date | null;
  issue?: MusicPlaybackIssue | null;
}) {
  const values = {
    guildId: input.guildId,
    guildName: input.guildName ?? null,
    voiceChannelId: input.voiceChannelId ?? null,
    voiceChannelName: input.voiceChannelName ?? null,
    availableVoiceChannels: input.availableVoiceChannels ?? [],
    textChannelId: input.textChannelId ?? null,
    status: input.status,
    currentTrack: input.currentTrack ?? null,
    queue: input.queue ?? [],
    positionMs: Math.max(0, Math.round(input.positionMs ?? 0)),
    volume: Math.max(0, Math.round(input.volume ?? 30)),
    paused: input.paused ?? false,
    connected: input.connected ?? false,
    voicePingMs: input.voicePingMs ?? null,
    frameLossPercent: input.frameLossPercent ?? null,
    nodeUptimeMs: input.nodeUptimeMs ?? null,
    reconnectAttempts: Math.max(0, input.reconnectAttempts ?? 0),
    lastRecoveredAt: input.lastRecoveredAt ?? null,
    issue: input.issue ?? null,
    updatedAt: new Date(),
  };
  await getDb().insert(musicPlaybackStates).values(values).onConflictDoUpdate({
    target: musicPlaybackStates.guildId,
    set: values,
  });
}

export async function getMusicPlaybackView(): Promise<MusicPlaybackView> {
  const states = await getDb().select().from(musicPlaybackStates).orderBy(asc(musicPlaybackStates.guildId));
  return {
    generatedAt: new Date().toISOString(),
    states: states.map((state) => ({
      ...state,
      currentTrack: state.currentTrack ?? null,
      availableVoiceChannels: state.availableVoiceChannels ?? [],
      queue: state.queue ?? [],
      issue: state.issue ?? null,
      lastRecoveredAt: state.lastRecoveredAt?.toISOString() ?? null,
      updatedAt: state.updatedAt.toISOString(),
    })),
  };
}

export async function setMusicRelatedAutoplay(guildId: string, enabled: boolean) {
  await getDb().insert(musicPlaybackStates).values({ guildId, status: "idle", autoplayRelated: enabled }).onConflictDoUpdate({
    target: musicPlaybackStates.guildId,
    set: { autoplayRelated: enabled, updatedAt: new Date() },
  });
  return enabled;
}

export async function isMusicRelatedAutoplayEnabled(guildId: string) {
  const row = await getDb().query.musicPlaybackStates.findFirst({ where: eq(musicPlaybackStates.guildId, guildId), columns: { autoplayRelated: true } });
  return row?.autoplayRelated ?? false;
}

export async function enqueueMusicControlCommand(input: {
  guildId: string;
  action: MusicControlAction;
  value?: number | null;
  payload?: Record<string, unknown> | null;
}) {
  const [row] = await getDb().insert(musicControlCommands).values({
    guildId: input.guildId,
    action: input.action,
    value: input.value ?? null,
    payload: input.payload ?? null,
  }).returning();
  return row;
}

export async function claimPendingMusicControlCommands(limit = 10) {
  const db = getDb();
  const staleBefore = new Date(Date.now() - 30_000);
  await db.update(musicControlCommands).set({ status: "pending", claimedAt: null }).where(and(
    eq(musicControlCommands.status, "claimed"),
    lt(musicControlCommands.claimedAt, staleBefore),
  ));
  const pending = await db.select().from(musicControlCommands).where(
    eq(musicControlCommands.status, "pending"),
  ).orderBy(asc(musicControlCommands.requestedAt)).limit(Math.max(1, Math.min(25, limit)));
  const claimed: Array<typeof musicControlCommands.$inferSelect> = [];
  for (const command of pending) {
    const [row] = await db.update(musicControlCommands).set({
      status: "claimed",
      claimedAt: new Date(),
      error: null,
    }).where(and(
      eq(musicControlCommands.id, command.id),
      eq(musicControlCommands.status, "pending"),
    )).returning();
    if (row) claimed.push(row);
  }
  return claimed;
}

export async function completeMusicControlCommand(
  id: string,
  error?: string | null,
  result?: Record<string, unknown> | null,
) {
  const [row] = await getDb().update(musicControlCommands).set({
    status: error ? "failed" : "completed",
    error: error?.slice(0, 500) ?? null,
    result: result ?? null,
    completedAt: new Date(),
  }).where(eq(musicControlCommands.id, id)).returning();
  return row;
}

export async function getMusicControlCommand(id: string) {
  return getDb().query.musicControlCommands.findFirst({ where: eq(musicControlCommands.id, id) });
}

export async function recordMusicResolverEvent(input: {
  guildId?: string | null;
  resolver: "yt-dlp" | "youtube" | "soundcloud" | "spotify" | "http";
  outcome: "success" | "failure";
  queryKind?: "search" | "load" | "playlist";
  latencyMs: number;
  error?: string | null;
}) {
  await getDb().insert(musicResolverEvents).values({
    guildId: input.guildId ?? null,
    resolver: input.resolver,
    outcome: input.outcome,
    queryKind: input.queryKind ?? "search",
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    error: input.error?.slice(0, 500) ?? null,
  });
}

export async function getMusicAnalytics(days = 30) {
  const since = new Date(Date.now() - Math.max(1, Math.min(365, days)) * 86_400_000);
  const [history, events] = await Promise.all([
    getDb().select().from(musicPlaybackHistory).where(gte(musicPlaybackHistory.startedAt, since)),
    getDb().select().from(musicResolverEvents).where(gte(musicResolverEvents.createdAt, since)),
  ]);
  const users = new Map<string, { discordUserId: string; requestCount: number; playbackMs: number; completed: number; skipped: number }>();
  for (const row of history) {
    if (!row.requestedByDiscordUserId) continue;
    const stats = users.get(row.requestedByDiscordUserId) ?? {
      discordUserId: row.requestedByDiscordUserId,
      requestCount: 0,
      playbackMs: 0,
      completed: 0,
      skipped: 0,
    };
    stats.requestCount += 1;
    const end = row.endedAt?.getTime() ?? Date.now();
    const elapsed = Math.max(0, end - row.startedAt.getTime());
    stats.playbackMs += row.duration > 0 ? Math.min(row.duration, elapsed) : elapsed;
    if (/finished|queueEnd/i.test(row.endReason ?? "")) stats.completed += 1;
    if (/skip|replaced/i.test(row.endReason ?? "")) stats.skipped += 1;
    users.set(row.requestedByDiscordUserId, stats);
  }
  const resolvers = new Map<string, { resolver: string; attempts: number; successes: number; totalLatencyMs: number; lastError: string | null }>();
  for (const event of events) {
    const stats = resolvers.get(event.resolver) ?? { resolver: event.resolver, attempts: 0, successes: 0, totalLatencyMs: 0, lastError: null };
    stats.attempts += 1;
    stats.successes += event.outcome === "success" ? 1 : 0;
    stats.totalLatencyMs += event.latencyMs;
    if (event.error) stats.lastError = event.error;
    resolvers.set(event.resolver, stats);
  }
  return {
    generatedAt: new Date().toISOString(),
    days,
    users: [...users.values()].sort((a, b) => b.playbackMs - a.playbackMs),
    resolvers: [...resolvers.values()].map((row) => ({
      ...row,
      successRate: row.attempts ? row.successes / row.attempts : 0,
      averageLatencyMs: row.attempts ? Math.round(row.totalLatencyMs / row.attempts) : 0,
    })).sort((a, b) => b.attempts - a.attempts),
  };
}

export async function startMusicPlaybackHistory(input: {
  guildId: string;
  track: PersistedMusicTrack;
  requestedByDiscordUserId?: string | null;
}) {
  const db = getDb();
  const now = new Date();
  await db.update(musicPlaybackHistory).set({ endedAt: now, endReason: "replaced" }).where(
    and(eq(musicPlaybackHistory.guildId, input.guildId), isNull(musicPlaybackHistory.endedAt)),
  );
  const [row] = await db.insert(musicPlaybackHistory).values({
    guildId: input.guildId,
    ...input.track,
    requestedByDiscordUserId: input.requestedByDiscordUserId ?? null,
    startedAt: now,
  }).returning();
  return row;
}

export async function finishMusicPlaybackHistory(guildId: string, endReason: string) {
  return getDb().update(musicPlaybackHistory).set({ endedAt: new Date(), endReason }).where(
    and(eq(musicPlaybackHistory.guildId, guildId), isNull(musicPlaybackHistory.endedAt)),
  );
}

export async function finishMusicPlaybackHistoryEntry(id: string, endReason: string) {
  return getDb().update(musicPlaybackHistory).set({ endedAt: new Date(), endReason }).where(
    eq(musicPlaybackHistory.id, id),
  );
}

export async function createMusicPlaylist(input: {
  guildId: string;
  name: string;
  description?: string | null;
  createdByDiscordUserId?: string | null;
}) {
  const [row] = await getDb().insert(musicPlaylists).values({
    guildId: input.guildId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    createdByDiscordUserId: input.createdByDiscordUserId ?? null,
  }).returning();
  return row;
}

export async function deleteMusicPlaylist(id: string) {
  const [row] = await getDb().delete(musicPlaylists).where(eq(musicPlaylists.id, id)).returning();
  return row;
}

export async function addMusicPlaylistTracks(
  playlistId: string,
  tracks: Array<PersistedMusicTrack & { addedByDiscordUserId?: string | null }>,
) {
  if (!tracks.length) return [];
  const db = getDb();
  const [playlist] = await db.select({ id: musicPlaylists.id }).from(musicPlaylists).where(eq(musicPlaylists.id, playlistId)).limit(1);
  if (!playlist) return null;
  const [last] = await db.select({ position: max(musicPlaylistTracks.position) }).from(musicPlaylistTracks).where(
    eq(musicPlaylistTracks.playlistId, playlistId),
  );
  const startPosition = (last?.position ?? -1) + 1;
  const rows = await db.insert(musicPlaylistTracks).values(tracks.map((track, index) => ({
    playlistId,
    position: startPosition + index,
    title: track.title.trim(),
    author: track.author.trim() || "Unknown artist",
    uri: track.uri.trim(),
    source: track.source.trim() || "unknown",
    duration: Math.max(0, Math.round(track.duration)),
    addedByDiscordUserId: track.addedByDiscordUserId ?? null,
  }))).returning();
  await db.update(musicPlaylists).set({ updatedAt: new Date() }).where(eq(musicPlaylists.id, playlistId));
  return rows;
}

export async function deleteMusicPlaylistTrack(id: string) {
  const db = getDb();
  const [row] = await db.delete(musicPlaylistTracks).where(eq(musicPlaylistTracks.id, id)).returning();
  if (row) await db.update(musicPlaylists).set({ updatedAt: new Date() }).where(eq(musicPlaylists.id, row.playlistId));
  return row;
}

export async function deleteMusicHistoryEntry(id: string) {
  const [row] = await getDb().delete(musicPlaybackHistory).where(eq(musicPlaybackHistory.id, id)).returning();
  return row;
}

export async function clearMusicPlaybackHistory(guildId?: string | null) {
  return guildId
    ? getDb().delete(musicPlaybackHistory).where(eq(musicPlaybackHistory.guildId, guildId))
    : getDb().delete(musicPlaybackHistory);
}

export async function listMusicPlaylistsForGuild(guildId: string) {
  const playlists = await getDb().select().from(musicPlaylists).where(eq(musicPlaylists.guildId, guildId)).orderBy(asc(musicPlaylists.name));
  const tracks = await getDb().select().from(musicPlaylistTracks).orderBy(asc(musicPlaylistTracks.position));
  return playlists.map((playlist) => ({
    ...playlist,
    tracks: tracks.filter((track) => track.playlistId === playlist.id),
  }));
}

export async function upsertMusicLocalAudioTrack(input: {
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
  uploadedVia: string;
  createdAt: string;
  updatedAt: string;
}) {
  const values = {
    ...input,
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.updatedAt),
  };
  const [row] = await getDb().insert(musicLocalAudioTracks).values(values).onConflictDoUpdate({
    target: musicLocalAudioTracks.id,
    set: {
      title: values.title,
      artist: values.artist,
      originalFilename: values.originalFilename,
      fileName: values.fileName,
      format: values.format,
      codec: values.codec,
      bitrateKbps: values.bitrateKbps,
      sampleRateHz: values.sampleRateHz,
      channels: values.channels,
      durationMs: values.durationMs,
      sizeBytes: values.sizeBytes,
      uploadedBy: values.uploadedBy,
      uploadedVia: values.uploadedVia,
      updatedAt: values.updatedAt,
    },
  }).returning();
  return row;
}

export async function deleteMusicLocalAudioTrack(id: string) {
  const [row] = await getDb().delete(musicLocalAudioTracks).where(eq(musicLocalAudioTracks.id, id)).returning();
  return row;
}

export async function listMusicLocalAudioTracks() {
  return getDb().select().from(musicLocalAudioTracks).orderBy(desc(musicLocalAudioTracks.createdAt));
}

export async function getMusicLibraryView(historyLimit = 100): Promise<MusicLibraryView> {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(5_000, Math.round(historyLimit)));
  const [playlists, tracks, history, [historyCount], localTracks] = await Promise.all([
    db.select().from(musicPlaylists).orderBy(desc(musicPlaylists.updatedAt)),
    db.select().from(musicPlaylistTracks).orderBy(asc(musicPlaylistTracks.position)),
    db.select().from(musicPlaybackHistory).orderBy(desc(musicPlaybackHistory.startedAt)).limit(safeLimit),
    db.select({ value: count() }).from(musicPlaybackHistory),
    db.select().from(musicLocalAudioTracks).orderBy(desc(musicLocalAudioTracks.createdAt)),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    historyTotal: historyCount?.value ?? 0,
    localTracks: localTracks.map((track) => ({
      ...track,
      createdAt: track.createdAt.toISOString(),
      updatedAt: track.updatedAt.toISOString(),
    })),
    playlists: playlists.map((playlist) => ({
      ...playlist,
      createdAt: playlist.createdAt.toISOString(),
      updatedAt: playlist.updatedAt.toISOString(),
      tracks: tracks.filter((track) => track.playlistId === playlist.id).map((track) => ({
        ...track,
        createdAt: track.createdAt.toISOString(),
      })),
    })),
    history: history.map((entry) => ({
      ...entry,
      startedAt: entry.startedAt.toISOString(),
      endedAt: entry.endedAt?.toISOString() ?? null,
    })),
  };
}

import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { BotMetricValues } from "../lib/bot-statistics";

export const botTelemetrySamples = pgTable(
  "bot_telemetry_samples",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    scope: text("scope").notNull(),
    scopeLabel: text("scope_label").notNull(),
    sessionId: text("session_id").notNull(),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull().defaultNow(),
    intervalSeconds: doublePrecision("interval_seconds").notNull(),
    metrics: jsonb("metrics").$type<BotMetricValues>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("bot_telemetry_sample_identity_idx").on(table.scope, table.sessionId, table.sampledAt),
    index("bot_telemetry_scope_time_idx").on(table.scope, table.sampledAt),
    index("bot_telemetry_time_idx").on(table.sampledAt),
  ],
);

export const osuModeEnum = pgEnum("osu_mode", [
  "osu",
  "taiko",
  "fruits",
  "mania",
]);

export const reminderStatusEnum = pgEnum("reminder_status", [
  "scheduled",
  "delivered",
  "cancelled",
  "failed",
]);

export const focusStatusEnum = pgEnum("focus_status", [
  "running",
  "completed",
  "cancelled",
]);

export const cloudRenderStatusEnum = pgEnum("cloud_render_status", [
  "queued",
  "claimed",
  "resolving_score",
  "downloading_replay",
  "resolving_beatmap",
  "rendering",
  "encoding",
  "uploading",
  "completed",
  "failed",
  "cancelled",
]);

export const cloudRenderInputEnum = pgEnum("cloud_render_input", [
  "score_url",
  "replay",
  "composition",
]);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    osuUserId: bigint("osu_user_id", { mode: "number" }).notNull().unique(),
    username: text("username").notNull(),
    countryCode: text("country_code"),
    avatarUrl: text("avatar_url"),
    primaryMode: osuModeEnum("primary_mode").notNull().default("osu"),
    timezone: text("timezone").notNull().default("Asia/Tokyo"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // `osu_user_id` is unique, so PostgreSQL already creates the lookup index.
  // Avoid maintaining a second identical index on every account refresh.
  () => [],
);

export const discordAccountLinks = pgTable(
  "discord_account_links",
  {
    discordUserId: text("discord_user_id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    primaryMode: osuModeEnum("primary_mode").notNull().default("osu"),
    dailyDmEnabled: boolean("daily_dm_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("discord_account_links_account_idx").on(table.accountId),
  ],
);

export const manuallyTrackedAccounts = pgTable("manually_tracked_accounts", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ServerStatusChannelIds = Partial<
  Record<
    | "renderer"
    | "cpu"
    | "gpu"
    | "memory"
    | "disk"
    | "network"
    | "render"
    | "videos"
    | "jobs"
    | "live",
    string
  >
>;

export const guildSettings = pgTable("guild_settings", {
  guildId: text("guild_id").primaryKey(),
  resultChannelId: text("result_channel_id"),
  announcementsEnabled: boolean("announcements_enabled").notNull().default(true),
  minimumPp: doublePrecision("minimum_pp").notNull().default(0),
  locale: text("locale").notNull().default("ja"),
  statusEnabled: boolean("status_enabled").notNull().default(false),
  statusCategoryId: text("status_category_id"),
  statusChannelIds: jsonb("status_channel_ids").$type<ServerStatusChannelIds>(),
  statusLiveMessageId: text("status_live_message_id"),
  utilityPanelChannelId: text("utility_panel_channel_id"),
  utilityPanelMessageId: text("utility_panel_message_id"),
  updatesChannelId: text("updates_channel_id"),
  dailyReportChannelId: text("daily_report_channel_id"),
  weeklyAwardsChannelId: text("weekly_awards_channel_id"),
  auditLogChannelId: text("audit_log_channel_id"),
  consoleLogChannelId: text("console_log_channel_id"),
  onboardingChannelId: text("onboarding_channel_id"),
  onboardingRoleId: text("onboarding_role_id"),
  onboardingPanelMessageId: text("onboarding_panel_message_id"),
  ticketCategoryId: text("ticket_category_id"),
  ticketLogChannelId: text("ticket_log_channel_id"),
  ticketSupportRoleId: text("ticket_support_role_id"),
  monthlyMontageEnabled: boolean("monthly_montage_enabled").notNull().default(false),
  monthlyMontageChannelId: text("monthly_montage_channel_id"),
  monthlyMontageMode: osuModeEnum("monthly_montage_mode").notNull().default("osu"),
  lastMonthlyMontageMonth: text("last_monthly_montage_month"),
  lastAnnouncedVersion: text("last_announced_version"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const accountGuilds = pgTable(
  "account_guilds",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    guildId: text("guild_id")
      .notNull()
      .references(() => guildSettings.guildId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.guildId] })],
);

export const scoreEvents = pgTable(
  "score_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    osuScoreId: text("osu_score_id").notNull().unique(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    mode: osuModeEnum("mode").notNull(),
    beatmapId: bigint("beatmap_id", { mode: "number" }).notNull(),
    beatmapsetId: bigint("beatmapset_id", { mode: "number" }),
    artist: text("artist").notNull(),
    title: text("title").notNull(),
    difficulty: text("difficulty").notNull(),
    mapper: text("mapper"),
    coverUrl: text("cover_url"),
    pp: doublePrecision("pp"),
    starRating: doublePrecision("star_rating"),
    aimDifficulty: doublePrecision("aim_difficulty"),
    speedDifficulty: doublePrecision("speed_difficulty"),
    bpm: doublePrecision("bpm"),
    beatmapLengthSeconds: integer("beatmap_length_seconds"),
    ar: doublePrecision("ar"),
    od: doublePrecision("od"),
    cs: doublePrecision("cs"),
    accuracy: doublePrecision("accuracy").notNull(),
    rank: text("rank").notNull(),
    maxCombo: integer("max_combo"),
    score: text("score"),
    mods: jsonb("mods").$type<string[]>().notNull().default([]),
    passed: boolean("passed").notNull().default(true),
    isPersonalBest: boolean("is_personal_best").notNull().default(false),
    anomalyScore: doublePrecision("anomaly_score"),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("score_events_account_mode_time_idx").on(
      table.accountId,
      table.mode,
      table.endedAt,
    ),
    index("score_events_account_mode_pp_idx").on(
      table.accountId,
      table.mode,
      table.pp,
    ),
  ],
);

export const dailySnapshots = pgTable(
  "daily_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    mode: osuModeEnum("mode").notNull(),
    snapshotDate: date("snapshot_date", { mode: "string" }).notNull(),
    globalRank: integer("global_rank"),
    countryRank: integer("country_rank"),
    pp: doublePrecision("pp").notNull().default(0),
    accuracy: doublePrecision("accuracy").notNull().default(0),
    playCount: integer("play_count").notNull().default(0),
    playTimeSeconds: integer("play_time_seconds"),
    totalScore: text("total_score").notNull().default("0"),
    rankedScore: text("ranked_score").notNull().default("0"),
    level: doublePrecision("level").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("daily_snapshot_account_mode_date_idx").on(
      table.accountId,
      table.mode,
      table.snapshotDate,
    ),
  ],
);

export const profileSnapshots = pgTable(
  "profile_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    mode: osuModeEnum("mode").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    globalRank: integer("global_rank"),
    countryRank: integer("country_rank"),
    pp: doublePrecision("pp").notNull().default(0),
    accuracy: doublePrecision("accuracy"),
    playCount: integer("play_count").notNull().default(0),
    playTimeSeconds: integer("play_time_seconds"),
    totalScore: text("total_score").notNull().default("0"),
    rankedScore: text("ranked_score"),
    level: doublePrecision("level"),
    source: text("source").notNull().default("live"),
    sourceKey: text("source_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("profile_snapshots_account_mode_time_idx").on(
      table.accountId,
      table.mode,
      table.capturedAt,
    ),
    uniqueIndex("profile_snapshots_source_key_idx").on(table.sourceKey),
  ],
);

export const topPlaySnapshots = pgTable(
  "top_play_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    mode: osuModeEnum("mode").notNull(),
    topLimit: integer("top_limit").notNull().default(50),
    scoreIds: jsonb("score_ids").$type<string[]>().notNull().default([]),
    topPpSum: doublePrecision("top_pp_sum").notNull().default(0),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    source: text("source").notNull().default("live"),
    sourceKey: text("source_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("top_play_snapshots_account_mode_time_idx").on(
      table.accountId,
      table.mode,
      table.capturedAt,
    ),
    uniqueIndex("top_play_snapshots_source_key_idx").on(table.sourceKey),
  ],
);

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    discordUserId: text("discord_user_id").notNull(),
    guildId: text("guild_id"),
    channelId: text("channel_id"),
    message: text("message").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: reminderStatusEnum("status").notNull().default("scheduled"),
    workflowRunId: text("workflow_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [index("reminders_due_status_idx").on(table.status, table.dueAt)],
);

export const focusSessions = pgTable(
  "focus_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    discordUserId: text("discord_user_id").notNull(),
    guildId: text("guild_id"),
    channelId: text("channel_id").notNull(),
    focusMinutes: integer("focus_minutes").notNull().default(25),
    breakMinutes: integer("break_minutes").notNull().default(5),
    rounds: integer("rounds").notNull().default(4),
    completedRounds: integer("completed_rounds").notNull().default(0),
    status: focusStatusEnum("status").notNull().default("running"),
    workflowRunId: text("workflow_run_id"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("focus_sessions_user_status_idx").on(
      table.discordUserId,
      table.status,
    ),
  ],
);

export const userGoals = pgTable(
  "user_goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    discordUserId: text("discord_user_id").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    mode: osuModeEnum("mode").notNull(),
    targetPp: doublePrecision("target_pp"),
    targetGlobalRank: integer("target_global_rank"),
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
    achievedAt: timestamp("achieved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_goals_discord_mode_idx").on(table.discordUserId, table.mode),
    index("user_goals_account_idx").on(table.accountId),
  ],
);

export const botErrors = pgTable(
  "bot_errors",
  {
    traceId: text("trace_id").primaryKey(),
    command: text("command").notNull(),
    discordUserId: text("discord_user_id"),
    guildId: text("guild_id"),
    message: text("message").notNull(),
    stack: text("stack"),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [index("bot_errors_created_idx").on(table.createdAt)],
);

export const botFeedback = pgTable(
  "bot_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    discordUserId: text("discord_user_id").notNull(),
    guildId: text("guild_id"),
    kind: text("kind").notNull().default("request"),
    title: text("title").notNull(),
    details: text("details").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("bot_feedback_status_created_idx").on(table.status, table.createdAt)],
);

export type PersistedMusicTrack = {
  queueEntryId?: string | null;
  title: string;
  author: string;
  uri: string;
  source: string;
  duration: number;
  videoId?: string | null;
  thumbnailUrl?: string | null;
  audioBitrateKbps?: number | null;
  audioCodec?: string | null;
  audioSampleRateHz?: number | null;
  audioChannels?: number | null;
  contentLength?: number | null;
  container?: string | null;
  resolver?: "lavalink" | "yt-dlp" | "local";
  repeatMode?: "off" | "track" | "queue";
};

export const musicQueueSnapshots = pgTable("music_queue_snapshots", {
  guildId: text("guild_id").primaryKey(),
  voiceChannelId: text("voice_channel_id").notNull(),
  textChannelId: text("text_channel_id").notNull(),
  volume: integer("volume").notNull().default(80),
  tracks: jsonb("tracks").$type<PersistedMusicTrack[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const musicFavorites = pgTable(
  "music_favorites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    discordUserId: text("discord_user_id").notNull(),
    title: text("title").notNull(),
    author: text("author").notNull(),
    uri: text("uri").notNull(),
    source: text("source").notNull(),
    duration: integer("duration").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("music_favorites_user_uri_idx").on(table.discordUserId, table.uri),
    index("music_favorites_user_created_idx").on(table.discordUserId, table.createdAt),
  ],
);

export type MusicPlaybackIssue = {
  title: string;
  detail: string;
  occurredAt: number;
};

export type MusicVoiceChannel = {
  id: string;
  name: string;
  memberCount: number;
};

export const musicPlaybackStates = pgTable("music_playback_states", {
  guildId: text("guild_id").primaryKey(),
  guildName: text("guild_name"),
  voiceChannelId: text("voice_channel_id"),
  voiceChannelName: text("voice_channel_name"),
  availableVoiceChannels: jsonb("available_voice_channels").$type<MusicVoiceChannel[]>().notNull().default([]),
  textChannelId: text("text_channel_id"),
  status: text("status").notNull().default("idle"),
  currentTrack: jsonb("current_track").$type<PersistedMusicTrack>(),
  queue: jsonb("queue").$type<PersistedMusicTrack[]>().notNull().default([]),
  positionMs: integer("position_ms").notNull().default(0),
  volume: integer("volume").notNull().default(80),
  paused: boolean("paused").notNull().default(false),
  connected: boolean("connected").notNull().default(false),
  autoplayRelated: boolean("autoplay_related").notNull().default(false),
  voicePingMs: integer("voice_ping_ms"),
  frameLossPercent: doublePrecision("frame_loss_percent"),
  nodeUptimeMs: bigint("node_uptime_ms", { mode: "number" }),
  reconnectAttempts: integer("reconnect_attempts").notNull().default(0),
  lastRecoveredAt: timestamp("last_recovered_at", { withTimezone: true }),
  issue: jsonb("issue").$type<MusicPlaybackIssue>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const musicPlaylists = pgTable(
  "music_playlists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    guildId: text("guild_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdByDiscordUserId: text("created_by_discord_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("music_playlists_guild_name_idx").on(table.guildId, table.name),
    index("music_playlists_guild_updated_idx").on(table.guildId, table.updatedAt),
  ],
);

export const musicPlaylistTracks = pgTable(
  "music_playlist_tracks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    playlistId: uuid("playlist_id")
      .notNull()
      .references(() => musicPlaylists.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    author: text("author").notNull(),
    uri: text("uri").notNull(),
    source: text("source").notNull(),
    duration: integer("duration").notNull().default(0),
    addedByDiscordUserId: text("added_by_discord_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("music_playlist_tracks_playlist_position_idx").on(table.playlistId, table.position),
  ],
);

export const musicPlaybackHistory = pgTable(
  "music_playback_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    guildId: text("guild_id").notNull(),
    title: text("title").notNull(),
    author: text("author").notNull(),
    uri: text("uri").notNull(),
    source: text("source").notNull(),
    duration: integer("duration").notNull().default(0),
    requestedByDiscordUserId: text("requested_by_discord_user_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason"),
  },
  (table) => [
    index("music_playback_history_guild_started_idx").on(table.guildId, table.startedAt),
    index("music_playback_history_started_idx").on(table.startedAt),
  ],
);

export const musicControlCommands = pgTable(
  "music_control_commands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    guildId: text("guild_id").notNull(),
    action: text("action").notNull(),
    value: integer("value"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("pending"),
    error: text("error"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("music_control_commands_status_requested_idx").on(table.status, table.requestedAt),
    index("music_control_commands_guild_requested_idx").on(table.guildId, table.requestedAt),
  ],
);

export const musicResolverEvents = pgTable(
  "music_resolver_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    guildId: text("guild_id"),
    resolver: text("resolver").notNull(),
    outcome: text("outcome").notNull(),
    queryKind: text("query_kind").notNull().default("search"),
    latencyMs: integer("latency_ms").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("music_resolver_events_created_idx").on(table.createdAt),
    index("music_resolver_events_resolver_created_idx").on(table.resolver, table.createdAt),
  ],
);

export const musicLocalAudioTracks = pgTable(
  "music_local_audio_tracks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    artist: text("artist").notNull().default("Unknown artist"),
    originalFilename: text("original_filename").notNull(),
    fileName: text("file_name").notNull(),
    format: text("format").notNull(),
    codec: text("codec").notNull(),
    bitrateKbps: integer("bitrate_kbps").notNull(),
    sampleRateHz: integer("sample_rate_hz"),
    channels: integer("channels"),
    durationMs: integer("duration_ms").notNull().default(0),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    uploadedBy: text("uploaded_by"),
    uploadedVia: text("uploaded_via").notNull().default("discord"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("music_local_audio_tracks_created_idx").on(table.createdAt),
    index("music_local_audio_tracks_title_idx").on(table.title),
  ],
);

export const serviceControlCommands = pgTable(
  "service_control_commands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    service: text("service").notNull(),
    action: text("action").notNull().default("restart"),
    status: text("status").notNull().default("pending"),
    error: text("error"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("service_control_commands_status_requested_idx").on(table.status, table.requestedAt)],
);

export const discordAnnouncements = pgTable("discord_announcements", {
  id: uuid("id").defaultRandom().primaryKey(),
  channelId: text("channel_id").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  sentBy: text("sent_by").notNull().default("control-panel"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    guildId: text("guild_id"),
    actorDiscordUserId: text("actor_discord_user_id"),
    source: text("source").notNull(),
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("admin_audit_logs_guild_created_idx").on(table.guildId, table.createdAt)],
);

export const communityTickets = pgTable(
  "community_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull().unique(),
    openerDiscordUserId: text("opener_discord_user_id").notNull(),
    subject: text("subject").notNull().default("Support request"),
    status: text("status").notNull().default("open"),
    closedByDiscordUserId: text("closed_by_discord_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    index("community_tickets_guild_status_idx").on(table.guildId, table.status),
    index("community_tickets_created_idx").on(table.createdAt),
  ],
);

export const communityEvents = pgTable(
  "community_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    winnerCount: integer("winner_count").notNull().default(1),
    createdByDiscordUserId: text("created_by_discord_user_id").notNull(),
    status: text("status").notNull().default("active"),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("community_events_guild_status_idx").on(table.guildId, table.status),
    index("community_events_due_idx").on(table.status, table.endsAt),
  ],
);

export const communityEventEntries = pgTable(
  "community_event_entries",
  {
    eventId: uuid("event_id").notNull().references(() => communityEvents.id, { onDelete: "cascade" }),
    discordUserId: text("discord_user_id").notNull(),
    choiceIndex: integer("choice_index"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.discordUserId] }),
    index("community_event_entries_event_idx").on(table.eventId),
  ],
);

export const discordActivityBuckets = pgTable(
  "discord_activity_buckets",
  {
    guildId: text("guild_id").notNull(),
    bucketHour: timestamp("bucket_hour", { withTimezone: true }).notNull(),
    messageCount: integer("message_count").notNull().default(0),
    voiceJoinCount: integer("voice_join_count").notNull().default(0),
    voiceLeaveCount: integer("voice_leave_count").notNull().default(0),
    activeDiscordUserIds: jsonb("active_discord_user_ids").$type<string[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.bucketHour] }),
    index("discord_activity_bucket_hour_idx").on(table.bucketHour),
  ],
);

export const reportDeliveries = pgTable(
  "report_deliveries",
  {
    guildId: text("guild_id").notNull(),
    reportType: text("report_type").notNull(),
    reportDate: date("report_date", { mode: "string" }).notNull(),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.reportType, table.reportDate] })],
);

export type NotificationRuleConditions = {
  modes: ("osu" | "taiko" | "fruits" | "mania")[];
  ranks: string[];
  minimumPp: number;
  maximumPp: number | null;
  minimumAccuracy: number;
  requiredMods: string[];
  personalBestOnly: boolean;
  anomalyOnly: boolean;
};

export const notificationRules = pgTable(
  "notification_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    conditions: jsonb("conditions").$type<NotificationRuleConditions>().notNull(),
    createdBy: text("created_by"),
    lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notification_rules_guild_enabled_idx").on(table.guildId, table.enabled),
    index("notification_rules_account_idx").on(table.accountId),
  ],
);

export const scoreNotificationDeliveries = pgTable(
  "score_notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scoreId: uuid("score_id")
      .notNull()
      .references(() => scoreEvents.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    ruleId: uuid("rule_id").references(() => notificationRules.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    messageId: text("message_id"),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("score_notification_deliveries_score_channel_idx").on(table.scoreId, table.channelId),
    index("score_notification_deliveries_due_idx").on(table.status, table.nextAttemptAt),
  ],
);

export const serviceUsageDaily = pgTable(
  "service_usage_daily",
  {
    service: text("service").notNull(),
    usageDate: date("usage_date", { mode: "string" }).notNull(),
    operations: integer("operations").notNull().default(0),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    alerted: boolean("alerted").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.service, table.usageDate] })],
);

export type CloudRenderOptions = {
  resolution: "1920x1080" | "2560x1440" | "2560x1600" | "3840x2160";
  fps: 60 | 120 | 240;
  speed: "original" | "0.5" | "0.75" | "1.0" | "1.25" | "1.5" | "2.0";
  motionBlur: boolean;
  highlight?: boolean;
};

export type CloudRenderMetadata = {
  request_source?: "manual" | "scheduled" | "automatic";
  score_id?: number | null;
  player_name?: string | null;
  user_id?: number | null;
  beatmap_id?: number | null;
  beatmapset_id?: number | null;
  artist?: string | null;
  title?: string | null;
  difficulty?: string | null;
  mapper?: string | null;
  ruleset?: string;
  mods?: string[];
  score?: number | null;
  pp?: number | null;
  rank?: string | null;
  accuracy?: number | null;
  max_combo?: number | null;
  miss_count?: number | null;
  ended_at?: string | null;
};

export const cloudRenderJobs = pgTable(
  "cloud_render_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accessTokenHash: text("access_token_hash").notNull(),
    inputType: cloudRenderInputEnum("input_type").notNull(),
    sourceHash: text("source_hash").notNull(),
    scoreUrl: text("score_url"),
    replayData: text("replay_data"),
    options: jsonb("options").$type<CloudRenderOptions>().notNull(),
    status: cloudRenderStatusEnum("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    message: text("message").notNull().default("ローカル Renderer の待機中"),
    metadata: jsonb("metadata").$type<CloudRenderMetadata>(),
    localJobId: text("local_job_id"),
    claimedBy: text("claimed_by"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    priority: integer("priority").notNull().default(0),
    batchId: uuid("batch_id"),
    requestedByDiscordUserId: text("requested_by_discord_user_id"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    videoUrl: text("video_url"),
    videoSize: bigint("video_size", { mode: "number" }),
    errorCode: text("error_code"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("cloud_render_jobs_status_created_idx").on(table.status, table.createdAt),
    index("cloud_render_jobs_status_priority_created_idx").on(table.status, table.priority, table.createdAt),
    index("cloud_render_jobs_source_status_idx").on(table.sourceHash, table.status),
    index("cloud_render_jobs_lease_idx").on(table.leaseExpiresAt),
    index("cloud_render_jobs_expiry_idx").on(table.expiresAt),
    index("cloud_render_jobs_scheduled_idx").on(table.status, table.scheduledAt),
  ],
);

export const cloudRendererState = pgTable("cloud_renderer_state", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("offline"),
  busy: boolean("busy").notNull().default(false),
  queueSize: integer("queue_size").notNull().default(0),
  activeCloudJobId: uuid("active_cloud_job_id"),
  dependencies: jsonb("dependencies").$type<Record<string, unknown>>().notNull().default({}),
  version: text("version"),
  configurationVersion: integer("configuration_version").notNull().default(0),
  restartRequired: boolean("restart_required").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const systemMetricSamples = pgTable(
  "system_metric_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    rendererId: text("renderer_id").notNull(),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull().defaultNow(),
    cpuPercent: doublePrecision("cpu_percent").notNull().default(0),
    gpuPercent: doublePrecision("gpu_percent"),
    cpuTemperatureC: doublePrecision("cpu_temperature_c"),
    gpuTemperatureC: doublePrecision("gpu_temperature_c"),
    memoryUsedBytes: bigint("memory_used_bytes", { mode: "number" }).notNull().default(0),
    memoryTotalBytes: bigint("memory_total_bytes", { mode: "number" }).notNull().default(0),
    diskUsedBytes: bigint("disk_used_bytes", { mode: "number" }).notNull().default(0),
    diskTotalBytes: bigint("disk_total_bytes", { mode: "number" }).notNull().default(0),
    networkReceivedBytes: bigint("network_received_bytes", { mode: "number" }).notNull().default(0),
    networkSentBytes: bigint("network_sent_bytes", { mode: "number" }).notNull().default(0),
    activeRenders: integer("active_renders").notNull().default(0),
    queueSize: integer("queue_size").notNull().default(0),
  },
  (table) => [
    index("system_metric_samples_renderer_time_idx").on(table.rendererId, table.sampledAt),
    index("system_metric_samples_time_idx").on(table.sampledAt),
  ],
);

export const serviceHeartbeats = pgTable("service_heartbeats", {
  service: text("service").primaryKey(),
  status: text("status").notNull().default("operational"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const serviceIncidents = pgTable(
  "service_incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    service: text("service").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    severity: text("severity").notNull().default("degraded"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("service_incidents_started_idx").on(table.startedAt),
    index("service_incidents_service_resolved_idx").on(table.service, table.resolvedAt),
  ],
);

export const rivalries = pgTable(
  "rivalries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    guildId: text("guild_id").notNull(),
    ownerDiscordUserId: text("owner_discord_user_id").notNull(),
    ownerAccountId: uuid("owner_account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    rivalDiscordUserId: text("rival_discord_user_id"),
    rivalAccountId: uuid("rival_account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    mode: osuModeEnum("mode").notNull().default("osu"),
    notificationChannelId: text("notification_channel_id"),
    enabled: boolean("enabled").notNull().default(true),
    lastNotifiedDate: date("last_notified_date", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("rivalries_owner_rival_mode_idx").on(table.guildId, table.ownerDiscordUserId, table.rivalAccountId, table.mode),
    index("rivalries_enabled_idx").on(table.enabled, table.guildId),
  ],
);

export const overlayFeeds = pgTable("overlay_feeds", {
  tokenHash: text("token_hash").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  createdByDiscordUserId: text("created_by_discord_user_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RenderVideoCleanup = {
  r2_deleted?: boolean;
  local_deleted?: boolean;
  errors?: string[];
  updated_at?: string;
};

export const renderVideos = pgTable(
  "render_videos",
  {
    videoId: text("video_id").primaryKey(),
    jobId: text("job_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    privacyStatus: text("privacy_status").notNull().default("public"),
    scoreId: bigint("score_id", { mode: "number" }),
    sourceSize: bigint("source_size", { mode: "number" }).notNull().default(0),
    cleanup: jsonb("cleanup").$type<RenderVideoCleanup>(),
    status: text("status").notNull().default("active"),
    deleteRequested: boolean("delete_requested").notNull().default(false),
    deleteError: text("delete_error"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("render_videos_uploaded_idx").on(table.uploadedAt),
    index("render_videos_delete_idx").on(table.deleteRequested, table.updatedAt),
  ],
);

export type ControlPanelSettingsValue = {
  renderDefaults: {
    resolution: CloudRenderOptions["resolution"];
    fps: CloudRenderOptions["fps"];
    speed: CloudRenderOptions["speed"];
    motionBlur: boolean;
  };
  renderer: {
    maxConcurrentRenders: 1 | 2;
    renderTimeoutSeconds: number;
    outputRetentionHours: number;
    videoEncoder: "auto" | "h264_nvenc" | "h264_amf" | "libx264";
    autoDownloadBeatmaps: boolean;
    beatmapDownloadNoVideo: boolean;
    videoCompress: boolean;
    videoCompressQuality: number;
    videoCompressAudioKbps: number;
    watermarkEnabled: boolean;
    watermarkText: string;
    watermarkPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    storageRetentionHours: number;
    scheduleEnabled: boolean;
    allowedStartTime: string;
    allowedEndTime: string;
    idleOnly: boolean;
    idleMinutes: number;
  };
  appearance: {
    maniaScrollSpeed: number;
    maniaJudgmentScale: number;
    maniaScoreScale: number;
    maniaComboScale: number;
    standardBackgroundParallax: boolean;
    standardKeyOverlay: boolean;
    standardKeyOverlayScale: number;
  };
  youtube: {
    autoUpload: boolean;
    privacyStatus: "private" | "unlisted" | "public";
    deleteAfterUpload: boolean;
    categoryId: string;
    titleTemplate: string;
    descriptionTemplate: string;
    tags: string[];
    playlistIds: {
      x: string;
      s: string;
      a: string;
      pp100: string;
      pp200: string;
      pp300: string;
      pp400: string;
    };
  };
  storage: {
    r2Endpoint: string;
    r2Bucket: string;
  };
  autoRender: {
    enabled: boolean;
    personalBestOnly: boolean;
    discordUserIds: string[];
    osuUserIds: string[];
    ranks: ("XH" | "X" | "SH" | "S" | "A" | "B" | "C" | "D" | "F")[];
    modes: ("osu" | "mania")[];
    minimumPp: number;
    minimumAccuracy: number;
    resolution: CloudRenderOptions["resolution"];
    fps: CloudRenderOptions["fps"];
    speed: CloudRenderOptions["speed"];
    motionBlur: boolean;
  };
  monitoring: {
    alertsEnabled: boolean;
    alertChannelId: string;
    osuDailyRequestLimit: number;
    youtubeDailyQuota: number;
    r2StorageLimitGb: number;
  };
};

export type ControlPanelSecretName =
  | "OSU_CLIENT_ID"
  | "OSU_CLIENT_SECRET"
  | "YOUTUBE_CLIENT_ID"
  | "YOUTUBE_CLIENT_SECRET"
  | "YOUTUBE_REFRESH_TOKEN"
  | "SPOTIFY_CLIENT_ID"
  | "SPOTIFY_CLIENT_SECRET"
  | "R2_ACCESS_KEY_ID"
  | "R2_SECRET_ACCESS_KEY";

export const controlPanelSettings = pgTable("control_panel_settings", {
  id: text("id").primaryKey(),
  version: integer("version").notNull().default(1),
  values: jsonb("values").$type<ControlPanelSettingsValue>().notNull(),
  encryptedSecrets: jsonb("encrypted_secrets")
    .$type<Partial<Record<ControlPanelSecretName, string>>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const controlPanelSessions = pgTable(
  "control_panel_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    authMethod: text("auth_method").notNull().default("keyphrase"),
    discordUserId: text("discord_user_id"),
    discordUsername: text("discord_username"),
    discordAvatarUrl: text("discord_avatar_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("control_panel_sessions_expiry_idx").on(table.expiresAt)],
);

export const controlPanelLoginAttempts = pgTable("control_panel_login_attempts", {
  fingerprintHash: text("fingerprint_hash").primaryKey(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Account = typeof accounts.$inferSelect;
export type BotTelemetrySample = typeof botTelemetrySamples.$inferSelect;
export type DiscordAccountLink = typeof discordAccountLinks.$inferSelect;
export type ManuallyTrackedAccount = typeof manuallyTrackedAccounts.$inferSelect;
export type GuildSettings = typeof guildSettings.$inferSelect;
export type ScoreEvent = typeof scoreEvents.$inferSelect;
export type DailySnapshot = typeof dailySnapshots.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type FocusSession = typeof focusSessions.$inferSelect;
export type UserGoal = typeof userGoals.$inferSelect;
export type BotError = typeof botErrors.$inferSelect;
export type BotFeedback = typeof botFeedback.$inferSelect;
export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type CommunityTicket = typeof communityTickets.$inferSelect;
export type CommunityEvent = typeof communityEvents.$inferSelect;
export type CommunityEventEntry = typeof communityEventEntries.$inferSelect;
export type DiscordActivityBucket = typeof discordActivityBuckets.$inferSelect;
export type ReportDelivery = typeof reportDeliveries.$inferSelect;
export type NotificationRule = typeof notificationRules.$inferSelect;
export type ScoreNotificationDelivery = typeof scoreNotificationDeliveries.$inferSelect;
export type MusicQueueSnapshot = typeof musicQueueSnapshots.$inferSelect;
export type MusicFavorite = typeof musicFavorites.$inferSelect;
export type MusicPlaybackState = typeof musicPlaybackStates.$inferSelect;
export type MusicPlaylist = typeof musicPlaylists.$inferSelect;
export type MusicPlaylistTrack = typeof musicPlaylistTracks.$inferSelect;
export type MusicPlaybackHistoryEntry = typeof musicPlaybackHistory.$inferSelect;
export type MusicLocalAudioTrack = typeof musicLocalAudioTracks.$inferSelect;
export type MusicControlCommand = typeof musicControlCommands.$inferSelect;
export type CloudRenderJob = typeof cloudRenderJobs.$inferSelect;
export type CloudRendererState = typeof cloudRendererState.$inferSelect;
export type ProfileSnapshot = typeof profileSnapshots.$inferSelect;
export type TopPlaySnapshot = typeof topPlaySnapshots.$inferSelect;
export type SystemMetricSample = typeof systemMetricSamples.$inferSelect;
export type ServiceHeartbeat = typeof serviceHeartbeats.$inferSelect;
export type ServiceIncident = typeof serviceIncidents.$inferSelect;
export type Rivalry = typeof rivalries.$inferSelect;
export type OverlayFeed = typeof overlayFeeds.$inferSelect;
export type RenderVideo = typeof renderVideos.$inferSelect;
export type ControlPanelSettings = typeof controlPanelSettings.$inferSelect;
export type ControlPanelSession = typeof controlPanelSessions.$inferSelect;

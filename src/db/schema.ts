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
]);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    discordUserId: text("discord_user_id").notNull().unique(),
    osuUserId: bigint("osu_user_id", { mode: "number" }).notNull().unique(),
    username: text("username").notNull(),
    countryCode: text("country_code"),
    avatarUrl: text("avatar_url"),
    primaryMode: osuModeEnum("primary_mode").notNull().default("osu"),
    timezone: text("timezone").notNull().default("Asia/Tokyo"),
    dailyDmEnabled: boolean("daily_dm_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("accounts_osu_user_idx").on(table.osuUserId),
    index("accounts_discord_user_idx").on(table.discordUserId),
  ],
);

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
    accuracy: doublePrecision("accuracy").notNull(),
    rank: text("rank").notNull(),
    maxCombo: integer("max_combo"),
    score: text("score"),
    mods: jsonb("mods").$type<string[]>().notNull().default([]),
    passed: boolean("passed").notNull().default(true),
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

export type CloudRenderOptions = {
  resolution: "1920x1080" | "2560x1440" | "2560x1600" | "3840x2160";
  fps: 60 | 120 | 240;
  speed: "original" | "0.5" | "0.75" | "1.0" | "1.25" | "1.5" | "2.0";
  motionBlur: boolean;
};

export type CloudRenderMetadata = {
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
    index("cloud_render_jobs_lease_idx").on(table.leaseExpiresAt),
    index("cloud_render_jobs_expiry_idx").on(table.expiresAt),
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
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Account = typeof accounts.$inferSelect;
export type GuildSettings = typeof guildSettings.$inferSelect;
export type ScoreEvent = typeof scoreEvents.$inferSelect;
export type DailySnapshot = typeof dailySnapshots.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type FocusSession = typeof focusSessions.$inferSelect;
export type CloudRenderJob = typeof cloudRenderJobs.$inferSelect;
export type CloudRendererState = typeof cloudRendererState.$inferSelect;

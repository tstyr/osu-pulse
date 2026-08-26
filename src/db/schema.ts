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

export const guildSettings = pgTable("guild_settings", {
  guildId: text("guild_id").primaryKey(),
  resultChannelId: text("result_channel_id"),
  announcementsEnabled: boolean("announcements_enabled").notNull().default(true),
  minimumPp: doublePrecision("minimum_pp").notNull().default(0),
  locale: text("locale").notNull().default("ja"),
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

export type Account = typeof accounts.$inferSelect;
export type GuildSettings = typeof guildSettings.$inferSelect;
export type ScoreEvent = typeof scoreEvents.$inferSelect;
export type DailySnapshot = typeof dailySnapshots.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type FocusSession = typeof focusSessions.$inferSelect;

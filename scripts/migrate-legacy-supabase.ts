import { count, countDistinct, eq, max, min } from "drizzle-orm";

import { getDb } from "@/db";
import {
  accounts,
  dailySnapshots,
  discordAccountLinks,
  guildSettings,
  manuallyTrackedAccounts,
  profileSnapshots,
  scoreEvents,
  topPlaySnapshots,
} from "@/db/schema";
import { getOsuScore, getOsuUser, type OsuApiCredentials } from "@/lib/osu/client";
import type { OsuMode } from "@/lib/osu/modes";
import { normalizeScore } from "@/lib/osu/normalize";
import { zonedDateKey } from "@/lib/time";

const SOURCE = "legacy-supabase";
const PAGE_SIZE = 1_000;
const INSERT_BATCH_SIZE = 250;
const VALID_DISCORD_ID = /^\d{17,20}$/;

type JsonRecord = Record<string, unknown>;

type LegacySnapshot = {
  id: string | number;
  osu_user_id: string | number;
  osu_username?: string | null;
  discord_id?: string | null;
  mode?: string | null;
  pp?: string | number | null;
  global_rank?: string | number | null;
  country_rank?: string | number | null;
  play_time_seconds?: string | number | null;
  play_count?: string | number | null;
  total_score?: string | number | null;
  captured_at: string;
};

type LegacyTrackedUser = {
  discord_id: string;
  osu_user_id?: string | number | null;
  osu_username?: string | null;
  first_linked_at?: string | null;
  last_linked_at?: string | null;
  daily_dm_history_enabled?: boolean | null;
};

type LegacyUserLink = {
  discord_id: string;
  osu_username?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type LegacyBestScore = {
  id: string | number;
  discord_id?: string | null;
  osu_user_id?: string | number | null;
  osu_username?: string | null;
  mode?: string | null;
  score_id: string | number;
  pp?: string | number | null;
  beatmap_id?: string | number | null;
  beatmap_title?: string | null;
  recorded_at: string;
  accuracy?: string | number | null;
  miss_count?: string | number | null;
  max_combo?: string | number | null;
  mods?: unknown;
};

type LegacyBestScoreEvent = {
  id: string | number;
  discord_id?: string | null;
  osu_user_id?: string | number | null;
  osu_username?: string | null;
  mode?: string | null;
  score_id: string | number;
  pp?: string | number | null;
  recorded_at: string;
};

type LegacyTopPlaySnapshot = {
  id: string | number;
  discord_id?: string | null;
  osu_user_id?: string | number | null;
  osu_username?: string | null;
  mode?: string | null;
  top_limit?: string | number | null;
  score_ids_json?: unknown;
  top_pp_sum?: string | number | null;
  captured_at: string;
};

type LegacyGuildSettings = {
  guild_id: string;
  alert_channel_id?: string | null;
  report_channel_id?: string | null;
  alert_pp_threshold?: string | number | null;
  realtime_score_channel_id?: string | null;
  daily_history_channel_id?: string | null;
  updated_at?: string | null;
};

type AccountSeed = {
  osuUserId: number;
  username: string;
  primaryMode: OsuMode;
  createdAt: Date;
};

type SourceData = {
  userSettings: JsonRecord[];
  userLinks: LegacyUserLink[];
  trackedUsers: LegacyTrackedUser[];
  bestScoreEvents: LegacyBestScoreEvent[];
  growthRates: JsonRecord[];
  topPlaySnapshots: LegacyTopPlaySnapshot[];
  bestScores: LegacyBestScore[];
  userSnapshots: LegacySnapshot[];
  guildSettings: LegacyGuildSettings[];
  guildAuthSettings: JsonRecord[];
  goals: JsonRecord[];
  youtubeDownloadSettings: JsonRecord[];
};

type ImportReport = {
  dryRun: boolean;
  sourceRows: Record<string, number>;
  discoveredAccounts: number;
  newAccounts: number;
  manuallyTrackedAccounts: number;
  profileSnapshots: number;
  dailySnapshots: number;
  discordLinks: number;
  unresolvedDiscordLinks: Array<{ discordId: string; username: string }>;
  scoreEvents: number;
  skippedScoreEvents: number;
  topPlaySnapshots: number;
  guildSettings: number;
  notes: string[];
};

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function legacyConfig() {
  const rawUrl = requiredEnvironment("LEGACY_SUPABASE_URL");
  const secret = requiredEnvironment("LEGACY_SUPABASE_SECRET_KEY");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
    throw new Error("LEGACY_SUPABASE_URL must be an https://*.supabase.co URL");
  }
  return { baseUrl: url.origin, secret };
}

async function fetchTable<T>(table: string): Promise<T[]> {
  const { baseUrl, secret } = legacyConfig();
  const rows: T[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const endpoint = new URL(`/rest/v1/${table}`, baseUrl);
    endpoint.searchParams.set("select", "*");
    endpoint.searchParams.set("limit", String(PAGE_SIZE));
    endpoint.searchParams.set("offset", String(offset));
    const response = await fetch(endpoint, {
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Supabase ${table} read failed (${response.status}): ${await response.text()}`);
    }
    const page = (await response.json()) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function loadSource(): Promise<SourceData> {
  const [
    userSettings,
    userLinks,
    trackedUsers,
    bestScoreEvents,
    growthRates,
    topPlaySnapshotRows,
    bestScores,
    userSnapshots,
    legacyGuildSettings,
    guildAuthSettings,
    goals,
    youtubeDownloadSettings,
  ] = await Promise.all([
    fetchTable<JsonRecord>("user_settings"),
    fetchTable<LegacyUserLink>("user_links"),
    fetchTable<LegacyTrackedUser>("osu_tracked_users"),
    fetchTable<LegacyBestScoreEvent>("osu_best_score_events"),
    fetchTable<JsonRecord>("osu_growth_rates"),
    fetchTable<LegacyTopPlaySnapshot>("osu_top_play_snapshots"),
    fetchTable<LegacyBestScore>("osu_best_scores"),
    fetchTable<LegacySnapshot>("osu_user_snapshots"),
    fetchTable<LegacyGuildSettings>("osu_guild_settings"),
    fetchTable<JsonRecord>("guild_auth_settings"),
    fetchTable<JsonRecord>("osu_goals"),
    fetchTable<JsonRecord>("youtube_download_settings"),
  ]);

  return {
    userSettings,
    userLinks,
    trackedUsers,
    bestScoreEvents,
    growthRates,
    topPlaySnapshots: topPlaySnapshotRows,
    bestScores,
    userSnapshots,
    guildSettings: legacyGuildSettings,
    guildAuthSettings,
    goals,
    youtubeDownloadSettings,
  };
}

function asNumber(value: unknown, fallback = 0) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asNullableInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function validOsuUserId(value: unknown) {
  const number = asNumber(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeMode(value: unknown): OsuMode {
  const mode = String(value ?? "osu").toLowerCase();
  if (mode === "std" || mode === "standard" || mode === "osu") return "osu";
  if (mode === "catch" || mode === "ctb" || mode === "fruits") return "fruits";
  if (mode === "taiko") return "taiko";
  if (mode === "mania") return "mania";
  return "osu";
}

function normalizeUsername(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/[ _-]+/g, "_");
}

function validDate(value: unknown, fallback = new Date()) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function stableSourceKey(table: string, id: unknown) {
  return `${SOURCE}:${table}:${String(id)}`;
}

function sourceCounts(source: SourceData) {
  return Object.fromEntries(
    Object.entries(source).map(([name, rows]) => [name, rows.length]),
  );
}

function discoverAccounts(source: SourceData) {
  const states = new Map<number, {
    usernames: Array<{ value: string; at: number }>;
    modes: Map<OsuMode, number>;
    createdAt: Date;
  }>();

  const add = (input: {
    osuUserId: unknown;
    username?: unknown;
    mode?: unknown;
    at?: unknown;
  }) => {
    const osuUserId = validOsuUserId(input.osuUserId);
    if (!osuUserId) return;
    const at = validDate(input.at, new Date(0));
    const state = states.get(osuUserId) ?? {
      usernames: [],
      modes: new Map<OsuMode, number>(),
      createdAt: at,
    };
    const username = String(input.username ?? "").trim();
    if (username) state.usernames.push({ value: username, at: at.getTime() });
    const mode = normalizeMode(input.mode);
    state.modes.set(mode, (state.modes.get(mode) ?? 0) + 1);
    if (at < state.createdAt) state.createdAt = at;
    states.set(osuUserId, state);
  };

  for (const row of source.userSnapshots) add({
    osuUserId: row.osu_user_id,
    username: row.osu_username,
    mode: row.mode,
    at: row.captured_at,
  });
  for (const row of source.trackedUsers) add({
    osuUserId: row.osu_user_id,
    username: row.osu_username,
    at: row.first_linked_at,
  });
  for (const row of source.bestScores) add({
    osuUserId: row.osu_user_id,
    username: row.osu_username,
    mode: row.mode,
    at: row.recorded_at,
  });
  for (const row of source.bestScoreEvents) add({
    osuUserId: row.osu_user_id,
    username: row.osu_username,
    mode: row.mode,
    at: row.recorded_at,
  });
  for (const row of source.topPlaySnapshots) add({
    osuUserId: row.osu_user_id,
    username: row.osu_username,
    mode: row.mode,
    at: row.captured_at,
  });

  const seeds = new Map<number, AccountSeed>();
  for (const [osuUserId, state] of states) {
    const latestUsername = state.usernames.sort((a, b) => b.at - a.at)[0]?.value;
    const primaryMode = [...state.modes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "osu";
    seeds.set(osuUserId, {
      osuUserId,
      username: latestUsername || `osu-${osuUserId}`,
      primaryMode,
      createdAt: state.createdAt.getTime() > 0 ? state.createdAt : new Date(),
    });
  }
  return seeds;
}

function buildIdentityLookups(source: SourceData) {
  const byDiscord = new Map<string, number>();
  const byUsername = new Map<string, number>();
  const add = (discordId: unknown, username: unknown, osuUserIdValue: unknown) => {
    const osuUserId = validOsuUserId(osuUserIdValue);
    if (!osuUserId) return;
    const discord = String(discordId ?? "").trim();
    const usernameKey = normalizeUsername(username);
    if (discord) byDiscord.set(discord, osuUserId);
    if (usernameKey) byUsername.set(usernameKey, osuUserId);
  };
  for (const row of source.userSnapshots) add(row.discord_id, row.osu_username, row.osu_user_id);
  for (const row of source.trackedUsers) add(row.discord_id, row.osu_username, row.osu_user_id);
  for (const row of source.bestScores) add(row.discord_id, row.osu_username, row.osu_user_id);
  for (const row of source.bestScoreEvents) add(row.discord_id, row.osu_username, row.osu_user_id);
  for (const row of source.topPlaySnapshots) add(row.discord_id, row.osu_username, row.osu_user_id);
  return { byDiscord, byUsername };
}

async function enrichMissingIdentities(
  source: SourceData,
  seeds: Map<number, AccountSeed>,
  lookups: ReturnType<typeof buildIdentityLookups>,
) {
  if (!process.env.OSU_CLIENT_ID || !process.env.OSU_CLIENT_SECRET) return;
  const credentials = {
    clientId: process.env.OSU_CLIENT_ID,
    clientSecret: process.env.OSU_CLIENT_SECRET,
  } satisfies OsuApiCredentials;
  const candidates = new Map<string, { username: string; discordIds: Set<string> }>();
  const add = (discordIdValue: unknown, usernameValue: unknown, osuUserIdValue: unknown) => {
    if (validOsuUserId(osuUserIdValue)) return;
    const username = String(usernameValue ?? "").trim();
    const key = normalizeUsername(username);
    if (!key || lookups.byUsername.has(key)) return;
    const candidate = candidates.get(key) ?? { username, discordIds: new Set<string>() };
    const discordId = String(discordIdValue ?? "").trim();
    if (discordId) candidate.discordIds.add(discordId);
    candidates.set(key, candidate);
  };
  for (const row of source.userLinks) add(row.discord_id, row.osu_username, null);
  for (const row of source.trackedUsers) add(row.discord_id, row.osu_username, row.osu_user_id);
  for (const row of source.bestScores) add(row.discord_id, row.osu_username, row.osu_user_id);
  for (const row of source.bestScoreEvents) add(row.discord_id, row.osu_username, row.osu_user_id);
  for (const row of source.topPlaySnapshots) add(row.discord_id, row.osu_username, row.osu_user_id);

  const resolved = await runWithConcurrency([...candidates.entries()], 4, async ([key, candidate]) => {
    try {
      const user = await getOsuUser(candidate.username, "osu", credentials);
      return { key, candidate, user };
    } catch (error) {
      console.warn(`[legacy] username lookup failed for ${candidate.username}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  });
  for (const item of resolved) {
    if (!item) continue;
    lookups.byUsername.set(item.key, item.user.id);
    for (const discordId of item.candidate.discordIds) lookups.byDiscord.set(discordId, item.user.id);
    if (!seeds.has(item.user.id)) {
      seeds.set(item.user.id, {
        osuUserId: item.user.id,
        username: item.user.username,
        primaryMode: item.user.playmode ?? "osu",
        createdAt: new Date(),
      });
    }
  }
}

function resolveOsuUserId(
  row: { discord_id?: string | null; osu_username?: string | null; osu_user_id?: unknown },
  lookups: ReturnType<typeof buildIdentityLookups>,
) {
  return validOsuUserId(row.osu_user_id)
    ?? lookups.byDiscord.get(String(row.discord_id ?? ""))
    ?? lookups.byUsername.get(normalizeUsername(row.osu_username))
    ?? null;
}

async function runWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  work: (value: T, index: number) => Promise<R>,
) {
  const result = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      result[index] = await work(values[index]!, index);
    }
  });
  await Promise.all(workers);
  return result;
}

function chunks<T>(values: T[], size = INSERT_BATCH_SIZE) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function parseScoreIds(value: unknown) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value.split(",");
    }
  }
  return Array.isArray(parsed)
    ? parsed.map(String).filter((id) => /^\d+$/.test(id))
    : [];
}

function parseMods(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed || trimmed === "NM") return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Legacy rows also used comma-separated text.
  }
  return trimmed.split(/[,+ ]+/).map((part) => part.trim()).filter(Boolean);
}

function parseBeatmapTitle(value: unknown, beatmapId: number) {
  const text = String(value ?? "").trim();
  const match = /^(.*?)\s+-\s+(.*?)\s+\[(.*)]$/.exec(text);
  if (match) return { artist: match[1]!, title: match[2]!, difficulty: match[3]! };
  return { artist: "Unknown artist", title: text || `Beatmap #${beatmapId}`, difficulty: "Unknown" };
}

function fallbackRank(accuracyValue: unknown, missValue: unknown) {
  const accuracy = asNumber(accuracyValue) > 1 ? asNumber(accuracyValue) / 100 : asNumber(accuracyValue);
  const misses = asNumber(missValue);
  if (accuracy >= 1 && misses === 0) return "X";
  if (accuracy >= 0.95 && misses === 0) return "S";
  if (accuracy >= 0.9) return "A";
  if (accuracy >= 0.8) return "B";
  if (accuracy >= 0.7) return "C";
  return "D";
}

async function ensureAccounts(
  seeds: Map<number, AccountSeed>,
  dryRun: boolean,
) {
  const db = getDb();
  const current = await db.select().from(accounts);
  const currentIds = new Set(current.map((row) => row.osuUserId));
  if (!dryRun) {
    const credentials = process.env.OSU_CLIENT_ID && process.env.OSU_CLIENT_SECRET
      ? { clientId: process.env.OSU_CLIENT_ID, clientSecret: process.env.OSU_CLIENT_SECRET } satisfies OsuApiCredentials
      : undefined;

    const missing = [...seeds.values()].filter((seed) => !currentIds.has(seed.osuUserId));
    const identities = await runWithConcurrency(missing, 4, async (seed) => {
      if (!credentials) return { seed, user: null };
      try {
        return { seed, user: await getOsuUser(seed.osuUserId, seed.primaryMode, credentials) };
      } catch (error) {
        console.warn(`[legacy] osu! identity lookup failed for ${seed.osuUserId}: ${error instanceof Error ? error.message : String(error)}`);
        return { seed, user: null };
      }
    });

    for (const batch of chunks(identities)) {
      if (batch.length === 0) continue;
      await db.insert(accounts).values(batch.map(({ seed, user }) => ({
        osuUserId: seed.osuUserId,
        username: user?.username ?? seed.username,
        countryCode: user?.country_code ?? null,
        avatarUrl: user?.avatar_url ?? `https://a.ppy.sh/${seed.osuUserId}`,
        primaryMode: seed.primaryMode,
        timezone: "Asia/Tokyo",
        createdAt: seed.createdAt,
        updatedAt: new Date(),
      }))).onConflictDoNothing();
    }
  }

  const all = dryRun ? current : await db.select().from(accounts);
  return {
    byOsuUserId: new Map(all.map((row) => [row.osuUserId, row])),
    newAccounts: [...seeds.keys()].filter((id) => !currentIds.has(id)).length,
  };
}

async function migrate(source: SourceData, dryRun: boolean): Promise<ImportReport> {
  const db = getDb();
  const seeds = discoverAccounts(source);
  const lookups = buildIdentityLookups(source);
  // Keep a dry run strictly read-only. The real import additionally resolves old
  // rows affected by the legacy osu_user_id=0 bug through the current osu! API.
  if (!dryRun) await enrichMissingIdentities(source, seeds, lookups);
  const { byOsuUserId: accountByOsuId, newAccounts } = await ensureAccounts(seeds, dryRun);
  const report: ImportReport = {
    dryRun,
    sourceRows: sourceCounts(source),
    discoveredAccounts: seeds.size,
    newAccounts,
    manuallyTrackedAccounts: seeds.size,
    profileSnapshots: 0,
    dailySnapshots: 0,
    discordLinks: 0,
    unresolvedDiscordLinks: [],
    scoreEvents: 0,
    skippedScoreEvents: 0,
    topPlaySnapshots: 0,
    guildSettings: source.guildSettings.length,
    notes: [
      "osu_growth_rates is derived data and will be recalculated from imported profile snapshots.",
      "Legacy per-user locale, YouTube download preferences, and verified-role settings have no equivalent in the current schema.",
    ],
  };

  if (dryRun) {
    report.profileSnapshots = source.userSnapshots.filter((row) => validOsuUserId(row.osu_user_id)).length;
    report.dailySnapshots = new Set(source.userSnapshots.flatMap((row) => {
      const osuUserId = validOsuUserId(row.osu_user_id);
      if (!osuUserId) return [];
      return [`${osuUserId}:${normalizeMode(row.mode)}:${zonedDateKey(validDate(row.captured_at), "Asia/Tokyo")}`];
    })).size;
    report.topPlaySnapshots = source.topPlaySnapshots.filter((row) => resolveOsuUserId(row, lookups)).length;
  } else {
    const manualRows = [...seeds.keys()].flatMap((osuUserId) => {
      const account = accountByOsuId.get(osuUserId);
      return account ? [{ accountId: account.id, updatedAt: new Date() }] : [];
    });
    for (const batch of chunks(manualRows)) {
      await db.insert(manuallyTrackedAccounts).values(batch).onConflictDoNothing();
    }

    const profileRows = source.userSnapshots.flatMap((row) => {
      const osuUserId = validOsuUserId(row.osu_user_id);
      const account = osuUserId ? accountByOsuId.get(osuUserId) : undefined;
      if (!account) return [];
      const capturedAt = validDate(row.captured_at);
      return [{
        accountId: account.id,
        mode: normalizeMode(row.mode),
        capturedAt,
        globalRank: asNullableInteger(row.global_rank),
        countryRank: asNullableInteger(row.country_rank),
        pp: asNumber(row.pp),
        accuracy: null,
        playCount: asNumber(row.play_count),
        playTimeSeconds: asNullableInteger(row.play_time_seconds),
        totalScore: String(row.total_score ?? "0"),
        rankedScore: null,
        level: null,
        source: SOURCE,
        sourceKey: stableSourceKey("osu_user_snapshots", row.id),
        createdAt: capturedAt,
      }];
    });
    report.profileSnapshots = profileRows.length;
    for (const batch of chunks(profileRows)) {
      await db.insert(profileSnapshots).values(batch).onConflictDoNothing();
    }

    const latestByDay = new Map<string, (typeof profileRows)[number]>();
    for (const row of profileRows) {
      const day = zonedDateKey(row.capturedAt, "Asia/Tokyo");
      const key = `${row.accountId}:${row.mode}:${day}`;
      const previous = latestByDay.get(key);
      if (!previous || previous.capturedAt < row.capturedAt) latestByDay.set(key, row);
    }
    const dailyRows = [...latestByDay.values()].map((row) => ({
      accountId: row.accountId,
      mode: row.mode,
      snapshotDate: zonedDateKey(row.capturedAt, "Asia/Tokyo"),
      globalRank: row.globalRank,
      countryRank: row.countryRank,
      pp: row.pp,
      accuracy: row.accuracy ?? 0,
      playCount: row.playCount,
      playTimeSeconds: row.playTimeSeconds,
      totalScore: row.totalScore,
      rankedScore: row.rankedScore ?? "0",
      level: row.level ?? 0,
      createdAt: row.capturedAt,
      updatedAt: row.capturedAt,
    }));
    report.dailySnapshots = dailyRows.length;
    for (const batch of chunks(dailyRows)) {
      await db.insert(dailySnapshots).values(batch).onConflictDoNothing();
    }
  }

  const linkCandidates = new Map<string, {
    discordId: string;
    osuUserId: number | null;
    username: string;
    dailyDmEnabled: boolean;
    createdAt: Date;
  }>();
  for (const row of source.userLinks) {
    const discordId = String(row.discord_id ?? "").trim();
    if (!VALID_DISCORD_ID.test(discordId)) continue;
    linkCandidates.set(discordId, {
      discordId,
      osuUserId: resolveOsuUserId(row, lookups),
      username: String(row.osu_username ?? ""),
      dailyDmEnabled: true,
      createdAt: validDate(row.created_at),
    });
  }
  for (const row of source.trackedUsers) {
    const discordId = String(row.discord_id ?? "").trim();
    if (!VALID_DISCORD_ID.test(discordId)) continue;
    const previous = linkCandidates.get(discordId);
    linkCandidates.set(discordId, {
      discordId,
      osuUserId: resolveOsuUserId(row, lookups) ?? previous?.osuUserId ?? null,
      username: String(row.osu_username ?? previous?.username ?? ""),
      dailyDmEnabled: row.daily_dm_history_enabled ?? previous?.dailyDmEnabled ?? true,
      createdAt: validDate(row.first_linked_at, previous?.createdAt),
    });
  }

  const resolvedLinks = [...linkCandidates.values()].flatMap((candidate) => {
    const account = candidate.osuUserId ? accountByOsuId.get(candidate.osuUserId) : undefined;
    if (!account) {
      report.unresolvedDiscordLinks.push({ discordId: candidate.discordId, username: candidate.username });
      return [];
    }
    return [{
      discordUserId: candidate.discordId,
      accountId: account.id,
      primaryMode: account.primaryMode,
      dailyDmEnabled: candidate.dailyDmEnabled,
      createdAt: candidate.createdAt,
      updatedAt: new Date(),
    }];
  });
  report.discordLinks = resolvedLinks.length;
  if (!dryRun) {
    for (const batch of chunks(resolvedLinks)) {
      await db.insert(discordAccountLinks).values(batch).onConflictDoNothing();
    }
  }

  const topRows = source.topPlaySnapshots.flatMap((row) => {
    const osuUserId = resolveOsuUserId(row, lookups);
    const account = osuUserId ? accountByOsuId.get(osuUserId) : undefined;
    if (!account) return [];
    const capturedAt = validDate(row.captured_at);
    return [{
      accountId: account.id,
      mode: normalizeMode(row.mode),
      topLimit: asNumber(row.top_limit, 50),
      scoreIds: parseScoreIds(row.score_ids_json),
      topPpSum: asNumber(row.top_pp_sum),
      capturedAt,
      source: SOURCE,
      sourceKey: stableSourceKey("osu_top_play_snapshots", row.id),
      createdAt: capturedAt,
    }];
  });
  report.topPlaySnapshots = topRows.length;
  if (!dryRun) {
    for (const batch of chunks(topRows)) {
      await db.insert(topPlaySnapshots).values(batch).onConflictDoNothing();
    }
  }

  const mergedScores = new Map<string, LegacyBestScore & { event?: LegacyBestScoreEvent }>();
  for (const row of source.bestScores) mergedScores.set(String(row.score_id), row);
  for (const event of source.bestScoreEvents) {
    const scoreId = String(event.score_id);
    const previous = mergedScores.get(scoreId);
    mergedScores.set(scoreId, previous ? { ...previous, event } : {
      id: event.id,
      discord_id: event.discord_id,
      osu_user_id: event.osu_user_id,
      osu_username: event.osu_username,
      mode: event.mode,
      score_id: event.score_id,
      pp: event.pp,
      recorded_at: event.recorded_at,
      event,
    });
  }

  const scoreCandidates = [...mergedScores.values()].flatMap((row) => {
    const osuUserId = resolveOsuUserId(row, lookups);
    const account = osuUserId ? accountByOsuId.get(osuUserId) : undefined;
    return account ? [{ row, account }] : [];
  });
  if (dryRun) {
    report.scoreEvents = scoreCandidates.length;
    report.skippedScoreEvents = mergedScores.size - scoreCandidates.length;
  } else {
    const credentials = process.env.OSU_CLIENT_ID && process.env.OSU_CLIENT_SECRET
      ? { clientId: process.env.OSU_CLIENT_ID, clientSecret: process.env.OSU_CLIENT_SECRET } satisfies OsuApiCredentials
      : undefined;
    const normalized = await runWithConcurrency(scoreCandidates, 4, async ({ row, account }) => {
      const mode = normalizeMode(row.mode ?? row.event?.mode ?? account.primaryMode);
      if (credentials) {
        try {
          const score = await getOsuScore(row.score_id, credentials, mode);
          return {
            ...normalizeScore(account.id, mode, score),
            isPersonalBest: true,
            createdAt: validDate(row.recorded_at),
          };
        } catch (error) {
          console.warn(`[legacy] score lookup failed for ${row.score_id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // A few legacy best-score events point to scores osu! has since removed
      // from both the solo and legacy score endpoints. Keep their PP/timestamp
      // in statistics even though beatmap metadata can no longer be recovered.
      const beatmapId = validOsuUserId(row.beatmap_id) ?? 0;
      const accuracyRaw = asNumber(row.accuracy);
      const accuracy = accuracyRaw > 1 ? accuracyRaw / 100 : accuracyRaw;
      return {
        osuScoreId: String(row.score_id),
        accountId: account.id,
        mode,
        beatmapId,
        beatmapsetId: null,
        ...(beatmapId > 0
          ? parseBeatmapTitle(row.beatmap_title, beatmapId)
          : { artist: "Legacy import", title: `Score #${row.score_id}`, difficulty: "Metadata unavailable" }),
        mapper: null,
        coverUrl: null,
        pp: row.pp === null || row.pp === undefined ? null : asNumber(row.pp),
        starRating: null,
        bpm: null,
        ar: null,
        od: null,
        cs: null,
        accuracy,
        rank: beatmapId > 0 ? fallbackRank(row.accuracy, row.miss_count) : "?",
        maxCombo: asNullableInteger(row.max_combo),
        score: null,
        mods: parseMods(row.mods),
        passed: true,
        isPersonalBest: true,
        endedAt: validDate(row.recorded_at),
        createdAt: validDate(row.recorded_at),
      };
    });
    const scoreRows = normalized.filter((row): row is NonNullable<typeof row> => row !== null);
    report.scoreEvents = scoreRows.length;
    report.skippedScoreEvents = mergedScores.size - scoreRows.length;
    for (const batch of chunks(scoreRows, 100)) {
      await db.insert(scoreEvents).values(batch).onConflictDoNothing();
    }
  }

  if (!dryRun) {
    for (const legacy of source.guildSettings) {
      await db.insert(guildSettings).values({
        guildId: legacy.guild_id,
        resultChannelId: legacy.realtime_score_channel_id ?? legacy.alert_channel_id ?? null,
        minimumPp: asNumber(legacy.alert_pp_threshold),
        locale: "ja",
        updatesChannelId: legacy.alert_channel_id ?? null,
        dailyReportChannelId: legacy.daily_history_channel_id ?? legacy.report_channel_id ?? null,
        createdAt: validDate(legacy.updated_at),
        updatedAt: validDate(legacy.updated_at),
      }).onConflictDoNothing();
    }
  }

  return report;
}

async function verifyTarget() {
  const db = getDb();
  const [profile] = await db.select({
    rows: count(),
    accounts: countDistinct(profileSnapshots.accountId),
    firstCapturedAt: min(profileSnapshots.capturedAt),
    lastCapturedAt: max(profileSnapshots.capturedAt),
  }).from(profileSnapshots).where(eq(profileSnapshots.source, SOURCE));
  const [top] = await db.select({
    rows: count(),
    accounts: countDistinct(topPlaySnapshots.accountId),
    firstCapturedAt: min(topPlaySnapshots.capturedAt),
    lastCapturedAt: max(topPlaySnapshots.capturedAt),
  }).from(topPlaySnapshots).where(eq(topPlaySnapshots.source, SOURCE));
  const [[accountCount], [manualCount], [dailyCount], [scoreCount], [linkCount], [guildCount]] = await Promise.all([
    db.select({ rows: count() }).from(accounts),
    db.select({ rows: count() }).from(manuallyTrackedAccounts),
    db.select({ rows: count(), firstDate: min(dailySnapshots.snapshotDate), lastDate: max(dailySnapshots.snapshotDate) }).from(dailySnapshots),
    db.select({ rows: count() }).from(scoreEvents),
    db.select({ rows: count() }).from(discordAccountLinks),
    db.select({ rows: count() }).from(guildSettings),
  ]);
  return {
    legacyProfileSnapshots: profile,
    legacyTopPlaySnapshots: top,
    totals: {
      accounts: accountCount?.rows ?? 0,
      manuallyTrackedAccounts: manualCount?.rows ?? 0,
      dailySnapshots: dailyCount,
      scoreEvents: scoreCount?.rows ?? 0,
      discordLinks: linkCount?.rows ?? 0,
      guildSettings: guildCount?.rows ?? 0,
    },
  };
}

async function main() {
  if (process.argv.includes("--verify-only")) {
    console.log(JSON.stringify(await verifyTarget(), null, 2));
    return;
  }
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[legacy] Loading source database${dryRun ? " (dry run)" : ""}...`);
  const source = await loadSource();
  const report = await migrate(source, dryRun);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

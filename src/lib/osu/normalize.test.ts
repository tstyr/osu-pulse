import { describe, expect, it } from "vitest";

import { normalizeMods, normalizeScore, snapshotFromUser } from "./normalize";
import type { OsuScore, OsuUser } from "./types";

describe("osu! normalization", () => {
  it("accepts both legacy and current mod payloads", () => {
    expect(normalizeMods(["HD", { acronym: "DT" }])).toEqual(["HD", "DT"]);
  });

  it("normalizes a score for durable storage", () => {
    const score: OsuScore = {
      id: 42,
      accuracy: 0.9876,
      pp: 321.45,
      rank: "S",
      max_combo: 900,
      total_score: 1_234_567,
      ended_at: "2026-08-27T10:00:00.000Z",
      mods: [{ acronym: "HD" }],
      beatmap: { id: 7, beatmapset_id: 8, version: "Insane" },
      beatmapset: { id: 8, artist: "Artist", title: "Song", creator: "Mapper" },
    };

    const normalized = normalizeScore("account-id", "osu", score);
    expect(normalized).toMatchObject({
      osuScoreId: "42",
      artist: "Artist",
      title: "Song",
      difficulty: "Insane",
      mods: ["HD"],
      score: "1234567",
      passed: true,
    });
    expect(normalized.endedAt.toISOString()).toBe("2026-08-27T10:00:00.000Z");
  });

  it("creates a mode snapshot", () => {
    const user: OsuUser = {
      id: 3,
      username: "player",
      avatar_url: "https://a.ppy.sh/3",
      country_code: "JP",
      playmode: "mania",
      statistics: {
        country_rank: 12,
        global_rank: 345,
        hit_accuracy: 98.5,
        level: { current: 101, progress: 25 },
        play_count: 2_000,
        pp: 7_654,
        ranked_score: 10,
        total_score: 20,
      },
    };

    expect(snapshotFromUser("account-id", "mania", user, "2026-08-27")).toMatchObject({
      accountId: "account-id",
      mode: "mania",
      snapshotDate: "2026-08-27",
      globalRank: 345,
      pp: 7_654,
      level: 101.25,
    });
  });
});

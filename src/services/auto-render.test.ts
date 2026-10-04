import { describe, expect, it } from "vitest";

import {
  autoRenderSettingsSchema,
  defaultAutoRenderSettings,
} from "../lib/control/auto-render-settings";
import { autoRenderOptionsForMode, autoRenderSourceHandled, matchesAutoRenderScore, prioritizeAutoRenderScores } from "./auto-render";

const score = {
  osuScoreId: "7369136249",
  mode: "osu" as const,
  rank: "A",
  pp: 145.2,
  accuracy: 0.9345,
  passed: true,
};

describe("auto render conditions", () => {
  it("matches the requested users' default A-rank policy", () => {
    expect(matchesAutoRenderScore(defaultAutoRenderSettings(), score)).toBe(true);
  });

  it("keeps legacy single-Discord settings compatible", () => {
    const current = defaultAutoRenderSettings();
    const parsed = autoRenderSettingsSchema.parse({
      ...current,
      discordUserIds: undefined,
      osuUserIds: undefined,
      discordUserId: "974264083853492234",
    });
    expect(parsed.discordUserIds).toEqual(["974264083853492234"]);
    expect(parsed.osuUserIds).toEqual([]);
  });

  it("applies rank, mode, pp, accuracy, and pass conditions", () => {
    const settings = { ...defaultAutoRenderSettings(), ranks: ["S"] as ["S"] };
    expect(matchesAutoRenderScore(settings, score)).toBe(false);
    expect(matchesAutoRenderScore({ ...settings, ranks: ["A"], modes: ["mania"] }, score)).toBe(false);
    expect(matchesAutoRenderScore({ ...settings, ranks: ["A"], minimumPp: 150 }, score)).toBe(false);
    expect(matchesAutoRenderScore({ ...settings, ranks: ["A"], minimumAccuracy: 94 }, score)).toBe(false);
    expect(matchesAutoRenderScore({ ...settings, ranks: ["A"] }, { ...score, passed: false })).toBe(false);
  });

  it("prioritizes the target with fewer handled renders", () => {
    const scores = [
      { accountId: "older-busy", osuScoreId: "1", endedAt: new Date("2026-01-01") },
      { accountId: "new-target", osuScoreId: "2", endedAt: new Date("2026-01-02") },
      { accountId: "older-busy", osuScoreId: "3", endedAt: new Date("2026-01-03") },
    ];
    const prioritized = prioritizeAutoRenderScores(scores, new Set(["1"]));
    expect(prioritized.map((item) => item.osuScoreId)).toEqual(["2", "3"]);
  });
});

describe("automatic render ruleset options", () => {
  const settings = {
    ...defaultAutoRenderSettings(),
    resolution: "2560x1440" as const,
    fps: 120 as const,
    speed: "2.0" as const,
    motionBlur: true,
  };

  it("normalizes unsupported mania effects while preserving resolution and fps", () => {
    expect(autoRenderOptionsForMode(settings, "mania")).toEqual({
      resolution: "2560x1440",
      fps: 120,
      speed: "original",
      motionBlur: false,
    });
  });

  it("retains std speed and motion blur settings, including after a mania job", () => {
    autoRenderOptionsForMode(settings, "mania");
    expect(autoRenderOptionsForMode(settings, "osu")).toEqual({
      resolution: "2560x1440",
      fps: 120,
      speed: "2.0",
      motionBlur: true,
    });
    expect(settings.speed).toBe("2.0");
    expect(settings.motionBlur).toBe(true);
  });
});

describe("automatic render retries", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  const oldFailure = { status: "failed" as const, errorCode: "BEATMAP_DOWNLOAD_FAILED", updatedAt: new Date(now - 31 * 60_000) };

  it("retries a transient failure after a cooldown rather than blocking it forever", () => {
    expect(autoRenderSourceHandled([oldFailure], now)).toBe(false);
    expect(autoRenderSourceHandled([{ ...oldFailure, updatedAt: new Date(now - 5 * 60_000) }], now)).toBe(true);
  });

  it("does not loop indefinitely on broken or unavailable replays", () => {
    expect(autoRenderSourceHandled([{ ...oldFailure, errorCode: "REPLAY_UNAVAILABLE" }], now)).toBe(true);
    expect(autoRenderSourceHandled([oldFailure, oldFailure, oldFailure], now)).toBe(true);
  });

  it("preserves active, completed, and explicitly cancelled jobs", () => {
    for (const status of ["queued", "completed", "cancelled"] as const) {
      expect(autoRenderSourceHandled([oldFailure, { ...oldFailure, status }], now)).toBe(true);
    }
    expect(autoRenderSourceHandled([], now)).toBe(false);
  });
});

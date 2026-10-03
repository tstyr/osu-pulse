import { describe, expect, it } from "vitest";

import { calculateProfileStrength, calculatePulseIndex, combineDailyPulseIndex } from "./pulse-index";

const base = {
  pp: 180,
  accuracy: 0.96,
  rank: "A",
  starRating: 5,
  bpm: 180,
  beatmapLengthSeconds: 150,
  ar: 9,
  od: 8,
  cs: 4,
  mods: [] as string[],
};

describe("Pulse Index", () => {
  it("stays inside a readable 0-100 range", () => {
    const result = calculatePulseIndex(base, "osu");
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThanOrEqual(100);
    expect(result.coverage).toBe(100);
  });

  it("rewards stronger execution and harder performance", () => {
    const stronger = calculatePulseIndex({ ...base, pp: 360, accuracy: 0.99, rank: "S", starRating: 6.5 }, "osu");
    const ordinary = calculatePulseIndex(base, "osu");
    expect(stronger.total).toBeGreaterThan(ordinary.total);
    expect(stronger.execution).toBeGreaterThan(ordinary.execution);
  });

  it("handles incomplete legacy beatmap data", () => {
    const result = calculatePulseIndex({ ...base, bpm: null, beatmapLengthSeconds: null, ar: null }, "mania");
    expect(Number.isFinite(result.total)).toBe(true);
    expect(result.coverage).toBeLessThan(100);
  });

  it("includes profile PP and rank without dominating the play score", () => {
    const high = calculateProfileStrength(10_000, 1_000);
    const low = calculateProfileStrength(2_000, 200_000);
    expect(high).toBeGreaterThan(low);
    expect(combineDailyPulseIndex(70, high)).toBeGreaterThan(combineDailyPulseIndex(70, low));
  });
});

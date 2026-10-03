import { describe, expect, it } from "vitest";

import { calculateSkillProfile } from "./skill-profile";

const score = {
  pp: 220,
  accuracy: 0.975,
  rank: "S",
  starRating: 5.8,
  aimDifficulty: 3.2,
  speedDifficulty: 2.7,
  bpm: 190,
  beatmapLengthSeconds: 180,
  ar: 9.3,
  od: 8.7,
  cs: 4,
  mods: ["HD"],
  maxCombo: 850,
};

describe("skill profile", () => {
  it("builds bounded skill outcomes from exact osu attributes", () => {
    const result = calculateSkillProfile([score], "osu");
    expect(result).not.toBeNull();
    expect(result!.aim).toBeGreaterThan(0);
    expect(result!.aim).toBeLessThanOrEqual(100);
    expect(result!.exactAttributeCoverage).toBe(100);
  });

  it("falls back for historical scores without official attributes", () => {
    const result = calculateSkillProfile([{ ...score, aimDifficulty: null, speedDifficulty: null }], "osu");
    expect(Number.isFinite(result!.aim)).toBe(true);
    expect(result!.exactAttributeCoverage).toBe(0);
  });
});

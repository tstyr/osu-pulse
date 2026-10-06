import { describe, expect, it } from "vitest";

import type { NotificationRuleConditions, ScoreEvent } from "../db/schema";
import { scoreMatchesRule } from "./notification-match";

const conditions: NotificationRuleConditions = {
  modes: ["osu", "mania"],
  ranks: ["A", "S", "X"],
  minimumPp: 150,
  maximumPp: 300,
  minimumAccuracy: 95,
  requiredMods: ["HD"],
  personalBestOnly: true,
  anomalyOnly: false,
};

const score = {
  mode: "osu",
  rank: "A",
  pp: 180,
  accuracy: 0.975,
  mods: ["HD", "DT"],
  isPersonalBest: true,
  anomalyScore: 0.5,
} as ScoreEvent;

describe("scoreMatchesRule", () => {
  it("matches every configured condition", () => {
    expect(scoreMatchesRule(score, conditions)).toBe(true);
  });

  it("rejects scores outside PP, accuracy, mode, rank, mod, and PB constraints", () => {
    expect(scoreMatchesRule({ ...score, pp: 149 } as ScoreEvent, conditions)).toBe(false);
    expect(scoreMatchesRule({ ...score, pp: 301 } as ScoreEvent, conditions)).toBe(false);
    expect(scoreMatchesRule({ ...score, accuracy: 0.949 } as ScoreEvent, conditions)).toBe(false);
    expect(scoreMatchesRule({ ...score, mode: "taiko" } as ScoreEvent, conditions)).toBe(false);
    expect(scoreMatchesRule({ ...score, rank: "B" } as ScoreEvent, conditions)).toBe(false);
    expect(scoreMatchesRule({ ...score, mods: ["DT"] } as ScoreEvent, conditions)).toBe(false);
    expect(scoreMatchesRule({ ...score, isPersonalBest: false } as ScoreEvent, conditions)).toBe(false);
  });

  it("enforces anomaly-only rules at an absolute z-score of two", () => {
    const anomaly = { ...conditions, personalBestOnly: false, anomalyOnly: true };
    expect(scoreMatchesRule({ ...score, anomalyScore: 1.99 } as ScoreEvent, anomaly)).toBe(false);
    expect(scoreMatchesRule({ ...score, anomalyScore: -2.2 } as ScoreEvent, anomaly)).toBe(true);
  });

  it("does not let a malformed stored rule abort matching of a healthy rule", () => {
    const damaged = [null, {}, { ...conditions, modes: null }, { ...conditions, ranks: "A" }, { ...conditions, requiredMods: [null] }];
    const stored = [...damaged, conditions] as NotificationRuleConditions[];
    expect(() => stored.filter((rule) => scoreMatchesRule(score, rule))).not.toThrow();
    expect(stored.filter((rule) => scoreMatchesRule(score, rule))).toEqual([conditions]);
  });

  it("fails closed for invalid numeric thresholds rather than matching everything", () => {
    expect(scoreMatchesRule(score, { ...conditions, minimumPp: NaN })).toBe(false);
    expect(scoreMatchesRule(score, { ...conditions, minimumPp: "150" } as unknown as NotificationRuleConditions)).toBe(false);
    expect(scoreMatchesRule(score, { ...conditions, maximumPp: Infinity })).toBe(false);
    expect(scoreMatchesRule(score, { ...conditions, minimumAccuracy: 101 })).toBe(false);
    expect(scoreMatchesRule(score, { ...conditions, minimumAccuracy: -1 })).toBe(false);
  });

  it("does not notify corrupt accuracy or a non-finite anomaly value", () => {
    expect(scoreMatchesRule({ ...score, accuracy: NaN }, conditions)).toBe(false);
    expect(scoreMatchesRule({ ...score, accuracy: 97.5 }, conditions)).toBe(false);
    expect(scoreMatchesRule({ ...score, anomalyScore: NaN }, { ...conditions, anomalyOnly: true })).toBe(false);
  });

  it("preserves configured exact ranks, inclusive PP bounds, and unrestricted options", () => {
    const anyRank = { ...conditions, ranks: [], requiredMods: [], maximumPp: null, personalBestOnly: false };
    expect(scoreMatchesRule({ ...score, rank: "B", mods: [], isPersonalBest: false }, anyRank)).toBe(true);
    expect(scoreMatchesRule({ ...score, pp: 150 }, conditions)).toBe(true);
    expect(scoreMatchesRule({ ...score, pp: 300 }, conditions)).toBe(true);
    expect(scoreMatchesRule({ ...score, rank: "SH" }, conditions)).toBe(false);
  });
});

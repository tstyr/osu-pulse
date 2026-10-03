import { describe, expect, it } from "vitest";
import { summarizeDailyScores } from "./score-analytics";

describe("daily player analytics", () => {
  it("groups plays by JST date and leaves missing PP out of PP averages", () => {
    const result = summarizeDailyScores([
      { endedAt: "2026-09-30T14:59:59Z", pp: 100, accuracy: 0.9, passed: true },
      { endedAt: "2026-09-30T15:00:00Z", pp: 200, accuracy: 1, passed: true },
      { endedAt: "2026-09-30T16:00:00Z", pp: null, accuracy: 0.8, passed: false },
    ]);
    expect(result.map((row) => row.date)).toEqual(["2026-09-30", "2026-10-01"]);
    expect(result[1]).toMatchObject({ averagePp: 200, bestPp: 200, averageAccuracy: 90, plays: 2, passRate: 50, rollingPp: 150 });
  });

  it("handles unlimited histories without spreading the scores into function arguments", () => {
    const scores = Array.from({ length: 150_000 }, (_, pp) => ({ endedAt: "2026-10-01T01:00:00Z", pp, accuracy: 0.99, passed: true }));
    const result = summarizeDailyScores(scores);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ plays: 150_000, bestPp: 149_999, averagePp: 74_999.5, passRate: 100 });
  });

  it("ignores malformed timestamps rather than failing the entire graph", () => {
    expect(summarizeDailyScores([{ endedAt: "invalid", pp: 1, accuracy: 1, passed: true }])).toEqual([]);
  });
});

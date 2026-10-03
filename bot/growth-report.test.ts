import { describe, expect, it } from "vitest";

import type { DailySnapshot } from "@/db/schema";
import { buildGrowthReport } from "./growth-report";

function snapshot(date: string, pp: number, rank: number, plays: number, playTimeSeconds: number): DailySnapshot {
  return {
    id: date,
    accountId: "account",
    mode: "mania",
    snapshotDate: date,
    globalRank: rank,
    countryRank: 100,
    pp,
    accuracy: 96.5,
    playCount: plays,
    playTimeSeconds,
    totalScore: String(plays * 1_000_000),
    rankedScore: String(plays * 900_000),
    level: 100,
    createdAt: new Date(`${date}T00:00:00Z`),
    updatedAt: new Date(`${date}T00:00:00Z`),
  };
}

describe("buildGrowthReport", () => {
  it("builds period deltas, daily rows, and insights", () => {
    const report = buildGrowthReport([
      snapshot("2026-07-01", 7_000, 12_000, 1_000, 100_000),
      snapshot("2026-08-01", 7_500, 11_000, 1_100, 110_000),
      snapshot("2026-08-31", 8_000, 9_000, 1_300, 130_000),
    ]);
    expect(report?.current).toContain("8,000.00pp");
    expect(report?.periods.find((period) => period.name === "30日")?.value).toContain("+500.00pp");
    expect(report?.daily).toContain("08/31");
    expect(report?.insights).toContain("最大日次PP増加");
  });

  it("returns null without history", () => {
    expect(buildGrowthReport([])).toBeNull();
  });
});

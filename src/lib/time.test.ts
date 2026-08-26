import { describe, expect, it } from "vitest";

import { formatRelativeDuration, parseDurationInput, zonedDateKey } from "./time";

describe("time helpers", () => {
  it("uses the requested timezone when creating a date key", () => {
    const instant = new Date("2026-08-26T16:30:00.000Z");
    expect(zonedDateKey(instant, "Asia/Tokyo")).toBe("2026-08-27");
    expect(zonedDateKey(instant, "UTC")).toBe("2026-08-26");
  });

  it("parses supported reminder durations", () => {
    expect(parseDurationInput(15, "minutes")).toBe(900_000);
    expect(parseDurationInput(2, "hours")).toBe(7_200_000);
    expect(parseDurationInput(3, "days")).toBe(259_200_000);
  });

  it("rejects non-positive durations", () => {
    expect(() => parseDurationInput(0, "minutes")).toThrow();
  });

  it("formats compact Japanese durations", () => {
    expect(formatRelativeDuration(25 * 60_000)).toBe("25分");
    expect(formatRelativeDuration(2 * 3_600_000)).toBe("2時間");
    expect(formatRelativeDuration(3 * 86_400_000)).toBe("3日");
  });
});

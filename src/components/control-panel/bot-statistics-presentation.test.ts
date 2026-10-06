import { describe, expect, it } from "vitest";
import type { BotStatisticsData } from "@/lib/bot-statistics";
import { botSeriesOpacity, formatBotAxisDate, formatBotDate, formatBotValue, matchingBotStatistics } from "./bot-statistics-presentation";

describe("Bot statistics presentation", () => {
  it("does not display missing or invalid measurements as zero", () => {
    for (const value of [null, undefined, NaN, Infinity]) expect(formatBotValue("receivedBytes", value)).toBe("未収集");
    expect(formatBotValue("receivedBytes", 0)).toBe("0 B");
    expect(formatBotValue("voiceMembers", 0)).toBe("0人");
  });
  it("distinguishes transfer size, speed, latency and elapsed time", () => {
    expect(formatBotValue("receivedBytes", 1024)).toBe("1 KiB");
    expect(formatBotValue("receiveBps", 2048)).toBe("2 KiB/s");
    expect(formatBotValue("dbPingMs", 12.25)).toBe("12.3 ms");
    expect(formatBotValue("voiceMemberSeconds", 3660)).toBe("1時間1分");
  });
  it("does not relabel cached data from another range or server", () => {
    const data = { range: "week", scope: "guild:123" } as BotStatisticsData;
    expect(matchingBotStatistics(data, "today", "guild:123")).toBeUndefined();
    expect(matchingBotStatistics(data, "week", "global")).toBeUndefined();
    expect(matchingBotStatistics(data, "week", "guild:123")).toBe(data);
  });
  it("formats dates in JST and preserves missing timestamps", () => {
    expect(formatBotDate("2026-10-06T00:30:00Z", true)).toContain("09:30");
    expect(formatBotDate(null)).toBe("未収集");
    expect(formatBotDate("invalid")).toBe("未収集");
  });
  it("keeps years visible for multi-year history and times for today's telemetry", () => {
    const at = "2026-10-06T16:30:00Z";
    expect(formatBotAxisDate(at, "today")).toBe("01:30");
    expect(formatBotAxisDate(at, "week")).toBe("10/07");
    expect(formatBotAxisDate(at, "month")).toBe("10/07");
    expect(formatBotAxisDate(at, "all")).toBe("26/10/07");
    expect(formatBotAxisDate("2022-12-02T15:00:00Z", "all")).toBe("22/12/03");
    expect(formatBotAxisDate("invalid", "all")).toBe("未収集");
  });
  it("keeps all series while dimming unfocused series", () => {
    expect(botSeriesOpacity(null, "sentBytes")).toBe(1);
    expect(botSeriesOpacity("receivedBytes", "receivedBytes")).toBe(1);
    expect(botSeriesOpacity("receivedBytes", "sentBytes")).toBe(0.15);
  });
});

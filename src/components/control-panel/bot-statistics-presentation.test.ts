import { describe, expect, it } from "vitest";
import type { BotStatisticsData } from "@/lib/bot-statistics";
import { botMetricIsGlobalOnly, botSeriesOpacity, botStatisticsScopeLabel, botTabNavigationIndex, formatBotAxisDate, formatBotAxisValue, formatBotDate, formatBotValue, matchingBotStatistics } from "./bot-statistics-presentation";

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
  it("keeps intraday timestamps distinguishable in multi-day telemetry", () => {
    expect(formatBotAxisDate("2026-10-06T00:00:00Z", "week", true)).toBe("10/06 09:00");
    expect(formatBotAxisDate("2026-10-06T01:00:00Z", "week", true)).toBe("10/06 10:00");
    expect(formatBotAxisDate("2026-10-06T01:00:00Z", "month", true)).toBe("10/06 10:00");
    expect(formatBotAxisDate("2026-10-06T01:00:00Z", "all", false)).toBe("26/10/06");
  });
  it("gives chart axes readable units without attaching unlike units", () => {
    expect(formatBotAxisValue(["memoryBytes"], 1024 ** 3)).toBe("1 GiB");
    expect(formatBotAxisValue(["receiveBps", "sendBps"], 2048)).toBe("2 KiB/s");
    expect(formatBotAxisValue(["voiceMemberSeconds"], 7200)).toBe("2時間0分");
    expect(formatBotAxisValue(["dbPingMs"], 12.5)).toBe("12.5 ms");
    expect(formatBotAxisValue(["cpuPercent"], 150)).toBe("150%");
    expect(formatBotAxisValue(["voiceMembers"], 10)).toBe("10人");
    expect(formatBotAxisValue(["dbRows"], 10000)).toBe("1万");
    expect(formatBotAxisValue(["voiceMembers", "voiceChannels"], 10)).toBe("10");
    expect(formatBotAxisValue(["memoryBytes", "cpuPercent"], 10)).toBe("10");
    expect(formatBotAxisValue(["memoryBytes"], NaN)).toBe("—");
  });
  it("does not present an unknown guild as the global scope", () => {
    expect(botStatisticsScopeLabel(undefined, "global")).toBe("Bot全体（全サーバー）");
    expect(botStatisticsScopeLabel(undefined, "guild:123")).toBe("サーバー 123");
    expect(botStatisticsScopeLabel([{ id: "guild:123", label: "My server" }], "guild:123")).toBe("My server");
  });
  it("navigates tabs by keyboard and wraps at both ends", () => {
    expect(botTabNavigationIndex(3, "ArrowRight", 4)).toBe(0);
    expect(botTabNavigationIndex(0, "ArrowLeft", 4)).toBe(3);
    expect(botTabNavigationIndex(2, "Home", 4)).toBe(0);
    expect(botTabNavigationIndex(2, "End", 4)).toBe(3);
    expect(botTabNavigationIndex(2, "Enter", 4)).toBeNull();
    expect(botTabNavigationIndex(0, "ArrowRight", 0)).toBeNull();
  });
  it("keeps guild notification queues and connection hours separate from global resource metrics", () => {
    for (const key of ["receivedBytes", "discordApiPingMs", "dbPingMs", "cpuPercent", "dbBytes", "diskTotalBytes", "renderQueue", "activeRenders"] as const) {
      expect(botMetricIsGlobalOnly(key)).toBe(true);
    }
    for (const key of ["gatewayPingMs", "memberCount", "notificationPending", "notificationFailed", "botOnlineSeconds", "osuLifetimePlayCount"] as const) {
      expect(botMetricIsGlobalOnly(key)).toBe(false);
    }
  });
});

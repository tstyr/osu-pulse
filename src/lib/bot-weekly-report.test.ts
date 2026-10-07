import { describe, expect, it } from "vitest";
import { botWeeklyReportSchedule, botWeeklyReportSettingsSchema, defaultBotWeeklyReportSettings } from "./bot-weekly-report";

describe("Bot weekly report settings", () => {
  it("defaults off with no channel and Monday 09:00 JST", () => {
    expect(defaultBotWeeklyReportSettings()).toEqual({ enabled: false, guildId: "", channelId: "", weekdayJst: 1, hourJst: 9, minuteJst: 0 });
  });
  it("requires an explicit valid destination when enabled", () => {
    expect(botWeeklyReportSettingsSchema.safeParse({ ...defaultBotWeeklyReportSettings(), enabled: true }).success).toBe(false);
    expect(botWeeklyReportSettingsSchema.safeParse({ ...defaultBotWeeklyReportSettings(), enabled: true, guildId: "123456789012345678", channelId: "234567890123456789" }).success).toBe(true);
  });
  it.each([{ weekdayJst: 7 }, { hourJst: 24 }, { minuteJst: 60 }, { hourJst: 1.5 }, { enabled: "true" }, { guildId: "not-an-id" }, { content: "do not store message content" }])("rejects unsafe or ambiguous settings %j", (changes) => {
    expect(botWeeklyReportSettingsSchema.safeParse({ ...defaultBotWeeklyReportSettings(), ...changes }).success).toBe(false);
  });
});

describe("completed JST calendar week scheduling", () => {
  it("reports the last Monday–Sunday week rather than today's rolling seven days", () => {
    const schedule = botWeeklyReportSchedule(defaultBotWeeklyReportSettings(), new Date("2026-10-07T03:00:00Z"));
    expect(schedule.scheduledAt.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(schedule.from.toISOString()).toBe("2026-09-27T15:00:00.000Z");
    expect(schedule.toExclusive.toISOString()).toBe("2026-10-04T15:00:00.000Z");
    expect(schedule.periodStart).toBe("2026-09-28");
    expect(schedule.nextDueAt.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
  it("changes the eligible report only at the configured exact time", () => {
    const settings = defaultBotWeeklyReportSettings();
    expect(botWeeklyReportSchedule(settings, new Date("2026-10-04T23:59:59Z")).periodStart).toBe("2026-09-21");
    expect(botWeeklyReportSchedule(settings, new Date("2026-10-05T00:00:00Z")).periodStart).toBe("2026-09-28");
  });
  it("uses the previous completed week even for a Sunday delivery", () => {
    const schedule = botWeeklyReportSchedule({ ...defaultBotWeeklyReportSettings(), weekdayJst: 0, hourJst: 21 }, new Date("2026-10-04T12:00:00Z"));
    expect(schedule.periodStart).toBe("2026-09-21");
    expect(schedule.toExclusive.toISOString()).toBe("2026-09-27T15:00:00.000Z");
    expect(schedule.scheduledAt.toISOString()).toBe("2026-10-04T12:00:00.000Z");
  });
  it("returns one most recent occurrence after prolonged downtime", () => {
    const schedule = botWeeklyReportSchedule(defaultBotWeeklyReportSettings(), new Date("2027-02-12T00:00:00Z"));
    expect(schedule.periodStart).toBe("2027-02-01");
    expect(schedule.toExclusive.getTime() - schedule.from.getTime()).toBe(7 * 86_400_000);
  });
});

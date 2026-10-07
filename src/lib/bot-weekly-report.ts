import { z } from "zod";

const discordId = z.string().regex(/^$|^\d{17,20}$/);
export const botWeeklyReportSettingsSchema = z.object({
  enabled: z.boolean(),
  guildId: discordId,
  channelId: discordId,
  weekdayJst: z.number().int().min(0).max(6),
  hourJst: z.number().int().min(0).max(23),
  minuteJst: z.number().int().min(0).max(59),
}).strict().superRefine((settings, context) => {
  if (settings.enabled && (!settings.guildId || !settings.channelId)) {
    context.addIssue({ code: "custom", message: "週報のサーバーと送信先を選択してください。", path: ["channelId"] });
  }
});

export type BotWeeklyReportSettings = z.infer<typeof botWeeklyReportSettingsSchema>;
export type BotWeeklyReportGuild = { id: string; name: string; channels: Array<{ id: string; name: string }> };
export type BotWeeklyReportResponse = {
  settings: BotWeeklyReportSettings;
  guilds: BotWeeklyReportGuild[];
  botOnline: boolean;
  nextDueAt: string | null;
  lastDelivery: { periodStart: string; sentAt: string | null; status: "sent" | "sending" | "failed"; channelId: string } | null;
};

export function defaultBotWeeklyReportSettings(): BotWeeklyReportSettings {
  return { enabled: false, guildId: "", channelId: "", weekdayJst: 1, hourJst: 9, minuteJst: 0 };
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const JST_OFFSET_MS = 9 * 3_600_000;

/** Latest scheduled occurrence only: no historical backlog after downtime. */
export function botWeeklyReportSchedule(settings: BotWeeklyReportSettings, now = new Date()) {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const mondayJst = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - (jst.getUTCDay() + 6) % 7);
  const offset = (settings.weekdayJst + 6) % 7 * DAY_MS + settings.hourJst * 3_600_000 + settings.minuteJst * 60_000;
  const candidate = mondayJst + offset - JST_OFFSET_MS;
  const scheduledAt = candidate > now.getTime() ? candidate - WEEK_MS : candidate;
  const periodEnd = scheduledAt - offset;
  return {
    scheduledAt: new Date(scheduledAt),
    nextDueAt: new Date(scheduledAt + WEEK_MS),
    from: new Date(periodEnd - WEEK_MS),
    toExclusive: new Date(periodEnd),
    periodStart: new Date(periodEnd - WEEK_MS + JST_OFFSET_MS).toISOString().slice(0, 10),
  };
}

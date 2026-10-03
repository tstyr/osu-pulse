import { asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import {
  getWeeklyLeaderboard,
  hasReportDelivery,
  listGuildAutomationChannels,
  recordReportDelivery,
} from "@/db/feature-repository";
import { accountGuilds, accounts, dailySnapshots } from "@/db/schema";
import { sendDiscordChannelMessage } from "@/lib/discord/rest";
import { OSU_MODES } from "@/lib/osu/modes";

function jstParts(now: Date) {
  const shifted = new Date(now.getTime() + 9 * 60 * 60_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay(),
  };
}

async function guildDailyGrowth(guildId: string) {
  const db = getDb();
  const linked = await db.select({ id: accounts.id, username: accounts.username }).from(accountGuilds)
    .innerJoin(accounts, eq(accountGuilds.accountId, accounts.id))
    .where(eq(accountGuilds.guildId, guildId));
  if (!linked.length) return [];
  const rows = await db.select().from(dailySnapshots).where(
    inArray(dailySnapshots.accountId, linked.map((item) => item.id)),
  ).orderBy(asc(dailySnapshots.snapshotDate));
  const names = new Map(linked.map((item) => [item.id, item.username]));
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.accountId}:${row.mode}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.values()].flatMap((snapshots) => {
    const latest = snapshots.at(-1);
    const previous = snapshots.at(-2);
    if (!latest || !previous || latest.snapshotDate === previous.snapshotDate) return [];
    return [{
      username: names.get(latest.accountId) ?? "Unknown",
      mode: latest.mode,
      ppGain: latest.pp - previous.pp,
      rankGain: latest.globalRank && previous.globalRank ? previous.globalRank - latest.globalRank : 0,
      playGain: latest.playCount - previous.playCount,
      currentPp: latest.pp,
    }];
  }).sort((left, right) => right.ppGain - left.ppGain);
}

export async function dispatchScheduledGuildReports(now = new Date()) {
  const { date, hour, weekday } = jstParts(now);
  const reportHour = Math.min(23, Math.max(0, Number(process.env.GUILD_REPORT_HOUR_JST ?? 23)));
  if (hour !== reportHour) return { daily: 0, weekly: 0 };
  const settings = await listGuildAutomationChannels();
  let daily = 0;
  let weekly = 0;
  for (const guild of settings) {
    if (guild.dailyReportChannelId && !(await hasReportDelivery(guild.guildId, "daily", date))) {
      const growth = await guildDailyGrowth(guild.guildId);
      const visible = growth.filter((item) => item.ppGain || item.rankGain || item.playGain).slice(0, 15);
      await sendDiscordChannelMessage(guild.dailyReportChannelId, {
        embeds: [{
          title: `📈 サーバーデイリーレポート · ${date}`,
          description: visible.length
            ? visible.map((item, index) => `${index + 1}. **${item.username}** (${item.mode}) · ${item.ppGain >= 0 ? "+" : ""}${item.ppGain.toFixed(1)}pp · Rank ${item.rankGain >= 0 ? "+" : ""}${item.rankGain.toLocaleString()} · ${item.playGain >= 0 ? "+" : ""}${item.playGain} plays`).join("\n")
            : "本日は記録上の変化がありませんでした。",
          color: 0x3b82f6,
          timestamp: now.toISOString(),
        }],
        allowed_mentions: { parse: [] },
      });
      await recordReportDelivery({ guildId: guild.guildId, reportType: "daily", reportDate: date, channelId: guild.dailyReportChannelId });
      daily += 1;
    }
    if (weekday === 1 && guild.weeklyAwardsChannelId && !(await hasReportDelivery(guild.guildId, "weekly", date))) {
      const all = (await Promise.all(OSU_MODES.map(async (mode) => ({ mode, rows: await getWeeklyLeaderboard(guild.guildId, mode) }))));
      const winners = all.flatMap(({ mode, rows }) => rows.slice(0, 3).map((row) => ({ ...row, mode }))).sort((left, right) => right.ppGain - left.ppGain).slice(0, 10);
      await sendDiscordChannelMessage(guild.weeklyAwardsChannelId, {
        embeds: [{
          title: "🏆 週間成長アワード",
          description: winners.length
            ? winners.map((row, index) => `${index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`} **${row.username}** (${row.mode}) · +${row.ppGain.toFixed(1)}pp${row.rankGain === null ? "" : ` · Rank +${row.rankGain.toLocaleString()}`}`).join("\n")
            : "集計できる週間データがまだありません。",
          color: 0xf59e0b,
          timestamp: now.toISOString(),
        }],
        allowed_mentions: { parse: [] },
      });
      await recordReportDelivery({ guildId: guild.guildId, reportType: "weekly", reportDate: date, channelId: guild.weeklyAwardsChannelId });
      weekly += 1;
    }
  }
  return { daily, weekly };
}

import { ChannelType, PermissionFlagsBits, type Client, type GuildBasedChannel } from "discord.js";
import { buildBotWeeklyReport, botWeeklyReportNonce, claimBotWeeklyReport, finishBotWeeklyReport, publishBotWeeklyReportChannels, readBotWeeklyReportSettings } from "../src/services/bot-weekly-report";
import type { BotWeeklyReportGuild } from "../src/lib/bot-weekly-report";

function canSend(channel: GuildBasedChannel) {
  const member = channel.guild.members.me;
  return (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
    && member && channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
}

export function botWeeklyReportChannels(client: Client): BotWeeklyReportGuild[] {
  return [...client.guilds.cache.values()].map((guild) => ({
    id: guild.id, name: guild.name,
    channels: [...guild.channels.cache.values()].filter(canSend).map((channel) => ({ id: channel.id, name: channel.name })),
  })).filter((guild) => guild.channels.length > 0);
}

export async function dispatchBotWeeklyReport(client: Client, signal?: AbortSignal, now = new Date()) {
  if (!client.isReady() || signal?.aborted) return 0;
  await publishBotWeeklyReportChannels(botWeeklyReportChannels(client), now);
  if (signal?.aborted) return 0;
  const { settings } = await readBotWeeklyReportSettings();
  if (!settings.enabled || signal?.aborted) return 0;
  const guild = client.guilds.cache.get(settings.guildId);
  if (!guild) return 0;
  const channel = await guild.channels.fetch(settings.channelId);
  if (!channel || !canSend(channel) || !channel.isSendable() || signal?.aborted) return 0;
  const claimed = await claimBotWeeklyReport(settings, now);
  if (!claimed) return 0;
  let delivered = false;
  try {
    if (signal?.aborted) throw new Error("Weekly report worker stopped before delivery");
    const nonce = botWeeklyReportNonce(settings.guildId, claimed.schedule.periodStart);
    // A previous sender may have reached Discord but failed to persist its
    // marker. Recover that visible report before retrying the external side effect.
    if (claimed.delivery.attempts > 1 && guild.members.me && channel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.ReadMessageHistory)) {
      const messages = await channel.messages.fetch({ limit: 100 });
      const previous = messages.find((message) => message.author.id === client.user.id
        && message.embeds.some((embed) => embed.footer?.text === `週報ID: ${nonce}`));
      if (previous) {
        delivered = true;
        await finishBotWeeklyReport(claimed.delivery.token, true, previous.createdAt);
        return 0;
      }
    }
    const embed = await buildBotWeeklyReport(settings, claimed.schedule, now);
    if (signal?.aborted || !client.isReady()) throw new Error("Weekly report worker stopped before delivery");
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] }, nonce, enforceNonce: true });
    delivered = true;
    await finishBotWeeklyReport(claimed.delivery.token, true);
    return 1;
  } catch (error) {
    // Do not mark an already-sent report as failed when the DB acknowledgement
    // is unavailable: its lease remains and the next attempt checks Discord.
    if (!delivered && !signal?.aborted) await finishBotWeeklyReport(claimed.delivery.token, false).catch(() => undefined);
    throw error;
  }
}

export type BotWeeklyReportHandle = { stop: () => Promise<void> };
export function startBotWeeklyReports(client: Client): BotWeeklyReportHandle {
  const controller = new AbortController();
  let running: Promise<void> | null = null;
  const tick = () => {
    if (running || controller.signal.aborted) return;
    running = dispatchBotWeeklyReport(client, controller.signal)
      .then((sent) => { if (sent) console.log("[bot-weekly] statistics report sent"); })
      .catch((error) => console.error("[bot-weekly] dispatcher failed:", error))
      .finally(() => { running = null; });
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
  return { stop: async () => {
    controller.abort();
    clearInterval(timer);
    if (!running) return;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      // The process has a shared 10-second shutdown budget. A stuck query or
      // Discord request must not delay music/DB/runtime-lock cleanup forever.
      await Promise.race([running, new Promise<void>((resolve) => { deadline = setTimeout(resolve, 3_000); deadline.unref(); })]);
    } finally { if (deadline) clearTimeout(deadline); }
  } };
}

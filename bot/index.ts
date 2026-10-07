import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { dispatchDueReminders } from "./automation";
import { handleCommand } from "./handlers";
import {
  handleFeedbackModal,
  handleUtilityButton,
  isFeedbackModal,
  isUtilityButton,
} from "./features";
import {
  createLavalinkManager,
  destroyMusicPanels,
  handleMusicButton,
  handleMusicSelect,
  isMusicButton,
  isMusicSelect,
} from "./music";
import { runOsuPoller } from "./poller";
import {
  handleRenderAutocomplete,
  handleRenderJobButton,
  handleRenderMessageCommand,
  isRenderJobButton,
  warmRenderRecentPlayCache,
} from "./render";
import { startServerStatusUpdater } from "./server-status";
import { announceBotUpdate } from "./release-notifier";
import { reportInteractionError } from "./interaction-errors";
import { measureBotCommand } from "./command-telemetry";
import { handleHelpSelect, isHelpSelect } from "./help-guide";
import { nonOverlappingTask } from "./non-overlapping-task";
import { startBackgroundTask } from "./background-task";
import { runSupervisedWorker } from "./supervised-worker";
import { startBotTelemetry, type BotTelemetryHandle } from "./telemetry";
import { dispatchScheduledGuildReports } from "../src/services/guild-reports";
import { startConsoleForwarder } from "./console-forwarder";
import {
  handleVerificationButton,
  handleVerificationModal,
  handleVerificationSelect,
  isVerificationButton,
  isVerificationModal,
  isVerificationSelect,
} from "./verification";
import { dispatchDailyRivalReports, dispatchMonthlyMontages, publishBotHeartbeats } from "./advanced-features";
import { startServiceControlDispatcher } from "./service-control";
import { dispatchDueCommunityEvents, handleCommunityButton, isCommunityButton } from "./community";
import { recordGuildActivity } from "../src/db/community-repository";
import { auditAdminAction } from "../src/services/admin-log";
import { reconcileAccountGuilds } from "./account-guild-reconciler";
import { runScoreNotificationWorker } from "../src/services/score-notification-delivery";
import { closeDatabase } from "../src/db";
import { startBotWeeklyReports, type BotWeeklyReportHandle } from "./bot-weekly-report";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is required");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const runtimeDirectory = resolve(process.cwd(), "work");
const runtimeHeartbeatPath = resolve(runtimeDirectory, "bot-heartbeat.json");
const runtimeLockPath = resolve(runtimeDirectory, "bot-runtime.lock");
mkdirSync(runtimeDirectory, { recursive: true });

function processIsRunning(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireRuntimeLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = openSync(runtimeLockPath, "wx");
      writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), "utf8");
      return handle;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(readFileSync(runtimeLockPath, "utf8")) as { pid?: number };
        if (owner.pid && processIsRunning(owner.pid)) {
          throw new Error(`Discord Bot is already running as PID ${owner.pid}.`);
        }
      } catch (lockError) {
        if (lockError instanceof Error && lockError.message.startsWith("Discord Bot is already running")) throw lockError;
      }
      rmSync(runtimeLockPath, { force: true });
    }
  }
  throw new Error("Discord Bot runtime lock could not be acquired.");
}

const runtimeLockHandle = acquireRuntimeLock();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel, Partials.Message],
});
let telemetry: BotTelemetryHandle | undefined;
try { telemetry = startBotTelemetry(client); }
catch (error) { console.error("[telemetry] initialization failed; Bot workers remain available:", error); }
const stopConsoleForwarder = startConsoleForwarder();
const lavalink = createLavalinkManager(client);
const pollController = new AbortController();
let shuttingDown = false;
let reminderTimer: ReturnType<typeof setInterval> | undefined;
let reportTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let stopStatusUpdater: (() => void) | undefined;
let botWeeklyReports: BotWeeklyReportHandle | undefined;
const stopServiceControlDispatcher = startServiceControlDispatcher();

function writeRuntimeHeartbeat() {
  mkdirSync(runtimeDirectory, { recursive: true });
  try {
    writeFileSync(runtimeHeartbeatPath, JSON.stringify({ pid: process.pid, updatedAt: new Date().toISOString(), discordReady: client.isReady() }), "utf8");
  } catch (error) {
    console.error("[heartbeat] local heartbeat write failed:", error);
  }
}

function removeRuntimeHeartbeat() {
  try {
    const current = JSON.parse(readFileSync(runtimeHeartbeatPath, "utf8")) as { pid?: number };
    if (current.pid !== process.pid) return;
    rmSync(runtimeHeartbeatPath, { force: true });
  } catch {
    // A stale heartbeat is also treated as offline, so cleanup is best-effort.
  }
}

function releaseRuntimeLock() {
  try {
    closeSync(runtimeLockHandle);
  } catch {
    // The process may already be exiting after a partial startup.
  }
  try {
    const owner = JSON.parse(readFileSync(runtimeLockPath, "utf8")) as { pid?: number };
    if (owner.pid === process.pid) rmSync(runtimeLockPath, { force: true });
  } catch {
    // A stale lock is recovered on the next startup.
  }
}

writeRuntimeHeartbeat();
const runtimeHeartbeatTimer = setInterval(writeRuntimeHeartbeat, 5_000);
runtimeHeartbeatTimer.unref();
process.once("exit", () => {
  removeRuntimeHeartbeat();
  releaseRuntimeLock();
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[discord] ready as ${readyClient.user.tag} in ${readyClient.guilds.cache.size} guild(s)`);

  void warmRenderRecentPlayCache()
    .then((count) => console.log(`[render] warmed recent-play cache for ${count} Discord user(s)`))
    .catch((error) => console.error("[render] recent-play cache warmup failed:", error));

  if (lavalink) {
    // Music is optional. Its connection must not delay score collection,
    // persistent notification delivery, reminders, or status updates.
    startBackgroundTask(
      () => lavalink.init({ ...readyClient.user }),
      (error) => console.error("[lavalink] initialization failed:", error),
    );
  }
  // Stored scores can be delivered even if the osu! API is unavailable.
  startBackgroundTask(
    () => runSupervisedWorker("score notifications", runScoreNotificationWorker, pollController.signal),
    (error) => console.error("[osu] notification worker stopped:", error),
  );
  if (process.env.OSU_CLIENT_ID && process.env.OSU_CLIENT_SECRET) {
    void reconcileAccountGuilds(client)
      .catch((error) => console.error("[osu] guild link reconciliation failed:", error));
    startBackgroundTask(
      () => runSupervisedWorker("osu poller", runOsuPoller, pollController.signal),
      (error) => console.error("[osu] poller stopped:", error),
    );
  } else {
    console.warn("[osu] poller disabled: OSU_CLIENT_ID / OSU_CLIENT_SECRET missing");
  }
  stopStatusUpdater = startServerStatusUpdater(client);
  botWeeklyReports = startBotWeeklyReports(client);
  void announceBotUpdate(client).catch((error) => console.error("[updates] startup announcement failed:", error));

  const reminders = nonOverlappingTask(dispatchDueReminders, (error) => console.error("[reminder] dispatcher failed:", error));
  reminderTimer = setInterval(() => { void reminders(); }, 15_000);
  reminderTimer.unref();
  void reminders();
  const reports = nonOverlappingTask(async () => {
    const [result, rivals, montages, community] = await Promise.allSettled([dispatchScheduledGuildReports(), dispatchDailyRivalReports(client), dispatchMonthlyMontages(client), dispatchDueCommunityEvents(client)]);
    for (const entry of [result, rivals, montages, community]) {
      if (entry.status === "rejected") console.error("[reports] dispatcher failed:", entry.reason);
    }
    if (result.status === "fulfilled" && (result.value.daily || result.value.weekly)) console.log(`[reports] daily=${result.value.daily} weekly=${result.value.weekly}`);
    if (rivals.status === "fulfilled" && rivals.value) console.log(`[advanced] rivals=${rivals.value}`);
    if (montages.status === "fulfilled" && montages.value) console.log(`[advanced] montages=${montages.value}`);
    if (community.status === "fulfilled" && community.value) console.log(`[community] completed=${community.value}`);
  }, (error) => console.error("[reports] dispatcher failed:", error));
  reportTimer = setInterval(() => { void reports(); }, 60_000);
  reportTimer.unref();
  void reports();
  const heartbeat = nonOverlappingTask(() => publishBotHeartbeats(client, lavalink), (error) => console.error("[heartbeat] publish failed:", error));
  heartbeatTimer = setInterval(() => { void heartbeat(); }, 30_000);
  heartbeatTimer.unref();
  void heartbeat();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (shuttingDown) return;
  try {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "render") await handleRenderAutocomplete(interaction);
      return;
    }
    if (interaction.isButton()) {
      if (isVerificationButton(interaction)) await handleVerificationButton(interaction);
      else if (isCommunityButton(interaction)) await handleCommunityButton(interaction);
      else if (isMusicButton(interaction)) await handleMusicButton(interaction, lavalink);
      else if (isUtilityButton(interaction)) await handleUtilityButton(interaction, lavalink);
      else if (isRenderJobButton(interaction)) await handleRenderJobButton(interaction);
      return;
    }
    if (interaction.isStringSelectMenu()) {
      if (isHelpSelect(interaction)) await handleHelpSelect(interaction);
      else if (isVerificationSelect(interaction)) await handleVerificationSelect(interaction);
      else if (isMusicSelect(interaction)) await handleMusicSelect(interaction, lavalink);
      return;
    }
    if (interaction.isModalSubmit() && isVerificationModal(interaction)) {
      await handleVerificationModal(interaction);
      return;
    }
    if (interaction.isModalSubmit() && isFeedbackModal(interaction)) {
      await handleFeedbackModal(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      await measureBotCommand(interaction, () => handleCommand(interaction, { client, lavalink }));
    }
    if (interaction.isMessageContextMenuCommand() && interaction.commandName === "osu!リザルトをレンダリング") {
      await handleRenderMessageCommand(interaction);
    }
  } catch (error) {
    await reportInteractionError(interaction, error);
  }
});

client.on(Events.MessageCreate, (message) => {
  if (!message.guildId || message.author.bot) return;
  void recordGuildActivity({ guildId: message.guildId, discordUserId: message.author.id, kind: "message", occurredAt: message.createdAt })
    .catch((error) => console.error("[activity] message record failed:", error));
});

client.on(Events.MessageDelete, (message) => {
  if (!message.guildId || message.author?.bot) return;
  const content = message.content?.trim();
  void auditAdminAction({
    guildId: message.guildId,
    actorDiscordUserId: message.author?.id ?? null,
    source: "discord-event",
    action: "message-delete",
    summary: `メッセージが <#${message.channelId}> から削除されました。${content ? `\n${content.slice(0, 700)}` : "（本文はキャッシュ外または権限制限により取得できません）"}`,
    details: { messageId: message.id, channelId: message.channelId, authorId: message.author?.id ?? null },
  }).catch((error) => console.error("[audit] message delete failed:", error));
});

client.on(Events.MessageUpdate, (before, after) => {
  if (!after.guildId || after.author?.bot || before.content === after.content) return;
  void auditAdminAction({
    guildId: after.guildId,
    actorDiscordUserId: after.author?.id ?? null,
    source: "discord-event",
    action: "message-edit",
    summary: `メッセージが <#${after.channelId}> で編集されました。`,
    details: {
      messageId: after.id,
      channelId: after.channelId,
      authorId: after.author?.id ?? null,
      before: before.content?.slice(0, 700) || "本文取得不可",
      after: after.content?.slice(0, 700) || "本文取得不可",
    },
  }).catch((error) => console.error("[audit] message edit failed:", error));
});

client.on(Events.VoiceStateUpdate, (before, after) => {
  if (after.member?.user.bot || before.channelId === after.channelId) return;
  const guildId = after.guild.id;
  const userId = after.id;
  if (!before.channelId && after.channelId) {
    void recordGuildActivity({ guildId, discordUserId: userId, kind: "voice-join" }).catch(() => undefined);
  } else if (before.channelId && !after.channelId) {
    void recordGuildActivity({ guildId, discordUserId: userId, kind: "voice-leave" }).catch(() => undefined);
  } else {
    void Promise.all([
      recordGuildActivity({ guildId, discordUserId: userId, kind: "voice-leave" }),
      recordGuildActivity({ guildId, discordUserId: userId, kind: "voice-join" }),
    ]).catch(() => undefined);
  }
  const movement = !before.channelId
    ? `<@${userId}> が <#${after.channelId}> に参加しました。`
    : !after.channelId
      ? `<@${userId}> が <#${before.channelId}> から退出しました。`
      : `<@${userId}> が <#${before.channelId}> から <#${after.channelId}> へ移動しました。`;
  void auditAdminAction({ guildId, actorDiscordUserId: userId, source: "discord-event", action: "voice-state", summary: movement, details: { beforeChannelId: before.channelId, afterChannelId: after.channelId } })
    .catch((error) => console.error("[audit] voice state failed:", error));
});

async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received, shutting down`);
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  pollController.abort();
  if (reminderTimer) clearInterval(reminderTimer);
  if (reportTimer) clearInterval(reportTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  clearInterval(runtimeHeartbeatTimer);
  removeRuntimeHeartbeat();
  stopConsoleForwarder();
  stopServiceControlDispatcher();
  destroyMusicPanels();
  stopStatusUpdater?.();
  await telemetry?.stop();
  await botWeeklyReports?.stop();
  await client.destroy();
  await closeDatabase();
  releaseRuntimeLock();
  process.exit(exitCode);
}

process.once("SIGINT", () => void shutdown("SIGINT").catch((error) => { console.error("[worker] shutdown failed:", error); process.exit(1); }));
process.once("SIGTERM", () => void shutdown("SIGTERM").catch((error) => { console.error("[worker] shutdown failed:", error); process.exit(1); }));
client.on(Events.Error, (error) => console.error("[discord] client error:", error));
client.on(Events.ShardError, (error, shardId) => console.error(`[discord] shard=${shardId} error:`, error));

async function main() {
  await client.login(token);
}

void main().catch((error) => {
  console.error("[worker] failed to start:", error);
  void shutdown("startup failure", 1).catch(() => process.exit(1));
});

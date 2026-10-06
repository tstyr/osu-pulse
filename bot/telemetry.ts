import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { Events, Status, type Client, type Guild, type VoiceState } from "discord.js";
import { sql } from "drizzle-orm";

import { getDb } from "../src/db";
import { getBotTelemetryContext, insertBotTelemetrySamples } from "../src/db/bot-telemetry-repository";
import type { BotMetricValues, BotTelemetryInput } from "../src/lib/bot-statistics";
import { startNetworkTelemetry, type NetworkTotals } from "./network-telemetry";

const SAMPLE_INTERVAL_MS = 60_000;
const ACTIVE_WINDOW_MS = 15 * 60_000;
const MEMBER_CACHE_MS = 5 * 60_000;

type ActivityTotals = { messageCount: number; commandCount: number; voiceMemberSeconds: number; botOnlineSeconds: number };
type GuildActivity = { label: string; present: boolean; voice: Map<string, string>; activity: Map<string, number>; totals: ActivityTotals };
type ActivitySnapshot = { global: ActivityTotals; guilds: Map<string, ActivityTotals> };

function activityTotals(): ActivityTotals {
  return { messageCount: 0, commandCount: 0, voiceMemberSeconds: 0, botOnlineSeconds: 0 };
}

function difference<T extends object>(current: T, previous: T): T {
  return Object.fromEntries(Object.entries(current).map(([key, value]) => [key, Math.max(0, Number(value) - Number(previous[key as keyof T] ?? 0))])) as T;
}

/** In-memory counts only: neither message content nor user identities are persisted. */
export class BotActivityTracker {
  readonly guilds = new Map<string, GuildActivity>();
  private readonly global = activityTotals();
  private ready = false;
  private lastAt: number;

  constructor(now: number) { this.lastAt = now; }

  private advance(now: number) {
    const seconds = Math.max(0, now - this.lastAt) / 1_000;
    this.lastAt = Math.max(now, this.lastAt);
    if (this.ready) this.global.botOnlineSeconds += seconds;
    for (const guild of this.guilds.values()) {
      const voiceSeconds = this.ready && guild.present ? guild.voice.size * seconds : 0;
      guild.totals.voiceMemberSeconds += voiceSeconds;
      this.global.voiceMemberSeconds += voiceSeconds;
      if (this.ready && guild.present) guild.totals.botOnlineSeconds += seconds;
    }
  }

  setReady(ready: boolean, now: number) { this.advance(now); this.ready = ready; }

  ensureGuild(id: string, label: string) {
    let guild = this.guilds.get(id);
    if (!guild) {
      guild = { label, present: true, voice: new Map(), activity: new Map(), totals: activityTotals() };
      this.guilds.set(id, guild);
    }
    guild.label = label;
    guild.present = true;
    return guild;
  }

  leaveGuild(id: string, now: number) {
    this.advance(now);
    const guild = this.guilds.get(id);
    if (!guild) return;
    // Retain cumulative deltas until persisted, but never retain live voices
    // or activity after leaving. Guild online time stops at this event.
    guild.present = false;
    guild.voice.clear();
    guild.activity.clear();
  }

  syncVoice(id: string, label: string, voice: Map<string, string>, now: number) {
    this.advance(now);
    this.ensureGuild(id, label).voice = voice;
  }

  recordMessage(id: string, label: string, userId: string, now: number) {
    const guild = this.ensureGuild(id, label);
    guild.totals.messageCount += 1;
    this.global.messageCount += 1;
    guild.activity.set(userId, now);
  }

  recordCommand(id: string | null, label: string) {
    this.global.commandCount += 1;
    if (id) this.ensureGuild(id, label).totals.commandCount += 1;
  }

  recordVoice(id: string, label: string, userId: string, channelId: string | null, now: number) {
    this.advance(now);
    const guild = this.ensureGuild(id, label);
    if (channelId) guild.voice.set(userId, channelId);
    else guild.voice.delete(userId);
    guild.activity.set(userId, now);
  }

  snapshot(now: number): ActivitySnapshot {
    this.advance(now);
    return { global: { ...this.global }, guilds: new Map([...this.guilds].map(([id, guild]) => [id, { ...guild.totals }])) };
  }

  community(now: number) {
    const globalActive = new Set<string>();
    const globalVoice = new Set<string>();
    const guilds = new Map<string, BotMetricValues>();
    let voiceChannels = 0;
    for (const [id, guild] of this.guilds) {
      for (const [userId, lastAt] of guild.activity) if (now - lastAt > ACTIVE_WINDOW_MS) guild.activity.delete(userId);
      const active = new Set([...guild.activity.keys(), ...(this.ready ? guild.voice.keys() : [])]);
      for (const userId of active) globalActive.add(userId);
      for (const userId of guild.voice.keys()) globalVoice.add(userId);
      const channels = new Set(guild.voice.values()).size;
      voiceChannels += channels;
      guilds.set(id, { activeDiscordUsers: active.size, voiceMembers: !guild.present ? 0 : this.ready ? guild.voice.size : null, voiceChannels: !guild.present ? 0 : this.ready ? channels : null });
    }
    return { global: { activeDiscordUsers: globalActive.size, voiceMembers: this.ready ? globalVoice.size : null, voiceChannels: this.ready ? voiceChannels : null }, guilds };
  }
}

export function botGatewayConnected(client: Client) {
  // discord.js's manager isReady() can remain true while a shard reconnects.
  // Conservative all-shards readiness avoids integrating stale VC caches.
  return client.isReady() && client.ws.shards.size > 0
    && [...client.ws.shards.values()].every((shard) => shard.status === Status.Ready);
}

function guildVoiceMembers(guild: Guild, client: Client) {
  return new Map([...guild.voiceStates.cache.values()].flatMap((state) => (
    state.channelId && !(state.member?.user.bot ?? client.users.cache.get(state.id)?.bot ?? false)
      ? [[state.id, state.channelId] as [string, string]] : []
  )));
}

function validNumber(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

async function discordApiPing() {
  const started = performance.now();
  try {
    const response = await fetch("https://discord.com/api/v10/gateway", { signal: AbortSignal.timeout(5_000), cache: "no-store" });
    if (!response.ok) return null;
    await response.arrayBuffer();
    return performance.now() - started;
  } catch { return null; }
}

async function databasePing() {
  const started = performance.now();
  try { await getDb().execute(sql`select 1`); return performance.now() - started; }
  catch { return null; }
}

export type BotTelemetryHandle = { sampleNow: () => Promise<void>; stop: () => Promise<void> };

/** Low-frequency, isolated telemetry; failures never enter command/notification paths. */
export function startBotTelemetry(client: Client): BotTelemetryHandle {
  const sessionId = randomUUID();
  const network = startNetworkTelemetry();
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const tracker = new BotActivityTracker(performance.now());
  let committedAt = performance.now();
  let committedActivity = tracker.snapshot(committedAt);
  let committedNetwork: NetworkTotals = network.snapshot();
  let committedCpu = process.cpuUsage();
  let lastSampleMs = Date.now() - 1;
  let stopped = false;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: { inputs: BotTelemetryInput[]; activity: ActivitySnapshot; network: NetworkTotals; cpu: NodeJS.CpuUsage; at: number } | undefined;
  const memberCache = new Map<string, { at: number; count: number | null }>();

  for (const guild of client.guilds.cache.values()) tracker.syncVoice(guild.id, guild.name, guildVoiceMembers(guild, client), performance.now());
  tracker.setReady(botGatewayConnected(client), performance.now());

  async function memberCount(guild: Guild) {
    const previous = memberCache.get(guild.id);
    if (previous && performance.now() - previous.at < MEMBER_CACHE_MS) return previous.count;
    let count = previous?.count ?? validNumber(guild.memberCount);
    const token = process.env.DISCORD_TOKEN;
    if (token) {
      try {
        const response = await fetch(`https://discord.com/api/v10/guilds/${guild.id}?with_counts=true`, {
          headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(5_000), cache: "no-store",
        });
        if (response.ok) {
          const data = await response.json() as { approximate_member_count?: number };
          count = validNumber(data.approximate_member_count) ?? count;
        }
      } catch { /* Fall back to the previous approximate/Gateway count. */ }
    }
    memberCache.set(guild.id, { at: performance.now(), count });
    return count;
  }

  async function persistPending() {
    if (!pending || stopped) return;
    const retained = pending;
    // Same session/scope/sample timestamp is retried after uncertain DB failure;
    // the repository's unique key makes this idempotent, without losing deltas.
    await insertBotTelemetrySamples(retained.inputs);
    committedAt = retained.at;
    committedActivity = retained.activity;
    committedNetwork = retained.network;
    committedCpu = retained.cpu;
    pending = undefined;
  }

  async function collect() {
    await persistPending();
    if (stopped) return;
    const currentGuilds = [...client.guilds.cache.values()];
    const [context, apiPing, dbPing, members] = await Promise.all([
      getBotTelemetryContext(), discordApiPing(), databasePing(),
      Promise.all(currentGuilds.map(async (guild) => [guild.id, await memberCount(guild)] as const)),
    ]);
    if (stopped) return;
    const now = performance.now();
    const connected = botGatewayConnected(client);
    tracker.setReady(connected, now);
    for (const id of tracker.guilds.keys()) if (!client.guilds.cache.has(id)) tracker.leaveGuild(id, now);
    for (const guild of currentGuilds) tracker.syncVoice(guild.id, guild.name, guildVoiceMembers(guild, client), now);
    const currentActivity = tracker.snapshot(now);
    const community = tracker.community(now);
    const currentNetwork = network.snapshot();
    const currentCpu = process.cpuUsage();
    const intervalSeconds = Math.max(0.001, (now - committedAt) / 1_000);
    const networkDelta = difference(currentNetwork, committedNetwork);
    const memberById = new Map(members);
    // Manual/ready-triggered samples can complete in one millisecond. Keep
    // their idempotency keys distinct without relying on insert timing.
    const sampledAt = new Date(Math.max(Date.now(), lastSampleMs + 1));
    lastSampleMs = sampledAt.getTime();
    const globalMetrics: BotMetricValues = {
      ...context.global, ...difference(currentActivity.global, committedActivity.global), ...community.global, ...networkDelta,
      receiveBps: networkDelta.receivedBytes / intervalSeconds,
      sendBps: networkDelta.sentBytes / intervalSeconds,
      gatewayPingMs: connected ? validNumber(client.ws.ping) : null, discordApiPingMs: apiPing, dbPingMs: dbPing,
      guildCount: currentGuilds.length,
      memberCount: members.every(([, count]) => count !== null) ? members.reduce((total, [, count]) => total + (count ?? 0), 0) : null,
      cpuPercent: Math.max(0, (currentCpu.user - committedCpu.user + currentCpu.system - committedCpu.system) / (intervalSeconds * 10_000)),
      memoryBytes: process.memoryUsage().rss,
      eventLoopLagMs: validNumber(loop.mean / 1_000_000),
    };
    const inputs: BotTelemetryInput[] = [{ scope: "global", scopeLabel: "Bot全体", sessionId, sampledAt, intervalSeconds, metrics: globalMetrics }];
    for (const [id, totals] of currentActivity.guilds) {
      inputs.push({
        scope: `guild:${id}`, scopeLabel: tracker.guilds.get(id)!.label, sessionId, sampledAt, intervalSeconds,
        metrics: {
          ...context.guilds[id], ...difference(totals, committedActivity.guilds.get(id) ?? activityTotals()), ...community.guilds.get(id),
          guildCount: client.guilds.cache.has(id) ? 1 : 0,
          memberCount: memberById.get(id) ?? null,
          gatewayPingMs: connected ? validNumber(client.guilds.cache.get(id)?.shard.ping) : null,
        },
      });
    }
    pending = { inputs, activity: currentActivity, network: currentNetwork, cpu: currentCpu, at: now };
    loop.reset();
    await persistPending();
  }

  function sampleNow() {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = collect().catch((error) => console.error("[telemetry] sample retained for retry:", error)).finally(() => { running = undefined; });
    return running;
  }

  const onReady = () => {
    tracker.setReady(botGatewayConnected(client), performance.now());
    for (const guild of client.guilds.cache.values()) tracker.syncVoice(guild.id, guild.name, guildVoiceMembers(guild, client), performance.now());
    void sampleNow();
    timer ??= setInterval(() => { void sampleNow(); }, SAMPLE_INTERVAL_MS);
    timer.unref();
  };
  const onConnection = () => tracker.setReady(botGatewayConnected(client), performance.now());
  const onMessage = (message: { guildId: string | null; guild?: { name: string } | null; author: { id: string; bot: boolean } }) => {
    if (!stopped && message.guildId && !message.author.bot) tracker.recordMessage(message.guildId, message.guild?.name ?? message.guildId, message.author.id, performance.now());
  };
  const onCommand = (interaction: { guildId: string | null; guild?: { name: string } | null; user: { id: string; bot?: boolean }; isChatInputCommand: () => boolean }) => {
    if (!stopped && !interaction.user.bot && interaction.isChatInputCommand()) tracker.recordCommand(interaction.guildId, interaction.guild?.name ?? interaction.guildId ?? "DM");
  };
  const onVoice = (_before: VoiceState, after: VoiceState) => {
    if (!stopped && !(after.member?.user.bot ?? client.users.cache.get(after.id)?.bot ?? false)) tracker.recordVoice(after.guild.id, after.guild.name, after.id, after.channelId, performance.now());
  };
  const onGuildCreate = (guild: Guild) => tracker.syncVoice(guild.id, guild.name, guildVoiceMembers(guild, client), performance.now());
  const onGuildDelete = (guild: Guild) => { tracker.leaveGuild(guild.id, performance.now()); memberCache.delete(guild.id); };
  client.on(Events.ClientReady, onReady);
  client.on(Events.ShardDisconnect, onConnection); client.on(Events.ShardReconnecting, onConnection); client.on(Events.ShardResume, onConnection); client.on(Events.ShardReady, onConnection);
  client.on(Events.MessageCreate, onMessage); client.on(Events.InteractionCreate, onCommand); client.on(Events.VoiceStateUpdate, onVoice);
  client.on(Events.GuildCreate, onGuildCreate); client.on(Events.GuildDelete, onGuildDelete);
  if (client.isReady()) onReady();

  return {
    sampleNow,
    stop: async () => {
      if (stopped) { await running; return; }
      stopped = true;
      if (timer) clearInterval(timer);
      client.off(Events.ClientReady, onReady);
      client.off(Events.ShardDisconnect, onConnection); client.off(Events.ShardReconnecting, onConnection); client.off(Events.ShardResume, onConnection); client.off(Events.ShardReady, onConnection);
      client.off(Events.MessageCreate, onMessage); client.off(Events.InteractionCreate, onCommand); client.off(Events.VoiceStateUpdate, onVoice);
      client.off(Events.GuildCreate, onGuildCreate); client.off(Events.GuildDelete, onGuildDelete);
      network.stop(); loop.disable(); memberCache.clear();
      await running;
    },
  };
}

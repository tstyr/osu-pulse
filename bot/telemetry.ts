import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { Events, Status, type Client, type Guild, type VoiceState } from "discord.js";
import { sql } from "drizzle-orm";

import { getDb } from "../src/db";
import { getBotTelemetryContext, insertBotTelemetrySamples } from "../src/db/bot-telemetry-repository";
import { BOT_STATISTIC_METRICS, type BotMetricKey, type BotMetricValues, type BotTelemetryInput } from "../src/lib/bot-statistics";
import { startNetworkTelemetry, type NetworkTotals } from "./network-telemetry";
import { startCommandTelemetry } from "./command-telemetry";
import { BOT_NETWORK_SERVICES, mergeBotDimensions, type BotTelemetryDimensions } from "../src/lib/bot-dimensions";

const SAMPLE_INTERVAL_MS = 60_000;
const ACTIVE_WINDOW_MS = 15 * 60_000;
const MEMBER_CACHE_MS = 5 * 60_000;
const MAX_QUEUED_SAMPLES = 240;
const STOP_TIMEOUT_MS = 3_000;
const CONTEXT_KEYS: BotMetricKey[] = ["osuActivePlayers", "trackedPlayers", "storedScores", "uniqueBeatmaps", "osuLifetimePlayCount", "osuLifetimePlaySeconds", "notificationPending", "notificationFailed"];
const unknownContext = Object.fromEntries(CONTEXT_KEYS.map((key) => [key, null])) as BotMetricValues;

type ActivityTotals = { messageCount: number; commandCount: number; voiceMemberSeconds: number; botOnlineSeconds: number };
type GuildActivity = { label: string; present: boolean; available: boolean; voice: Map<string, string>; activity: Map<string, number>; totals: ActivityTotals };
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
      const voiceSeconds = this.ready && guild.present && guild.available ? guild.voice.size * seconds : 0;
      guild.totals.voiceMemberSeconds += voiceSeconds;
      this.global.voiceMemberSeconds += voiceSeconds;
      if (this.ready && guild.present && guild.available) guild.totals.botOnlineSeconds += seconds;
    }
  }

  setReady(ready: boolean, now: number) { this.advance(now); this.ready = ready; }

  ensureGuild(id: string, label: string) {
    let guild = this.guilds.get(id);
    if (!guild) {
      guild = { label, present: true, available: true, voice: new Map(), activity: new Map(), totals: activityTotals() };
      this.guilds.set(id, guild);
    }
    guild.label = label;
    guild.present = true;
    guild.available = true;
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

  unavailableGuild(id: string, label: string, now: number) {
    this.advance(now);
    const guild = this.ensureGuild(id, label);
    guild.available = false;
    // Discord keeps an unavailable guild's stale voice cache. Never integrate
    // those voices until a fresh GuildAvailable cache has been received.
    guild.voice.clear();
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
    let available = this.ready;
    for (const [id, guild] of this.guilds) {
      for (const [userId, lastAt] of guild.activity) if (now - lastAt > ACTIVE_WINDOW_MS) guild.activity.delete(userId);
      const observed = this.ready && guild.available;
      if (guild.present && !guild.available) available = false;
      const active = new Set([...guild.activity.keys(), ...(observed ? guild.voice.keys() : [])]);
      for (const userId of active) globalActive.add(userId);
      for (const userId of guild.voice.keys()) globalVoice.add(userId);
      const channels = new Set(guild.voice.values()).size;
      voiceChannels += channels;
      guilds.set(id, { activeDiscordUsers: !guild.present ? 0 : observed ? active.size : null, voiceMembers: !guild.present ? 0 : observed ? guild.voice.size : null, voiceChannels: !guild.present ? 0 : observed ? channels : null });
    }
    return { global: { activeDiscordUsers: available ? globalActive.size : null, voiceMembers: available ? globalVoice.size : null, voiceChannels: available ? voiceChannels : null }, guilds };
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

/** Keep the uncertain attempted head immutable; only unattempted rows may merge. */
export function compactBotTelemetryQueue(queue: BotTelemetryInput[][], maximum = MAX_QUEUED_SAMPLES) {
  let compacted = false;
  const limit = Math.max(2, maximum);
  while (queue.length > limit) {
    const earlier = new Map(queue[1].map((input) => [input.scope, input]));
    const later = new Map(queue[2].map((input) => [input.scope, input]));
    const end = queue[2][0].sampledAt;
    const merged = [...new Set([...earlier.keys(), ...later.keys()])].map((scope) => {
      const before = earlier.get(scope);
      const after = later.get(scope);
      const metrics: BotMetricValues = {};
      for (const key of new Set([...Object.keys(before?.metrics ?? {}), ...Object.keys(after?.metrics ?? {})]) as Set<BotMetricKey>) {
        const left = before?.metrics[key];
        const right = after?.metrics[key];
        metrics[key] = BOT_STATISTIC_METRICS[key].kind === "delta"
          ? left == null && right == null ? null : (left ?? 0) + (right ?? 0)
          : null;
      }
      return { ...(after ?? before!), sampledAt: end, intervalSeconds: (before?.intervalSeconds ?? 0) + (after?.intervalSeconds ?? 0), metrics,
        dimensions: before?.dimensions || after?.dimensions ? mergeBotDimensions(before?.dimensions, after?.dimensions) : undefined };
    });
    queue.splice(1, 2, merged);
    compacted = true;
  }
  return compacted;
}

/** Low-frequency, isolated telemetry; failures never enter command/notification paths. */
export function startBotTelemetry(client: Client): BotTelemetryHandle {
  const sessionId = randomUUID();
  const network = startNetworkTelemetry();
  const commandTracker = startCommandTelemetry();
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const tracker = new BotActivityTracker(performance.now());
  let observedAt = performance.now();
  let observedActivity = tracker.snapshot(observedAt);
  let observedNetwork: NetworkTotals = network.snapshot();
  let observedServices: BotTelemetryDimensions["services"] = network.servicesSnapshot?.() ?? {};
  let observedCpu = process.cpuUsage();
  let lastSampleMs = Date.now() - 1;
  let stopped = false;
  let stopping = false;
  let collecting: Promise<void> | undefined;
  let samplePromise: Promise<void> | undefined;
  let flushing: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const queue: BotTelemetryInput[][] = [];
  let compressionWarning = false;
  const memberCache = new Map<string, { at: number; count: number | null }>();

  function syncGuild(guild: Guild, now: number) {
    if (guild.available === false) tracker.unavailableGuild(guild.id, guild.name, now);
    else tracker.syncVoice(guild.id, guild.name, guildVoiceMembers(guild, client), now);
  }
  for (const guild of client.guilds.cache.values()) syncGuild(guild, performance.now());
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

  function flushQueue() {
    if (flushing) return flushing;
    flushing = (async () => {
      while (queue.length && !stopped) {
        const retained = queue[0];
        // Retrying the same immutable session/scope/timestamp preserves
        // idempotency even if a connection failed after the DB committed.
        await insertBotTelemetrySamples(retained);
        queue.shift();
      }
    })().catch((error) => console.error("[telemetry] samples retained for retry:", error))
      .finally(() => { flushing = undefined; });
    return flushing;
  }

  function capture(
    context: Awaited<ReturnType<typeof getBotTelemetryContext>>,
    apiPing: number | null,
    dbPing: number | null,
    members: ReadonlyArray<readonly [string, number | null]>,
    final = false,
  ) {
    const currentGuilds = [...client.guilds.cache.values()];
    const now = performance.now();
    const connected = !final && botGatewayConnected(client);
    tracker.setReady(connected, now);
    for (const id of tracker.guilds.keys()) if (!client.guilds.cache.has(id)) tracker.leaveGuild(id, now);
    for (const guild of currentGuilds) syncGuild(guild, now);
    const currentActivity = tracker.snapshot(now);
    const community = tracker.community(now);
    const currentNetwork = network.snapshot();
    const currentServices = network.servicesSnapshot?.() ?? {};
    const currentCpu = process.cpuUsage();
    const intervalSeconds = Math.max(0.001, (now - observedAt) / 1_000);
    const networkDelta = difference(currentNetwork, observedNetwork);
    const memberById = new Map(members);
    // Manual/ready-triggered samples can complete in one millisecond. Keep
    // their idempotency keys distinct without relying on insert timing.
    const sampledAt = new Date(Math.max(Date.now(), lastSampleMs + 1));
    lastSampleMs = sampledAt.getTime();
    const globalMetrics: BotMetricValues = {
      ...unknownContext, ...context.global, ...difference(currentActivity.global, observedActivity.global), ...community.global, ...networkDelta,
      receiveBps: networkDelta.receivedBytes / intervalSeconds,
      sendBps: networkDelta.sentBytes / intervalSeconds,
      gatewayPingMs: connected ? validNumber(client.ws.ping) : null, discordApiPingMs: apiPing, dbPingMs: dbPing,
      guildCount: currentGuilds.length,
      memberCount: members.every(([, count]) => count !== null) ? members.reduce((total, [, count]) => total + (count ?? 0), 0) : null,
      cpuPercent: Math.max(0, (currentCpu.user - observedCpu.user + currentCpu.system - observedCpu.system) / (intervalSeconds * 10_000)),
      memoryBytes: process.memoryUsage().rss,
      eventLoopLagMs: validNumber(loop.mean / 1_000_000),
    };
    const serviceDeltas: BotTelemetryDimensions["services"] = {};
    for (const service of BOT_NETWORK_SERVICES) {
      if (currentServices[service]) serviceDeltas[service] = difference(currentServices[service], observedServices[service] ?? { receivedBytes: 0, sentBytes: 0 });
    }
    const commandSnapshot = commandTracker.drain();
    const inputs: BotTelemetryInput[] = [{ scope: "global", scopeLabel: "Bot全体", sessionId, sampledAt, intervalSeconds, metrics: globalMetrics,
      dimensions: { commands: commandSnapshot.global, services: serviceDeltas } }];
    for (const [id, totals] of currentActivity.guilds) {
      inputs.push({
        scope: `guild:${id}`, scopeLabel: tracker.guilds.get(id)!.label, sessionId, sampledAt, intervalSeconds,
        metrics: {
          ...unknownContext, ...context.guilds[id], ...difference(totals, observedActivity.guilds.get(id) ?? activityTotals()), ...community.guilds.get(id),
          guildCount: client.guilds.cache.has(id) ? 1 : 0,
          memberCount: memberById.get(id) ?? null,
          gatewayPingMs: connected ? validNumber(client.guilds.cache.get(id)?.shard.ping) : null,
        },
        dimensions: { commands: commandSnapshot.guilds.get(id) ?? {}, services: {} },
      });
    }
    queue.push(inputs);
    observedAt = now;
    observedActivity = currentActivity;
    observedNetwork = currentNetwork;
    observedServices = currentServices;
    observedCpu = currentCpu;
    loop.reset();
    if (compactBotTelemetryQueue(queue) && !compressionWarning) {
      compressionWarning = true;
      console.warn("[telemetry] DB backlog compacted: cumulative counters retained; older instantaneous observations are unavailable");
    }
  }

  async function collect() {
    const currentGuilds = [...client.guilds.cache.values()];
    const [context, apiPing, dbPing, members] = await Promise.all([
      getBotTelemetryContext(), discordApiPing(), databasePing(),
      Promise.all(currentGuilds.map(async (guild) => [guild.id, await memberCount(guild)] as const)),
    ]);
    if (stopping || stopped) return;
    capture(context, apiPing, dbPing, members);
  }

  function sampleNow() {
    if (stopping || stopped) return Promise.resolve();
    if (collecting) return samplePromise!;
    collecting = collect().catch((error) => console.error("[telemetry] collection failed:", error))
      .finally(() => { collecting = undefined; });
    // Collection is single-flight independently of persistence. A slow or
    // unavailable DB must not freeze the next minute's measured observations.
    samplePromise = collecting.then(() => stopping || stopped ? undefined : flushQueue());
    return samplePromise;
  }

  const onReady = () => {
    tracker.setReady(botGatewayConnected(client), performance.now());
    for (const guild of client.guilds.cache.values()) syncGuild(guild, performance.now());
    void sampleNow();
    timer ??= setInterval(() => { void sampleNow(); }, SAMPLE_INTERVAL_MS);
    timer.unref();
  };
  const onConnection = () => tracker.setReady(botGatewayConnected(client), performance.now());
  const onMessage = (message: { guildId: string | null; guild?: { name: string } | null; author: { id: string; bot: boolean } }) => {
    if (!stopping && !stopped && message.guildId && !message.author.bot) tracker.recordMessage(message.guildId, message.guild?.name ?? message.guildId, message.author.id, performance.now());
  };
  const onCommand = (interaction: { guildId: string | null; guild?: { name: string } | null; user: { id: string; bot?: boolean }; isChatInputCommand: () => boolean }) => {
    if (!stopping && !stopped && !interaction.user.bot && interaction.isChatInputCommand()) tracker.recordCommand(interaction.guildId, interaction.guild?.name ?? interaction.guildId ?? "DM");
  };
  const onVoice = (_before: VoiceState, after: VoiceState) => {
    if (!stopping && !stopped && !(after.member?.user.bot ?? client.users.cache.get(after.id)?.bot ?? false)) tracker.recordVoice(after.guild.id, after.guild.name, after.id, after.channelId, performance.now());
  };
  const onGuildCreate = (guild: Guild) => syncGuild(guild, performance.now());
  const onGuildUnavailable = (guild: Guild) => tracker.unavailableGuild(guild.id, guild.name, performance.now());
  const onGuildDelete = (guild: Guild) => { tracker.leaveGuild(guild.id, performance.now()); memberCache.delete(guild.id); };
  client.on(Events.ClientReady, onReady);
  client.on(Events.ShardDisconnect, onConnection); client.on(Events.ShardReconnecting, onConnection); client.on(Events.ShardResume, onConnection); client.on(Events.ShardReady, onConnection);
  client.on(Events.MessageCreate, onMessage); client.on(Events.InteractionCreate, onCommand); client.on(Events.VoiceStateUpdate, onVoice);
  client.on(Events.GuildCreate, onGuildCreate); client.on(Events.GuildDelete, onGuildDelete);
  client.on(Events.GuildUnavailable, onGuildUnavailable); client.on(Events.GuildAvailable, onGuildCreate);
  if (client.isReady()) onReady();

  return {
    sampleNow,
    stop: () => {
      if (stopPromise) return stopPromise;
      stopping = true;
      if (timer) clearInterval(timer);
      client.off(Events.ClientReady, onReady);
      client.off(Events.ShardDisconnect, onConnection); client.off(Events.ShardReconnecting, onConnection); client.off(Events.ShardResume, onConnection); client.off(Events.ShardReady, onConnection);
      client.off(Events.MessageCreate, onMessage); client.off(Events.InteractionCreate, onCommand); client.off(Events.VoiceStateUpdate, onVoice);
      client.off(Events.GuildCreate, onGuildCreate); client.off(Events.GuildDelete, onGuildDelete);
      client.off(Events.GuildUnavailable, onGuildUnavailable); client.off(Events.GuildAvailable, onGuildCreate);
      // Do not start more HTTP/context reads during shutdown. Flush the final
      // in-memory counters, even if another context read is still pending.
      const unknownGauges = Object.fromEntries(Object.entries(BOT_STATISTIC_METRICS)
        .filter(([, metric]) => metric.kind === "gauge").map(([key]) => [key, null])) as BotMetricValues;
      capture({ global: unknownGauges, guilds: {} }, null, null, [...client.guilds.cache.values()]
        .map((guild) => [guild.id, memberCache.get(guild.id)?.count ?? validNumber(guild.memberCount)] as const), true);
      stopPromise = (async () => {
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([flushQueue(), new Promise<void>((resolve) => { deadline = setTimeout(resolve, STOP_TIMEOUT_MS); })]);
        } finally {
          if (deadline) clearTimeout(deadline);
          stopped = true;
          network.stop(); commandTracker.stop(); loop.disable(); memberCache.clear();
        }
      })();
      return stopPromise;
    },
  };
}

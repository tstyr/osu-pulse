import { EventEmitter } from "node:events";
import { Events, Status, type Client } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotMetricValues, BotTelemetryInput } from "../src/lib/bot-statistics";

const mocks = vi.hoisted(() => ({ context: vi.fn(), insert: vi.fn(), network: vi.fn(), stopNetwork: vi.fn(), db: vi.fn() }));
vi.mock("../src/db/bot-telemetry-repository", () => ({ getBotTelemetryContext: mocks.context, insertBotTelemetrySamples: mocks.insert }));
vi.mock("../src/db", () => ({ getDb: () => ({ execute: mocks.db }) }));
vi.mock("./network-telemetry", () => ({ startNetworkTelemetry: () => ({ snapshot: mocks.network, stop: mocks.stopNetwork }) }));

import { botGatewayConnected, BotActivityTracker, compactBotTelemetryQueue, startBotTelemetry, type BotTelemetryHandle } from "./telemetry";

const guildId = "123456789012345678";
const network = { receivedBytes: 0, sentBytes: 0, externalReceivedBytes: 0, externalSentBytes: 0, localReceivedBytes: 0, localSentBytes: 0 };

class FakeClient extends EventEmitter {
  ready = false;
  guilds = { cache: new Map([[guildId, { id: guildId, name: "Guild", memberCount: 50, shard: { ping: 12 }, voiceStates: { cache: new Map() } }]]) };
  users = { cache: new Map() };
  ws = { ping: -1, shards: new Map([[0, { status: Status.Ready }]]) };
  isReady() { return this.ready; }
}

let handle: BotTelemetryHandle | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  for (const key of Object.keys(network) as Array<keyof typeof network>) network[key] = 0;
  mocks.network.mockImplementation(() => ({ ...network }));
  mocks.context.mockResolvedValue({ global: { storedScores: 42 }, guilds: { [guildId]: { trackedPlayers: 7 } } });
  mocks.insert.mockResolvedValue(undefined);
  mocks.db.mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({ approximate_member_count: 52 }) }));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Bot community activity", () => {
  it("integrates exact VC occupancy between joins/leaves and stops integrating offline time", () => {
    const tracker = new BotActivityTracker(0);
    tracker.setReady(true, 0);
    tracker.recordVoice("one", "One", "u1", "vc", 0);
    tracker.recordVoice("one", "One", "u2", "vc", 10_000);
    tracker.recordVoice("one", "One", "u1", null, 20_000);
    tracker.setReady(false, 30_000);
    const snapshot = tracker.snapshot(90_000);
    expect(snapshot.global).toMatchObject({ voiceMemberSeconds: 40, botOnlineSeconds: 30 });
    expect(snapshot.guilds.get("one")?.voiceMemberSeconds).toBe(40);
    expect(tracker.community(90_000).global.voiceMembers).toBeNull();
  });

  it("deduplicates active users across guilds and expires messages after 15 minutes", () => {
    const tracker = new BotActivityTracker(0);
    tracker.setReady(true, 0);
    tracker.recordMessage("one", "One", "user", 0);
    tracker.recordMessage("two", "Two", "user", 0);
    tracker.recordVoice("two", "Two", "voice-user", "vc", 0);
    expect(tracker.community(1).global.activeDiscordUsers).toBe(2);
    expect(tracker.community(16 * 60_000).global.activeDiscordUsers).toBe(1);
    expect(tracker.snapshot(16 * 60_000).global.messageCount).toBe(2);
  });

  it("flushes then stops guild occupancy and activity when the Bot leaves", () => {
    const tracker = new BotActivityTracker(0);
    tracker.setReady(true, 0);
    tracker.recordVoice("one", "One", "user", "vc", 0);
    tracker.recordMessage("one", "One", "user", 0);
    tracker.leaveGuild("one", 10_000);
    const snapshot = tracker.snapshot(90_000);
    expect(snapshot.guilds.get("one")).toMatchObject({ botOnlineSeconds: 10, voiceMemberSeconds: 10, messageCount: 1 });
    expect(tracker.community(90_000).global.activeDiscordUsers).toBe(0);
    expect(tracker.community(90_000).global.voiceMembers).toBe(0);
  });

  it("does not mistake logged-in manager state for a connected shard", () => {
    const client = new FakeClient();
    client.ready = true;
    expect(botGatewayConnected(client as unknown as Client)).toBe(true);
    client.ws.shards.get(0)!.status = Status.Reconnecting;
    expect(botGatewayConnected(client as unknown as Client)).toBe(false);
  });

  it("stops stale VC occupancy during a guild outage and resumes only with fresh voices", () => {
    const tracker = new BotActivityTracker(0);
    tracker.setReady(true, 0);
    tracker.recordVoice("one", "One", "user", "vc", 0);
    tracker.unavailableGuild("one", "One", 10_000);
    expect(tracker.snapshot(90_000).global.voiceMemberSeconds).toBe(10);
    expect(tracker.community(90_000).global.voiceMembers).toBeNull();
    expect(tracker.community(90_000).guilds.get("one")?.activeDiscordUsers).toBeNull();
    tracker.syncVoice("one", "One", new Map([["user", "new-vc"]]), 100_000);
    expect(tracker.snapshot(110_000).global.voiceMemberSeconds).toBe(20);
    expect(tracker.community(110_000).global.voiceMembers).toBe(1);
  });
});

describe("Bot telemetry sampling", () => {
  it("records only human guild messages and slash commands, without retaining content", async () => {
    const client = new FakeClient();
    handle = startBotTelemetry(client as unknown as Client);
    const human = { guildId, guild: { name: "Guild" }, author: { id: "user", bot: false }, content: "DO NOT STORE THIS" };
    client.emit(Events.MessageCreate, human);
    client.emit(Events.MessageCreate, { ...human, author: { id: "bot", bot: true } });
    client.emit(Events.MessageCreate, { ...human, guildId: null });
    client.emit(Events.InteractionCreate, { guildId, guild: { name: "Guild" }, user: { id: "user" }, isChatInputCommand: () => true });
    client.emit(Events.InteractionCreate, { guildId, user: { id: "user" }, isChatInputCommand: () => false });
    await handle.sampleNow();
    const inputs = mocks.insert.mock.calls[0][0] as BotTelemetryInput[];
    expect(inputs.find((sample) => sample.scope === "global")?.metrics).toMatchObject({ messageCount: 1, commandCount: 1, gatewayPingMs: null, storedScores: 42 });
    expect(inputs.find((sample) => sample.scope === `guild:${guildId}`)?.metrics).toMatchObject({ messageCount: 1, commandCount: 1, trackedPlayers: 7 });
    expect(JSON.stringify(inputs)).not.toContain("DO NOT STORE THIS");
    expect(JSON.stringify(inputs)).not.toContain('"user"');
  });

  it("retries an immutable failed sample before advancing deltas, without double counting new activity", async () => {
    const client = new FakeClient();
    handle = startBotTelemetry(client as unknown as Client);
    const message = { guildId, author: { id: "user", bot: false } };
    client.emit(Events.MessageCreate, message);
    network.receivedBytes = 10; network.externalReceivedBytes = 10;
    mocks.insert.mockRejectedValueOnce(new Error("uncertain database commit"));
    await handle.sampleNow();
    const first = mocks.insert.mock.calls[0][0] as BotTelemetryInput[];
    client.emit(Events.MessageCreate, message);
    network.receivedBytes = 15; network.externalReceivedBytes = 15;
    await handle.sampleNow();
    expect(mocks.insert.mock.calls[1][0]).toBe(first);
    const next = mocks.insert.mock.calls[2][0] as BotTelemetryInput[];
    expect(next[0].sampledAt.getTime()).toBeGreaterThan(first[0].sampledAt.getTime());
    expect(first.find((sample) => sample.scope === "global")?.metrics).toMatchObject({ messageCount: 1, receivedBytes: 10 });
    expect(next.find((sample) => sample.scope === "global")?.metrics).toMatchObject({ messageCount: 1, receivedBytes: 5 });
    await handle.sampleNow();
    const idle = mocks.insert.mock.calls[3][0] as BotTelemetryInput[];
    expect(idle.find((sample) => sample.scope === "global")?.metrics).toMatchObject({ messageCount: 0, receivedBytes: 0 });
  });

  it("is single-flight and shutdown flushes final counters without awaiting or repeating a pending context read", async () => {
    const client = new FakeClient();
    let finish!: (context: { global: BotMetricValues; guilds: Record<string, BotMetricValues> }) => void;
    mocks.context.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    handle = startBotTelemetry(client as unknown as Client);
    const first = handle.sampleNow();
    const second = handle.sampleNow();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(mocks.context).toHaveBeenCalledOnce();
    const stopping = handle.stop();
    await stopping;
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.context).toHaveBeenCalledOnce();
    const beforeCompletion = mocks.insert.mock.calls[0][0];
    finish({ global: {}, guilds: {} });
    await first;
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.insert.mock.calls[0][0]).toBe(beforeCompletion);
    expect(mocks.stopNetwork).toHaveBeenCalledOnce();
    expect(client.listenerCount(Events.MessageCreate)).toBe(0);
    expect(client.listenerCount(Events.VoiceStateUpdate)).toBe(0);
    await handle.sampleNow();
    expect(mocks.context).toHaveBeenCalledOnce();
  });

  it("persists the final unsampled messages/network counters during graceful shutdown without extra HTTP calls", async () => {
    const client = new FakeClient();
    handle = startBotTelemetry(client as unknown as Client);
    await handle.sampleNow();
    const fetchCount = vi.mocked(fetch).mock.calls.length;
    const contextCount = mocks.context.mock.calls.length;
    client.emit(Events.MessageCreate, { guildId, author: { id: "human", bot: false } });
    network.receivedBytes = 123; network.externalReceivedBytes = 123;
    await handle.stop();
    const final = mocks.insert.mock.calls[1][0] as BotTelemetryInput[];
    expect(final[0].metrics).toMatchObject({ messageCount: 1, receivedBytes: 123, gatewayPingMs: null, voiceMembers: null, discordApiPingMs: null, dbPingMs: null, storedScores: null });
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCount);
    expect(mocks.context.mock.calls.length).toBe(contextCount);
    expect(client.listenerCount(Events.GuildUnavailable)).toBe(0);
  });

  it("continues collecting chronological observations while an earlier DB write is still pending", async () => {
    const client = new FakeClient();
    handle = startBotTelemetry(client as unknown as Client);
    let rejectWrite!: (error: Error) => void;
    mocks.insert.mockImplementationOnce(() => new Promise((_, reject) => { rejectWrite = reject; }));
    client.emit(Events.MessageCreate, { guildId, author: { id: "human", bot: false } });
    const first = handle.sampleNow();
    await vi.waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce());
    const initial = mocks.insert.mock.calls[0][0] as BotTelemetryInput[];
    client.emit(Events.MessageCreate, { guildId, author: { id: "human", bot: false } });
    mocks.context.mockResolvedValue({ global: { storedScores: 99 }, guilds: {} });
    const second = handle.sampleNow();
    await vi.waitFor(() => expect(mocks.context).toHaveBeenCalledTimes(2));
    expect(mocks.insert).toHaveBeenCalledOnce();
    rejectWrite(new Error("DB unavailable"));
    await Promise.all([first, second]);
    await handle.sampleNow();
    expect(mocks.insert.mock.calls[1][0]).toBe(initial);
    const observedDuringWrite = mocks.insert.mock.calls[2][0] as BotTelemetryInput[];
    expect(observedDuringWrite[0].metrics).toMatchObject({ storedScores: 99, messageCount: 1 });
    expect(observedDuringWrite[0].sampledAt.getTime()).toBeGreaterThan(initial[0].sampledAt.getTime());
    expect(observedDuringWrite[1].metrics).toMatchObject({ storedScores: null, trackedPlayers: null, notificationPending: null });
    expect(mocks.insert.mock.calls[3][0][0].metrics.messageCount).toBe(0);
  });

  it("drains an immutable retained failed sample and final deltas in order on stop", async () => {
    const client = new FakeClient();
    handle = startBotTelemetry(client as unknown as Client);
    client.emit(Events.MessageCreate, { guildId, author: { id: "human", bot: false } });
    mocks.insert.mockRejectedValueOnce(new Error("uncertain commit"));
    await handle.sampleNow();
    const pending = mocks.insert.mock.calls[0][0] as BotTelemetryInput[];
    client.emit(Events.MessageCreate, { guildId, author: { id: "human", bot: false } });
    await handle.stop();
    expect(mocks.insert.mock.calls[1][0]).toBe(pending);
    expect(mocks.insert.mock.calls[2][0][0].metrics.messageCount).toBe(1);
    expect(mocks.insert.mock.calls[2][0][0].sampledAt.getTime()).toBeGreaterThan(pending[0].sampledAt.getTime());
  });

  it("bounds shutdown waiting and never starts another write after the timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const client = new FakeClient();
    handle = startBotTelemetry(client as unknown as Client);
    let finishWrite!: () => void;
    mocks.insert.mockImplementationOnce(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    const stopping = handle.stop();
    await vi.advanceTimersByTimeAsync(3_001);
    await stopping;
    expect(mocks.stopNetwork).toHaveBeenCalledOnce();
    finishWrite();
    await Promise.resolve();
    await handle.sampleNow();
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it("takes an immediate first sample on ready, uses approximate members and caches the HTTP count", async () => {
    vi.stubEnv("DISCORD_TOKEN", "test-token");
    const client = new FakeClient();
    handle = startBotTelemetry(client as unknown as Client);
    client.ready = true;
    client.ws.ping = 24;
    client.emit(Events.ClientReady, client);
    await handle.sampleNow();
    const inputs = mocks.insert.mock.calls[0][0] as BotTelemetryInput[];
    expect(inputs.find((sample) => sample.scope === "global")?.metrics).toMatchObject({ gatewayPingMs: 24, memberCount: 52 });
    await handle.sampleNow();
    const requests = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("with_counts"));
    expect(requests).toHaveLength(1);
    expect(requests[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("bounded Bot telemetry backlog", () => {
  const sample = (minute: number, metrics: BotMetricValues): BotTelemetryInput[] => [{
    scope: "global", scopeLabel: "Bot", sessionId: "same-session", sampledAt: new Date(minute * 60_000), intervalSeconds: 60, metrics,
  }];

  it("preserves uncertain head identity, cumulative deltas and chronology while dropping unmeasured gauge history", () => {
    const head = sample(1, { messageCount: 1, receivedBytes: 10, memoryBytes: 100 });
    const queue = [head, sample(2, { messageCount: 2, receivedBytes: 20, memoryBytes: 200 }),
      sample(3, { messageCount: 3, receivedBytes: 30, memoryBytes: 300 }), sample(4, { messageCount: 4, receivedBytes: 40, memoryBytes: 400 })];
    expect(compactBotTelemetryQueue(queue, 3)).toBe(true);
    expect(queue).toHaveLength(3);
    expect(queue[0]).toBe(head);
    expect(queue[1][0]).toMatchObject({ intervalSeconds: 120, sampledAt: new Date(180_000), metrics: { messageCount: 5, receivedBytes: 50, memoryBytes: null } });
    expect(queue[2][0].sampledAt.getTime()).toBe(240_000);
    expect(queue.flat().reduce((total, input) => total + (input.metrics.messageCount ?? 0), 0)).toBe(10);
    expect(compactBotTelemetryQueue(queue, 3)).toBe(false);
  });

  it("enforces the production 240-snapshot cap without losing cumulative counters", () => {
    const head = sample(1, { commandCount: 1, gatewayPingMs: 10 });
    const queue = [head, ...Array.from({ length: 499 }, (_, index) => sample(index + 2, { commandCount: 1, gatewayPingMs: 10 }))];
    compactBotTelemetryQueue(queue);
    expect(queue).toHaveLength(240);
    expect(queue[0]).toBe(head);
    expect(queue[1][0].metrics.gatewayPingMs).toBeNull();
    expect(queue.flat().reduce((total, input) => total + (input.metrics.commandCount ?? 0), 0)).toBe(500);
    expect(queue.flat().reduce((total, input) => total + input.intervalSeconds, 0)).toBe(30_000);
  });
});

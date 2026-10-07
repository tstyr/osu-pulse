import { Collection, type Client } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ publish: vi.fn(), read: vi.fn(), claim: vi.fn(), finish: vi.fn(), build: vi.fn() }));
vi.mock("../src/services/bot-weekly-report", () => ({
  publishBotWeeklyReportChannels: mocks.publish, readBotWeeklyReportSettings: mocks.read,
  claimBotWeeklyReport: mocks.claim, finishBotWeeklyReport: mocks.finish, buildBotWeeklyReport: mocks.build,
  botWeeklyReportNonce: () => "fixed-report-nonce",
}));
import { dispatchBotWeeklyReport, startBotWeeklyReports } from "./bot-weekly-report";
import { defaultBotWeeklyReportSettings } from "../src/lib/bot-weekly-report";

const settings = { ...defaultBotWeeklyReportSettings(), enabled: true, guildId: "123456789012345678", channelId: "234567890123456789" };
const now = new Date("2026-10-07T03:00:00Z");
const claim = { delivery: { token: "claim-token", attempts: 1 }, schedule: { periodStart: "2026-09-28" } };
function fixture() {
  const permissions = { has: vi.fn().mockReturnValue(true) };
  const guild = { id: settings.guildId, name: "Fixture server", members: { me: {} }, channels: { cache: new Map(), fetch: vi.fn() } };
  const channel = { id: settings.channelId, name: "reports", type: 0, guild, permissionsFor: () => permissions,
    isSendable: () => true, send: vi.fn().mockResolvedValue({ id: "sent-id" }), messages: { fetch: vi.fn().mockResolvedValue(new Collection()) } };
  guild.channels.cache.set(channel.id, channel);
  guild.channels.fetch.mockResolvedValue(channel);
  const client = { isReady: () => true, user: { id: "bot-id" }, guilds: { cache: new Map([[guild.id, guild]]) } } as unknown as Client;
  return { client, guild, channel, permissions };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.publish.mockResolvedValue(undefined); mocks.read.mockResolvedValue({ settings }); mocks.claim.mockResolvedValue(claim);
  mocks.finish.mockResolvedValue(undefined); mocks.build.mockResolvedValue({ title: "Weekly report", footer: { text: "週報ID: fixed-report-nonce" } });
});
afterEach(() => { vi.useRealTimers(); });

describe("weekly report worker", () => {
  it("indexes only sendable channels while leaving the initial disabled configuration silent", async () => {
    const f = fixture(); mocks.read.mockResolvedValue({ settings: defaultBotWeeklyReportSettings() });
    expect(await dispatchBotWeeklyReport(f.client, undefined, now)).toBe(0);
    expect(mocks.publish).toHaveBeenCalledWith([{ id: f.guild.id, name: f.guild.name, channels: [{ id: f.channel.id, name: f.channel.name }] }], now);
    expect(mocks.claim).not.toHaveBeenCalled(); expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("checks the target guild and live channel permission before claiming", async () => {
    const f = fixture(); f.permissions.has.mockReturnValue(false);
    expect(await dispatchBotWeeklyReport(f.client, undefined, now)).toBe(0);
    expect(mocks.claim).not.toHaveBeenCalled(); expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("sends with no mentions and a deterministic enforced nonce, then persists success", async () => {
    const f = fixture();
    expect(await dispatchBotWeeklyReport(f.client, undefined, now)).toBe(1);
    expect(f.channel.send).toHaveBeenCalledWith({ embeds: [{ title: "Weekly report", footer: { text: "週報ID: fixed-report-nonce" } }], allowedMentions: { parse: [] }, nonce: "fixed-report-nonce", enforceNonce: true });
    expect(mocks.finish).toHaveBeenCalledWith("claim-token", true);
  });
  it("does not build or send when another worker owns the lease or the report was sent", async () => {
    const f = fixture(); mocks.claim.mockResolvedValue(null);
    expect(await dispatchBotWeeklyReport(f.client, undefined, now)).toBe(0);
    expect(mocks.build).not.toHaveBeenCalled(); expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("releases a failed send for a later retry", async () => {
    const f = fixture(); f.channel.send.mockRejectedValue(new Error("Discord unavailable"));
    await expect(dispatchBotWeeklyReport(f.client, undefined, now)).rejects.toThrow("Discord unavailable");
    expect(mocks.finish).toHaveBeenCalledWith("claim-token", false);
  });
  it("keeps a sent report leased when DB acknowledgement fails instead of marking it unsent", async () => {
    const f = fixture(); mocks.finish.mockRejectedValue(new Error("DB unavailable"));
    await expect(dispatchBotWeeklyReport(f.client, undefined, now)).rejects.toThrow("DB unavailable");
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledWith("claim-token", true);
  });
  it("recovers a visible report after an interrupted acknowledgement without another send", async () => {
    const f = fixture(); mocks.claim.mockResolvedValue({ ...claim, delivery: { ...claim.delivery, attempts: 2 } });
    const sentAt = new Date("2026-10-05T00:01:00Z");
    f.channel.messages.fetch.mockResolvedValue(new Collection([["sent-id", { author: { id: "bot-id" }, embeds: [{ footer: { text: "週報ID: fixed-report-nonce" } }], createdAt: sentAt }]]));
    expect(await dispatchBotWeeklyReport(f.client, undefined, now)).toBe(0);
    expect(mocks.finish).toHaveBeenCalledWith("claim-token", true, sentAt);
    expect(mocks.build).not.toHaveBeenCalled(); expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("does not collect or send after shutdown begins", async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    expect(await dispatchBotWeeklyReport(f.client, controller.signal, now)).toBe(0);
    expect(mocks.publish).not.toHaveBeenCalled(); expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("bounds shutdown at three seconds and prevents a delayed DB operation from causing a send", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let release: () => void = () => undefined;
    mocks.publish.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const worker = startBotWeeklyReports(f.client);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const stopped = worker.stop();
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(stopped).resolves.toBeUndefined();
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });
});

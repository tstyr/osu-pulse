import { afterEach, describe, expect, it, vi } from "vitest";
import type { Interaction } from "discord.js";
vi.mock("../src/db/feature-repository", () => ({ recordBotError: vi.fn().mockResolvedValue(undefined) }));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn().mockResolvedValue(undefined), appendFile: vi.fn().mockResolvedValue(undefined) }));
import { reportInteractionError } from "./interaction-errors";
import { measureBotCommand, startCommandTelemetry } from "./command-telemetry";

let monitor: ReturnType<typeof startCommandTelemetry> | undefined;
afterEach(() => { monitor?.stop(); monitor = undefined; vi.restoreAllMocks(); });
function interaction() {
  return { commandName: "osu", guildId: "123456789012345678", options: { getSubcommandGroup: () => null, getSubcommand: () => "growth" },
    reply: vi.fn().mockResolvedValue("reply-result"), deferReply: vi.fn().mockResolvedValue("defer-result"),
    isCommand: () => true, isAutocomplete: () => false, isRepliable: () => true, user: { id: "not-persisted" },
    isMessageComponent: () => false, isModalSubmit: () => false, deferred: false, replied: false, ephemeral: null,
  };
}

describe("Command observability", () => {
  it("separates successful initial ACK from handler completion and restores methods", async () => {
    monitor = startCommandTelemetry();
    const source = interaction(); const originalReply = source.reply; let now = 0;
    expect(await measureBotCommand(source, async () => {
      now = 12; expect(await source.reply()).toBe("reply-result");
      now = 200; return "handler-result";
    }, () => now)).toBe("handler-result");
    const snapshot = monitor.drain();
    expect(snapshot.global["osu growth"]).toMatchObject({ attempts: 1, failures: 0, completed: 1, durationMsTotal: 200, acknowledged: 1, ackMsTotal: 12 });
    expect(snapshot.guilds.get(source.guildId)?.["osu growth"]).toEqual(snapshot.global["osu growth"]);
    expect(source.reply).toBe(originalReply);
    expect(JSON.stringify(snapshot)).not.toContain("not-persisted");
    expect(monitor.drain().global).toEqual({});
  });

  it("counts errors swallowed by reportInteractionError as failures", async () => {
    monitor = startCommandTelemetry();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const source = interaction(); let now = 0;
    await measureBotCommand(source, async () => {
      try { throw new Error("failed handler"); }
      catch (error) { now = 50; await reportInteractionError(source as unknown as Interaction, error); }
      now = 70;
    }, () => now);
    expect(monitor.drain().global["osu growth"]).toMatchObject({ attempts: 1, failures: 1, completed: 1, durationMsTotal: 70, acknowledged: 1, ackMsTotal: 50 });
  });

  it("preserves thrown failures and never treats missing/failed ACK as zero milliseconds", async () => {
    monitor = startCommandTelemetry();
    const source = interaction(); const failure = new Error("ACK failed"); source.reply.mockRejectedValue(failure);
    await expect(measureBotCommand(source, async () => { await source.reply(); })).rejects.toBe(failure);
    expect(monitor.drain().global["osu growth"]).toMatchObject({ failures: 1, acknowledged: 0, ackMsTotal: 0 });
    await measureBotCommand(source, async () => undefined);
    expect(monitor.drain().global["osu growth"]).toMatchObject({ failures: 0, acknowledged: 0 });
  });

  it("does not split unfinished execution counts across a sample boundary", async () => {
    monitor = startCommandTelemetry();
    const source = interaction(); let complete!: () => void;
    const pending = measureBotCommand(source, async () => { await new Promise<void>((resolve) => { complete = resolve; }); });
    expect(monitor.drain().global).toEqual({});
    complete(); await pending;
    expect(monitor.drain().global["osu growth"]).toMatchObject({ attempts: 1, completed: 1 });
  });
});

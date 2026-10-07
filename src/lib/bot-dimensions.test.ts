import { describe, expect, it } from "vitest";
import { emptyBotCommandCounters, mergeBotDimensions, sanitizeBotDimensions, validBotCommandName } from "./bot-dimensions";

describe("Bot telemetry dimensions", () => {
  it("allows registered command structure but rejects URLs and option payloads", () => {
    expect(validBotCommandName("osu growth")).toBe(true);
    expect(validBotCommandName("music playlist add")).toBe(true);
    expect(validBotCommandName("認証")).toBe(true);
    for (const value of ["https://discord.com/?token=secret", "osu user@email", "name\nsecret", "x".repeat(121)]) expect(validBotCommandName(value)).toBe(false);
    const input = { commands: { "osu growth": { ...emptyBotCommandCounters(), attempts: 2, completed: 2, failures: 8, durationMsTotal: 50, durationMsMax: 40, token: "SECRET" }, "https://host": {} }, services: { discord: { receivedBytes: 42, sentBytes: NaN, url: "SECRET" }, unknownHost: { receivedBytes: 7 } } };
    const clean = sanitizeBotDimensions(input);
    expect(clean.commands["osu growth"]).toMatchObject({ attempts: 2, failures: 2, completed: 2, durationMsTotal: 50, durationMsMax: 40 });
    expect(clean.services).toEqual({ discord: { receivedBytes: 42, sentBytes: 0 } });
    expect(JSON.stringify(clean)).not.toContain("SECRET");
    expect(clean.commands).not.toHaveProperty("https://host");
  });

  it("merges sum counters while preserving maxima and unknown dimensions", () => {
    const left = { commands: { ping: { ...emptyBotCommandCounters(), attempts: 1, completed: 1, durationMsTotal: 50, durationMsMax: 50, acknowledged: 1, ackMsTotal: 10, ackMsMax: 10 } }, services: { local: { receivedBytes: 2, sentBytes: 3 } } };
    const right = { commands: { ping: { ...emptyBotCommandCounters(), attempts: 2, completed: 2, failures: 1, durationMsTotal: 60, durationMsMax: 40, acknowledged: 1, ackMsTotal: 20, ackMsMax: 20 } }, services: { local: { receivedBytes: 5, sentBytes: 7 } } };
    const result = mergeBotDimensions(left, right);
    expect(result.commands.ping).toMatchObject({ attempts: 3, completed: 3, failures: 1, durationMsTotal: 110, durationMsMax: 50, acknowledged: 2, ackMsTotal: 30, ackMsMax: 20 });
    expect(result.services.local).toEqual({ receivedBytes: 7, sentBytes: 10 });
    expect(left.commands.ping.attempts).toBe(1);
    expect(sanitizeBotDimensions(undefined)).toEqual({ commands: {}, services: {} });
  });
});

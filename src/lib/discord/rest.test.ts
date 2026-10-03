import { afterEach, describe, expect, it, vi } from "vitest";
import { sendDiscordChannelMessage } from "./rest";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Discord delivery recovery", () => {
  it("retries a short rate limit and supplies a request deadline", async () => {
    vi.stubEnv("DISCORD_TOKEN", "test-token");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 0 }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "sent" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendDiscordChannelMessage("channel", { content: "result" })).resolves.toEqual({ id: "sent" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it("does not hold the entire outbox behind a long rate limit", async () => {
    vi.stubEnv("DISCORD_TOKEN", "test-token");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ retry_after: 3600 }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendDiscordChannelMessage("channel", { content: "result" })).rejects.toThrow("rate limit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

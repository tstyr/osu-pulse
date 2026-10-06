import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), statistics: vi.fn() }));
vi.mock("@/lib/control/auth", () => ({ hasControlPanelSession: mocks.session }));
vi.mock("@/services/bot-statistics", () => ({ getBotStatistics: mocks.statistics }));
vi.mock("@/lib/bot-statistics", () => ({ BOT_STATISTICS_RANGES: ["today", "week", "month", "all"] }));

import { GET } from "./route";

beforeEach(() => {
  mocks.session.mockReset().mockResolvedValue(true);
  mocks.statistics.mockReset().mockResolvedValue({ range: "today", scope: "global", points: [] });
});

describe("private Bot statistics API", () => {
  it("requires authentication before accessing statistics", async () => {
    mocks.session.mockResolvedValue(false);
    const response = await GET(new Request("https://example.test/api/control/bot-statistics"));
    expect(response.status).toBe(401);
    expect(mocks.statistics).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("defaults to today's global scope and prevents public caching", async () => {
    const response = await GET(new Request("https://example.test/api/control/bot-statistics"));
    expect(response.status).toBe(200);
    expect(mocks.statistics).toHaveBeenCalledWith({ range: "today", scope: "global" });
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("accepts the all-time view of one guild", async () => {
    const response = await GET(new Request("https://example.test/api/control/bot-statistics?range=all&scope=guild:123456789012345678"));
    expect(response.status).toBe(200);
    expect(mocks.statistics).toHaveBeenCalledWith({ range: "all", scope: "guild:123456789012345678" });
  });
  it.each(["range=invalid", "scope=123", "scope=guild:123", "scope=guild:abc", "scope=guild:123456789012345678901", "scope="])("rejects invalid selectors: %s", async (query) => {
    const response = await GET(new Request(`https://example.test/api/control/bot-statistics?${query}`));
    expect(response.status).toBe(400);
    expect(mocks.statistics).not.toHaveBeenCalled();
  });
  it("returns a retryable error without exposing database details", async () => {
    mocks.statistics.mockRejectedValue(new Error("internal query details"));
    const response = await GET(new Request("https://example.test/api/control/bot-statistics"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("internal query details");
  });
});

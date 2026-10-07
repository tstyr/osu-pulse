import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), get: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/control/auth", () => ({ hasControlPanelSession: mocks.session }));
vi.mock("@/lib/public-app-url", () => ({ publicAppOrigin: () => "https://osu-pulse.example.test" }));
vi.mock("@/lib/bot-weekly-report", () => import("../../../../../lib/bot-weekly-report"));
vi.mock("@/services/bot-weekly-report", () => ({
  getBotWeeklyReportConfiguration: mocks.get, saveBotWeeklyReportSettings: mocks.save,
  BotWeeklyReportDestinationError: class extends Error {},
}));
import { GET, PUT } from "./route";
import { defaultBotWeeklyReportSettings } from "../../../../../lib/bot-weekly-report";
const settings = defaultBotWeeklyReportSettings();
const request = (origin: string | null = "https://osu-pulse.example.test", body: unknown = settings, contentType = "application/json") => new Request("http://localhost:3000/api/control/bot-statistics/report", {
  method: "PUT", headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": contentType }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.mockResolvedValue(true); mocks.get.mockResolvedValue({ settings }); mocks.save.mockResolvedValue({ settings });
});

describe("private weekly report settings API", () => {
  it("requires authentication for reads and writes", async () => {
    mocks.session.mockResolvedValue(false);
    expect((await GET()).status).toBe(401);
    expect((await PUT(request())).status).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("keeps settings and channel candidates out of shared caches", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });
  it.each([null, "https://attacker.example", "https://osu-pulse.example.test/path", "null"])("rejects CSRF origin %s", async (origin) => {
    expect((await PUT(request(origin))).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("requires JSON and validates values before storing", async () => {
    expect((await PUT(request(undefined, settings, "text/plain"))).status).toBe(403);
    expect((await PUT(request(undefined, { ...settings, enabled: true }))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("accepts configured public origin when the route is behind the local proxy", async () => {
    expect((await PUT(request())).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(settings);
  });
  it("never exposes database or secret details when a save fails", async () => {
    mocks.save.mockRejectedValue(new Error("postgres://secret user:password"));
    const response = await PUT(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("password");
  });
});

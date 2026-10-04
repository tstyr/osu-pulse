import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import type { RendererHealth, RenderJobStatus } from "./renderer-client";

const mocks = vi.hoisted(() => ({ accounts: vi.fn(), scores: vi.fn(), health: vi.fn(), submit: vi.fn(), getJob: vi.fn(), share: vi.fn(), cancel: vi.fn() }));
vi.mock("node:fs", () => ({ mkdirSync: vi.fn(), readFileSync: () => { throw new Error("test cache is empty"); }, renameSync: vi.fn(), writeFileSync: vi.fn() }));
vi.mock("../src/db/repository", () => ({ getAccountsByDiscord: mocks.accounts, listDiscordAccountAssignments: vi.fn() }));
vi.mock("../src/lib/osu/client", () => ({ getRecentScores: mocks.scores }));
vi.mock("../src/lib/control/settings", () => ({ getControlSettings: vi.fn() }));
vi.mock("../src/db/render-queue-repository", () => ({ createCloudRenderBatch: vi.fn() }));
vi.mock("../src/lib/public-app-url", () => ({ publicAppUrl: (path: string) => `https://osu-pulse.example${path}` }));
vi.mock("./renderer-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./renderer-client")>();
  return { ...actual, RendererClient: class { health = mocks.health; submitScore = mocks.submit; getJob = mocks.getJob; shareVideo = mocks.share; cancel = mocks.cancel; } };
});

import { downloadComponents, handleRenderCommand } from "./render";
import { RendererClientError } from "./renderer-client";

const ready = { status: "degraded", ffmpeg: true, osu_songs: true, songs_index_ready: true, osu_api: true, danser: false, standard_skin: false, mania_renderer: true, mania_skin: true } as RendererHealth;
const completed = { job_id: "job", status: "completed", progress: 100, message: "completed", queue_position: null, priority: 0, estimated_wait_seconds: 0, estimated_render_seconds: 120, metadata: null, options: { resolution: "1920x1080", fps: 60, speed: "original", motion_blur: false, highlight: false }, youtube_url: "https://youtu.be/abcdefghijk", youtube_privacy_status: "public", highlight_available: false, render_duration_seconds: null } as RenderJobStatus;
let userSequence = 0;
function interaction(account?: string) {
  const message = { edit: vi.fn().mockResolvedValue(undefined) };
  const input = {
    user: { id: `test-user-${userSequence++}` }, deferred: false, replied: false,
    options: { getString: (name: string) => name === "account" ? account ?? null : name === "url" && !account ? "https://osu.ppy.sh/scores/mania/123" : null, getAttachment: () => null, getInteger: () => null, getBoolean: () => null },
    deferReply: vi.fn(async () => { input.deferred = true; }),
    reply: vi.fn(), editReply: vi.fn().mockResolvedValue(message), fetchReply: vi.fn().mockResolvedValue(message),
  };
  return { input: input as unknown as ChatInputCommandInteraction, message, defer: input.deferReply, editReply: input.editReply };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.health.mockResolvedValue(ready);
  mocks.submit.mockResolvedValue({ job_id: "job" });
  mocks.getJob.mockResolvedValue(completed);
  mocks.share.mockResolvedValue({ provider: "youtube", url: "https://youtu.be/abcdefghijk", size: 123 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("Discord render workflow", () => {
  it("acknowledges account commands before waiting for DB/API and does not defer twice", async () => {
    const f = interaction("mania:123");
    mocks.accounts.mockImplementation(async () => {
      expect(f.defer).toHaveBeenCalledTimes(1);
      return [{ osuUserId: 12, username: "player" }];
    });
    mocks.scores.mockImplementation(async (_user: number, ruleset: string) => ruleset === "mania" ? [{ id: 123, has_replay: true, pp: 100, rank: "A", beatmap: { id: 1, version: "4K" }, beatmapset: { artist: "Artist", title: "Song" }, ended_at: new Date().toISOString() }] : []);
    await handleRenderCommand(f.input);
    expect(f.defer).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it("displays a YouTube link when sharing retry returns a newly uploaded video", async () => {
    mocks.getJob.mockResolvedValue({ ...completed, youtube_url: null });
    const f = interaction();
    await handleRenderCommand(f.input);
    const payload = f.message.edit.mock.calls.at(-1)?.[0];
    expect(payload.content).toContain("YouTubeへ投稿しました");
    expect(payload.components[0].toJSON().components[0].url).toBe("https://youtu.be/abcdefghijk");
  });

  it("retries one transient status timeout and recovers instead of abandoning the job", async () => {
    vi.useFakeTimers();
    mocks.getJob.mockRejectedValueOnce(new RendererClientError("RENDERER_TIMEOUT", "timeout")).mockResolvedValue(completed);
    const f = interaction();
    const running = handleRenderCommand(f.input);
    await vi.advanceTimersByTimeAsync(4_000);
    await running;
    expect(mocks.getJob).toHaveBeenCalledTimes(2);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(f.message.edit.mock.calls.at(-1)?.[0].content).toContain("YouTubeへ投稿しました");
  });

  it("does not cancel long renders when the Bot monitoring deadline expires", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RENDER_POLL_TIMEOUT_MS", "1");
    vi.stubEnv("RENDER_POLL_INTERVAL_MS", "10");
    mocks.getJob.mockResolvedValue({ ...completed, status: "rendering", youtube_url: null });
    const f = interaction();
    const running = handleRenderCommand(f.input);
    await vi.advanceTimersByTimeAsync(10);
    await running;
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(f.message.edit.mock.calls.at(-1)?.[0].content).toContain("レンダリングは継続");
  });

  it("does not edit a deleted progress message again or cancel its render", async () => {
    const f = interaction();
    f.message.edit.mockRejectedValueOnce(Object.assign(new Error("Unknown Message"), { code: 10008 }));
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(handleRenderCommand(f.input)).resolves.toBeUndefined();
      expect(f.message.edit).toHaveBeenCalledTimes(1);
      expect(mocks.cancel).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it("shows actionable storage guidance when the USB goes offline after the health check", async () => {
    mocks.submit.mockRejectedValue(new RendererClientError("STORAGE_UNAVAILABLE", "storage offline", 503));
    const f = interaction();
    await handleRenderCommand(f.input);
    expect(f.message.edit.mock.calls.at(-1)?.[0].content).toContain("OSU_PULSEを接続・マウント");
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("does not build empty action rows and preserves YouTube links for long storage URLs", () => {
    expect(downloadComponents("invalid-youtube", null, "youtube")).toEqual([]);
    expect(downloadComponents("https://storage.example/" + "a".repeat(512), "https://youtu.be/abcdefghijk", "r2")[0].toJSON().components).toHaveLength(1);
  });
});

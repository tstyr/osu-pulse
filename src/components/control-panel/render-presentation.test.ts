import { describe, expect, it } from "vitest";
import { formatRenderTime, missingRenderDependencies, readRenderResponse, renderOperationError, renderPhase, renderPollingInterval, renderRuntimeHealth, renderSourceLabel, youtubeOutcome, youtubeVideoUrl } from "./render-presentation";

describe("render UI presentation", () => {
  it("separates render completion from YouTube success", () => {
    expect(youtubeOutcome({ status: "completed", progress: 100, videoUrl: "https://example.com/video.mp4" }).kind).toBe("unconfirmed");
    expect(youtubeOutcome({ status: "completed", progress: 100, metadata: { youtube_error: "quota exceeded" } }).kind).toBe("failed");
    expect(youtubeOutcome({ status: "completed", progress: 100, videoUrl: "https://youtu.be/abc", metadata: { youtube_privacy_status: "unlisted" } }).label).toContain("限定公開");
  });
  it("prefers a confirmed YouTube link over an earlier upload error", () => {
    expect(youtubeOutcome({ status: "completed", progress: 100, metadata: { youtube_url: "https://www.youtube.com/watch?v=abc", youtube_error: "old failure" } }).kind).toBe("uploaded");
    expect(youtubeVideoUrl("https://youtube.com.evil.test/watch?v=abc")).toBeNull();
    expect(youtubeVideoUrl("javascript:alert(1)")).toBeNull();
  });
  it("does not label unknown privacy as public or uploads as completed", () => {
    expect(youtubeOutcome({ status: "completed", progress: 100, videoUrl: "https://youtu.be/abc" }).label).toContain("公開範囲未確認");
    expect(youtubeOutcome({ status: "uploading", progress: 99 }).kind).toBe("uploading");
  });
  it("stops terminal polling and slows queued or upload checks", () => {
    expect(renderPollingInterval({ status: "completed" })).toBe(0);
    expect(renderPollingInterval({ status: "failed" })).toBe(0);
    expect(renderPollingInterval({ status: "queued" })).toBe(8_000);
    expect(renderPollingInterval({ status: "uploading" })).toBe(5_000);
    expect(renderPollingInterval({ status: "rendering" })).toBe(2_500);
  });
  it("keeps cancellation pending until the renderer confirms it and clamps progress", () => {
    expect(renderPhase({ status: "rendering", progress: 120, cancelRequested: true }).label).toBe("キャンセル要求中");
    expect(renderPhase({ status: "cancelled", progress: 5, cancelRequested: true }).label).toBe("キャンセル済み");
    expect(renderPhase({ status: "rendering", progress: NaN }).progress).toBe(0);
  });
  it("shows only explicitly missing dependencies, not unknown probe values", () => {
    expect(missingRenderDependencies({ ffmpeg: false, danser: true })).toEqual(["FFmpeg"]);
    expect(missingRenderDependencies({})).toEqual([]);
    expect(renderSourceLabel({ status: "queued", progress: 0, requestSource: "automatic", scheduledAt: "2026-10-05T21:00:00Z" })).toBe("自動");
    expect(formatRenderTime("invalid")).toBe("—");
  });
  it("retains API diagnostic codes and handles non-JSON proxy responses", async () => {
    await expect(readRenderResponse(new Response(JSON.stringify({ error: "設定不足", errorCode: "INVALID_OPTIONS" }), { status: 400 }), "失敗")).rejects.toThrow("設定不足 [INVALID_OPTIONS]");
    await expect(readRenderResponse(new Response("<html>unavailable</html>", { status: 503 }), "送信できません")).rejects.toThrow("送信できません（HTTP 503）");
    await expect(readRenderResponse(new Response("invalid", { status: 200 }), "失敗")).rejects.toThrow("受付済みか確認");
  });
  it("uses realtime USB and YouTube health instead of cached prerequisite readiness", () => {
    const health = renderRuntimeHealth({ youtube_upload: true, render_stats: { storage: { available: false, songs_available: false, output_available: true }, youtube: { enabled: true, configured: true, auth_status: "reauthorization_required", pending_count: 3, last_error: "invalid_grant" } } });
    expect(health.storageAvailable).toBe(false);
    expect(health.youtubeAuthStatus).toBe("reauthorization_required");
    expect(health.youtubePendingCount).toBe(3);
    expect(renderRuntimeHealth({}).storageAvailable).toBeNull();
    expect(renderRuntimeHealth({ youtube_upload: true }).youtubeAuthStatus).toBeNull();
  });
  it("does not recommend blind resubmission after an ambiguous timeout", () => {
    const error = new Error("timed out"); error.name = "TimeoutError";
    expect(renderOperationError(error, "失敗")).toContain("重複送信を避ける");
    expect(renderOperationError(new Error("明確なエラー"), "失敗")).toBe("明確なエラー");
  });
});

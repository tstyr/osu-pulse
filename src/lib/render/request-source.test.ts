import { describe, expect, it } from "vitest";
import { automaticRenderingAllowed, renderRequestSource } from "./request-source";

describe("render request policy", () => {
  it("retains an automatic request's origin after progress messages change", () => {
    expect(renderRequestSource({ metadata: { request_source: "automatic" }, message: "エンコード中" })).toBe("automatic");
  });

  it("recognizes legacy automatic jobs and manual/scheduled requests", () => {
    expect(renderRequestSource({ message: "自動レンダーを待機列へ追加" })).toBe("automatic");
    expect(renderRequestSource({ message: "予約時刻まで待機中", scheduledAt: "2026-10-01" })).toBe("scheduled");
    expect(renderRequestSource({ message: "レンダリング待機中" })).toBe("manual");
  });

  it("honors the renderer's idle/time-window denial without blocking legacy renderers", () => {
    expect(automaticRenderingAllowed({ start_policy: { allowed: false } })).toBe(false);
    expect(automaticRenderingAllowed({ render_stats: { start_policy: { allowed: false } } })).toBe(false);
    expect(automaticRenderingAllowed({ start_policy: { allowed: true } })).toBe(true);
    expect(automaticRenderingAllowed({})).toBe(true);
  });
});

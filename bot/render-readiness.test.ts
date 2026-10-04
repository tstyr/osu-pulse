import { describe, expect, it } from "vitest";
import type { RendererHealth } from "./renderer-client";
import { renderMissingDependencies } from "./render-readiness";

const health = { ffmpeg: true, osu_songs: true, songs_index_ready: true, osu_api: true, danser: true, standard_skin: true, mania_renderer: true, mania_skin: true } as RendererHealth;

describe("per-mode render readiness", () => {
  it("allows mania when the standard renderer or standard skin is absent", () => {
    expect(renderMissingDependencies({ ...health, danser: false, standard_skin: false }, true, "mania")).toEqual([]);
  });
  it("allows standard when the mania renderer or mania skin is absent", () => {
    expect(renderMissingDependencies({ ...health, mania_renderer: false, mania_skin: false }, true, "osu")).toEqual([]);
  });
  it("requires only the requested mode and permits offline replay rendering", () => {
    expect(renderMissingDependencies({ ...health, mania_skin: false, osu_api: false }, false, "mania")).toEqual(["R Skin"]);
    expect(renderMissingDependencies({ ...health, osu_api: false }, true)).toEqual(["osu! API credentials"]);
  });
  it("identifies an unavailable USB instead of listing unrelated dependencies", () => {
    expect(renderMissingDependencies({ ...health, render_stats: { storage: { available: false, songs_available: false, output_available: false } } } as RendererHealth, true, "mania")).toEqual(["USB共有ストレージ（OSU_PULSEを接続・マウントしてください）"]);
  });
});

import type { RendererHealth } from "./renderer-client";

/** Check only dependencies required by the requested mode. The server resolves unknown modes. */
export function renderMissingDependencies(health: RendererHealth, requiresApi: boolean, ruleset?: "osu" | "mania") {
  if (health.render_stats?.storage?.available === false) {
    return ["USB共有ストレージ（OSU_PULSEを接続・マウントしてください）"];
  }
  return [
    !health.ffmpeg && "FFmpeg",
    !health.osu_songs && "osu! Songs",
    !health.songs_index_ready && "Songs Index",
    requiresApi && !health.osu_api && "osu! API credentials",
    ruleset === "osu" && !health.danser && "danser",
    ruleset === "osu" && !health.standard_skin && "Appu Skin",
    ruleset === "mania" && !health.mania_renderer && "mania Renderer",
    ruleset === "mania" && !health.mania_skin && "R Skin",
  ].filter((value): value is string => typeof value === "string");
}

import { z } from "zod";

import type { ControlPanelSettingsValue } from "../../db/schema";
import { RENDER_FPS, RENDER_RESOLUTIONS, RENDER_SPEEDS } from "../render/constants";

export const AUTO_RENDER_RANKS = ["XH", "X", "SH", "S", "A", "B", "C", "D", "F"] as const;
export const AUTO_RENDER_MODES = ["osu", "mania"] as const;

const boolFromForm = z.preprocess(
  (value) => value === true || value === "true" || value === "on" || value === "1",
  z.boolean(),
);

export const autoRenderSettingsSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const settings = value as Record<string, unknown>;
  return {
    ...settings,
    discordUserIds: settings.discordUserIds ?? (
      typeof settings.discordUserId === "string" ? [settings.discordUserId] : []
    ),
    osuUserIds: settings.osuUserIds ?? [],
    personalBestOnly: settings.personalBestOnly ?? false,
  };
}, z.object({
  enabled: boolFromForm,
  personalBestOnly: boolFromForm,
  discordUserIds: z.array(z.string().regex(/^\d{17,20}$/)).max(25),
  osuUserIds: z.array(z.string().regex(/^\d{1,10}$/)).max(25),
  ranks: z.array(z.enum(AUTO_RENDER_RANKS)).min(1),
  modes: z.array(z.enum(AUTO_RENDER_MODES)).min(1),
  minimumPp: z.coerce.number().min(0).max(2_000),
  minimumAccuracy: z.coerce.number().min(0).max(100),
  resolution: z.enum(RENDER_RESOLUTIONS),
  fps: z.coerce.number().pipe(z.union(RENDER_FPS.map((fps) => z.literal(fps)))),
  speed: z.enum(RENDER_SPEEDS),
  motionBlur: boolFromForm,
}).refine(
  (settings) => !settings.enabled || settings.discordUserIds.length + settings.osuUserIds.length > 0,
  { message: "自動レンダー対象を1件以上指定してください。" },
));

export type AutoRenderSettings = ControlPanelSettingsValue["autoRender"];

export function defaultAutoRenderSettings(): AutoRenderSettings {
  return {
    enabled: true,
    personalBestOnly: false,
    discordUserIds: ["974264083853492234"],
    osuUserIds: ["40389660"],
    ranks: ["A"],
    modes: ["osu", "mania"],
    minimumPp: 0,
    minimumAccuracy: 0,
    resolution: "1920x1080",
    fps: 60,
    speed: "original",
    motionBlur: false,
  };
}

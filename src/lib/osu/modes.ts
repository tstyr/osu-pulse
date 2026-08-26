export const OSU_MODES = ["osu", "taiko", "fruits", "mania"] as const;

export type OsuMode = (typeof OSU_MODES)[number];

export const MODE_LABELS: Record<OsuMode, string> = {
  osu: "osu!",
  taiko: "taiko",
  fruits: "catch",
  mania: "mania",
};

export const MODE_ACCENTS: Record<OsuMode, string> = {
  osu: "#ff66aa",
  taiko: "#ff7a59",
  fruits: "#80d94e",
  mania: "#8c7cff",
};

export function isOsuMode(value: string | null | undefined): value is OsuMode {
  return OSU_MODES.includes(value as OsuMode);
}

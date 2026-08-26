import type { OsuMode } from "./osu/modes";

export const demoProfile = {
  id: "demo",
  osuUserId: 7562902,
  username: "pulse_demo",
  countryCode: "JP",
  avatarUrl: null,
  primaryMode: "osu" as OsuMode,
};

const modeBase = {
  osu: { pp: 12842, rank: 6421, countryRank: 318, accuracy: 98.41, plays: 18324 },
  taiko: { pp: 5240, rank: 12582, countryRank: 541, accuracy: 97.86, plays: 4821 },
  fruits: { pp: 3778, rank: 9217, countryRank: 402, accuracy: 99.04, plays: 2917 },
  mania: { pp: 7014, rank: 11083, countryRank: 762, accuracy: 96.92, plays: 7230 },
} satisfies Record<
  OsuMode,
  { pp: number; rank: number; countryRank: number; accuracy: number; plays: number }
>;

export function demoModeStats(mode: OsuMode) {
  return modeBase[mode];
}

export function demoGrowth(mode: OsuMode, days = 28) {
  const base = modeBase[mode];
  return Array.from({ length: days }, (_, index) => {
    const lift = index * (mode === "osu" ? 14.3 : 6.7);
    const wave = Math.sin(index / 2.4) * 20 + Math.cos(index / 5) * 12;
    return {
      date: `8/${String(index + 1).padStart(2, "0")}`,
      fullDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
      pp: Math.round((base.pp - days * 14 + lift + wave) * 10) / 10,
      rank: Math.max(1, Math.round(base.rank + (days - index) * 38 - wave * 3)),
      accuracy: Math.round((base.accuracy - 0.25 + index * 0.008) * 100) / 100,
      playCount: base.plays - (days - index) * 23,
    };
  });
}

export const demoRecentPlays = [
  {
    id: "1",
    rank: "S",
    artist: "YOASOBI",
    title: "勇者",
    difficulty: "Luminance",
    pp: 327.4,
    accuracy: 0.9881,
    maxCombo: 1124,
    mods: ["HD", "DT"],
    endedAt: new Date("2026-08-27T11:42:00Z"),
  },
  {
    id: "2",
    rank: "A",
    artist: "xi",
    title: "FREEDOM DiVE",
    difficulty: "FOUR DIMENSIONS",
    pp: 284.8,
    accuracy: 0.9724,
    maxCombo: 816,
    mods: ["HR"],
    endedAt: new Date("2026-08-27T10:18:00Z"),
  },
  {
    id: "3",
    rank: "SS",
    artist: "Ado",
    title: "唱",
    difficulty: "Master",
    pp: 241.1,
    accuracy: 1,
    maxCombo: 742,
    mods: ["HD"],
    endedAt: new Date("2026-08-27T09:51:00Z"),
  },
  {
    id: "4",
    rank: "S",
    artist: "Camellia",
    title: "Exit This Earth's Atomosphere",
    difficulty: "Evolution",
    pp: 219.6,
    accuracy: 0.9867,
    maxCombo: 1040,
    mods: [],
    endedAt: new Date("2026-08-26T15:12:00Z"),
  },
];

import type { OsuMode } from "./modes";

export type OsuLevel = {
  current: number;
  progress: number;
};

export type OsuStatistics = {
  count_100?: number;
  count_300?: number;
  count_50?: number;
  count_miss?: number;
  country_rank: number | null;
  global_rank: number | null;
  grade_counts?: Record<string, number>;
  hit_accuracy: number;
  is_ranked?: boolean;
  level: OsuLevel;
  maximum_combo?: number;
  play_count: number;
  play_time?: number;
  pp: number;
  ranked_score: number | string;
  replays_watched_by_others?: number;
  total_hits?: number;
  total_score: number | string;
};

export type OsuUser = {
  id: number;
  username: string;
  avatar_url: string;
  country_code: string;
  playmode: OsuMode;
  statistics: OsuStatistics | null;
};

export type OsuBeatmap = {
  id: number;
  beatmapset_id?: number;
  difficulty_rating?: number;
  version: string;
};

export type OsuBeatmapset = {
  id: number;
  artist: string;
  title: string;
  creator: string;
  covers?: {
    cover?: string;
    "cover@2x"?: string;
    list?: string;
  };
};

export type OsuScore = {
  id: number | string;
  has_replay?: boolean;
  accuracy: number;
  pp: number | null;
  rank: string;
  max_combo: number | null;
  total_score?: number | string;
  score?: number | string;
  ended_at?: string;
  created_at?: string;
  passed?: boolean;
  ruleset?: OsuMode;
  mode?: OsuMode;
  mods?: Array<string | { acronym: string }>;
  beatmap: OsuBeatmap;
  beatmapset?: OsuBeatmapset;
};

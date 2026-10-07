import type { BotMetricKey, BotMetricValues, BotStatisticsData, BotStatisticsRange } from "./bot-statistics";

export type BotComparisonMetric = {
  metric: BotMetricKey;
  label: string;
  aggregation: "total" | "average" | "latest";
  current: number | null;
  previous: number | null;
  change: number | null;
  changePercent: number | null;
  status: "ready" | "insufficient" | "zero_baseline";
};

/** Weekdays are JST Monday=0 through Sunday=6. Null is not an observed zero. */
export type BotHeatmapCell = {
  weekday: number;
  hour: number;
  plays: number | null;
  messages: number | null;
  voiceMemberSeconds: number | null;
  averagePlays: number | null;
  averageMessages: number | null;
  averageVoiceMemberSeconds: number | null;
  playDays: number;
  messageDays: number;
  voiceDays: number;
};

export type BotInsights = {
  comparison: {
    status: "ready" | "insufficient" | "not_applicable";
    label: string;
    from: string | null;
    to: string | null;
    elapsedSeconds: number;
    currentCoveragePercent: number | null;
    previousCoveragePercent: number | null;
    metrics: BotComparisonMetric[];
    note: string;
  };
  heatmap: {
    status: "ready" | "unavailable";
    timezone: "Asia/Tokyo";
    cells: BotHeatmapCell[];
    notes: string[];
  };
  disk: {
    status: "ready" | "insufficient" | "not_applicable" | "non_growing";
    usedBytes: number | null;
    totalBytes: number | null;
    freeBytes: number | null;
    usedPercent: number | null;
    bytesPerDay: number | null;
    daysUntilFull: number | null;
    projectedFullAt: string | null;
    observedDays: number;
    observations: number;
    from: string | null;
    to: string | null;
    cleanupCount: number;
    note: string;
  };
  anomalies: {
    status: "ready" | "insufficient";
    checkedAt: string;
    observationCount: number;
    baselineObservationCount: number;
    findings: Array<{
      metric: BotMetricKey;
      level: "warning" | "critical";
      current: number;
      baseline: number;
      threshold: number;
      since: string;
      note: string;
    }>;
    notes: string[];
  };
};

export type BotInsightsInput = {
  range: BotStatisticsRange;
  scope: string;
  from: Date | string;
  to: Date | string;
  summary: BotStatisticsData["summary"];
  points: BotStatisticsData["points"];
  coverage?: Pick<BotStatisticsData["coverage"], "sampleCount" | "observedSeconds">;
};

export type BotInsightSample = {
  at: string;
  sessionId: string;
  intervalSeconds: number;
  metrics: BotMetricValues;
};

export type BotDiskObservation = { at: string; usedBytes: number; totalBytes: number };
export type BotDiskHistory = {
  points: BotDiskObservation[];
  observations: number;
  segmentFrom: string | null;
  lastSampleAt: string | null;
};

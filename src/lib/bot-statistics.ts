export const BOT_STATISTICS_RANGES = ["today", "week", "month", "all"] as const;
export type BotStatisticsRange = typeof BOT_STATISTICS_RANGES[number];

export const BOT_STATISTIC_METRICS = {
  receivedBytes: { label: "Bot TCP受信量", unit: "bytes", kind: "delta", group: "network" },
  sentBytes: { label: "Bot TCP送信量", unit: "bytes", kind: "delta", group: "network" },
  externalReceivedBytes: { label: "外部受信量", unit: "bytes", kind: "delta", group: "network" },
  externalSentBytes: { label: "外部送信量", unit: "bytes", kind: "delta", group: "network" },
  localReceivedBytes: { label: "ローカル受信量", unit: "bytes", kind: "delta", group: "network" },
  localSentBytes: { label: "ローカル送信量", unit: "bytes", kind: "delta", group: "network" },
  receiveBps: { label: "受信速度", unit: "bytesPerSecond", kind: "gauge", group: "network" },
  sendBps: { label: "送信速度", unit: "bytesPerSecond", kind: "gauge", group: "network" },
  gatewayPingMs: { label: "Gateway Ping", unit: "ms", kind: "gauge", group: "latency" },
  discordApiPingMs: { label: "Discord API Ping", unit: "ms", kind: "gauge", group: "latency" },
  dbPingMs: { label: "DB Ping", unit: "ms", kind: "gauge", group: "latency" },
  guildCount: { label: "参加サーバー数", unit: "count", kind: "gauge", group: "community" },
  memberCount: { label: "サーバー人数", unit: "people", kind: "gauge", group: "community" },
  voiceMembers: { label: "VC接続人数", unit: "people", kind: "gauge", group: "community" },
  voiceChannels: { label: "使用中VC数", unit: "count", kind: "gauge", group: "community" },
  activeDiscordUsers: { label: "Discordアクティブ人数", unit: "people", kind: "gauge", group: "community" },
  messageCount: { label: "受信メッセージ数", unit: "count", kind: "delta", group: "activity" },
  commandCount: { label: "コマンド実行数", unit: "count", kind: "delta", group: "activity" },
  voiceMemberSeconds: { label: "VC延べ接続時間", unit: "seconds", kind: "delta", group: "activity" },
  botOnlineSeconds: { label: "Bot接続時間", unit: "seconds", kind: "delta", group: "activity" },
  osuActivePlayers: { label: "osu!アクティブ人数", unit: "people", kind: "gauge", group: "osu" },
  trackedPlayers: { label: "追跡プレイヤー数", unit: "people", kind: "gauge", group: "osu" },
  storedScores: { label: "保存済みプレイ数", unit: "count", kind: "gauge", group: "osu" },
  uniqueBeatmaps: { label: "プレイ済みユニーク譜面数", unit: "count", kind: "gauge", group: "osu" },
  osuLifetimePlayCount: { label: "osu!プロフィール累計プレイ回数", unit: "count", kind: "gauge", group: "osu" },
  osuLifetimePlaySeconds: { label: "osu!プロフィール累計プレイ時間", unit: "seconds", kind: "gauge", group: "osu" },
  cpuPercent: { label: "Bot CPU使用率", unit: "percent", kind: "gauge", group: "resources" },
  memoryBytes: { label: "Botメモリ使用量", unit: "bytes", kind: "gauge", group: "resources" },
  eventLoopLagMs: { label: "イベントループ遅延", unit: "ms", kind: "gauge", group: "resources" },
  dbBytes: { label: "DB使用容量", unit: "bytes", kind: "gauge", group: "storage" },
  dbRows: { label: "DBデータ行数（概算）", unit: "count", kind: "gauge", group: "storage" },
  diskUsedBytes: { label: "PCディスク使用容量", unit: "bytes", kind: "gauge", group: "storage" },
  diskTotalBytes: { label: "PCディスク総容量", unit: "bytes", kind: "gauge", group: "storage" },
  videoBytes: { label: "レンダー動画使用容量", unit: "bytes", kind: "gauge", group: "storage" },
  audioBytes: { label: "音源使用容量", unit: "bytes", kind: "gauge", group: "storage" },
  notificationPending: { label: "通知送信待ち", unit: "count", kind: "gauge", group: "operations" },
  notificationFailed: { label: "通知再試行待ち", unit: "count", kind: "gauge", group: "operations" },
  renderQueue: { label: "レンダー待機本数", unit: "count", kind: "gauge", group: "operations" },
  activeRenders: { label: "処理中レンダー本数", unit: "count", kind: "gauge", group: "operations" },
} as const;

export type BotMetricKey = keyof typeof BOT_STATISTIC_METRICS;
export type BotMetricValues = Partial<Record<BotMetricKey, number | null>>;
export type BotTelemetryInput = {
  scope: string;
  scopeLabel: string;
  sessionId: string;
  sampledAt: Date;
  intervalSeconds: number;
  metrics: BotMetricValues;
};
export type BotMetricSummary = {
  latest: number | null;
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  total: number | null;
};
export type BotStatisticsData = {
  range: BotStatisticsRange;
  scope: string;
  generatedAt: string;
  from: string;
  to: string;
  collectionStartedAt: string | null;
  lastSampleAt: string | null;
  stale: boolean;
  bucketSeconds: number;
  scopes: Array<{ id: string; label: string }>;
  summary: Partial<Record<BotMetricKey, BotMetricSummary>>;
  points: Array<{ at: string; values: BotMetricValues }>;
  coverage: { sampleCount: number; observedSeconds: number; periodSeconds: number; percent: number };
  activityHours: Array<{ hour: number; messages: number | null; plays: number; voiceMemberSeconds: number | null; days: number; averageMessages: number | null; averagePlays: number; averageVoiceMemberSeconds: number | null }>;
  modeBreakdown: Array<{ mode: string; scores: number; activePlayers: number; uniqueBeatmaps: number; playTimeSeconds: number }>;
  historical: Array<{ at: string; messages: number | null; plays: number; uniqueBeatmaps: number; activePlayers: number; playTimeSeconds: number }>;
  historicalTotals: { messages: number; plays: number; uniqueBeatmaps: number; activePlayers: number; playTimeSeconds: number; days: number };
  notes: string[];
};

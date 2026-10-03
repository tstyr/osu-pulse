import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, ScoreEvent } from "../db/schema";

const mocks = vi.hoisted(() => ({
  scores: vi.fn(),
  insert: vi.fn(),
  analyze: vi.fn(),
  enqueue: vi.fn(),
  normalize: vi.fn(),
}));
vi.mock("../db/repository", () => ({
  attachAccountToGuild: vi.fn(), insertScoreEvent: mocks.insert, linkAccount: vi.fn(), listAccounts: vi.fn(), markAccountManuallyTracked: vi.fn(), updateAccountIdentity: vi.fn(), updateScoreDifficultyAttributes: vi.fn(), upsertAccount: vi.fn(), upsertDailySnapshot: vi.fn(),
}));
vi.mock("../db/feature-repository", () => ({ analyzeAndMarkScore: mocks.analyze, listGoalsForAccount: vi.fn(), markGoalAchieved: vi.fn() }));
vi.mock("../lib/discord/rest", () => ({ sendDiscordDm: vi.fn() }));
vi.mock("../lib/osu/client", () => ({ getRecentScores: mocks.scores, getBeatmapDifficultyAttributes: vi.fn(), getOsuUser: vi.fn(), OsuApiError: class extends Error {} }));
vi.mock("../lib/osu/normalize", () => ({ normalizeScore: mocks.normalize, snapshotFromUser: vi.fn() }));
vi.mock("./score-notification-delivery", () => ({ enqueueScoreNotificationDeliveries: mocks.enqueue, scoreNotificationCutoff: () => new Date(Date.now() - 6 * 60 * 60_000) }));

import { importRecentScores } from "./osu-sync";

const account = { id: "account", osuUserId: 123 } as Account;
const score = { id: "score", osuScoreId: "456", mode: "mania", isPersonalBest: false, anomalyScore: null, endedAt: new Date() } as ScoreEvent;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.scores.mockResolvedValue([{}]);
  mocks.normalize.mockReturnValue(score);
  mocks.insert.mockResolvedValue(score);
  mocks.enqueue.mockResolvedValue(0);
});

describe("score notification ingestion", () => {
  it("evaluates PB and anomaly notifications after analytics while preserving generic delivery", async () => {
    const analyzed = { ...score, isPersonalBest: true, anomalyScore: 3 };
    mocks.analyze.mockResolvedValue(analyzed);
    await expect(importRecentScores(account, "mania", true)).resolves.toEqual([analyzed]);
    expect(mocks.enqueue).toHaveBeenNthCalledWith(1, account, score);
    expect(mocks.enqueue).toHaveBeenNthCalledWith(2, account, analyzed);
  });

  it("still queues generic notifications if analysis fails", async () => {
    mocks.analyze.mockRejectedValue(new Error("analytics unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(importRecentScores(account, "mania", true)).resolves.toEqual([score]);
      expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});

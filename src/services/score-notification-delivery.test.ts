import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, NotificationRuleConditions, ScoreEvent } from "../db/schema";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  changes: [] as Record<string, unknown>[],
  inserted: [] as unknown[],
  insertValues: vi.fn(),
  rules: vi.fn(),
  markMatched: vi.fn(),
  snapshot: vi.fn(),
  send: vi.fn(),
}));

vi.mock("../db", () => ({
  getDb: () => ({
    select: () => {
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: () => query,
        orderBy: () => query,
        limit: async () => mocks.rows,
      };
      return query;
    },
    insert: () => ({
      values: (values: unknown) => {
        mocks.insertValues(values);
        return { onConflictDoNothing: () => ({ returning: async () => mocks.inserted }) };
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        mocks.changes.push(value);
        return {
          where: () => Object.assign(Promise.resolve(), { returning: async () => [{ id: "delivery" }] }),
        };
      },
    }),
  }),
}));
vi.mock("../db/feature-repository", () => ({ listMatchingNotificationRules: mocks.rules, markNotificationRuleMatched: mocks.markMatched }));
vi.mock("../db/repository", () => ({ getSnapshotDelta: mocks.snapshot }));
vi.mock("../lib/discord/embeds", () => ({ notificationRuleScoreEmbed: () => ({ title: "result" }) }));
vi.mock("../lib/discord/rest", () => ({ sendDiscordChannelMessage: mocks.send }));

import { backfillRecentScoreNotificationDeliveries, dispatchDueScoreNotifications, enqueueScoreNotificationDeliveries } from "./score-notification-delivery";

const account = { id: "account" } as Account;
const conditions: NotificationRuleConditions = { modes: ["mania"], ranks: ["A"], minimumPp: 0, maximumPp: null, minimumAccuracy: 0, requiredMods: [], personalBestOnly: false, anomalyOnly: false };
const score = { id: "score", osuScoreId: "123", mode: "mania", rank: "A", accuracy: 0.98, pp: 200, mods: [] } as unknown as ScoreEvent;
const rule = { id: "rule", channelId: "channel", conditions };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rows = [];
  mocks.changes = [];
  mocks.inserted = [{ id: "delivery" }];
  mocks.rules.mockResolvedValue([rule]);
  mocks.markMatched.mockResolvedValue(undefined);
  mocks.snapshot.mockResolvedValue({ latest: null, previous: null });
  mocks.send.mockResolvedValue({ id: "message" });
});

describe("score notification delivery", () => {
  it("does not retry an already sent message when rule activity persistence fails", async () => {
    mocks.rows = [{ delivery: { id: "delivery", status: "pending", ruleId: "rule", channelId: "channel", updatedAt: new Date(), attempts: 0 }, account, score, rule }];
    mocks.markMatched.mockRejectedValue(new Error("DB temporarily unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(dispatchDueScoreNotifications()).resolves.toMatchObject({ sent: 1, failed: 0 });
      expect(mocks.changes.map((value) => value.status)).toEqual(["sending", "sent"]);
      expect(mocks.send).toHaveBeenCalledTimes(1);
      expect(mocks.send.mock.calls[0][1]).toMatchObject({ nonce: expect.stringMatching(/^[0-9a-f]{24}$/), enforce_nonce: true });
    } finally {
      log.mockRestore();
    }
  });

  it("looks up account rules once and inserts reconciled scores together", async () => {
    mocks.rows = Array.from({ length: 20 }, (_, index) => ({ account, score: { ...score, id: `score-${index}` } }));
    await expect(backfillRecentScoreNotificationDeliveries()).resolves.toEqual({ inspected: 20, queued: 1 });
    expect(mocks.rules).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues.mock.calls[0][0]).toHaveLength(20);
  });

  it("reports zero new deliveries when the outbox already contains the score", async () => {
    mocks.inserted = [];
    await expect(enqueueScoreNotificationDeliveries(account, score)).resolves.toBe(0);
  });
});

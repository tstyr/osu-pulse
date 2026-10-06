import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Account, NotificationRuleConditions, ScoreEvent } from "../db/schema";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  changes: [] as Record<string, unknown>[],
  inserted: [] as unknown[],
  claims: [] as unknown[],
  updateConditions: [] as SQL[],
  readConditions: [] as SQL[],
  selectRows: vi.fn(),
  write: vi.fn(),
  delay: vi.fn(),
  embed: vi.fn(),
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
        where: (condition: SQL) => { mocks.readConditions.push(condition); return query; },
        orderBy: () => query,
        limit: (limit: number) => mocks.selectRows(limit),
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
          where: (condition: SQL) => {
            mocks.updateConditions.push(condition);
            const result = Promise.resolve().then(() => mocks.write(value, condition));
            return Object.assign(result, { returning: () => result });
          },
        };
      },
    }),
  }),
}));
vi.mock("../db/feature-repository", () => ({ listMatchingNotificationRules: mocks.rules, markNotificationRuleMatched: mocks.markMatched }));
vi.mock("../db/repository", () => ({ getSnapshotDelta: mocks.snapshot }));
vi.mock("../lib/discord/embeds", () => ({ notificationRuleScoreEmbed: mocks.embed }));
vi.mock("../lib/discord/rest", () => ({ sendDiscordChannelMessage: mocks.send }));
vi.mock("../../bot/worker-delay", () => ({ workerDelay: mocks.delay }));

import { backfillRecentScoreNotificationDeliveries, dispatchDueScoreNotifications, enqueueScoreNotificationDeliveries, runScoreNotificationWorker } from "./score-notification-delivery";

const account = { id: "account" } as Account;
const conditions: NotificationRuleConditions = { modes: ["mania"], ranks: ["A"], minimumPp: 0, maximumPp: null, minimumAccuracy: 0, requiredMods: [], personalBestOnly: false, anomalyOnly: false };
const score = { id: "score", osuScoreId: "123", mode: "mania", rank: "A", accuracy: 0.98, pp: 200, mods: [] } as unknown as ScoreEvent;
const rule = { id: "rule", channelId: "channel", conditions };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rows = [];
  mocks.changes = [];
  mocks.inserted = [{ id: "delivery" }];
  mocks.claims = [{ id: "delivery" }];
  mocks.updateConditions = [];
  mocks.readConditions = [];
  mocks.selectRows.mockImplementation(async () => mocks.rows);
  mocks.write.mockImplementation(async () => mocks.claims);
  mocks.embed.mockReturnValue({ title: "result" });
  mocks.rules.mockResolvedValue([rule]);
  mocks.markMatched.mockResolvedValue(undefined);
  mocks.snapshot.mockResolvedValue({ latest: null, previous: null });
  mocks.send.mockResolvedValue({ id: "message" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  // Flush only test acknowledgements retained by the module-level worker state.
  mocks.rows = [];
  mocks.selectRows.mockResolvedValue([]);
  mocks.write.mockResolvedValue([{ id: "delivery" }]);
  await dispatchDueScoreNotifications();
  vi.restoreAllMocks();
});

function deliveryRow(id = "delivery") {
  return { delivery: { id, status: "pending", ruleId: "rule", channelId: id, updatedAt: new Date(), attempts: 0 }, account, score, rule };
}

describe("score notification delivery", () => {
  it("claims database-default timestamps without an exact millisecond Date comparison", async () => {
    // PostgreSQL now() can contain .123456; Drizzle returns only .123 here.
    const updatedAt = new Date("2026-10-06T02:00:00.123456Z");
    mocks.rows = [{ delivery: { id: "delivery", status: "pending", ruleId: "rule", channelId: "channel", updatedAt, attempts: 0 }, account, score, rule }];
    await expect(dispatchDueScoreNotifications()).resolves.toMatchObject({ sent: 1, failed: 0 });
    const claim = new PgDialect().sqlToQuery(mocks.updateConditions[0]);
    expect(claim.sql).not.toContain('"updated_at"');
    expect(claim.sql).toContain('"status" =');
    expect(claim.sql).toContain('"next_attempt_at" <=');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("does not send when another worker has already claimed the delivery", async () => {
    mocks.rows = [{ delivery: { id: "delivery", status: "pending", ruleId: "rule", channelId: "channel", updatedAt: new Date(), attempts: 0 }, account, score, rule }];
    mocks.claims = [];
    await expect(dispatchDueScoreNotifications()).resolves.toMatchObject({ sent: 0, failed: 0 });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.changes.map((value) => value.status)).toEqual(["sending"]);
  });

  it("only reclaims sending deliveries with an expired lease", async () => {
    mocks.rows = [{ delivery: { id: "delivery", status: "sending", ruleId: "rule", channelId: "channel", updatedAt: new Date(Date.now() - 11 * 60_000), attempts: 0 }, account, score, rule }];
    await expect(dispatchDueScoreNotifications()).resolves.toMatchObject({ sent: 1, failed: 0 });
    const claim = new PgDialect().sqlToQuery(mocks.updateConditions[0]);
    expect(claim.sql).toContain('"updated_at" <=');
    expect(claim.sql).not.toContain('"updated_at" =');
    expect(claim.sql).toContain('"next_attempt_at" <=');
  });

  it("continues with other deliveries after one claim query fails", async () => {
    mocks.rows = [deliveryRow("bad"), deliveryRow("good")];
    mocks.write.mockRejectedValueOnce(new Error("temporary DB failure"));
    await expect(dispatchDueScoreNotifications()).resolves.toMatchObject({ sent: 1, failed: 0 });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0]).toBe("good");
  });

  it("bounds a database outage instead of issuing the whole batch of failing claims", async () => {
    mocks.rows = Array.from({ length: 25 }, (_, index) => deliveryRow(String(index)));
    mocks.write.mockRejectedValue(new Error("DB disconnected"));
    await expect(dispatchDueScoreNotifications()).resolves.toMatchObject({ sent: 0, failed: 0 });
    expect(mocks.write).toHaveBeenCalledTimes(3);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends scores without optional snapshot enrichment when that query fails", async () => {
    mocks.rows = [deliveryRow("first"), deliveryRow("second")];
    mocks.snapshot.mockRejectedValue(new Error("snapshot unavailable"));
    await expect(dispatchDueScoreNotifications()).resolves.toMatchObject({ sent: 2, failed: 0 });
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(mocks.embed).toHaveBeenCalledWith(account, score, null, null);
  });

  it("continues the batch even if recording a failed Discord send also fails", async () => {
    mocks.rows = [deliveryRow("bad"), deliveryRow("good")];
    mocks.send.mockRejectedValueOnce(new Error("Discord temporarily unavailable"));
    mocks.write.mockImplementation(async (value) => {
      if (value.status === "failed") throw new Error("failure record unavailable");
      return mocks.claims;
    });
    await expect(dispatchDueScoreNotifications()).resolves.toMatchObject({ sent: 1, failed: 1, persistenceErrors: 1 });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it("retries only DB acknowledgement persistence after Discord already accepted the message", async () => {
    mocks.rows = [deliveryRow()];
    mocks.write.mockImplementation(async (value) => {
      if (value.status === "sent") throw new Error("DB unavailable after send");
      return mocks.claims;
    });
    await expect(dispatchDueScoreNotifications()).resolves.toMatchObject({ sent: 1, failed: 0, persistenceErrors: 1 });
    expect(mocks.changes.map((value) => value.status)).toEqual(["sending", "sent"]);
    mocks.rows = [];
    await dispatchDueScoreNotifications();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(mocks.readConditions.at(-1)!);
    expect(query.sql).toContain("not in");
    mocks.write.mockResolvedValue([{ id: "delivery" }]);
    await dispatchDueScoreNotifications();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.changes.at(-1)).toMatchObject({ status: "sent", messageId: "message" });
    expect(mocks.markMatched).toHaveBeenCalledTimes(1);
  });

  it("does not abort later deliveries when persisting an accepted message fails", async () => {
    mocks.rows = [deliveryRow("first"), deliveryRow("second")];
    mocks.write.mockImplementation(async (value, condition: SQL) => {
      if (value.status === "sent" && new PgDialect().sqlToQuery(condition).params.includes("first")) {
        throw new Error("first acknowledgement unavailable");
      }
      return mocks.claims;
    });
    await expect(dispatchDueScoreNotifications()).resolves.toMatchObject({ sent: 2, failed: 0, persistenceErrors: 1 });
    expect(mocks.send.mock.calls.map(([channel]) => channel)).toEqual(["first", "second"]);
    expect(mocks.changes.some((value) => value.status === "failed")).toBe(false);
  });

  it("retains the acknowledgement after an external lease reset and never reposts it", async () => {
    mocks.selectRows.mockImplementation(async (limit) => limit === 1 ? [{ status: "pending" }] : [deliveryRow()]);
    mocks.write.mockImplementation(async (value) => value.status === "sent" ? [] : mocks.claims);
    await dispatchDueScoreNotifications();
    await dispatchDueScoreNotifications();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.changes.filter((value) => value.status === "sending")).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(mocks.markMatched).not.toHaveBeenCalled();
    const dueQuery = new PgDialect().sqlToQuery(mocks.readConditions.at(-1)!);
    expect(dueQuery.sql).toContain("not in");
  });

  it.each(["sent", null])("releases a lease-conflict acknowledgement only when the DB row is %s", async (status) => {
    mocks.selectRows.mockImplementation(async (limit) => limit === 1 ? (status ? [{ status }] : []) : [deliveryRow()]);
    mocks.write.mockImplementation(async (value) => value.status === "sent" ? [] : mocks.claims);
    await dispatchDueScoreNotifications();
    mocks.selectRows.mockResolvedValue([]);
    await dispatchDueScoreNotifications();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const dueQuery = new PgDialect().sqlToQuery(mocks.readConditions.at(-1)!);
    expect(dueQuery.sql).not.toContain("not in");
  });

  it("rotates retained lease conflicts so later acknowledgements still reach the database", async () => {
    mocks.selectRows.mockImplementation(async (limit) => limit === 1 ? [{ status: "pending" }] : mocks.rows);
    mocks.write.mockImplementation(async (value) => value.status === "sent" ? [] : mocks.claims);
    mocks.rows = Array.from({ length: 25 }, (_, index) => deliveryRow(`ack-${index}`));
    await dispatchDueScoreNotifications();
    mocks.rows = Array.from({ length: 5 }, (_, index) => deliveryRow(`ack-${25 + index}`));
    await dispatchDueScoreNotifications();
    mocks.rows = [];
    mocks.write.mockImplementation(async (value, condition: SQL) => {
      const params = new PgDialect().sqlToQuery(condition).params;
      return value.status === "sent" && params.some((param) => /^ack-2[5-9]$/.test(String(param))) ? mocks.claims : [];
    });
    await dispatchDueScoreNotifications();
    await dispatchDueScoreNotifications();
    expect(mocks.markMatched).toHaveBeenCalledTimes(5);
    expect(mocks.send).toHaveBeenCalledTimes(30);
  });

  it("guards sent/failure persistence with the exact lease written by this worker", async () => {
    mocks.rows = [deliveryRow()];
    await dispatchDueScoreNotifications();
    const committed = new PgDialect().sqlToQuery(mocks.updateConditions[1]);
    expect(committed.sql).toContain('"status" =');
    expect(committed.sql).toContain('"updated_at" =');
    expect(committed.params).toContain((mocks.changes[0].updatedAt as Date).toISOString());
  });

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

  it("dispatches before backfill and keeps dispatching while a single backfill is pending", async () => {
    const controller = new AbortController();
    let finishBackfill!: (rows: unknown[]) => void;
    const pendingBackfill = new Promise<unknown[]>((resolve) => { finishBackfill = resolve; });
    mocks.selectRows.mockImplementation((limit) => limit === 5_000 ? pendingBackfill : Promise.resolve([]));
    mocks.delay.mockImplementation(async () => {
      if (mocks.delay.mock.calls.length === 2) {
        controller.abort();
        finishBackfill([]);
      }
    });
    await runScoreNotificationWorker(controller.signal);
    expect(mocks.selectRows.mock.calls.map(([limit]) => limit)).toEqual([25, 5_000, 25]);
  });

  it("keeps the delivery worker alive when reconciliation fails", async () => {
    const controller = new AbortController();
    mocks.selectRows.mockImplementation((limit) => limit === 5_000 ? Promise.reject(new Error("backfill failed")) : Promise.resolve([]));
    mocks.delay.mockImplementation(async () => {
      if (mocks.delay.mock.calls.length === 2) controller.abort();
    });
    await expect(runScoreNotificationWorker(controller.signal)).resolves.toBeUndefined();
    expect(mocks.selectRows.mock.calls.filter(([limit]) => limit === 25)).toHaveLength(2);
    expect(console.error).toHaveBeenCalledWith("[osu] notification outbox backfill failed:", expect.any(Error));
  });

  it("warns on repeated zero-progress batches without using a fast retry loop", async () => {
    const controller = new AbortController();
    mocks.selectRows.mockImplementation(async (limit) => limit === 5_000 ? [] : Array.from({ length: 25 }, (_, index) => deliveryRow(String(index))));
    mocks.claims = [];
    mocks.delay.mockImplementation(async () => {
      if (mocks.delay.mock.calls.length === 3) controller.abort();
    });
    await runScoreNotificationWorker(controller.signal);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("notification outbox stalled"));
    expect(mocks.delay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([10_000, 10_000, 10_000]);
  });

  it("recovers from a dispatch-query exception without accelerating the retry loop", async () => {
    const controller = new AbortController();
    mocks.selectRows.mockRejectedValueOnce(new Error("temporary dispatch DB outage"));
    mocks.delay.mockImplementation(async () => {
      if (mocks.delay.mock.calls.length === 2) controller.abort();
    });
    await expect(runScoreNotificationWorker(controller.signal)).resolves.toBeUndefined();
    expect(mocks.delay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([10_000, 10_000]);
    expect(console.error).toHaveBeenCalledWith("[osu] notification outbox worker failed:", expect.any(Error));
  });

  it("uses a one-second delay for a productive full backlog batch", async () => {
    const controller = new AbortController();
    mocks.selectRows.mockImplementation(async (limit) => limit === 5_000 ? [] : Array.from({ length: 25 }, (_, index) => deliveryRow(String(index))));
    mocks.delay.mockImplementation(async () => controller.abort());
    await runScoreNotificationWorker(controller.signal);
    expect(mocks.send).toHaveBeenCalledTimes(25);
    expect(mocks.delay.mock.calls[0][0]).toBe(1_000);
  });
});

import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, or } from "drizzle-orm";

import { getDb } from "../db";
import {
  accounts,
  notificationRules,
  scoreEvents,
  scoreNotificationDeliveries,
  type Account,
  type ScoreEvent,
} from "../db/schema";
import { listMatchingNotificationRules, markNotificationRuleMatched } from "../db/feature-repository";
import { getSnapshotDelta } from "../db/repository";
import { notificationRuleScoreEmbed } from "../lib/discord/embeds";
import { sendDiscordChannelMessage } from "../lib/discord/rest";
import { scoreMatchesRule } from "./notification-match";
import { workerDelay } from "../../bot/worker-delay";

const DEFAULT_LOOKBACK_HOURS = 6;
const DELIVERY_BATCH_SIZE = 25;
const BACKFILL_INTERVAL_MS = 5 * 60_000;
const BACKFILL_INSERT_BATCH_SIZE = 500;
type MatchingRules = Awaited<ReturnType<typeof listMatchingNotificationRules>>;

function lookbackHours() {
  const configured = Number(process.env.SCORE_NOTIFICATION_LOOKBACK_HOURS ?? DEFAULT_LOOKBACK_HOURS);
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 1), 168) : DEFAULT_LOOKBACK_HOURS;
}

export function scoreNotificationCutoff(now = new Date()) {
  return new Date(now.getTime() - lookbackHours() * 60 * 60_000);
}

function deliveryValues(score: ScoreEvent, rules: MatchingRules) {
  const matchingRules = rules.filter((rule) => scoreMatchesRule(score, rule.conditions));
  const destinations = new Map<string, string>();

  for (const rule of matchingRules) destinations.set(rule.channelId, rule.id);
  return [...destinations].map(([channelId, ruleId]) => ({
    scoreId: score.id,
    channelId,
    ruleId,
    status: "pending",
    nextAttemptAt: new Date(),
  }));
}

async function insertDeliveries(values: ReturnType<typeof deliveryValues>) {
  if (!values.length) return 0;
  const inserted = await getDb().insert(scoreNotificationDeliveries).values(values).onConflictDoNothing({
    target: [scoreNotificationDeliveries.scoreId, scoreNotificationDeliveries.channelId],
  }).returning({ id: scoreNotificationDeliveries.id });
  return inserted.length;
}

export async function enqueueScoreNotificationDeliveries(account: Account, score: ScoreEvent) {
  return insertDeliveries(deliveryValues(score, await listMatchingNotificationRules(account.id)));
}

export async function backfillRecentScoreNotificationDeliveries() {
  const db = getDb();
  const recent = await db.select({ score: scoreEvents, account: accounts })
    .from(scoreEvents)
    .innerJoin(accounts, eq(accounts.id, scoreEvents.accountId))
    .where(gte(scoreEvents.endedAt, scoreNotificationCutoff()))
    .orderBy(desc(scoreEvents.endedAt))
    .limit(5_000);
  const rulesByAccount = new Map<string, MatchingRules>();
  let pending: ReturnType<typeof deliveryValues> = [];
  let queued = 0;
  for (const row of recent.reverse()) {
    let rules = rulesByAccount.get(row.account.id);
    if (!rules) {
      rules = await listMatchingNotificationRules(row.account.id);
      rulesByAccount.set(row.account.id, rules);
    }
    pending.push(...deliveryValues(row.score, rules));
    if (pending.length >= BACKFILL_INSERT_BATCH_SIZE) {
      queued += await insertDeliveries(pending);
      pending = [];
    }
  }
  queued += await insertDeliveries(pending);
  return { inspected: recent.length, queued };
}

function retryDelay(attempt: number) {
  return Math.min(15 * 60_000, 15_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 6));
}

function errorDetail(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

export async function dispatchDueScoreNotifications() {
  const db = getDb();
  const now = new Date();
  const due = await db.select({
    delivery: scoreNotificationDeliveries,
    score: scoreEvents,
    account: accounts,
    rule: notificationRules,
  })
    .from(scoreNotificationDeliveries)
    .innerJoin(scoreEvents, eq(scoreEvents.id, scoreNotificationDeliveries.scoreId))
    .innerJoin(accounts, eq(accounts.id, scoreEvents.accountId))
    .innerJoin(notificationRules, eq(notificationRules.id, scoreNotificationDeliveries.ruleId))
    .where(and(
      eq(notificationRules.enabled, true),
      or(
        inArray(scoreNotificationDeliveries.status, ["pending", "failed"]),
        and(
          eq(scoreNotificationDeliveries.status, "sending"),
          lte(scoreNotificationDeliveries.updatedAt, new Date(now.getTime() - 10 * 60_000)),
        ),
      ),
      lte(scoreNotificationDeliveries.nextAttemptAt, now),
    ))
    .orderBy(asc(scoreNotificationDeliveries.nextAttemptAt))
    .limit(DELIVERY_BATCH_SIZE);

  let sent = 0;
  let failed = 0;
  const snapshots = new Map<string, ReturnType<typeof getSnapshotDelta>>();
  for (const row of due) {
    const claimCondition = row.delivery.status === "sending"
      ? and(
        eq(scoreNotificationDeliveries.status, "sending"),
        lte(scoreNotificationDeliveries.updatedAt, new Date(now.getTime() - 10 * 60_000)),
      )
      : eq(scoreNotificationDeliveries.status, row.delivery.status);
    const claimed = await db.update(scoreNotificationDeliveries).set({
      status: "sending",
      updatedAt: new Date(),
      nextAttemptAt: new Date(Date.now() + 10 * 60_000),
    }).where(and(
      eq(scoreNotificationDeliveries.id, row.delivery.id),
      claimCondition,
      // PostgreSQL's default now() retains microseconds, but Drizzle decodes
      // this timestamp into a millisecond Date. Comparing that Date for exact
      // equality leaves newly inserted deliveries permanently unclaimable.
      // The status/due-time guards still atomically exclude another worker's
      // active lease; stale sending leases have their own age guard above.
      lte(scoreNotificationDeliveries.nextAttemptAt, now),
    )).returning({ id: scoreNotificationDeliveries.id });
    if (!claimed.length) continue;

    try {
      const snapshotKey = `${row.account.id}:${row.score.mode}`;
      let snapshot = snapshots.get(snapshotKey);
      if (!snapshot) {
        snapshot = getSnapshotDelta(row.account.id, row.score.mode);
        snapshots.set(snapshotKey, snapshot);
      }
      const { latest, previous } = await snapshot;
      const payload = {
        embeds: [notificationRuleScoreEmbed(row.account, row.score, latest, previous)],
        allowed_mentions: { parse: [] },
        // Discord returns the existing message if a nearby network/DB retry
        // repeats this delivery, instead of creating a duplicate announcement.
        nonce: createHash("sha256").update(row.delivery.id).digest("hex").slice(0, 24),
        enforce_nonce: true,
      };
      const message = await sendDiscordChannelMessage(row.delivery.channelId, payload) as { id?: string };
      await db.update(scoreNotificationDeliveries).set({
        status: "sent",
        messageId: message?.id ?? null,
        lastError: null,
        sentAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(scoreNotificationDeliveries.id, row.delivery.id));
      sent += 1;
    } catch (error) {
      const attempts = row.delivery.attempts + 1;
      await db.update(scoreNotificationDeliveries).set({
        status: "failed",
        attempts,
        lastError: errorDetail(error),
        nextAttemptAt: new Date(Date.now() + retryDelay(attempts)),
        updatedAt: new Date(),
      }).where(eq(scoreNotificationDeliveries.id, row.delivery.id));
      console.error(`[osu] score notification retry scheduled: score=${row.score.osuScoreId} channel=${row.delivery.channelId} attempt=${attempts}`, error);
      failed += 1;
      continue;
    }
    if (row.delivery.ruleId) {
      // The message and sent state are already committed. A rule-statistics
      // failure must never put the delivery back into the retry queue.
      await markNotificationRuleMatched(row.delivery.ruleId).catch((error) => {
        console.error(`[osu] notification rule activity update failed: rule=${row.delivery.ruleId}`, error);
      });
    }
  }
  return { processed: due.length, sent, failed };
}

export async function runScoreNotificationWorker(signal: AbortSignal) {
  let lastBackfillAt = -Infinity;
  while (!signal.aborted) {
    if (Date.now() - lastBackfillAt >= BACKFILL_INTERVAL_MS) {
      lastBackfillAt = Date.now();
      try {
        const backfill = await backfillRecentScoreNotificationDeliveries();
        if (backfill.queued) console.log(`[osu] notification outbox reconciled: inspected=${backfill.inspected} queued=${backfill.queued}`);
      } catch (error) {
        console.error("[osu] notification outbox backfill failed:", error);
      }
    }
    if (signal.aborted) break;
    try {
      const result = await dispatchDueScoreNotifications();
      if (result.processed) console.log(`[osu] score notifications: sent=${result.sent} failed=${result.failed}`);
    } catch (error) {
      console.error("[osu] notification outbox worker failed:", error);
    }
    await workerDelay(10_000, signal);
  }
}

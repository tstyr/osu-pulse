import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, notInArray, or } from "drizzle-orm";

import { getDb } from "../db";
import {
  accounts,
  notificationRules,
  scoreEvents,
  scoreNotificationDeliveries,
  type Account,
  type DailySnapshot,
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
const DELIVERY_LEASE_MS = 10 * 60_000;
const CONSECUTIVE_DB_ERROR_LIMIT = 3;
type MatchingRules = Awaited<ReturnType<typeof listMatchingNotificationRules>>;

type AcceptedNotification = {
  id: string;
  leaseAt: Date;
  messageId: string | null;
  sentAt: Date;
  ruleId: string | null;
  leaseConflictWarned?: boolean;
};

// Keep successful Discord acknowledgements across worker-loop restarts. If DB
// persistence fails after Discord accepts a message, retry only the DB write,
// never the POST. A process crash still relies on the persistent lease/nonce.
const acceptedNotifications = new Map<string, AcceptedNotification>();

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

export async function backfillRecentScoreNotificationDeliveries(signal?: AbortSignal) {
  if (signal?.aborted) return { inspected: 0, queued: 0 };
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
    if (signal?.aborted) break;
    let rules = rulesByAccount.get(row.account.id);
    if (!rules) {
      rules = await listMatchingNotificationRules(row.account.id);
      rulesByAccount.set(row.account.id, rules);
    }
    if (signal?.aborted) break;
    pending.push(...deliveryValues(row.score, rules));
    if (pending.length >= BACKFILL_INSERT_BATCH_SIZE) {
      queued += await insertDeliveries(pending);
      pending = [];
    }
  }
  if (!signal?.aborted) queued += await insertDeliveries(pending);
  return { inspected: recent.length, queued };
}

function retryDelay(attempt: number) {
  return Math.min(15 * 60_000, 15_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 6));
}

function errorDetail(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function deliveryLease(id: string, leaseAt: Date) {
  return and(
    eq(scoreNotificationDeliveries.id, id),
    eq(scoreNotificationDeliveries.status, "sending"),
    // Unlike the original DB default timestamp, this is the exact millisecond
    // value written by this worker when claiming the delivery.
    eq(scoreNotificationDeliveries.updatedAt, leaseAt),
  );
}

async function recordRuleActivity(ruleId: string | null) {
  if (!ruleId) return;
  await markNotificationRuleMatched(ruleId).catch((error) => {
    console.error(`[osu] notification rule activity update failed: rule=${ruleId}`, error);
  });
}

async function persistAcceptedNotification(db: ReturnType<typeof getDb>, accepted: AcceptedNotification) {
  const committed = await db.update(scoreNotificationDeliveries).set({
    status: "sent",
    messageId: accepted.messageId,
    lastError: null,
    sentAt: accepted.sentAt,
    updatedAt: new Date(),
  }).where(deliveryLease(accepted.id, accepted.leaseAt)).returning({ id: scoreNotificationDeliveries.id });
  if (committed.length) {
    acceptedNotifications.delete(accepted.id);
    await recordRuleActivity(accepted.ruleId);
    return;
  }
  const [current] = await db.select({ status: scoreNotificationDeliveries.status })
    .from(scoreNotificationDeliveries)
    .where(eq(scoreNotificationDeliveries.id, accepted.id))
    .limit(1);
  if (!current || current.status === "sent") {
    acceptedNotifications.delete(accepted.id);
    return;
  }
  // An external reset/reclaim is not evidence that Discord lost the message.
  // Keep suppressing POSTs unless its row is already sent or actually removed.
  if (!accepted.leaseConflictWarned) {
    accepted.leaseConflictWarned = true;
    console.warn(`[osu] notification acknowledgement lease changed: delivery=${accepted.id}; retaining acknowledgement, no Discord resend`);
  }
}

export async function dispatchDueScoreNotifications(signal?: AbortSignal) {
  const db = getDb();
  let persistenceErrors = 0;
  let consecutiveDbErrors = 0;
  for (const accepted of [...acceptedNotifications.values()].slice(0, DELIVERY_BATCH_SIZE)) {
    if (signal?.aborted) break;
    try {
      await persistAcceptedNotification(db, accepted);
      if (acceptedNotifications.has(accepted.id)) {
        // A retained lease conflict must not occupy the first batch forever
        // and starve later successful acknowledgements of their DB retry.
        acceptedNotifications.delete(accepted.id);
        acceptedNotifications.set(accepted.id, accepted);
      }
      consecutiveDbErrors = 0;
    } catch (error) {
      persistenceErrors += 1;
      // Rotate transient failures so one row cannot starve other acknowledgements.
      acceptedNotifications.delete(accepted.id);
      acceptedNotifications.set(accepted.id, accepted);
      console.error(`[osu] notification acknowledgement persistence retry: delivery=${accepted.id}; no Discord resend`, error);
      if (++consecutiveDbErrors >= CONSECUTIVE_DB_ERROR_LIMIT) break;
    }
  }
  if (signal?.aborted) return { processed: 0, sent: 0, failed: 0, persistenceErrors };
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
          lte(scoreNotificationDeliveries.updatedAt, new Date(now.getTime() - DELIVERY_LEASE_MS)),
        ),
      ),
      lte(scoreNotificationDeliveries.nextAttemptAt, now),
      acceptedNotifications.size
        ? notInArray(scoreNotificationDeliveries.id, [...acceptedNotifications.keys()])
        : undefined,
    ))
    .orderBy(asc(scoreNotificationDeliveries.nextAttemptAt))
    .limit(DELIVERY_BATCH_SIZE);

  let sent = 0;
  let failed = 0;
  consecutiveDbErrors = 0;
  const snapshots = new Map<string, Promise<{ latest: DailySnapshot | null; previous: DailySnapshot | null }>>();
  for (const row of due) {
    if (signal?.aborted) break;
    if (acceptedNotifications.has(row.delivery.id)) continue;
    const claimCondition = row.delivery.status === "sending"
      ? and(
        eq(scoreNotificationDeliveries.status, "sending"),
        lte(scoreNotificationDeliveries.updatedAt, new Date(now.getTime() - DELIVERY_LEASE_MS)),
      )
      : eq(scoreNotificationDeliveries.status, row.delivery.status);
    const leaseAt = new Date();
    let claimed;
    try {
      claimed = await db.update(scoreNotificationDeliveries).set({
        status: "sending",
        updatedAt: leaseAt,
        nextAttemptAt: new Date(leaseAt.getTime() + DELIVERY_LEASE_MS),
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
      consecutiveDbErrors = 0;
    } catch (error) {
      console.error(`[osu] notification claim failed: delivery=${row.delivery.id}; retained for retry`, error);
      if (++consecutiveDbErrors >= CONSECUTIVE_DB_ERROR_LIMIT) break;
      continue;
    }
    if (!claimed.length) continue;

    let message: { id?: string };
    try {
      const snapshotKey = `${row.account.id}:${row.score.mode}`;
      let snapshot = snapshots.get(snapshotKey);
      if (!snapshot) {
        snapshot = getSnapshotDelta(row.account.id, row.score.mode).catch((error) => {
          console.error(`[osu] notification snapshot unavailable: account=${row.account.id} mode=${row.score.mode}; sending score without profile delta`, error);
          return { latest: null, previous: null };
        });
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
      message = await sendDiscordChannelMessage(row.delivery.channelId, payload) as { id?: string };
    } catch (error) {
      const attempts = row.delivery.attempts + 1;
      try {
        await db.update(scoreNotificationDeliveries).set({
          status: "failed",
          attempts,
          lastError: errorDetail(error),
          nextAttemptAt: new Date(Date.now() + retryDelay(attempts)),
          updatedAt: new Date(),
        }).where(deliveryLease(row.delivery.id, leaseAt));
      } catch (persistenceError) {
        persistenceErrors += 1;
        console.error(`[osu] notification failure persistence failed: delivery=${row.delivery.id}; persistent lease will recover`, persistenceError);
      }
      console.error(`[osu] score notification retry scheduled: score=${row.score.osuScoreId} channel=${row.delivery.channelId} attempt=${attempts}`, error);
      failed += 1;
      continue;
    }
    sent += 1;
    const accepted = { id: row.delivery.id, leaseAt, messageId: message?.id ?? null, sentAt: new Date(), ruleId: row.delivery.ruleId };
    acceptedNotifications.set(accepted.id, accepted);
    try {
      await persistAcceptedNotification(db, accepted);
    } catch (error) {
      persistenceErrors += 1;
      console.error(`[osu] notification acknowledgement persistence retry: delivery=${accepted.id}; no Discord resend`, error);
    }
  }
  return { processed: due.length, sent, failed, persistenceErrors };
}

export async function runScoreNotificationWorker(signal: AbortSignal) {
  let lastBackfillAt = -Infinity;
  let stalledCycles = 0;
  let backfill: Promise<void> | undefined;
  try {
    while (!signal.aborted) {
      let delayMs = 10_000;
      try {
        const result = await dispatchDueScoreNotifications(signal);
        if (result.processed) console.log(`[osu] score notifications: sent=${result.sent} failed=${result.failed} persistenceErrors=${result.persistenceErrors}`);
        stalledCycles = result.processed > 0 && result.sent === 0 && result.failed === 0 ? stalledCycles + 1 : 0;
        if (stalledCycles === 3 || (stalledCycles > 3 && stalledCycles % 30 === 0)) {
          console.warn(`[osu] notification outbox stalled: ${result.processed} due deliveries, no progress for ${stalledCycles} cycles; inspect claim/DB errors`);
        }
        // Drain a healthy backlog promptly, but never accelerate empty/error
        // cycles or send in parallel around Discord's rate-limit handling.
        if (result.processed === DELIVERY_BATCH_SIZE && result.sent + result.failed > 0) delayMs = 1_000;
      } catch (error) {
        console.error("[osu] notification outbox worker failed:", error);
      }
      if (signal.aborted) break;
      if (!backfill && Date.now() - lastBackfillAt >= BACKFILL_INTERVAL_MS) {
        lastBackfillAt = Date.now();
        // One bounded-by-driver reconciliation task at a time. It cannot delay
        // the next dispatch cycle, and is joined at shutdown rather than raced.
        backfill = backfillRecentScoreNotificationDeliveries(signal).then((result) => {
          if (result.queued) console.log(`[osu] notification outbox reconciled: inspected=${result.inspected} queued=${result.queued}`);
        }).catch((error) => {
          console.error("[osu] notification outbox backfill failed:", error);
        }).finally(() => { backfill = undefined; });
      }
      await workerDelay(delayMs, signal);
    }
  } finally {
    await backfill;
  }
}

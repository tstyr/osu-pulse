import { and, asc, desc, eq, gte, lte } from "drizzle-orm";

import { getDb } from "./index";
import {
  communityEventEntries,
  communityEvents,
  communityTickets,
  discordActivityBuckets,
  guildSettings,
} from "./schema";

export async function configureOnboarding(input: {
  guildId: string;
  channelId: string;
  roleId: string;
  panelMessageId: string;
}) {
  const values = {
    onboardingChannelId: input.channelId,
    onboardingRoleId: input.roleId,
    onboardingPanelMessageId: input.panelMessageId,
    updatedAt: new Date(),
  };
  const [row] = await getDb().insert(guildSettings).values({ guildId: input.guildId, ...values }).onConflictDoUpdate({
    target: guildSettings.guildId,
    set: values,
  }).returning();
  return row;
}

export async function configureTickets(input: {
  guildId: string;
  categoryId: string;
  logChannelId: string;
  supportRoleId?: string | null;
}) {
  const values = {
    ticketCategoryId: input.categoryId,
    ticketLogChannelId: input.logChannelId,
    ticketSupportRoleId: input.supportRoleId ?? null,
    updatedAt: new Date(),
  };
  const [row] = await getDb().insert(guildSettings).values({ guildId: input.guildId, ...values }).onConflictDoUpdate({
    target: guildSettings.guildId,
    set: values,
  }).returning();
  return row;
}

export async function getCommunityGuildSettings(guildId: string) {
  return getDb().query.guildSettings.findFirst({ where: eq(guildSettings.guildId, guildId) });
}

export async function createCommunityTicket(input: {
  guildId: string;
  channelId: string;
  openerDiscordUserId: string;
  subject?: string;
}) {
  const [row] = await getDb().insert(communityTickets).values({
    ...input,
    subject: input.subject?.trim().slice(0, 200) || "Support request",
  }).returning();
  return row;
}

export async function findOpenCommunityTicket(guildId: string, openerDiscordUserId: string) {
  return getDb().query.communityTickets.findFirst({
    where: and(
      eq(communityTickets.guildId, guildId),
      eq(communityTickets.openerDiscordUserId, openerDiscordUserId),
      eq(communityTickets.status, "open"),
    ),
  });
}

export async function getCommunityTicketByChannel(channelId: string) {
  return getDb().query.communityTickets.findFirst({ where: eq(communityTickets.channelId, channelId) });
}

export async function closeCommunityTicket(id: string, closedByDiscordUserId: string) {
  const now = new Date();
  const [row] = await getDb().update(communityTickets).set({
    status: "closed",
    closedByDiscordUserId,
    closedAt: now,
  }).where(and(eq(communityTickets.id, id), eq(communityTickets.status, "open"))).returning();
  return row;
}

export async function listCommunityTickets(limit = 100) {
  return getDb().select().from(communityTickets).orderBy(desc(communityTickets.createdAt)).limit(Math.min(Math.max(limit, 1), 500));
}

export async function createCommunityEvent(input: {
  guildId: string;
  channelId: string;
  kind: "poll" | "giveaway";
  title: string;
  options?: string[];
  winnerCount?: number;
  createdByDiscordUserId: string;
  endsAt: Date;
}) {
  const [row] = await getDb().insert(communityEvents).values({
    ...input,
    title: input.title.trim().slice(0, 250),
    options: input.options ?? [],
    winnerCount: Math.max(1, Math.min(20, input.winnerCount ?? 1)),
  }).returning();
  return row;
}

export async function setCommunityEventMessage(id: string, messageId: string) {
  const [row] = await getDb().update(communityEvents).set({ messageId }).where(eq(communityEvents.id, id)).returning();
  return row;
}

export async function getCommunityEvent(id: string) {
  const event = await getDb().query.communityEvents.findFirst({ where: eq(communityEvents.id, id) });
  if (!event) return null;
  const entries = await getDb().select().from(communityEventEntries)
    .where(eq(communityEventEntries.eventId, id))
    .orderBy(asc(communityEventEntries.createdAt));
  return { event, entries };
}

export async function enterCommunityEvent(input: { eventId: string; discordUserId: string; choiceIndex?: number | null }) {
  const now = new Date();
  const [row] = await getDb().insert(communityEventEntries).values({
    eventId: input.eventId,
    discordUserId: input.discordUserId,
    choiceIndex: input.choiceIndex ?? null,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [communityEventEntries.eventId, communityEventEntries.discordUserId],
    set: { choiceIndex: input.choiceIndex ?? null, updatedAt: now },
  }).returning();
  return row;
}

export async function listDueCommunityEvents(now = new Date()) {
  return getDb().select().from(communityEvents).where(and(
    eq(communityEvents.status, "active"),
    lte(communityEvents.endsAt, now),
  )).orderBy(asc(communityEvents.endsAt)).limit(50);
}

export async function completeCommunityEvent(id: string) {
  const [row] = await getDb().update(communityEvents).set({ status: "completed", completedAt: new Date() })
    .where(and(eq(communityEvents.id, id), eq(communityEvents.status, "active"))).returning();
  return row;
}

export async function listCommunityEvents(limit = 100) {
  return getDb().select().from(communityEvents).orderBy(desc(communityEvents.createdAt)).limit(Math.min(Math.max(limit, 1), 500));
}

function hourBucket(date = new Date()) {
  const bucket = new Date(date);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket;
}

export async function recordGuildActivity(input: {
  guildId: string;
  discordUserId: string;
  kind: "message" | "voice-join" | "voice-leave";
  occurredAt?: Date;
}) {
  const bucketHour = hourBucket(input.occurredAt);
  const db = getDb();
  const current = await db.query.discordActivityBuckets.findFirst({
    where: and(eq(discordActivityBuckets.guildId, input.guildId), eq(discordActivityBuckets.bucketHour, bucketHour)),
  });
  const users = [...new Set([...(current?.activeDiscordUserIds ?? []), input.discordUserId])].slice(-5_000);
  const values = {
    guildId: input.guildId,
    bucketHour,
    messageCount: (current?.messageCount ?? 0) + (input.kind === "message" ? 1 : 0),
    voiceJoinCount: (current?.voiceJoinCount ?? 0) + (input.kind === "voice-join" ? 1 : 0),
    voiceLeaveCount: (current?.voiceLeaveCount ?? 0) + (input.kind === "voice-leave" ? 1 : 0),
    activeDiscordUserIds: users,
    updatedAt: new Date(),
  };
  await db.insert(discordActivityBuckets).values(values).onConflictDoUpdate({
    target: [discordActivityBuckets.guildId, discordActivityBuckets.bucketHour],
    set: values,
  });
}

export async function getDiscordActivitySummary(days = 30) {
  const boundedDays = Math.max(1, Math.min(365, Math.floor(days)));
  const since = new Date(Date.now() - boundedDays * 86_400_000);
  const rows = await getDb().select().from(discordActivityBuckets)
    .where(gte(discordActivityBuckets.bucketHour, since))
    .orderBy(asc(discordActivityBuckets.bucketHour));
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, messages: 0, voiceJoins: 0, voiceLeaves: 0, activeUsers: new Set<string>() }));
  for (const row of rows) {
    const jstHour = (row.bucketHour.getUTCHours() + 9) % 24;
    const target = hours[jstHour];
    target.messages += row.messageCount;
    target.voiceJoins += row.voiceJoinCount;
    target.voiceLeaves += row.voiceLeaveCount;
    for (const id of row.activeDiscordUserIds) target.activeUsers.add(id);
  }
  return {
    days: boundedDays,
    totalMessages: rows.reduce((sum, row) => sum + row.messageCount, 0),
    totalVoiceJoins: rows.reduce((sum, row) => sum + row.voiceJoinCount, 0),
    uniqueActiveUsers: new Set(rows.flatMap((row) => row.activeDiscordUserIds)).size,
    hours: hours.map((row) => ({ ...row, activeUsers: row.activeUsers.size })),
  };
}

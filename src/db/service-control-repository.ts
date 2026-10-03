import { and, asc, desc, eq, lt } from "drizzle-orm";

import { getDb } from "./index";
import { serviceControlCommands } from "./schema";

export type LocalServiceName = "bot" | "renderer" | "lavalink";

export async function enqueueServiceRestart(service: LocalServiceName) {
  const [row] = await getDb().insert(serviceControlCommands).values({ service, action: "restart" }).returning();
  return row;
}

export async function listServiceControlCommands(limit = 20) {
  return getDb().select().from(serviceControlCommands)
    .orderBy(desc(serviceControlCommands.requestedAt))
    .limit(Math.max(1, Math.min(100, limit)));
}

export async function claimPendingServiceControlCommands(limit = 3) {
  const db = getDb();
  const staleBefore = new Date(Date.now() - 60_000);
  await db.update(serviceControlCommands).set({ status: "pending", claimedAt: null }).where(and(
    eq(serviceControlCommands.status, "claimed"),
    lt(serviceControlCommands.claimedAt, staleBefore),
  ));
  const pending = await db.select().from(serviceControlCommands)
    .where(eq(serviceControlCommands.status, "pending"))
    .orderBy(asc(serviceControlCommands.requestedAt))
    .limit(Math.max(1, Math.min(3, limit)));
  const claimed: Array<typeof serviceControlCommands.$inferSelect> = [];
  for (const command of pending) {
    const [row] = await db.update(serviceControlCommands).set({
      status: "claimed",
      claimedAt: new Date(),
      error: null,
    }).where(and(
      eq(serviceControlCommands.id, command.id),
      eq(serviceControlCommands.status, "pending"),
    )).returning();
    if (row) claimed.push(row);
  }
  return claimed;
}

export async function completeServiceControlCommand(id: string, error?: string | null) {
  const [row] = await getDb().update(serviceControlCommands).set({
    status: error ? "failed" : "completed",
    error: error?.slice(0, 500) ?? null,
    completedAt: new Date(),
  }).where(eq(serviceControlCommands.id, id)).returning();
  return row;
}

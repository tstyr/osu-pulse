import "server-only";

import { count, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { renderVideos } from "@/db/schema";

export async function getVideoLibrary() {
  const db = getDb();
  const [videos, totalRows, activeRows, bytesRows] = await Promise.all([
    db.select().from(renderVideos).orderBy(desc(renderVideos.uploadedAt)).limit(200),
    db.select({ value: count() }).from(renderVideos),
    db.select({ value: count() }).from(renderVideos).where(eq(renderVideos.status, "active")),
    db.select({ value: sql<number>`coalesce(sum(${renderVideos.sourceSize}), 0)` }).from(renderVideos),
  ]);
  return {
    total: totalRows[0]?.value ?? 0,
    active: activeRows[0]?.value ?? 0,
    sourceBytes: Number(bytesRows[0]?.value ?? 0),
    videos: videos.map((video) => ({
      ...video,
      uploadedAt: video.uploadedAt.toISOString(),
      deletedAt: video.deletedAt?.toISOString() ?? null,
      lastSyncedAt: video.lastSyncedAt.toISOString(),
      updatedAt: video.updatedAt.toISOString(),
    })),
  };
}

export type VideoLibrary = Awaited<ReturnType<typeof getVideoLibrary>>;

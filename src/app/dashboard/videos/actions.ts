"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { renderVideos } from "@/db/schema";
import { hasControlPanelSession } from "@/lib/control/auth";
import { auditAdminAction } from "@/services/admin-log";

const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{6,32}$/);

export async function requestVideoDeletion(formData: FormData) {
  if (!(await hasControlPanelSession())) redirect("/");
  const videoId = videoIdSchema.parse(formData.get("videoId"));
  await getDb().update(renderVideos).set({
    status: "delete_requested",
    deleteRequested: true,
    deleteError: null,
    updatedAt: new Date(),
  }).where(and(
    eq(renderVideos.videoId, videoId),
    inArray(renderVideos.status, ["active", "delete_failed"]),
  ));
  await auditAdminAction({ source: "web", action: "delete-youtube-video", summary: `YouTube動画 ${videoId} の削除を要求しました。` });
  revalidatePath("/dashboard/videos");
}

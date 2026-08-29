"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { renderVideos } from "@/db/schema";
import { hasControlPanelSession } from "@/lib/control/auth";

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
  revalidatePath("/dashboard/videos");
}

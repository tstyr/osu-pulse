import { z } from "zod";

import { renderApiError } from "@/lib/render/api";
import { createCloudRenderBatch, renderOptionsSchema, requireWebRenderAccess } from "@/lib/render/server";
import { auditAdminAction } from "@/services/admin-log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireWebRenderAccess(request);
    const input = z.object({
      urls: z.array(z.string().max(2_000)).min(1).max(20),
      scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
    }).and(renderOptionsSchema).parse(await request.json());
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (scheduledAt && scheduledAt.getTime() > Date.now() + 31 * 86_400_000) {
      return Response.json({ error: "予約できるのは31日後までです。" }, { status: 400 });
    }
    const result = await createCloudRenderBatch({
      scoreUrls: input.urls,
      options: {
        resolution: input.resolution,
        fps: input.fps,
        speed: input.speed,
        motionBlur: input.motionBlur,
        highlight: input.highlight,
      },
      scheduledAt,
    });
    await auditAdminAction({ source: "web", action: "create-render-batch", summary: `${result.created.length}件の一括レンダーを追加しました。`, details: { batchId: result.batchId } });
    return Response.json({ batchId: result.batchId, jobs: result.created.map((job) => ({ id: job.id, status: job.status })) }, { status: 202 });
  } catch (error) {
    return renderApiError(error);
  }
}

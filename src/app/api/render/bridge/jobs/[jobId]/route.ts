import { z } from "zod";

import { renderApiError } from "@/lib/render/api";
import {
  bridgeUpdateSchema,
  RenderApiError,
  requireBridgeAccess,
  updateCloudRenderJob,
} from "@/lib/render/server";

export async function PATCH(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    requireBridgeAccess(request);
    const { jobId } = await context.params;
    if (!z.string().uuid().safeParse(jobId).success) {
      throw new RenderApiError("JOB_NOT_FOUND", "Cloud render job was not found.", 404);
    }
    const rendererId = request.headers.get("x-renderer-id") ?? "";
    if (!rendererId || rendererId.length > 64) {
      throw new RenderApiError("UNAUTHORIZED", "Renderer id is missing.", 401);
    }
    const input = bridgeUpdateSchema.parse(await request.json());
    const job = await updateCloudRenderJob(jobId, rendererId, input);
    return Response.json({ ok: true, cancelRequested: job.cancelRequested });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid job update" }, { status: 400 });
    return renderApiError(error);
  }
}

import { z } from "zod";

import { renderApiError } from "@/lib/render/api";
import { completeRenderVideoCommand, requireBridgeAccess } from "@/lib/render/server";

const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{6,32}$/);
const resultSchema = z.object({
  success: z.boolean(),
  error: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ videoId: string }> },
) {
  try {
    requireBridgeAccess(request);
    const { videoId } = await context.params;
    videoIdSchema.parse(videoId);
    const result = resultSchema.parse(await request.json());
    await completeRenderVideoCommand(videoId, result.success, result.error);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid video command result" }, { status: 400 });
    return renderApiError(error);
  }
}

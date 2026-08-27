import { z } from "zod";

import { renderApiError } from "@/lib/render/api";
import { claimCloudRenderJob, heartbeatRenderer, requireBridgeAccess } from "@/lib/render/server";

const schema = z.object({
  rendererId: z.string().min(1).max(64),
  status: z.string().min(1).max(64),
  busy: z.boolean(),
  queueSize: z.number().int().min(0).max(100),
  dependencies: z.record(z.string(), z.unknown()),
  version: z.string().max(64).optional(),
});

export async function POST(request: Request) {
  try {
    requireBridgeAccess(request);
    const input = schema.parse(await request.json());
    await heartbeatRenderer({ ...input, activeCloudJobId: null });
    if (input.busy) return Response.json({ job: null });
    const job = await claimCloudRenderJob(input.rendererId);
    if (!job) return Response.json({ job: null });
    return Response.json({
      job: {
        jobId: job.id,
        inputType: job.inputType,
        scoreUrl: job.scoreUrl,
        replayData: job.replayData,
        options: job.options,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid claim request" }, { status: 400 });
    return renderApiError(error);
  }
}

import { z } from "zod";

import { renderApiError } from "@/lib/render/api";
import { getBridgeConfiguration } from "@/lib/control/settings";
import { claimCloudRenderJob, heartbeatRenderer, requireBridgeAccess } from "@/lib/render/server";

const schema = z.object({
  rendererId: z.string().min(1).max(64),
  status: z.string().min(1).max(64),
  busy: z.boolean(),
  queueSize: z.number().int().min(0).max(100),
  dependencies: z.record(z.string(), z.unknown()),
  version: z.string().max(64).optional(),
  activeCount: z.number().int().min(0).max(2).optional(),
  capacity: z.number().int().min(1).max(2).optional(),
  configurationVersion: z.number().int().min(0).optional(),
  restartRequired: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    requireBridgeAccess(request);
    const input = schema.parse(await request.json());
    await heartbeatRenderer({ ...input, activeCloudJobId: null });
    const configuration = await getBridgeConfiguration();
    const activeCount = input.activeCount ?? (input.busy ? 1 : 0);
    const capacity = input.capacity ?? 1;
    if (activeCount >= capacity || input.restartRequired) {
      return Response.json({ job: null, configuration });
    }
    const job = await claimCloudRenderJob(input.rendererId);
    if (!job) return Response.json({ job: null, configuration });
    return Response.json({
      job: {
        jobId: job.id,
        inputType: job.inputType,
        scoreUrl: job.scoreUrl,
        replayData: job.replayData,
        options: job.options,
      },
      configuration,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid claim request" }, { status: 400 });
    return renderApiError(error);
  }
}

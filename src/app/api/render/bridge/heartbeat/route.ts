import { z } from "zod";

import { renderApiError } from "@/lib/render/api";
import { getBridgeConfiguration } from "@/lib/control/settings";
import { heartbeatRenderer, requireBridgeAccess } from "@/lib/render/server";

const schema = z.object({
  rendererId: z.string().min(1).max(64),
  status: z.string().min(1).max(64),
  busy: z.boolean(),
  queueSize: z.number().int().min(0).max(100),
  activeCloudJobId: z.string().uuid().nullable().optional(),
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
    await heartbeatRenderer(input);
    return Response.json({ ok: true, configuration: await getBridgeConfiguration() });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid heartbeat" }, { status: 400 });
    return renderApiError(error);
  }
}

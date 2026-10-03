import { z } from "zod";

import { noStoreJson, renderApiError } from "@/lib/render/api";
import { listCloudRenderQueue, reorderCloudRenderQueue, requireWebRenderAccess } from "@/lib/render/server";
import { auditAdminAction } from "@/services/admin-log";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireWebRenderAccess(request);
    return noStoreJson({ jobs: await listCloudRenderQueue() });
  } catch (error) {
    return renderApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireWebRenderAccess(request);
    const input = z.object({ jobIds: z.array(z.string().uuid()).max(100) }).parse(await request.json());
    const jobs = await reorderCloudRenderQueue(input.jobIds);
    await auditAdminAction({ source: "web", action: "reorder-render-queue", summary: `${input.jobIds.length}件のレンダー優先順を変更しました。` });
    return noStoreJson({ jobs });
  } catch (error) {
    return renderApiError(error);
  }
}

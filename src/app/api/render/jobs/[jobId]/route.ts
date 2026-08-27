import { z } from "zod";

import { noStoreJson, renderApiError } from "@/lib/render/api";
import {
  cancelCloudRenderJob,
  getCloudRenderJob,
  publicJob,
  RenderApiError,
  requireJobToken,
} from "@/lib/render/server";

const idSchema = z.string().uuid();

async function findAuthorized(request: Request, id: string) {
  if (!idSchema.safeParse(id).success) {
    throw new RenderApiError("JOB_NOT_FOUND", "レンダージョブが見つかりません。", 404);
  }
  const job = await getCloudRenderJob(id);
  if (!job) throw new RenderApiError("JOB_NOT_FOUND", "レンダージョブが見つかりません。", 404);
  requireJobToken(request, job);
  return job;
}

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    return noStoreJson({ job: publicJob(await findAuthorized(request, jobId)) });
  } catch (error) {
    return renderApiError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    const job = await findAuthorized(request, jobId);
    if (["completed", "failed", "cancelled"].includes(job.status)) {
      return noStoreJson({ job: publicJob(job) });
    }
    return noStoreJson({ job: publicJob(await cancelCloudRenderJob(job)) });
  } catch (error) {
    return renderApiError(error);
  }
}

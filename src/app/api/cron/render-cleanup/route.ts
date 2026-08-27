import { del } from "@vercel/blob";

import { deleteCloudRenderJobs, expiredCloudRenderJobs } from "@/lib/render/server";

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const expired = await expiredCloudRenderJobs();
  const urls = expired.flatMap((job) => job.videoUrl ? [job.videoUrl] : []);
  if (urls.length) await del(urls, { token: process.env.BLOB_READ_WRITE_TOKEN });
  await deleteCloudRenderJobs(expired.map((job) => job.id));
  return Response.json({ ok: true, deletedJobs: expired.length, deletedBlobs: urls.length });
}

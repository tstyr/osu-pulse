import { z } from "zod";

import { createCloudCompositionJob } from "@/db/render-queue-repository";
import { hasControlPanelSession } from "@/lib/control/auth";
import { getControlSettings } from "@/lib/control/settings";

const inputSchema = z.object({
  kind: z.enum(["same-beatmap", "versus"]),
  firstUrl: z.string().url().max(2_000),
  secondUrl: z.string().url().max(2_000),
});

export async function POST(request: Request) {
  if (!(await hasControlPanelSession())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "2件のosu! Score URLを確認してください。" }, { status: 400 });
  try {
    const input = parsed.data;
    const settings = await getControlSettings();
    const job = await createCloudCompositionJob({
      kind: "comparison",
      comparisonMode: input.kind,
      title: input.kind === "same-beatmap" ? "Old vs New Comparison" : "Player vs Player",
      scoreUrls: [input.firstUrl, input.secondUrl],
      options: settings.values.renderDefaults,
    });
    return Response.json({ ok: true, jobId: job.id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "比較レンダーを作成できませんでした。" }, { status: 409 });
  }
}

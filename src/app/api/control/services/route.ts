import { z } from "zod";

import { enqueueServiceRestart, listServiceControlCommands } from "@/db/service-control-repository";
import { hasControlPanelSession } from "@/lib/control/auth";

const inputSchema = z.object({ service: z.enum(["bot", "renderer", "lavalink"]), action: z.literal("restart") });

export async function GET() {
  if (!(await hasControlPanelSession())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const commands = await listServiceControlCommands();
  return Response.json({ commands: commands.map((command) => ({
    ...command,
    requestedAt: command.requestedAt.toISOString(),
    claimedAt: command.claimedAt?.toISOString() ?? null,
    completedAt: command.completedAt?.toISOString() ?? null,
  })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!(await hasControlPanelSession())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "サービス名を確認してください。" }, { status: 400 });
  const command = await enqueueServiceRestart(parsed.data.service);
  return Response.json({ ok: true, commandId: command?.id }, { status: 202 });
}

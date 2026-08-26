import { start } from "workflow/api";
import { z } from "zod";

import { setFocusWorkflowRun, setReminderWorkflowRun } from "@/db/repository";
import { pomodoroWorkflow } from "@/workflows/pomodoro";
import { reminderWorkflow } from "@/workflows/reminder";

const requestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reminder"), reminderId: z.string().uuid(), dueAt: z.string().datetime() }),
  z.object({ type: z.literal("pomodoro"), sessionId: z.string().uuid() }),
]);

export async function POST(request: Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.type === "reminder") {
    const run = await start(reminderWorkflow, [parsed.data.reminderId, parsed.data.dueAt]);
    await setReminderWorkflowRun(parsed.data.reminderId, run.runId);
    return Response.json({ runId: run.runId });
  }

  const run = await start(pomodoroWorkflow, [parsed.data.sessionId]);
  await setFocusWorkflowRun(parsed.data.sessionId, run.runId);
  return Response.json({ runId: run.runId });
}

import { hasControlPanelSession } from "@/lib/control/auth";
import { getCommandCenterView } from "@/lib/control/command-center";

export async function GET() {
  if (!(await hasControlPanelSession())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await getCommandCenterView(), { headers: { "Cache-Control": "no-store, max-age=0" } });
}

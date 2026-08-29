import { getDashboardOverview } from "@/lib/control/dashboard";
import { hasControlPanelSession } from "@/lib/control/auth";

export async function GET() {
  if (!(await hasControlPanelSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(await getDashboardOverview(), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

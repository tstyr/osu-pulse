import { getPlayerStatisticsDataset } from "@/lib/control/statistics";
import { hasControlPanelSession } from "@/lib/control/auth";

export async function GET() {
  if (!(await hasControlPanelSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return Response.json(await getPlayerStatisticsDataset(), {
    headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=15" },
  });
}

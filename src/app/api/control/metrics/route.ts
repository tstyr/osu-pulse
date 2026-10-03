import { getSystemMetricHistory } from "@/db/advanced-features";
import { hasControlPanelSession } from "@/lib/control/auth";

export async function GET(request: Request) {
  if (!(await hasControlPanelSession())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const hours = Number.parseInt(new URL(request.url).searchParams.get("hours") ?? "24", 10);
  return Response.json({ samples: await getSystemMetricHistory(hours) }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

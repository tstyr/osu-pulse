import { BOT_STATISTICS_RANGES, type BotStatisticsRange } from "@/lib/bot-statistics";
import { hasControlPanelSession } from "@/lib/control/auth";
import { getBotStatistics } from "@/services/bot-statistics";

const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  if (!(await hasControlPanelSession())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const range = params.get("range") ?? "today";
  const scope = params.get("scope") ?? "global";
  if (!BOT_STATISTICS_RANGES.includes(range as BotStatisticsRange) || !/^(global|guild:\d{17,20})$/.test(scope)) {
    return Response.json({ error: "Invalid statistics range or scope" }, { status: 400, headers });
  }
  try {
    return Response.json(await getBotStatistics({ range: range as BotStatisticsRange, scope }), { headers });
  } catch {
    return Response.json({ error: "Bot統計を取得できませんでした。接続を確認して再試行してください。" }, { status: 503, headers });
  }
}

import { botWeeklyReportSettingsSchema } from "@/lib/bot-weekly-report";
import { hasControlPanelSession } from "@/lib/control/auth";
import { publicAppOrigin } from "@/lib/public-app-url";
import { BotWeeklyReportDestinationError, getBotWeeklyReportConfiguration, saveBotWeeklyReportSettings } from "@/services/bot-weekly-report";

const headers = { "Cache-Control": "private, no-store, max-age=0" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return false;
  try {
    const parsed = new URL(origin);
    return origin === parsed.origin && [new URL(request.url).origin, publicAppOrigin()].includes(parsed.origin);
  } catch { return false; }
}

export async function GET() {
  if (!(await hasControlPanelSession())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    return Response.json(await getBotWeeklyReportConfiguration(), { headers });
  } catch {
    return Response.json({ error: "週報設定を取得できませんでした。再試行してください。" }, { status: 503, headers });
  }
}

export async function PUT(request: Request) {
  if (!(await hasControlPanelSession())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!sameOrigin(request)) return Response.json({ error: "この画面から設定を保存してください。" }, { status: 403, headers });
  const parsed = botWeeklyReportSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "送信先・曜日・時刻を確認してください。" }, { status: 400, headers });
  try {
    return Response.json(await saveBotWeeklyReportSettings(parsed.data), { headers });
  } catch (error) {
    const destination = error instanceof BotWeeklyReportDestinationError;
    return Response.json({ error: destination ? error.message : "週報設定を保存できませんでした。再試行してください。" }, { status: destination ? 400 : 503, headers });
  }
}

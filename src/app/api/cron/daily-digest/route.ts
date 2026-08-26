import { sendDailyDigests } from "@/services/daily-digest";
import { refreshAllAccounts } from "@/services/osu-sync";

export const maxDuration = 300;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sync = await refreshAllAccounts();
  const digest = await sendDailyDigests();
  return Response.json({ ok: true, synced: sync.length, digest });
}

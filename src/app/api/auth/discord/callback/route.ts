import { completeDiscordOAuth } from "@/lib/control/discord-oauth";
import { recordAdminAudit } from "@/db/feature-repository";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return Response.redirect(new URL("/?oauth=cancelled", request.url), 302);
  try {
    const user = await completeDiscordOAuth({ code, state });
    await recordAdminAudit({
      actorDiscordUserId: user.id,
      source: "web",
      action: "discord-oauth-login",
      summary: `${user.global_name || user.username} がDiscord OAuthでログインしました。`,
    });
    return Response.redirect(new URL("/dashboard", request.url), 302);
  } catch (error) {
    console.error("[auth] Discord OAuth failed:", error);
    return Response.redirect(new URL("/?oauth=denied", request.url), 302);
  }
}

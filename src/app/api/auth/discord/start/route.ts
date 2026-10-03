import { createDiscordAuthorizationUrl } from "@/lib/control/discord-oauth";

export async function GET(request: Request) {
  try {
    return Response.redirect(await createDiscordAuthorizationUrl(), 302);
  } catch {
    return Response.redirect(new URL("/?oauth=not-configured", request.url), 302);
  }
}

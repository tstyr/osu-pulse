import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

import { inArray } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb } from "@/db";
import { guildSettings } from "@/db/schema";
import { createControlPanelSession } from "@/lib/control/auth";
import { publicAppOrigin } from "@/lib/public-app-url";

const STATE_COOKIE = "osu_pulse_discord_state";
const STATE_SECONDS = 10 * 60;
const ADMINISTRATOR = BigInt(1) << BigInt(3);
const MANAGE_GUILD = BigInt(1) << BigInt(5);

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
};

type DiscordGuild = {
  id: string;
  owner?: boolean;
  permissions?: string;
};

function oauthBaseUrl() {
  return publicAppOrigin();
}

export function discordOAuthConfigured() {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

export function discordRedirectUri() {
  return `${oauthBaseUrl()}/api/auth/discord/callback`;
}

function sameValue(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createDiscordAuthorizationUrl() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId || !process.env.DISCORD_CLIENT_SECRET) throw new Error("Discord OAuth is not configured");
  const state = randomBytes(32).toString("base64url");
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/discord",
    maxAge: STATE_SECONDS,
    priority: "high",
  });
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: discordRedirectUri(),
    scope: "identify guilds",
    state,
  });
  return `https://discord.com/oauth2/authorize?${query}`;
}

async function discordApi<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Discord API request failed (${response.status})`);
  return await response.json() as T;
}

async function isAuthorizedDiscordAdmin(userId: string, guilds: DiscordGuild[]) {
  const explicit = new Set((process.env.CONTROL_PANEL_DISCORD_ADMIN_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
  if (explicit.has(userId)) return true;
  const manageableGuildIds = guilds.filter((guild) => {
    if (guild.owner) return true;
    try {
      const permissions = BigInt(guild.permissions ?? "0");
      return Boolean(permissions & ADMINISTRATOR) || Boolean(permissions & MANAGE_GUILD);
    } catch {
      return false;
    }
  }).map((guild) => guild.id);
  if (!manageableGuildIds.length) return false;
  const configured = await getDb().select({ guildId: guildSettings.guildId })
    .from(guildSettings)
    .where(inArray(guildSettings.guildId, manageableGuildIds));
  return configured.length > 0;
}

export async function completeDiscordOAuth(input: { code: string; state: string }) {
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);
  if (!expectedState || !sameValue(input.state, expectedState)) throw new Error("OAuth state is invalid or expired");
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Discord OAuth is not configured");
  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: discordRedirectUri(),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`Discord token exchange failed (${tokenResponse.status})`);
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) throw new Error("Discord access token is missing");
  const [user, guilds] = await Promise.all([
    discordApi<DiscordUser>("/users/@me", token.access_token),
    discordApi<DiscordGuild[]>("/users/@me/guilds", token.access_token),
  ]);
  if (!(await isAuthorizedDiscordAdmin(user.id, guilds))) throw new Error("このDiscordアカウントには管理権限がありません");
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : null;
  await createControlPanelSession({
    authMethod: "discord",
    discordUserId: user.id,
    discordUsername: user.global_name || user.username,
    discordAvatarUrl: avatarUrl,
  });
  return user;
}
